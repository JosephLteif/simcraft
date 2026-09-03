import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL, fetchJson } from '../lib/api';
import type { SeasonConfigResponse, DungeonCategory } from '../lib/types';
import { parseCharacterInfo } from '../../lib/simc-parser';
import {
  detectClass,
  detectSpec,
  normalizeUpgradeTracks,
  type DropItem,
  type Instance,
  type UpgradeTracks,
} from './types';
import { coerceDropsResponse, FALLBACK_SEASON_CONFIG, parseInstanceSelectionIds } from './utils';

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error;
  return error instanceof Error && error.message ? error.message : fallback;
}

export function useDropFinderData(simcInput: string, activeSpecs: Set<string>) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [seasonConfig, setSeasonConfig] = useState<SeasonConfigResponse | null>(
    FALLBACK_SEASON_CONFIG
  );
  const [upgradeTracks, setUpgradeTracks] = useState<UpgradeTracks>({});
  const [selectedId, setSelectedId] = useState('');
  const [drops, setDrops] = useState<Record<string, DropItem[]> | null>(null);
  const [loading, setLoading] = useState(false);
  const [dropState, setDropState] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>(
    'idle'
  );
  const [dropError, setDropError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogReloadKey, setCatalogReloadKey] = useState(0);
  const dropRequestIdRef = useRef(0);

  const parsedCharacter = useMemo(() => parseCharacterInfo(simcInput), [simcInput]);
  const className = useMemo(() => {
    const detected = detectClass(simcInput);
    if (detected) return detected;
    if (parsedCharacter?.kind !== 'character') return null;
    const raw = parsedCharacter.className.trim().toLowerCase();
    if (!raw) return null;
    if (raw === 'deathknight') return 'death_knight';
    if (raw === 'demonhunter') return 'demon_hunter';
    return raw.replace(/[\s-]+/g, '_');
  }, [simcInput, parsedCharacter]);

  const specName = useMemo(() => {
    const detected = detectSpec(simcInput);
    if (detected) return detected;
    if (parsedCharacter?.kind !== 'character' || parsedCharacter.spec === 'unknown') return null;
    return parsedCharacter.spec
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
  }, [simcInput, parsedCharacter]);

  const specParam = useMemo(() => [...activeSpecs].sort().join(','), [activeSpecs]);

  useEffect(() => {
    let cancelled = false;

    async function fetchWithRetries<T>(url: string, attempts: number, delayMs: number): Promise<T> {
      let lastError: unknown = new Error('Request failed');
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          return await fetchJson<T>(url);
        } catch (error) {
          lastError = error;
          if (attempt + 1 < attempts) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs * (attempt + 1)));
          }
        }
      }
      throw lastError;
    }

    setCatalogLoading(true);
    setCatalogError(null);

    const loadCatalog = async () => {
      const [seasonResult, tracksResult, instancesResult] = await Promise.allSettled([
        fetchWithRetries<SeasonConfigResponse>(`${API_URL}/api/season-config`, 3, 400),
        fetchWithRetries<unknown>(`${API_URL}/api/upgrade-tracks`, 5, 350).then((data) => {
          const normalized = normalizeUpgradeTracks(data);
          if (Object.keys(normalized).length === 0) {
            throw new Error('Upgrade-track data was empty.');
          }
          return normalized;
        }),
        fetchWithRetries<Instance[]>(`${API_URL}/api/instances`, 3, 400),
      ]);

      if (cancelled) return;

      const failures: string[] = [];
      if (seasonResult.status === 'fulfilled') setSeasonConfig(seasonResult.value);
      else failures.push('season configuration');
      if (tracksResult.status === 'fulfilled') setUpgradeTracks(tracksResult.value);
      else failures.push('upgrade tracks');
      if (instancesResult.status === 'fulfilled') setInstances(instancesResult.value);
      else failures.push('raid and dungeon catalog');

      setCatalogError(
        failures.length > 0
          ? `Could not load ${failures.join(', ')}. Some drop-finder options may be unavailable.`
          : null
      );
      setCatalogLoading(false);
    };

    void loadCatalog();

    return () => {
      cancelled = true;
    };
  }, [catalogReloadKey]);

  const { raids, dungeonCats } = useMemo(() => {
    if (!seasonConfig) {
      return {
        raids: [] as Instance[],
        dungeonCats: [] as { cat: DungeonCategory; instances: Instance[] }[],
      };
    }

    const currentSeasonInstances = instances.filter(
      (instance) => instance.id <= 0 || instance.current_season === true
    );
    const poolMap = new Map<number, Set<number>>();
    for (const cat of seasonConfig.dungeon_categories) {
      const meta = currentSeasonInstances.find((instance) => instance.id === cat.poolInstanceId);
      if (meta) {
        poolMap.set(cat.poolInstanceId, new Set(meta.encounters.map((encounter) => encounter.id)));
      }
    }

    const raidList: Instance[] = [];
    const dcList: { cat: DungeonCategory; instances: Instance[] }[] =
      seasonConfig.dungeon_categories.map((cat) => ({ cat, instances: [] }));

    for (const instance of currentSeasonInstances) {
      if (instance.type === 'raid' && instance.id > 0) {
        raidList.push(instance);
      } else if (instance.type === 'dungeon') {
        let placed = false;
        for (const dc of dcList) {
          const pool = poolMap.get(dc.cat.poolInstanceId);
          if (pool?.has(instance.id)) {
            dc.instances.push(instance);
            placed = true;
          }
        }
        if (!placed && dcList.length > 0 && instance.id > 0) {
          dcList[dcList.length - 1].instances.push(instance);
        }
      }
    }

    // Older data snapshots do not contain the synthetic -32 normal-dungeon
    // pool. Keep that tab useful by showing the current-season dungeon set
    // directly instead of falling back to every historical dungeon.
    const normalDungeonCategory = dcList.find((dc) => dc.cat.key === 'normal-dungeons');
    if (normalDungeonCategory && !poolMap.has(normalDungeonCategory.cat.poolInstanceId)) {
      normalDungeonCategory.instances = currentSeasonInstances.filter(
        (instance) => instance.type === 'dungeon' && instance.id > 0
      );
    }

    raidList.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const dc of dcList) {
      dc.instances.sort((a, b) => a.name.localeCompare(b.name));
    }

    return { raids: raidList, dungeonCats: dcList };
  }, [instances, seasonConfig]);

  useEffect(() => {
    const requestId = ++dropRequestIdRef.current;
    const isCurrentRequest = () => dropRequestIdRef.current === requestId;

    if (!selectedId) {
      setDrops(null);
      setLoading(false);
      setDropState('idle');
      setDropError(null);
      return () => {
        if (isCurrentRequest()) dropRequestIdRef.current += 1;
      };
    }

    setLoading(true);
    setDropState('loading');
    setDropError(null);
    const params = new URLSearchParams();
    if (className) params.set('class_name', className);
    if (specParam) params.set('spec', specParam);

    let url = '';
    if (selectedId.startsWith('type:')) {
      url = `${API_URL}/api/instances/type/${selectedId.slice(5)}/drops`;
    } else if (selectedId.startsWith('ids:')) {
      const ids = parseInstanceSelectionIds(selectedId)
        .filter((id) => id !== '-1' && id !== '-32')
        .join(',');
      if (!ids) {
        setDrops(null);
        setLoading(false);
        setDropState('empty');
        setDropError(null);
        return () => {
          if (isCurrentRequest()) dropRequestIdRef.current += 1;
        };
      }
      params.set('ids', ids);
      url = `${API_URL}/api/instances/drops`;
    } else {
      url = `${API_URL}/api/instances/${selectedId}/drops`;
    }

    const query = params.toString();
    fetchJson<unknown>(`${url}${query ? `?${query}` : ''}`)
      .then((data) => {
        if (!isCurrentRequest()) return;
        const maybeDetail = (data as { detail?: unknown })?.detail;
        if (maybeDetail) {
          throw new Error(errorMessage(maybeDetail, 'The drop list could not be loaded.'));
        }
        const nextDrops = coerceDropsResponse(data);
        setDrops(nextDrops);
        setDropState(nextDrops ? 'ready' : 'empty');
      })
      .catch((error) => {
        if (!isCurrentRequest()) return;
        setDrops(null);
        setDropState('error');
        setDropError(errorMessage(error, 'Could not load drops for this selection.'));
      })
      .finally(() => {
        if (isCurrentRequest()) setLoading(false);
      });

    return () => {
      if (isCurrentRequest()) dropRequestIdRef.current += 1;
    };
  }, [selectedId, className, specParam]);

  const retryCatalog = useCallback(() => {
    setCatalogReloadKey((key) => key + 1);
  }, []);

  return {
    instances,
    seasonConfig,
    upgradeTracks,
    selectedId,
    setSelectedId,
    drops,
    loading,
    dropState,
    dropError,
    catalogLoading,
    catalogError,
    retryCatalog,
    raids,
    dungeonCats,
    className,
    specName,
  };
}

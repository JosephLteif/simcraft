'use client';

import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { API_URL, fetchJson, fetchJsonCached } from '../lib/api';
import DpsHeroCard from './DpsHeroCard';
import ResultInsights, { MeaningfulDifferenceIndicator } from './ResultInsights';
import GearOverview from './GearOverview';
import SimStatsComparisonCard from './SimStatsComparisonCard';
import type { StatSnapshot } from '../lib/stat-snapshot';
import { buildExactTopGearSimInput, getTopGearProfilesetName } from '../lib/top-gear-exact-stats';
import type { ItemInfo, ItemQuery } from '../lib/useItemInfo';
import { useEnchantInfo, useGemInfo, useItemInfo } from '../lib/useItemInfo';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ResultItem, TopGearResult } from '../lib/types';
import { useTopGearResults } from './top-gear-results/useTopGearResults';
import { useAuth } from './AuthContext';
import RankedResults, { ResultList } from './top-gear-results/RankedResults';
import SimResultTalentsCard from './SimResultTalentsCard';
import { addItemsToWishlist, buildWishlistOwnerKey, isWishlisted, removeFromWishlist } from '../lib/wishlist';
import type { DropItem, Instance } from '../drop-finder/types';
import { trackSimulations } from '../lib/sim-tracking';

interface TopGearResultsProps {
  parentSimId?: string;
  playerName: string;
  playerClass: string;
  playerRealm?: string;
  playerRegion?: string;
  baseDps: number;
  results: TopGearResult[];
  equippedGear?: Record<string, ResultItem>;
  dpsError?: number;
  dpsErrorPct?: number;
  fightLength?: number;
  desiredTargets?: number;
  iterations?: number;
  targetError?: number;
  elapsedTime?: number;
  stageTimings?: Array<{ name: string; elapsed: number }>;
  talentString?: string;
  currencies?: Record<string, { id: number; name: string; icon: string }>;
  enableWishlistActions?: boolean;
  baselineLiveStats?: StatSnapshot | null;
  simulatedStats?: StatSnapshot | null;
  generatedInput?: string;
  simOptions?: Record<string, unknown> | null;
}

interface ExactStatsCacheEntry {
  status: 'idle' | 'loading' | 'ready' | 'error';
  simulatedStats?: StatSnapshot | null;
  jobId?: string;
  error?: string;
}

function dropBaselineKey(item: ResultItem): string {
  const slot = String(item.slot || '').toLowerCase();
  const itemId = Number(item.item_id || 0);
  const sourceType = String(item.source_type || '')
    .toLowerCase()
    .trim();
  const instance = String(item.instance_name || '')
    .toLowerCase()
    .trim();
  const encounter = String(item.encounter || '')
    .toLowerCase()
    .trim();
  return `${slot}:${itemId}:${sourceType}:${instance}:${encounter}`;
}

function extractTierLevelLabel(item?: { upgrade?: string; tag?: string }): string {
  if (!item) return '';
  const candidates = [String(item.upgrade || ''), String(item.tag || '')];
  for (const candidate of candidates) {
    const segments = candidate
      .split(/\s*->\s*/)
      .map((segment) => segment.trim())
      .filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const match = segments[i].match(/^([A-Za-z]+)\s+(\d+)\s*\/\s*(\d+)$/);
      if (match) {
        return `${match[1]} ${match[2]}/${match[3]}`;
      }
    }
  }
  return '';
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between border-b border-border/60 bg-white/[0.01] px-5 py-3.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        <span className="text-xs font-medium uppercase tracking-widest text-muted">{title}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-zinc-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          strokeWidth={2}
        />
      </button>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}

function buildExactStatsRequest(
  simcInput: string,
  simOptions: Record<string, unknown> | null | undefined,
  parentSimId?: string
): Record<string, unknown> {
  return {
    simc_input: simcInput,
    ...(simOptions || {}),
    sim_type: 'top_gear_exact_stats',
    include_timeline: false,
    batch_id: parentSimId || undefined,
  };
}

async function waitForExactStats(jobId: string): Promise<StatSnapshot | null> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const job = await fetchJson<{
      status: string;
      result: Record<string, unknown> | null;
      error?: string | null;
    }>(`${API_URL}/api/sim/${jobId}`);
    if (job.status === 'done') {
      return (job.result?.simulated_stats as StatSnapshot | undefined) || null;
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new Error(job.error || 'Exact stats simulation failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('Exact stats simulation timed out');
}

async function linkSimToParentCharacter(params: {
  jobId: string;
  name?: string;
  realm?: string;
  region?: string;
}): Promise<void> {
  const name = (params.name || '').trim();
  const realm = (params.realm || '').trim();
  const region = (params.region || '').trim().toLowerCase();
  if (!name || !realm || !region) return;
  try {
    await fetchJson(`${API_URL}/api/sim/${params.jobId}/link`, {
      method: 'POST',
      body: JSON.stringify({ name, realm, region }),
    });
  } catch {
    // Keep sim usable even when linking fails (e.g. unauthenticated web mode).
  }
}

export default function TopGearResults({
  parentSimId,
  playerName,
  playerClass,
  playerRealm,
  playerRegion,
  baseDps,
  results,
  equippedGear,
  dpsError,
  dpsErrorPct,
  fightLength,
  desiredTargets,
  iterations,
  targetError,
  elapsedTime,
  stageTimings,
  talentString,
  currencies,
  enableWishlistActions = false,
  simulatedStats,
  generatedInput,
  simOptions,
}: TopGearResultsProps) {
  const { lightMode } = useAuth();
  const router = useRouter();
  const exactStatsStorageKey = useMemo(
    () => `top_gear_exact_stats_jobs_${parentSimId || 'unknown'}`,
    [parentSimId]
  );
  const {
    groupMode,
    setGroupMode,
    selectedResultName,
    setSelectedResultName,
    selectedResult,
    groupedResults,
    bestGearSet,
    baseAvgIlevel,
    selectedAvgIlevel,
    upgradeSlots,
    downgradeSlots,
    hasGroupingData,
  } = useTopGearResults({ results, equippedGear, baseDps });

  const maxDps = results.length > 0 ? results[0].dps : baseDps;

  const allItemQueries = useMemo(() => {
    const seen = new Set<string>();
    const queries: ItemQuery[] = [];
    const addItem = (it: { item_id: number; bonus_ids?: number[] }) => {
      if (it.item_id <= 0) return;
      const key = `${it.item_id}:${(it.bonus_ids || []).sort().join(':')}`;
      if (!seen.has(key)) {
        seen.add(key);
        queries.push({ item_id: it.item_id, bonus_ids: it.bonus_ids });
      }
    };
    for (const r of results) {
      for (const it of r.items) addItem(it);
    }
    if (equippedGear) {
      for (const it of Object.values(equippedGear)) addItem(it);
    }
    return queries;
  }, [results, equippedGear]);

  const itemInfoMap = useItemInfo(allItemQueries);

  const allEnchantIds = useMemo(() => {
    const ids = new Set<number>();
    const addEnchant = (id?: number) => {
      if (id && id > 0) ids.add(id);
    };
    for (const r of results) {
      for (const it of r.items) addEnchant(it.enchant_id);
    }
    if (equippedGear) {
      for (const it of Object.values(equippedGear)) addEnchant(it.enchant_id);
    }
    return [...ids];
  }, [results, equippedGear]);

  const enchantInfoMap = useEnchantInfo(allEnchantIds);

  const allGemIds = useMemo(() => {
    const ids = new Set<number>();
    const addGem = (id?: number) => {
      if (id && id > 0) ids.add(id);
    };
    for (const r of results) {
      for (const it of r.items) addGem(it.gem_id);
    }
    if (equippedGear) {
      for (const it of Object.values(equippedGear)) addGem(it.gem_id);
    }
    return [...ids];
  }, [results, equippedGear]);

  const gemInfoMap = useGemInfo(allGemIds);
  useWowheadTooltips([itemInfoMap]);
  const equippedUpgradeQueries = useMemo(() => {
    if (!equippedGear) return [];
    return Object.values(equippedGear)
      .filter((item) => Number(item.item_id || 0) > 0)
      .map((item) => ({
        slot: item.slot,
        item_id: Number(item.item_id || 0),
        bonus_ids: item.bonus_ids || [],
      }));
  }, [equippedGear]);
  const [exactEquippedTierBySlot, setExactEquippedTierBySlot] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    if (equippedUpgradeQueries.length === 0) {
      setExactEquippedTierBySlot({});
      return;
    }

    Promise.all(
      equippedUpgradeQueries.map(async (item) => {
        const params = new URLSearchParams();
        if (item.bonus_ids.length > 0) params.set('bonus_ids', item.bonus_ids.join(','));
        const info = await fetchJsonCached<ItemInfo>(
          `${API_URL}/api/item-info/${item.item_id}?${params}`,
          { usePersistentCache: true, ttl: 86400000 }
        );
        return [item.slot, extractTierLevelLabel(info)] as const;
      })
    )
      .then((entries) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const [slot, tier] of entries) {
          if (tier) next[slot] = tier;
        }
        setExactEquippedTierBySlot(next);
      })
      .catch(() => {
        if (!cancelled) setExactEquippedTierBySlot({});
      });

    return () => {
      cancelled = true;
    };
  }, [equippedUpgradeQueries]);
  const baselineTierBySlot = useMemo(() => {
    const bySlot: Record<string, string> = { ...exactEquippedTierBySlot };
    if (equippedGear) {
      for (const item of Object.values(equippedGear)) {
        const tier = extractTierLevelLabel(item);
        if (tier && !bySlot[item.slot]) bySlot[item.slot] = tier;
      }
    }
    const equippedResult = results.find(
      (r) => r.items.length === 0 || r.name.startsWith('Currently Equipped')
    );
    for (const item of equippedResult?.items || []) {
      const tier = extractTierLevelLabel(item);
      if (tier && !bySlot[item.slot]) bySlot[item.slot] = tier;
    }
    return bySlot;
  }, [equippedGear, exactEquippedTierBySlot, results]);
  const dropBaselineIlevelByKey = useMemo(() => {
    const baseline: Record<string, number> = {};
    for (const r of results) {
      for (const it of r.items) {
        if (it.is_kept || it.item_id <= 0) continue;
        const key = dropBaselineKey(it);
        const ilvl = Number(it.ilevel || 0);
        if (ilvl <= 0) continue;
        if (!baseline[key] || ilvl < baseline[key]) baseline[key] = ilvl;
      }
    }
    return baseline;
  }, [results]);

  const hasGearOverview = equippedGear && Object.keys(equippedGear).length > 0;
  const [wishlistFeedback, setWishlistFeedback] = useState('');
  const [sourceInstances, setSourceInstances] = useState<Instance[]>([]);
  const [wishlistRefreshTick, setWishlistRefreshTick] = useState(0);
  const wishlistOwnerKey = useMemo(
    () =>
      buildWishlistOwnerKey({
        name: playerName,
        realm: playerRealm,
        region: playerRegion,
        className: playerClass,
      }),
    [playerName, playerRealm, playerRegion, playerClass]
  );

  const [exactStatsCache, setExactStatsCache] = useState<Record<string, ExactStatsCacheEntry>>({});
  const [cachedExactJobIds, setCachedExactJobIds] = useState<Record<string, string>>({});
  const [slotFilter, setSlotFilter] = useState<string>('all');
  const warmStartedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchJson<Instance[]>(`${API_URL}/api/instances`)
      .then((response) => {
        if (cancelled) return;
        setSourceInstances(Array.isArray(response) ? response : []);
      })
      .catch(() => {
        if (cancelled) return;
        setSourceInstances([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadExactStats = useCallback(
    async (result: TopGearResult) => {
      const profilesetName = getTopGearProfilesetName(result);
      if (!profilesetName || !generatedInput) return;

      if (typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem(exactStatsStorageKey);
          const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
          const existingJobId = map[profilesetName];
          if (existingJobId) {
            setExactStatsCache((prev) => ({
              ...prev,
              [profilesetName]: {
                status: 'loading',
                simulatedStats: prev[profilesetName]?.simulatedStats,
                jobId: existingJobId,
              },
            }));
            const exactStats = await waitForExactStats(existingJobId);
            if (exactStats) {
              setExactStatsCache((prev) => ({
                ...prev,
                [profilesetName]: {
                  status: 'ready',
                  simulatedStats: exactStats,
                  jobId: existingJobId,
                },
              }));
              return;
            }
          }
        } catch {
          // ignore storage parse issues
        }
      }

      setExactStatsCache((prev) => {
        const existing = prev[profilesetName];
        if (existing?.status === 'loading' || existing?.status === 'ready') {
          return prev;
        }
        return {
          ...prev,
          [profilesetName]: {
            status: 'loading',
            simulatedStats: existing?.simulatedStats,
            jobId: existing?.jobId,
          },
        };
      });

      try {
        const exactInput = buildExactTopGearSimInput(generatedInput, profilesetName);
        if (!exactInput) {
          throw new Error('Could not build the selected Top Gear profile for an exact stat sim.');
        }

        const created = await fetchJson<{ id: string }>(`${API_URL}/api/sim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildExactStatsRequest(exactInput, simOptions, parentSimId)),
        });
        trackSimulations([{ id: created.id, simType: 'top_gear_exact_stats', playerName }]);
        await linkSimToParentCharacter({
          jobId: created.id,
          name: playerName,
          realm: playerRealm,
          region: playerRegion,
        });
        const exactStats = await waitForExactStats(created.id);
        if (!exactStats) {
          throw new Error('Exact stat simulation finished without a stat snapshot.');
        }

        setExactStatsCache((prev) => ({
          ...prev,
          [profilesetName]: {
            status: 'ready',
            simulatedStats: exactStats,
            jobId: created.id,
          },
        }));
        if (typeof window !== 'undefined') {
          try {
            const raw = localStorage.getItem(exactStatsStorageKey);
            const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
            map[profilesetName] = created.id;
            localStorage.setItem(exactStatsStorageKey, JSON.stringify(map));
          } catch {
            // ignore storage write issues
          }
        }
      } catch (error) {
        setExactStatsCache((prev) => ({
          ...prev,
          [profilesetName]: {
            status: 'error',
            error: error instanceof Error ? error.message : 'Failed to load exact stats.',
          },
        }));
      }
    },
    [generatedInput, exactStatsStorageKey, simOptions, parentSimId, playerName, playerRealm, playerRegion],
  );

  const openOrStartExactStats = useCallback(
    async (result: TopGearResult) => {
      const isEquipped = result.items.length === 0 || result.name.startsWith('Currently Equipped');
      if (isEquipped) return;
      const profilesetName = getTopGearProfilesetName(result);
      if (!profilesetName || !generatedInput) return;

      const cachedJobId =
        cachedExactJobIds[profilesetName] || exactStatsCache[profilesetName]?.jobId;
      if (cachedJobId) {
        router.push(`/sim/${cachedJobId}`);
        return;
      }

      setExactStatsCache((prev) => ({
        ...prev,
        [profilesetName]: {
          status: 'loading',
          simulatedStats: prev[profilesetName]?.simulatedStats,
        },
      }));

      try {
        const exactInput = buildExactTopGearSimInput(generatedInput, profilesetName);
        if (!exactInput) throw new Error('Could not build selected profile.');
        const created = await fetchJson<{ id: string }>(`${API_URL}/api/sim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildExactStatsRequest(exactInput, simOptions, parentSimId)),
        });
        trackSimulations([{ id: created.id, simType: 'top_gear_exact_stats', playerName }]);
        await linkSimToParentCharacter({
          jobId: created.id,
          name: playerName,
          realm: playerRealm,
          region: playerRegion,
        });
        setExactStatsCache((prev) => ({
          ...prev,
          [profilesetName]: {
            ...(prev[profilesetName] || {}),
            status: 'loading',
            jobId: created.id,
          },
        }));
        setCachedExactJobIds((prev) => ({ ...prev, [profilesetName]: created.id }));
        if (typeof window !== 'undefined') {
          try {
            const raw = localStorage.getItem(exactStatsStorageKey);
            const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
            map[profilesetName] = created.id;
            localStorage.setItem(exactStatsStorageKey, JSON.stringify(map));
          } catch {}
        }
        router.push(`/sim/${created.id}`);
      } catch (error) {
        setExactStatsCache((prev) => ({
          ...prev,
          [profilesetName]: {
            status: 'error',
            error: error instanceof Error ? error.message : 'Failed to start stats sim.',
          },
        }));
      }
    },
    [
      cachedExactJobIds,
      exactStatsCache,
      generatedInput,
      simOptions,
      parentSimId,
      playerName,
      playerRealm,
      playerRegion,
      exactStatsStorageKey,
      router,
    ]
  );

  useEffect(() => {
    if (warmStartedRef.current) return;
    warmStartedRef.current = true;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(exactStatsStorageKey);
      const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      setCachedExactJobIds(map);
    } catch {
      setCachedExactJobIds({});
    }
  }, [exactStatsStorageKey]);

  useEffect(() => {
    if (!generatedInput || results.length === 0) return;
    for (const result of results) {
      const profilesetName = getTopGearProfilesetName(result);
      if (!profilesetName) continue;
      const cachedJobId = cachedExactJobIds[profilesetName];
      if (!cachedJobId) continue;
      const current = exactStatsCache[profilesetName];
      if (current?.status === 'ready' || current?.status === 'loading') continue;

      setExactStatsCache((prev) => ({
        ...prev,
        [profilesetName]: {
          status: 'loading',
          simulatedStats: prev[profilesetName]?.simulatedStats,
          jobId: cachedJobId,
        },
      }));

      void waitForExactStats(cachedJobId)
        .then((exactStats) => {
          setExactStatsCache((prev) => ({
            ...prev,
            [profilesetName]: {
              status: 'ready',
              simulatedStats: exactStats || null,
              jobId: cachedJobId,
            },
          }));
        })
        .catch((error) => {
          setExactStatsCache((prev) => ({
            ...prev,
            [profilesetName]: {
              status: 'error',
              jobId: cachedJobId,
              error: error instanceof Error ? error.message : 'Failed to load cached stats sim.',
            },
          }));
        });
    }
  }, [generatedInput, results, cachedExactJobIds, exactStatsCache]);

  const selectedProfilesetName = selectedResult ? getTopGearProfilesetName(selectedResult) : null;
  const selectedExactStatsEntry = selectedProfilesetName
    ? exactStatsCache[selectedProfilesetName]
    : undefined;
  const selectedExactSimulatedStats =
    selectedExactStatsEntry?.status === 'ready'
      ? selectedExactStatsEntry.simulatedStats || null
      : null;
  const canLoadSelectedExactStats = Boolean(
    selectedResult && selectedProfilesetName && generatedInput
  );
  const getExactStatsStatus = useCallback(
    (
      result: TopGearResult
    ): { status: 'idle' | 'loading' | 'ready' | 'error' | 'same_base'; label?: string } => {
      const isEquipped = result.items.length === 0 || result.name.startsWith('Currently Equipped');
      if (isEquipped) {
        return { status: 'same_base', label: 'Same as base stats (no extra sim)' };
      }
      const profilesetName = getTopGearProfilesetName(result);
      if (!profilesetName) return { status: 'idle', label: 'No profileset key' };
      if (!cachedExactJobIds[profilesetName] && !exactStatsCache[profilesetName]) {
        return { status: 'idle', label: 'Not cached' };
      }
      const entry = exactStatsCache[profilesetName];
      if (!entry) return { status: 'loading', label: 'Loading cached stats sim...' };
      if (entry.status === 'ready') return { status: 'ready', label: 'Saved stats sim' };
      if (entry.status === 'loading') return { status: 'loading', label: 'Loading stats sim...' };
      if (entry.status === 'error') return { status: 'error', label: entry.error || 'Failed' };
      return { status: 'idle', label: 'Not loaded' };
    },
    [cachedExactJobIds, exactStatsCache]
  );

  const toggleResultWishlist = useCallback(
    (result: TopGearResult) => {
      const changedItems = result.items.filter((it) => !it.is_kept && it.item_id > 0);
      if (changedItems.length === 0) {
        setWishlistFeedback('No changed items in this row.');
        return;
      }
      const allWishlisted = changedItems.every((it) =>
        isWishlisted(it.item_id, wishlistOwnerKey, Number(it.ilevel || 0))
      );
      if (allWishlisted) {
        for (const it of changedItems) {
          removeFromWishlist(it.item_id, wishlistOwnerKey, Number(it.ilevel || 0));
        }
        setWishlistFeedback(`Removed ${changedItems.length} item(s) from wishlist.`);
        setWishlistRefreshTick((v) => v + 1);
        return;
      }
      const entries = changedItems.map((it) => {
        const dropItem: DropItem = {
          item_id: it.item_id,
          name: it.name,
          icon: it.icon,
          quality: it.quality,
          ilevel: it.ilevel,
          encounter: it.encounter || '',
          instance_name: it.instance_name,
          source_type: it.source_type || 'Drop Finder Result',
          inventory_type: it.inventory_type,
          bonus_ids: Array.isArray(it.bonus_ids) ? it.bonus_ids : [],
        };
        return {
          item: dropItem,
          slot: it.slot.replace(/_/g, ' '),
          meta: {
            ilvl: it.ilevel,
            bonusId:
              Array.isArray(it.bonus_ids) && it.bonus_ids.length > 0 ? it.bonus_ids[0] : undefined,
            upgradeLabel: it.upgrade || undefined,
          },
        };
      });

      const { added, skipped } = addItemsToWishlist(entries, wishlistOwnerKey);
      if (added > 0 && skipped > 0)
        setWishlistFeedback(`Added ${added} item(s), ${skipped} already saved.`);
      else if (added > 0) setWishlistFeedback(`Added ${added} item(s) to wishlist.`);
      else setWishlistFeedback('All row items are already in wishlist.');
      setWishlistRefreshTick((v) => v + 1);
    },
    [wishlistOwnerKey]
  );

  const isResultWishlisted = useCallback(
    (result: TopGearResult) => {
      void wishlistRefreshTick;
      const changedItems = result.items.filter((it) => !it.is_kept && it.item_id > 0);
      if (changedItems.length === 0) return false;
      return changedItems.every((it) =>
        isWishlisted(it.item_id, wishlistOwnerKey, Number(it.ilevel || 0))
      );
    },
    [wishlistOwnerKey, wishlistRefreshTick]
  );

  const characterRenderUrl =
    !lightMode && playerRealm && playerName
      ? `${API_URL}/api/blizzard/character/${encodeURIComponent(
          playerRealm.toLowerCase()
        )}/${encodeURIComponent(playerName.toLowerCase())}/media/render${
          playerRegion ? `?region=${playerRegion.toLowerCase()}` : ''
        }`
      : null;

  const rankingSlotOptions = useMemo(() => {
    const slots = new Set<string>();
    for (const result of results) {
      for (const item of result.items) {
        if (item.is_kept) continue;
        if (!item.slot) continue;
        slots.add(String(item.slot));
      }
    }
    return [...slots].sort((a, b) => a.localeCompare(b));
  }, [results]);

  const filteredResults = useMemo(() => {
    if (slotFilter === 'all') return results;
    return results.filter((result) =>
      result.items.some((item) => !item.is_kept && String(item.slot) === slotFilter)
    );
  }, [results, slotFilter]);

  const filteredGroupedResults = useMemo(() => {
    if (!groupedResults) return null;
    return groupedResults
      .map(([instance, group]) => [
        instance,
        group.filter((result) =>
          slotFilter === 'all'
            ? true
            : result.items.some((item) => !item.is_kept && String(item.slot) === slotFilter)
        ),
      ] as [string, TopGearResult[]])
      .filter(([, group]) => group.length > 0);
  }, [groupedResults, slotFilter]);

  return (
    <div className="space-y-6">
      <DpsHeroCard
        playerName={playerName}
        playerClass={playerClass}
        playerRealm={playerRealm}
        playerRegion={playerRegion}
        dps={selectedResult?.dps || baseDps}
        dpsError={selectedResult?.target_error ?? dpsError}
        dpsErrorPct={dpsErrorPct}
        fightLength={fightLength}
        desiredTargets={desiredTargets}
        iterations={iterations}
        targetError={targetError}
        elapsedTime={elapsedTime}
        stageTimings={stageTimings}
        avgIlevel={selectedAvgIlevel}
        avgIlevelGain={selectedAvgIlevel - baseAvgIlevel}
      >
        {selectedResult && (
          <div className="mt-4 flex flex-col items-center gap-2">
            {selectedResult.delta > 0 ? (
              <div className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-3 py-1.5 text-emerald-400">
                <span className="text-sm font-bold">
                  +{Math.round(selectedResult.delta).toLocaleString()} DPS (
                  {((selectedResult.delta / baseDps) * 100).toFixed(1)}%)
                </span>
                <span className="text-xs opacity-60">upgrade</span>
              </div>
            ) : selectedResult.delta < 0 ? (
              <div className="flex items-center gap-1.5 rounded-md bg-red-500/10 px-3 py-1.5 text-red-400">
                <span className="text-sm font-bold">
                  {Math.round(selectedResult.delta).toLocaleString()} DPS (
                  {((selectedResult.delta / baseDps) * 100).toFixed(1)}%)
                </span>
                <span className="text-xs opacity-60">downgrade</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 rounded-md bg-zinc-500/10 px-3 py-1.5 text-zinc-400">
                <span className="text-sm font-bold italic">Currently Equipped</span>
              </div>
            )}

            {selectedResult.delta !== 0 && (
              <MeaningfulDifferenceIndicator
                delta={selectedResult.delta}
                standardDeviation={dpsError}
                iterations={iterations}
              />
            )}

            {selectedResultName && selectedResultName !== results[0]?.name && (
              <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                Viewing Selection: {selectedResultName}
              </span>
            )}
            {selectedResultName === results[0]?.name && selectedResult.delta > 0 && (
              <span className="text-[11px] uppercase tracking-[0.16em] text-gold/80">
                Best Gear Combination
              </span>
            )}
          </div>
        )}
      </DpsHeroCard>

      {hasGearOverview && (
        <CollapsibleSection title="Character Panel">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,0.95fr)] xl:items-start">
            <GearOverview
              gear={bestGearSet}
              title={
                selectedResultName && selectedResultName !== results[0]?.name
                  ? 'Selected Gear'
                  : 'Best Gear'
              }
              characterRenderUrl={characterRenderUrl}
              equippedGear={equippedGear}
              dropBaselineIlevelByKey={dropBaselineIlevelByKey}
              upgradeSlots={upgradeSlots}
              downgradeSlots={downgradeSlots}
              currencies={currencies}
              framed={false}
              comparisonMode="result"
              sourceInstances={sourceInstances}
            />

            {simulatedStats || generatedInput ? (
              <div className="xl:sticky xl:top-6">
                {selectedExactSimulatedStats ? (
                  <SimStatsComparisonCard
                    current={simulatedStats}
                    simulated={selectedExactSimulatedStats}
                    title="Base vs Exact Selected Stats"
                    description="Base is the currently equipped simulated profile from the main Top Gear run. Selected is the exact follow-up simulation for the row you chose."
                    currentLabel="Base"
                    simulatedLabel="Selected"
                  />
                ) : (
                  <div className="card overflow-hidden border-border/70 bg-surface/95">
                    <div className="flex items-start justify-between gap-4 border-b border-border/60 px-4 py-4 sm:px-5">
                      <div className="space-y-1">
                        <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">
                          Exact Simulated Stats
                        </h3>
                        <p className="max-w-xl text-[12px] leading-5 text-zinc-400">
                          Load an exact follow-up sim for the selected Top Gear row to compare it
                          against the base simulated profile from the main Top Gear run.
                        </p>
                      </div>
                      {canLoadSelectedExactStats ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedResult) void loadExactStats(selectedResult);
                          }}
                          disabled={selectedExactStatsEntry?.status === 'loading'}
                          className="shrink-0 rounded border border-gold/35 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold transition-colors hover:bg-gold/20 disabled:cursor-wait disabled:opacity-60"
                        >
                          {selectedExactStatsEntry?.status === 'loading'
                            ? 'Loading Exact Stats...'
                            : 'Load Exact Stats'}
                        </button>
                      ) : null}
                    </div>
                    <div className="space-y-3 px-4 py-5 sm:px-5">
                      <p className="text-[13px] text-zinc-300">
                        {!canLoadSelectedExactStats
                          ? 'Exact stats are unavailable for this older result. Run Top Gear again to enable row-specific stat snapshots.'
                          : selectedResultName && selectedResultName !== results[0]?.name
                            ? `Exact stats for "${selectedResultName}" have not been loaded yet.`
                            : 'The top result exact stats are being prepared or can be loaded on demand.'}
                      </p>
                      {selectedExactStatsEntry?.status === 'error' ? (
                        <p className="text-[12px] text-red-300">
                          {selectedExactStatsEntry.error || 'Failed to load exact stats.'}
                        </p>
                      ) : null}
                      <p className="text-[12px] text-zinc-500">
                        Exact stats are loaded only on demand and cached for this sim for future
                        opens.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </CollapsibleSection>
      )}

      {talentString && (
        <CollapsibleSection title="Talents" defaultOpen={false}>
          <SimResultTalentsCard talentString={talentString} />
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Rankings">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {enableWishlistActions && (
              <div className="flex items-center gap-2">
                <Link
                  href="/wishlist"
                  className="rounded border border-border bg-surface-2 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white"
                >
                  Open Wishlist
                </Link>
              </div>
            )}
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
              {filteredResults.length} results
            </span>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Slot
              </span>
              <select
                value={slotFilter}
                onChange={(e) => setSlotFilter(e.target.value)}
                className="rounded border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-zinc-200 focus:border-zinc-500 focus:outline-none"
              >
                <option value="all">All Slots</option>
                {rankingSlotOptions.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Group by
              </span>
              <div className="flex gap-1">
                {(
                  [
                    ['rank', 'Rank'],
                    ['instance', 'Dungeon/Raid'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setGroupMode(mode)}
                    className={`rounded border px-3 py-1.5 text-[14px] font-medium transition-all ${
                      groupMode === mode
                        ? 'border-white bg-white text-black'
                        : 'border-border bg-surface-2 text-gray-400 hover:border-gray-500 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        {enableWishlistActions && wishlistFeedback && (
          <div className="mb-3 text-xs text-zinc-300">{wishlistFeedback}</div>
        )}

        {groupMode === 'instance' ? (
          <div className="space-y-6">
            {(filteredGroupedResults ??
              [[hasGroupingData ? 'Unknown' : 'All Results', filteredResults]]).map(
              ([instance, group]) => (
                <div key={instance}>
                  {instance !== '__ungrouped__' && (
                    <div className="mb-2 flex items-center gap-2 border-b border-border/50 pb-1.5">
                      <span className="text-[15px] font-semibold text-zinc-200">{instance}</span>
                      <span className="font-mono text-[13px] text-zinc-400">
                        {group.length} items
                      </span>
                    </div>
                  )}
                  <ResultList
                    results={group}
                    maxDps={maxDps}
                    baseDps={baseDps}
                    dpsError={dpsError}
                    iterations={iterations}
                    equippedGear={equippedGear}
                    baseAvgIlevel={baseAvgIlevel}
                    itemInfoMap={itemInfoMap}
                    enchantInfoMap={enchantInfoMap}
                    gemInfoMap={gemInfoMap}
                    selectedResultName={selectedResultName}
                    onSelectResult={setSelectedResultName}
                    currencies={currencies}
                    dropBaselineIlevelByKey={dropBaselineIlevelByKey}
                    getExactStatsStatus={getExactStatsStatus}
                    onLoadExactStats={(result) => {
                      void openOrStartExactStats(result);
                    }}
                    onAddResultToWishlist={enableWishlistActions ? toggleResultWishlist : undefined}
                    isResultWishlisted={enableWishlistActions ? isResultWishlisted : undefined}
                    sourceInstances={sourceInstances}
                    baselineTierBySlot={baselineTierBySlot}
                    showRanks={false}
                    isBestResult={(result) => result === results[0] && result.delta > 0}
                  />
                </div>
              )
            )}
          </div>
        ) : (
          <RankedResults
            results={filteredResults}
            maxDps={maxDps}
            baseDps={baseDps}
            dpsError={dpsError}
            iterations={iterations}
            equippedGear={equippedGear}
            baseAvgIlevel={baseAvgIlevel}
            itemInfoMap={itemInfoMap}
            enchantInfoMap={enchantInfoMap}
            gemInfoMap={gemInfoMap}
            selectedResultName={selectedResultName}
            onSelectResult={setSelectedResultName}
            currencies={currencies}
            dropBaselineIlevelByKey={dropBaselineIlevelByKey}
            getExactStatsStatus={getExactStatsStatus}
            onLoadExactStats={(result) => {
              void openOrStartExactStats(result);
            }}
            onAddResultToWishlist={enableWishlistActions ? toggleResultWishlist : undefined}
            isResultWishlisted={enableWishlistActions ? isResultWishlisted : undefined}
            sourceInstances={sourceInstances}
            baselineTierBySlot={baselineTierBySlot}
          />
        )}
      </CollapsibleSection>
      <ResultInsights
        dps={selectedResult?.dps || baseDps}
        dpsError={dpsError}
        iterations={iterations}
      />
    </div>
  );
}

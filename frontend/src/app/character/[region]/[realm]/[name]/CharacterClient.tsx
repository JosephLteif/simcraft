'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, Copy, Heart, Trash2 } from 'lucide-react';
import {
  API_URL,
  deleteCharacterProfile,
  fetchJson,
  getIntegrationSettings,
  getRaiderIoCharacter,
  getWarcraftLogsCharacter,
  listCharacterProfiles,
  SavedCharacterProfile,
} from '@/app/lib/api';
import type { IntegrationSettings, RaiderIoData, WarcraftLogsData } from '@/app/lib/api';
import type {
  CharacterPanelEquipment,
  CharacterProfilePayload,
  CharacterProfessionsPayload,
  CharacterSpecializationsPayload,
  CharacterStatisticsPayload,
  MythicPlusPayload,
  RaidEncountersPayload,
} from '@/app/lib/character-domain-types';
import { getCharacterValueLabel, normalizeCharacterSlug } from '@/app/lib/character-panel-utils';
import { CHARACTER_DATA_TTL_MS, isCharacterDataStale } from '@/app/lib/character-refresh';
import { buildWishlistHref } from '@/app/lib/wishlist';
import { useAuth } from '../../../../components/AuthContext';
import CharacterPanel from '../../../../components/CharacterPanel';
import ConfirmModal from '../../../../components/ConfirmModal';
import ToggleOptionCard from '../../../../components/shared/ToggleOptionCard';
import type { CharacterIntegrationState } from '../../../../components/character/ExternalIntegrationCards';

const LOCAL_TRACKED_CHARACTERS_KEY = 'whylowdps_tracked_characters';
const LAST_REFRESH_PREFIX = 'whylowdps_last_refresh_';

type RosterCharacter = {
  name?: string;
  realm?: string;
  region?: string;
  class?: string;
  className?: string;
  character_class?: { name?: string };
};

type CharacterPageData = {
  profile: CharacterProfilePayload;
  equipment: CharacterPanelEquipment;
  statistics: CharacterStatisticsPayload;
  specializations: CharacterSpecializationsPayload | null;
  professions: CharacterProfessionsPayload;
  mythicPlus: MythicPlusPayload;
  raidEncounters: RaidEncountersPayload;
};

function initialIntegrationState<T>(enabled: boolean): CharacterIntegrationState<T> {
  return {
    enabled,
    loading: false,
    refreshing: false,
    snapshot: null,
    error: null,
  };
}

function integrationErrorMessage(provider: 'Raider.IO' | 'Warcraft Logs'): string {
  return `${provider} is temporarily unavailable.`;
}

function readRefreshTimestamp(storageKey: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function numberOrNull(value: unknown): number | null {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function hasPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0;
}

function retainPreviousPayload<T>(
  next: T,
  previous: T | undefined,
  shouldRetain: boolean
): T | undefined {
  return shouldRetain && previous !== undefined && !hasPayload(next) ? previous : next;
}

function objectSlug(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const slug = (value as Record<string, unknown>).slug;
  return typeof slug === 'string' && slug.trim() ? normalizeCharacterSlug(slug) : null;
}

function CopyIcon() {
  return <Copy className="h-4 w-4" strokeWidth={2} />;
}

export default function CharacterClient() {
  const params = useParams();
  const searchParams = useSearchParams();
  const { lightMode } = useAuth();

  // Robust resolution from params or URL path
  let region = (searchParams.get('region') || (params.region as string) || 'us').toLowerCase();
  let realm = (searchParams.get('realm') || (params.realm as string) || '').toLowerCase();
  let name = (searchParams.get('name') || (params.name as string) || '').toLowerCase();
  const tabParam = (searchParams.get('tab') || '').toLowerCase();
  const forceRefresh = (searchParams.get('refresh') || '').toLowerCase() === 'true';
  const initialTab =
    tabParam === 'vault' ||
    tabParam === 'mythic' ||
    tabParam === 'profile' ||
    tabParam === 'raiding'
      ? (tabParam as 'vault' | 'mythic' | 'profile' | 'raiding')
      : undefined;

  const usingPlaceholderSegments = realm === 'realm' && name === 'name';

  if ((!realm || !name || usingPlaceholderSegments) && typeof window !== 'undefined') {
    const query = new URLSearchParams(window.location.search);
    const queryRegion = query.get('region');
    const queryRealm = query.get('realm');
    const queryName = query.get('name');
    if (queryRegion && queryRealm && queryName) {
      region = queryRegion.toLowerCase();
      realm = queryRealm.toLowerCase();
      name = queryName.toLowerCase();
    } else {
      const parts = window.location.pathname.split('/').filter(Boolean);
      // Expected pattern: character/[region]/[realm]/[name]
      const charIndex = parts.indexOf('character');
      if (charIndex !== -1 && parts.length >= charIndex + 4) {
        region = parts[charIndex + 1];
        realm = parts[charIndex + 2];
        name = parts[charIndex + 3];
      }
    }
  }

  const requestedKey = `${region.toLowerCase()}|${realm.toLowerCase()}|${name.toLowerCase()}`;
  const refreshStorageKey = `${LAST_REFRESH_PREFIX}${requestedKey}`;
  const [data, setData] = useState<CharacterPageData | null>(null);
  const [raiderIoIntegration, setRaiderIoIntegration] = useState<
    CharacterIntegrationState<RaiderIoData>
  >(() => initialIntegrationState(true));
  const [warcraftLogsIntegration, setWarcraftLogsIntegration] = useState<
    CharacterIntegrationState<WarcraftLogsData>
  >(() => initialIntegrationState(false));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [dataWarning, setDataWarning] = useState<string | null>(null);
  const [savedProfiles, setSavedProfiles] = useState<SavedCharacterProfile[]>([]);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [trackedCharacterKeys, setTrackedCharacterKeys] = useState<string[]>([]);
  const [rosterCharacters, setRosterCharacters] = useState<RosterCharacter[]>([]);
  const [trackSaving, setTrackSaving] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [simcMenuOpen, setSimcMenuOpen] = useState(false);
  const simcMenuRef = useRef<HTMLDivElement | null>(null);
  const dataRef = useRef<CharacterPageData | null>(null);
  const lastRefreshRef = useRef<number | null>(null);
  const backgroundRefreshInFlightRef = useRef(false);
  const initialLoadKeyRef = useRef<string | null>(null);
  const integrationRequestKeyRef = useRef(requestedKey);

  // Fetch saved profiles for this character
  useEffect(() => {
    if (!name || !realm || !region) return;
    listCharacterProfiles({ name, realm, region })
      .then(setSavedProfiles)
      .catch(() => setSavedProfiles([]));
  }, [name, realm, region]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem(LOCAL_TRACKED_CHARACTERS_KEY) || '[]';
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setTrackedCharacterKeys(parsed.map((v) => String(v)));
    } catch {
      setTrackedCharacterKeys([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ characters?: RosterCharacter[] } | RosterCharacter[]>(
      `${API_URL}/api/bnet/user/characters`
    )
      .then((response) => {
        if (cancelled) return;
        const list = Array.isArray(response) ? response : response?.characters || [];
        setRosterCharacters(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (cancelled) return;
        setRosterCharacters([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!simcMenuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && simcMenuRef.current?.contains(target)) return;
      setSimcMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSimcMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [simcMenuOpen]);

  const handleDeleteProfiles = useCallback(async () => {
    for (const p of savedProfiles) {
      await deleteCharacterProfile(p.id);
    }
    setSavedProfiles([]);
  }, [savedProfiles]);

  const fetchIntegrations = useCallback(
    async (refresh = false) => {
      if (!region || !realm || !name) return;
      if (lightMode) {
        setRaiderIoIntegration(initialIntegrationState(false));
        setWarcraftLogsIntegration(initialIntegrationState(false));
        return;
      }
      const requestKey = `${region.toLowerCase()}|${realm.toLowerCase()}|${name.toLowerCase()}`;
      const begin = <T,>(
        setter: React.Dispatch<React.SetStateAction<CharacterIntegrationState<T>>>,
        enabled: boolean
      ) => {
        setter((previous) => ({
          enabled,
          loading: enabled && !previous.snapshot,
          refreshing: enabled && refresh && Boolean(previous.snapshot),
          snapshot: enabled ? previous.snapshot : null,
          error: null,
        }));
      };

      setRaiderIoIntegration((previous) => ({
        ...previous,
        loading: !previous.snapshot,
        refreshing: refresh && Boolean(previous.snapshot),
        error: null,
      }));
      setWarcraftLogsIntegration((previous) => ({
        ...previous,
        loading: !previous.snapshot,
        refreshing: refresh && Boolean(previous.snapshot),
        error: null,
      }));

      let settings: IntegrationSettings;
      try {
        settings = await getIntegrationSettings();
      } catch {
        settings = {
          raider_io_enabled: true,
          warcraft_logs_enabled: false,
          warcraft_logs: {
            user_configured: false,
            user_client_id: null,
            effective_source: null,
            environment_configured: false,
            admin_configured: false,
          },
        };
      }
      if (integrationRequestKeyRef.current !== requestKey) return;

      begin(setRaiderIoIntegration, settings.raider_io_enabled !== false);
      begin(setWarcraftLogsIntegration, settings.warcraft_logs_enabled === true);

      if (settings.raider_io_enabled !== false) {
        void getRaiderIoCharacter(region, realm, name, refresh)
          .then((response) => {
            if (integrationRequestKeyRef.current !== requestKey) return;
            const hasFreshData = response.status === 'ok' && response.data !== null;
            setRaiderIoIntegration((previous) => ({
              ...previous,
              loading: false,
              refreshing: false,
              snapshot:
                hasFreshData || previous.snapshot?.status !== 'ok'
                  ? response
                  : previous.snapshot,
              error:
                hasFreshData || previous.snapshot?.status !== 'ok'
                  ? null
                  : integrationErrorMessage('Raider.IO'),
            }));
          })
          .catch(() => {
            if (integrationRequestKeyRef.current !== requestKey) return;
            setRaiderIoIntegration((previous) => ({
              ...previous,
              loading: false,
              refreshing: false,
              error: integrationErrorMessage('Raider.IO'),
            }));
          });
      }

      if (settings.warcraft_logs_enabled === true) {
        void getWarcraftLogsCharacter(region, realm, name, refresh)
          .then((response) => {
            if (integrationRequestKeyRef.current !== requestKey) return;
            const hasFreshData = response.status === 'ok' && response.data !== null;
            setWarcraftLogsIntegration((previous) => ({
              ...previous,
              loading: false,
              refreshing: false,
              snapshot:
                hasFreshData || previous.snapshot?.status !== 'ok'
                  ? response
                  : previous.snapshot,
              error:
                hasFreshData || previous.snapshot?.status !== 'ok'
                  ? null
                  : integrationErrorMessage('Warcraft Logs'),
            }));
          })
          .catch(() => {
            if (integrationRequestKeyRef.current !== requestKey) return;
            setWarcraftLogsIntegration((previous) => ({
              ...previous,
              loading: false,
              refreshing: false,
              error: integrationErrorMessage('Warcraft Logs'),
            }));
          });
      }
    },
    [lightMode, name, realm, region]
  );

  const fetchCharacterData = useCallback(
    async (refresh = false, background = false) => {
      if (!region || !realm || !name) return;
      if (background) {
        if (backgroundRefreshInFlightRef.current) return;
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        backgroundRefreshInFlightRef.current = true;
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError('');
      setDataWarning(null);
      const refreshKey = `${LAST_REFRESH_PREFIX}${region.toLowerCase()}|${realm.toLowerCase()}|${name.toLowerCase()}`;
      const previousData = dataRef.current;

      try {
        const query = `?region=${region}${refresh ? '&refresh=true' : ''}`;
        const baseUrl = `${API_URL}/api/blizzard/character/${realm}/${name}`;

        const [
          profile,
          equipment,
          statistics,
          specializations,
          professions,
          mythicPlus,
          raidEncounters,
        ] = await Promise.all([
          fetchJson<CharacterProfilePayload>(`${baseUrl}/profile${query}`),
          fetchJson<CharacterPanelEquipment>(`${baseUrl}/equipment${query}`).catch(() => null),
          fetchJson<CharacterStatisticsPayload>(`${baseUrl}/statistics${query}`).catch(() => null),
          fetchJson<CharacterSpecializationsPayload>(`${baseUrl}/specializations${query}`).catch(
            () => null
          ),
          fetchJson<CharacterProfessionsPayload>(`${baseUrl}/professions${query}`).catch(
            () => null
          ),
          fetchJson<MythicPlusPayload>(`${baseUrl}/mythic-keystone-profile${query}`).catch(
            () => null
          ),
          fetchJson<RaidEncountersPayload>(`${baseUrl}/encounters/raids${query}`).catch(() => null),
        ]);

        const retainSnapshot = refresh && previousData !== null;
        const nextData: CharacterPageData = {
          profile: retainPreviousPayload(profile, previousData?.profile, retainSnapshot) || profile,
          equipment: retainPreviousPayload(equipment, previousData?.equipment, retainSnapshot) || {
            equipped_items: [],
          },
          statistics:
            retainPreviousPayload(statistics, previousData?.statistics, retainSnapshot) ?? null,
          specializations:
            retainPreviousPayload(specializations, previousData?.specializations, retainSnapshot) ??
            null,
          professions:
            retainPreviousPayload(professions, previousData?.professions, retainSnapshot) ?? null,
          mythicPlus:
            retainPreviousPayload(mythicPlus, previousData?.mythicPlus, retainSnapshot) ?? null,
          raidEncounters:
            retainPreviousPayload(raidEncounters, previousData?.raidEncounters, retainSnapshot) ??
            null,
        };
        dataRef.current = nextData;
        setData(nextData);
        void fetchIntegrations(refresh);
        if (refresh || lastRefreshRef.current === null) {
          const ts = Date.now();
          lastRefreshRef.current = ts;
          setLastRefreshedAt(ts);
          if (typeof window !== 'undefined') {
            try {
              window.localStorage.setItem(refreshKey, String(ts));
            } catch {
              // Local storage can be unavailable in privacy-restricted webviews.
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch character';
        if (dataRef.current) {
          setDataWarning(
            `Unable to refresh character data. Showing the last successful snapshot. ${message}`
          );
        } else {
          setError(message);
        }
      } finally {
        if (background) {
          backgroundRefreshInFlightRef.current = false;
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [fetchIntegrations, region, realm, name]
  );

  useEffect(() => {
    if (!region || !realm || !name || initialLoadKeyRef.current === requestedKey) return;

    const storedTimestamp = readRefreshTimestamp(refreshStorageKey);
    lastRefreshRef.current = storedTimestamp;
    setLastRefreshedAt(storedTimestamp);
    if (initialLoadKeyRef.current !== null) {
      dataRef.current = null;
      setData(null);
      setDataWarning(null);
    }
    integrationRequestKeyRef.current = requestedKey;
    setRaiderIoIntegration(initialIntegrationState(true));
    setWarcraftLogsIntegration(initialIntegrationState(false));
    initialLoadKeyRef.current = requestedKey;
    void fetchCharacterData(forceRefresh || isCharacterDataStale(storedTimestamp));
  }, [fetchCharacterData, forceRefresh, name, realm, refreshStorageKey, region, requestedKey]);

  useEffect(() => {
    if (!data) return;

    const refreshIfStale = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (isCharacterDataStale(lastRefreshRef.current)) {
        void fetchCharacterData(true, true);
      }
    };
    const intervalId = window.setInterval(refreshIfStale, CHARACTER_DATA_TTL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshIfStale();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [data, fetchCharacterData]);

  if (loading && !data) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4">
        <div className="border-t-gold h-10 w-10 animate-spin rounded-full border-2 border-zinc-800" />
        <p className="text-sm font-medium text-zinc-500">Loading Character Profile...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 text-red-500">
          <AlertTriangle className="h-8 w-8" strokeWidth={2} />
        </div>
        <h2 className="mb-2 text-xl font-bold text-zinc-200">Character Not Found</h2>
        <p className="mb-6 text-zinc-500">{error}</p>
        <button
          onClick={() => fetchCharacterData(true)}
          className="rounded-lg bg-zinc-800 px-6 py-2 text-sm font-bold text-zinc-200 transition-colors hover:bg-zinc-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { profile } = data;
  const profileName = getCharacterValueLabel(profile.name) || name;
  const profileRealmName = getCharacterValueLabel(profile.realm) || realm;
  const profileRealmSlug = objectSlug(profile.realm) || normalizeCharacterSlug(profileRealmName);
  const profileClassName = getCharacterValueLabel(profile.character_class);
  const profileRaceName = getCharacterValueLabel(profile.race);
  const profileLevel = numberOrNull(profile.level);
  const equippedItemLevel = numberOrNull(profile.equipped_item_level);
  const averageItemLevel = numberOrNull(profile.average_item_level);
  const canonicalRegion = region.toLowerCase();
  const canonicalRealm = profileRealmSlug || normalizeCharacterSlug(realm);
  const canonicalName = profileName.toLowerCase();
  const currentKey = `${canonicalRegion}|${canonicalRealm}|${canonicalName}`;
  const isTrackedCharacter = trackedCharacterKeys.includes(currentKey);
  const rosterCharacter =
    rosterCharacters.find((char) => {
      const charName = normalizeCharacterSlug(char.name);
      const charRealm = normalizeCharacterSlug(char.realm);
      const charRegion = String(char.region || '').toLowerCase();
      return (
        charName === normalizeCharacterSlug(profileName) &&
        charRealm === canonicalRealm &&
        charRegion === canonicalRegion
      );
    }) || null;
  const rosterWishlistHref = rosterCharacter
    ? buildWishlistHref({
        name: rosterCharacter.name || profileName,
        realm: rosterCharacter.realm || profileRealmName,
        region: rosterCharacter.region || region,
        className:
          rosterCharacter.className ||
          rosterCharacter.class ||
          rosterCharacter.character_class?.name ||
          profileClassName ||
          undefined,
      })
    : '';
  const characterMediaUrl = `${API_URL}/api/blizzard/character/${realm}/${name}/media/main?region=${region}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-black tracking-tight text-white">{profileName}</h1>
            <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-bold tracking-wider text-zinc-400 uppercase">
              {[
                profileLevel !== null ? `Lv ${profileLevel}` : null,
                profileRaceName,
                profileClassName,
              ]
                .filter(Boolean)
                .join(' ') || 'Profile details unavailable'}
            </span>
            <div className="bg-gold/10 ring-gold/20 flex items-center gap-2 rounded-lg px-3 py-1 ring-1">
              <span className="text-gold/70 text-[10px] font-bold tracking-widest uppercase">
                ILVL
              </span>
              <span className="text-gold text-sm font-black">{equippedItemLevel ?? '—'}</span>
              {averageItemLevel !== null && averageItemLevel !== equippedItemLevel && (
                <span className="text-gold/40 text-[11px] font-bold">({averageItemLevel})</span>
              )}
            </div>
            <button
              onClick={() => fetchCharacterData(true)}
              disabled={loading || refreshing}
              className="ml-2 rounded border border-white/10 bg-black/20 px-3 py-1 text-xs font-bold text-zinc-200 backdrop-blur-sm hover:bg-white/10 active:scale-95 disabled:opacity-50"
            >
              {loading || refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            {rosterWishlistHref ? (
              <Link
                href={rosterWishlistHref}
                className="ml-2 flex items-center gap-1.5 rounded border border-rose-400/35 bg-rose-500/15 px-3 py-1 text-xs font-bold text-rose-200 backdrop-blur-sm hover:bg-rose-500/25 active:scale-95"
              >
                <Heart className="h-4 w-4" strokeWidth={2} />
                Open Wishlist
              </Link>
            ) : null}
            {savedProfiles.length > 0 && (
              <div ref={simcMenuRef} className="relative ml-2">
                <button
                  type="button"
                  onClick={() => setSimcMenuOpen((prev) => !prev)}
                  aria-expanded={simcMenuOpen}
                  className="flex items-center gap-1.5 rounded border border-white/10 bg-black/20 px-3 py-1 text-xs font-bold text-zinc-200 backdrop-blur-sm hover:bg-white/10 active:scale-95"
                >
                  <CopyIcon />
                  SimC
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${simcMenuOpen ? 'rotate-180' : ''}`}
                    strokeWidth={2}
                  />
                </button>
                {simcMenuOpen ? (
                  <div className="absolute top-8 right-0 z-40 min-w-[150px] rounded-md border border-white/15 bg-[#111317] p-1 shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        const latestProfile = savedProfiles[0];
                        navigator.clipboard.writeText(latestProfile.simc_input);
                        setSimcMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/10"
                    >
                      <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                      Copy SimC
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteModalOpen(true);
                        setSimcMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                      Delete SimC
                    </button>
                  </div>
                ) : null}
              </div>
            )}
            <div className="ml-2">
              <ToggleOptionCard
                checked={isTrackedCharacter}
                onToggle={() => {
                  if (trackSaving) return;
                  void (async () => {
                    setTrackSaving(true);
                    setTrackError(null);
                    try {
                      const next = isTrackedCharacter
                        ? trackedCharacterKeys.filter((k) => k !== currentKey)
                        : [...trackedCharacterKeys, currentKey];
                      if (typeof window !== 'undefined') {
                        localStorage.setItem(LOCAL_TRACKED_CHARACTERS_KEY, JSON.stringify(next));
                      }
                      setTrackedCharacterKeys(next);
                    } catch (err) {
                      setTrackError(
                        err instanceof Error ? err.message : 'Failed to update tracked characters'
                      );
                    } finally {
                      setTrackSaving(false);
                    }
                  })();
                }}
                title={trackSaving ? 'Track Character (Saving...)' : 'Track Character'}
                description="Add this character to your tracked characters on the dashboard."
                titleClassName="text-xs font-bold text-zinc-200"
                descriptionClassName="text-[11px] text-zinc-400"
              />
            </div>
          </div>
          {trackError && (
            <p className="mt-1 text-xs text-red-400">Track Character failed: {trackError}</p>
          )}
          <p className="mt-1 font-medium text-zinc-500">
            {profileRealmName} - {region.toUpperCase()}
          </p>
          {lastRefreshedAt ? (
            <p className="mt-1 text-xs text-zinc-500">
              Last refreshed at {new Date(lastRefreshedAt).toLocaleString()}
            </p>
          ) : null}
          {refreshing ? (
            <p className="mt-1 text-xs text-zinc-400" role="status">
              Refreshing character data…
            </p>
          ) : null}
          {dataWarning ? (
            <p className="mt-1 text-xs text-amber-300" role="status">
              {dataWarning}
            </p>
          ) : null}
        </div>
      </div>

      <CharacterPanel
        name={profileName}
        realm={profileRealmName}
        region={region}
        profile={profile}
        characterClass={profileClassName || 'Unavailable'}
        race={profileRaceName || 'Unavailable'}
        level={profileLevel ?? 0}
        equipment={data.equipment}
        statistics={data.statistics}
        specializations={data.specializations}
        professions={data.professions}
        mythicPlus={data.mythicPlus}
        raidEncounters={data.raidEncounters}
        characterMediaUrl={characterMediaUrl}
        latestSimcInput={savedProfiles[0]?.simc_input || null}
        initialTab={initialTab}
        raiderIoIntegration={raiderIoIntegration}
        warcraftLogsIntegration={warcraftLogsIntegration}
        onRefreshIntegrations={() => void fetchIntegrations(true)}
      />
      <ConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteProfiles}
        title="Delete SimC Profiles"
        message={`Are you sure you want to delete all saved SimC profiles for ${profileName}? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
      />
    </div>
  );
}

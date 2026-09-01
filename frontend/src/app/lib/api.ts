import { SavedRoute, SimSummary, SystemStats } from './types';
import { Instance } from '../drop-finder/types';

export function isDesktopRuntime(): boolean {
  const desktopBuild =
    process.env.DESKTOP_BUILD === 'true' || process.env.NEXT_PUBLIC_DESKTOP_BUILD === 'true';
  // Keep the build flag for server rendering, but let the browser decide from
  // its actual runtime. A desktop export can also be opened by a phone from
  // the PC's LAN address, where Tauri APIs and localhost are not available.
  if (typeof window === 'undefined') return desktopBuild;
  const isDesktopDevFrontend =
    window.location.protocol === 'http:' &&
    (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') &&
    window.location.port === '1420';
  return (
    isDesktopDevFrontend ||
    window.location.protocol === 'tauri:' ||
    window.location.protocol === 'asset:' ||
    window.location.protocol === 'file:' ||
    window.location.hostname === 'tauri.localhost' ||
    !!(window as any).__TAURI__ ||
    !!(window as any).__TAURI_METADATA__ ||
    !!(window as any).__TAURI_INTERNALS__ ||
    !!(window as any).__TAURI_IPC__
  );
}

export const isDesktop = isDesktopRuntime();
export const isHostedPrivate = process.env.NEXT_PUBLIC_DEPLOYMENT_MODE === 'hosted-private';
export const LAN_ACCESS_REVOKED_EVENT = 'whylowdps-lan-access-revoked';
export const LAN_ACCESS_REQUIRED_STORAGE_KEY = 'whylowdps_lan_access_required';
export const BROWSER_USER_SCOPE_CHANGED_EVENT = 'whylowdps-user-scope-changed';

export function isLanHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false;
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function isLanBrowser(): boolean {
  if (isDesktop || typeof window === 'undefined') return false;
  if (window.location.port === '17384') return true;
  return (
    isLanHost(window.location.hostname) &&
    !['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
  );
}

if (typeof window !== 'undefined') {
  console.log('[WhyLowDps] Mode:', isDesktop ? 'Desktop' : 'Web');
  if (!isDesktop) {
    console.log('[WhyLowDps] Protocol:', window.location.protocol);
    console.log('[WhyLowDps] Hostname:', window.location.hostname);
  }
}

export const API_URL = isDesktop ? 'http://localhost:17384' : '';

let sessionToken: string | null = null;

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

const USER_SCOPE_KEY = 'whylowdps_active_user_scope';
const USER_SCOPE_PREFIX = 'whylowdps_user_scope:';
const DEVICE_STORAGE_KEYS = new Set([
  'whylowdps_lan_access_required',
  'whylowdps_data_ready',
  'whylowdps_light_mode',
  'whylowdps_full_mode',
  'whylowdps_guided_tours_v1',
  'whylowdps_update_channel',
]);

function restoreLegacyDeviceStorage(nextUserId: string): boolean {
  const saved = localStorage.getItem(`${USER_SCOPE_PREFIX}${nextUserId}`);
  if (!saved) return false;

  try {
    const values = JSON.parse(saved) as Record<string, string>;
    let restored = false;
    for (const key of DEVICE_STORAGE_KEYS) {
      const value = values[key];
      if (value === undefined) continue;
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
      delete values[key];
      restored = true;
    }
    if (restored) {
      if (Object.keys(values).length > 0) {
        localStorage.setItem(`${USER_SCOPE_PREFIX}${nextUserId}`, JSON.stringify(values));
      } else {
        localStorage.removeItem(`${USER_SCOPE_PREFIX}${nextUserId}`);
      }
    }
    return restored;
  } catch {
    return false;
  }
}

/** Swap account-owned browser preferences without changing every feature's storage key. */
export async function switchBrowserUserScope(nextUserId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const currentUserId = localStorage.getItem(USER_SCOPE_KEY);
  const restoredLegacyDeviceStorage = restoreLegacyDeviceStorage(nextUserId);
  if (currentUserId === nextUserId) {
    if (restoredLegacyDeviceStorage) {
      window.dispatchEvent(new Event(BROWSER_USER_SCOPE_CHANGED_EVENT));
    }
    return;
  }

  const accountValues: Record<string, string> = {};
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (
      !key ||
      key === USER_SCOPE_KEY ||
      key.startsWith(USER_SCOPE_PREFIX) ||
      DEVICE_STORAGE_KEYS.has(key) ||
      key.startsWith('whylowdps_changelog_seen_')
    ) {
      continue;
    }
    if (key.startsWith('whylowdps_')) {
      const value = localStorage.getItem(key);
      if (value !== null) accountValues[key] = value;
      localStorage.removeItem(key);
    }
  }
  if (currentUserId) {
    localStorage.setItem(`${USER_SCOPE_PREFIX}${currentUserId}`, JSON.stringify(accountValues));
  }

  const saved = localStorage.getItem(`${USER_SCOPE_PREFIX}${nextUserId}`);
  if (saved) {
    try {
      const values = JSON.parse(saved) as Record<string, string>;
      Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, value));
    } catch {}
  }
  localStorage.setItem(USER_SCOPE_KEY, nextUserId);
  sessionStorage.clear();
  Object.keys(memoryCache).forEach((key) => delete memoryCache[key]);
  if ('caches' in window) await caches.delete(PERSISTENT_CACHE_NAME).catch(() => false);
  window.dispatchEvent(new Event(BROWSER_USER_SCOPE_CHANGED_EVENT));
}
const DEFAULT_FETCH_TIMEOUT_MS = 8000;
const GET_RETRY_ATTEMPTS = 2;
const GET_RETRY_DELAY_MS = 300;

type FetchJsonInit = RequestInit & {
  timeoutMs?: number;
};

export type BlizzardCredentialProfile = {
  id: string;
  name: string;
  client_id: string;
  created_at: number;
  updated_at: number;
  has_secret?: boolean;
};

export type HostedUser = {
  id: string;
  provider_subject: string | null;
  battletag: string;
  role: 'admin' | 'member';
  enabled: boolean;
  created_at: string;
  last_login_at: string | null;
};

export function listHostedUsers(): Promise<HostedUser[]> {
  return fetchJson<HostedUser[]>(`${API_URL}/api/admin/users`);
}

export function createHostedUser(battletag: string, role: 'admin' | 'member') {
  return fetchJson<HostedUser>(`${API_URL}/api/admin/users`, {
    method: 'POST',
    body: JSON.stringify({ battletag, role }),
  });
}

export function updateHostedUser(
  id: string,
  update: { role?: 'admin' | 'member'; enabled?: boolean; revoke_sessions?: boolean }
) {
  return fetchJson<HostedUser>(`${API_URL}/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(update),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(init: RequestInit | undefined, timeoutMs: number): RequestInit {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const nextInit = { ...(init || {}), signal: controller.signal };
  // Clear timeout once caller awaits fetch resolution.
  (nextInit as any).__clearTimeout = () => clearTimeout(timer);
  return nextInit;
}

export function isNetworkUnavailableError(err: any): boolean {
  return err?.status === 0 || err?.name === 'AbortError' || err?.code === 'NETWORK_UNAVAILABLE';
}

/** Fetch JSON with consistent error handling. Throws on non-ok responses. */
export async function fetchJson<T>(url: string, init?: FetchJsonInit): Promise<T> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, ...requestInit } = init || {};
  const headers = { ...requestInit.headers } as Record<string, string>;

  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  // Default to application/json for mutating requests if not specified.
  const requestMethod = requestInit.method?.toUpperCase();
  if (requestMethod === 'POST' || requestMethod === 'PUT' || requestMethod === 'PATCH') {
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const finalInit = {
    ...requestInit,
    headers,
    credentials: 'include' as RequestCredentials,
  };
  const method = (finalInit.method || 'GET').toUpperCase();
  const retries = method === 'GET' ? GET_RETRY_ATTEMPTS : 0;
  let lastErr: any;
  let res: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timedInit = withTimeout(finalInit, timeoutMs);
    const clearTimer = (timedInit as any).__clearTimeout as (() => void) | undefined;
    delete (timedInit as any).__clearTimeout;
    try {
      res = await fetch(url, timedInit);
      clearTimer?.();
      break;
    } catch (err: any) {
      clearTimer?.();
      lastErr = err;
      if (attempt < retries) {
        await sleep(GET_RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  if (!res) {
    const error = new Error('Backend not reachable') as any;
    error.status = 0;
    error.code = 'NETWORK_UNAVAILABLE';
    error.cause = lastErr;
    throw error;
  }

  if (!res.ok) {
    const responseText = await res.text().catch(() => '');
    let data: any = {};
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      // Actix's default unauthorized response may be plain text.
    }
    const message =
      data.detail || data.error || responseText.trim() || `Server error ${res.status}`;
    const isLanPairingRequired = message === 'LAN pairing required';
    if (res.status === 401 && isLanPairingRequired && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(LAN_ACCESS_REVOKED_EVENT));
    }
    const error = new Error(message) as any;
    error.status = res.status;
    error.detail = data.detail;
    error.error = data.error;
    if (isLanPairingRequired) error.code = 'LAN_ACCESS_REQUIRED';
    throw error;
  }
  const text = await res.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

/** Cache for generic API requests */
const memoryCache: Record<string, { data: any; expiry: number }> = {};
const inflightCache: Record<string, Promise<any> | undefined> = {};
const PERSISTENT_CACHE_NAME = 'whylowdps-api-cache-v1';
let legacyLocalStorageCacheCleaned = false;

function cleanupLegacyLocalStorageCache() {
  if (legacyLocalStorageCacheCleaned || typeof window === 'undefined') return;
  legacyLocalStorageCacheCleaned = true;
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith('api_cache_')) localStorage.removeItem(key);
    }
  } catch {}
}

async function readPersistentCache(
  cacheKey: string
): Promise<{ data: any; expiry: number } | null> {
  if (typeof window === 'undefined' || !('caches' in window)) return null;
  try {
    const cache = await caches.open(PERSISTENT_CACHE_NAME);
    const res = await cache.match(cacheKey);
    if (!res) return null;
    const parsed = (await res.json()) as { data?: any; expiry?: number };
    if (typeof parsed.expiry !== 'number' || parsed.expiry <= Date.now()) {
      await cache.delete(cacheKey);
      return null;
    }
    return { data: parsed.data, expiry: parsed.expiry };
  } catch {
    return null;
  }
}

async function writePersistentCache(cacheKey: string, cacheEntry: { data: any; expiry: number }) {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    const cache = await caches.open(PERSISTENT_CACHE_NAME);
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(cacheEntry), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
  } catch {}
}

/**
 * Fetches JSON and caches it in memory or the browser Cache API.
 * Only caches GET requests.
 */
export async function fetchJsonCached<T>(
  url: string,
  options?: {
    ttl?: number;
    usePersistentCache?: boolean;
    init?: RequestInit;
  }
): Promise<T> {
  const { ttl = 300000, usePersistentCache = false, init } = options || {};

  if (init?.method && init.method !== 'GET') {
    return fetchJson<T>(url, init);
  }

  const cacheKey = `api_cache_${url}`;
  const now = Date.now();
  if (usePersistentCache) cleanupLegacyLocalStorageCache();

  // 1. Check Memory Cache
  if (memoryCache[cacheKey] && memoryCache[cacheKey].expiry > now) {
    return memoryCache[cacheKey].data as T;
  }

  // 2. Check Persistent Cache
  if (usePersistentCache) {
    const cached = await readPersistentCache(cacheKey);
    if (cached) {
      memoryCache[cacheKey] = cached;
      return cached.data as T;
    }
  }

  // 3. Fetch Fresh
  if (inflightCache[cacheKey]) {
    return inflightCache[cacheKey] as Promise<T>;
  }
  inflightCache[cacheKey] = (async () => {
    try {
      const data = await fetchJson<T>(url, init);

      // 4. Update Caches
      const cacheEntry = { data, expiry: now + ttl };
      memoryCache[cacheKey] = cacheEntry;
      if (usePersistentCache) await writePersistentCache(cacheKey, cacheEntry);
      return data;
    } finally {
      delete inflightCache[cacheKey];
    }
  })();

  return inflightCache[cacheKey] as Promise<T>;
}

export async function deleteSim(id: string): Promise<void> {
  await fetchJson(`${API_URL}/api/sim/${id}`, {
    method: 'DELETE',
  });
}

export async function pauseSim(id: string): Promise<{ status: 'paused' }> {
  return fetchJson<{ status: 'paused' }>(`${API_URL}/api/sim/${id}/pause`, {
    method: 'POST',
  });
}

export async function resumeSim(id: string): Promise<{ status: 'pending' | 'running' | 'paused' }> {
  return fetchJson<{ status: 'pending' | 'running' | 'paused' }>(
    `${API_URL}/api/sim/${id}/resume`,
    { method: 'POST' }
  );
}

export async function setSimPinned(id: string, pinned: boolean): Promise<void> {
  await fetchJson(`${API_URL}/api/sim/${id}/pin`, {
    method: 'POST',
    body: JSON.stringify({ pinned }),
  });
}

export async function listBlizzardCredentialProfiles(): Promise<BlizzardCredentialProfile[]> {
  const data = await fetchJson<{ profiles?: BlizzardCredentialProfile[] }>(
    `${API_URL}/api/auth/bnet/credential-profiles`
  );
  return Array.isArray(data?.profiles) ? data.profiles : [];
}

export async function saveBlizzardCredentialProfile(input: {
  name?: string;
  client_id: string;
  client_secret: string;
}): Promise<BlizzardCredentialProfile> {
  const data = await fetchJson<{ profile: BlizzardCredentialProfile }>(
    `${API_URL}/api/auth/bnet/credential-profiles`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
  return data.profile;
}

export async function renameBlizzardCredentialProfile(
  id: string,
  name: string
): Promise<BlizzardCredentialProfile> {
  const data = await fetchJson<{ profile: BlizzardCredentialProfile }>(
    `${API_URL}/api/auth/bnet/credential-profiles/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }
  );
  return data.profile;
}

export async function deleteBlizzardCredentialProfile(id: string): Promise<void> {
  await fetchJson(`${API_URL}/api/auth/bnet/credential-profiles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export interface HistoryStats {
  size_bytes: number;
  count: number;
}

export async function getHistoryStats(): Promise<HistoryStats> {
  return fetchJson<HistoryStats>(`${API_URL}/api/history/stats`);
}

/** List simulations with optional filters */
export async function listSims(params?: {
  player?: string;
  realm?: string;
  linked_only?: boolean;
  unlinked_only?: boolean;
  pinned_only?: boolean;
}): Promise<SimSummary[]> {
  const query = new URLSearchParams();
  if (params?.player) query.set('player', params.player);
  if (params?.realm) query.set('realm', params.realm);
  if (params?.linked_only) query.set('linked_only', 'true');
  if (params?.unlinked_only) query.set('unlinked_only', 'true');
  if (params?.pinned_only) query.set('pinned_only', 'true');
  const qs = query.toString();
  return fetchJson<SimSummary[]>(`${API_URL}/api/sims${qs ? '?' + qs : ''}`);
}

export type QueueScope = 'mine' | 'all';

export interface QueueJob {
  id: string;
  status: 'pending' | 'running' | 'paused';
  sim_type: string;
  created_at: string;
  fight_style: string;
  iterations: number;
  player_name?: string | null;
  player_class?: string | null;
  realm?: string | null;
  batch_id?: string | null;
  queue_position: number | null;
  progress: number;
  progress_stage?: string | null;
  progress_detail?: string | null;
  owner?: string | null;
}

export interface QueueResponse {
  jobs: QueueJob[];
  queued_count: number;
  running_count: number;
  max_parallel_jobs: number;
  scope: QueueScope;
  can_manage_all: boolean;
}

export async function getQueue(scope?: QueueScope): Promise<QueueResponse> {
  const query = scope ? `?scope=${scope}` : '';
  return fetchJson<QueueResponse>(`${API_URL}/api/queue${query}`);
}

export async function reorderQueue(jobIds: string[], scope: QueueScope): Promise<void> {
  await fetchJson(`${API_URL}/api/queue/reorder`, {
    method: 'POST',
    body: JSON.stringify({ job_ids: jobIds, scope }),
  });
}

export async function runNextSimulation(id: string, scope: QueueScope): Promise<void> {
  await fetchJson(`${API_URL}/api/sim/${encodeURIComponent(id)}/run-next?scope=${scope}`, {
    method: 'POST',
  });
}

/** Get current system CPU usage (Desktop only) */
export async function getSystemStats(): Promise<SystemStats> {
  return fetchJson<SystemStats>(`${API_URL}/api/system-stats`);
}

export async function clearHistory(): Promise<void> {
  await fetchJson(`${API_URL}/api/history/clear`, {
    method: 'POST',
  });
}

export interface AppConfig {
  max_scenarios: number;
  max_jobs: number;
  max_parallel_jobs: number;
}

export async function getConfig(): Promise<AppConfig> {
  return fetchJson<AppConfig>(`${API_URL}/api/config`);
}

export async function updateConfig(config: Partial<AppConfig>): Promise<void> {
  await fetchJson(`${API_URL}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

export async function listSavedRoutes(): Promise<SavedRoute[]> {
  return fetchJson<SavedRoute[]>(`${API_URL}/api/routes`);
}

export async function saveRoute(route: {
  name: string;
  dungeon: string;
  level?: number;
  pull_count?: number;
  timer_seconds?: number;
  affixes?: string;
  route_data: string;
}): Promise<SavedRoute> {
  return fetchJson<SavedRoute>(`${API_URL}/api/routes`, {
    method: 'POST',
    body: JSON.stringify(route),
  });
}

export async function deleteSavedRoute(id: string): Promise<void> {
  await fetchJson(`${API_URL}/api/routes/${id}`, {
    method: 'DELETE',
  });
}

export interface SavedCharacterProfile {
  id: string;
  name: string;
  realm: string;
  region: string;
  class?: string;
  spec?: string;
  simc_input: string;
  created_at: string;
}

export async function listCharacterProfiles(options?: {
  name?: string;
  realm?: string;
  region?: string;
}): Promise<SavedCharacterProfile[]> {
  const params = new URLSearchParams();
  if (options?.name) params.set('name', options.name);
  if (options?.realm) params.set('realm', options.realm);
  if (options?.region) params.set('region', options.region);
  const query = params.toString();
  return fetchJson<SavedCharacterProfile[]>(
    `${API_URL}/api/character-profiles${query ? '?' + query : ''}`
  );
}

export async function saveCharacterProfile(profile: {
  name: string;
  realm: string;
  region: string;
  class?: string;
  spec?: string;
  simc_input: string;
}): Promise<SavedCharacterProfile> {
  return fetchJson<SavedCharacterProfile>(`${API_URL}/api/character-profiles`, {
    method: 'POST',
    body: JSON.stringify(profile),
  });
}

export async function deleteCharacterProfile(id: string): Promise<void> {
  await fetchJson(`${API_URL}/api/character-profiles/${id}`, {
    method: 'DELETE',
  });
}

export async function listInstances(): Promise<Instance[]> {
  return fetchJson<Instance[]>(`${API_URL}/api/instances`);
}

export type GameContextCapability = {
  status: 'ready' | 'degraded' | 'unavailable' | string;
  reason?: string;
};

export type GameContext = {
  schema_version: number;
  active_season?: {
    id?: number;
    name?: string;
    short_name?: string;
    periods?: Array<Record<string, unknown>>;
  };
  pools?: Record<string, number>;
  pool_members?: Record<string, number[]>;
  current_expansion?: { number?: number | null };
  classes?: Array<{
    name: string;
    aliases?: string[];
    wow_id?: number | null;
    specs?: Array<{ name: string; id: number }>;
  }>;
  rules?: {
    catalyst_currency_id?: number;
    item_conversion_id?: number | null;
    dps_enchant_slots?: string[];
    upgrade_track_fingerprint?: string[];
  };
  source?: Record<string, unknown>;
  capabilities?: Record<string, GameContextCapability>;
  warnings?: string[];
};

export async function getGameContext(): Promise<GameContext> {
  return fetchJson<GameContext>(`${API_URL}/api/game-context`);
}

export interface DungeonAffix {
  id: number;
  name: string;
  description: string;
  icon: string | null;
  wowhead_url?: string | null;
  spell_id: number | null;
}

export interface DungeonInfo {
  id: number;
  name: string;
  description?: string;
  zone: string | null;
  slug?: string | null;
  short_name?: string | null;
  wowhead_id: number | null;
  num_bosses: number | null;
  expansion: number | null;
  expansion_name?: string | null;
  map_id?: number | null;
  challenge_mode_id?: number | null;
  minimum_level?: number | null;
  keystone_timer_ms?: number | null;
  keystone_upgrades?: number[];
  encounters?: string[];
  blizzard_href?: string | null;
  image_url?: string;
  linked_code?: string;
  blizzard_api_data?: unknown;
}

export interface DungeonSeasonData {
  season_id: number;
  season_name: string;
  current_affixes: DungeonAffix[];
  rotation_dungeons: DungeonInfo[];
}

export interface MythicKeystoneDungeonIndexEntry {
  id: number;
  name: string;
  key?: { href?: string };
}

export interface MythicKeystoneDungeonIndexResponse {
  dungeons: MythicKeystoneDungeonIndexEntry[];
}

export interface MythicKeystoneUpgradeTimer {
  upgrade_level: number;
  qualifying_duration: number;
}

export interface MythicKeystoneDungeonDetail {
  id: number;
  name: string;
  map?: { id?: number; name?: string };
  zone?: { slug?: string };
  dungeon?: { id?: number; name?: string; key?: { href?: string } };
  keystone_upgrades?: MythicKeystoneUpgradeTimer[];
  is_tracked?: boolean;
}

export async function getDungeonData(): Promise<DungeonSeasonData> {
  return fetchJson<DungeonSeasonData>(`${API_URL}/api/dungeons`);
}

export async function getMythicKeystoneDungeonIndex(
  region = 'us'
): Promise<MythicKeystoneDungeonIndexResponse> {
  return fetchJson<MythicKeystoneDungeonIndexResponse>(
    `${API_URL}/api/blizzard/mythic-keystone/dungeon/index?region=${encodeURIComponent(region)}`
  );
}

export async function getMythicKeystoneDungeonDetail(
  dungeonId: number,
  region = 'us'
): Promise<MythicKeystoneDungeonDetail> {
  return fetchJson<MythicKeystoneDungeonDetail>(
    `${API_URL}/api/blizzard/mythic-keystone/dungeon/${encodeURIComponent(String(dungeonId))}?region=${encodeURIComponent(region)}`
  );
}

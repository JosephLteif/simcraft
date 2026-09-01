import type { DropItem } from '../drop-finder/types';

export const WISHLIST_STORAGE_KEY = 'whylowdps_wishlist';
const GLOBAL_WISHLIST_OWNER_KEY = 'global';

export type RoadmapSource = 'drop' | 'owned-upgrade';

export interface WishlistItem extends DropItem {
  roadmap_id?: string;
  roadmap_source?: RoadmapSource;
  roadmap_completed?: boolean;
  wishlist_slot?: string;
  added_at?: number;
  wishlist_ilvl?: number;
  wishlist_bonus_id?: number;
  wishlist_upgrade_label?: string;
}

interface WishlistStorageV3 {
  version: 3;
  by_owner: Record<string, WishlistItem[]>;
}

export interface WishlistOwnerInput {
  name?: string | null;
  realm?: string | null;
  region?: string | null;
  className?: string | null;
}

export interface WishlistOwnerSummary {
  key: string;
  count: number;
  name?: string;
  realm?: string;
  region?: string;
  className?: string;
  label: string;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getWishlistItemLevel(item: Pick<WishlistItem, 'wishlist_ilvl' | 'ilevel'>): number {
  return Number(item.wishlist_ilvl ?? item.ilevel ?? 0);
}

export function getRoadmapItemId(
  item: Pick<
    WishlistItem,
    | 'item_id'
    | 'wishlist_slot'
    | 'wishlist_ilvl'
    | 'ilevel'
    | 'wishlist_bonus_id'
    | 'bonus_ids'
    | 'roadmap_source'
  >
): string {
  const source = item.roadmap_source || 'drop';
  const slot = (item.wishlist_slot || '').trim().toLowerCase();
  const level = getWishlistItemLevel(item);
  const bonusIds = [...(Array.isArray(item.bonus_ids) ? item.bonus_ids : [])];
  if (item.wishlist_bonus_id && !bonusIds.includes(item.wishlist_bonus_id)) {
    bonusIds.push(item.wishlist_bonus_id);
  }
  return `${source}:${item.item_id}:${slot}:${level}:${[...bonusIds].sort((a, b) => a - b).join('/')}`;
}

function normalizeItemList(items: unknown): WishlistItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter(
      (item): item is WishlistItem =>
        !!item && typeof item === 'object' && typeof (item as WishlistItem).item_id === 'number'
    )
    .map((item) => {
      const normalized: WishlistItem = {
        ...item,
        roadmap_source: item.roadmap_source === 'owned-upgrade' ? 'owned-upgrade' : 'drop',
        roadmap_completed: item.roadmap_completed === true,
      };
      normalized.roadmap_id = item.roadmap_id || getRoadmapItemId(normalized);
      return normalized;
    });
}

function dedupeItemList(items: WishlistItem[]): WishlistItem[] {
  const seen = new Set<string>();
  const out: WishlistItem[] = [];
  for (const item of items) {
    const key = item.roadmap_id || getRoadmapItemId(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function resolveOwnerKey(ownerKey?: string): string {
  const normalized = (ownerKey || '').trim().toLowerCase();
  return normalized || GLOBAL_WISHLIST_OWNER_KEY;
}

function canonicalOwnerKey(ownerKey?: string): string {
  const resolved = resolveOwnerKey(ownerKey);
  if (resolved === GLOBAL_WISHLIST_OWNER_KEY) return resolved;
  const parsed = parseWishlistOwnerKey(resolved);
  return buildWishlistOwnerKey({
    name: parsed.name,
    realm: parsed.realm,
    region: parsed.region,
  });
}

function emptyStorage(): WishlistStorageV3 {
  return {
    version: 3,
    by_owner: {},
  };
}

function readStorage(): WishlistStorageV3 {
  if (!canUseStorage()) return emptyStorage();

  try {
    const raw = localStorage.getItem(WISHLIST_STORAGE_KEY);
    if (!raw) return emptyStorage();
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return {
        version: 3,
        by_owner: {
          [GLOBAL_WISHLIST_OWNER_KEY]: dedupeItemList(normalizeItemList(parsed)),
        },
      };
    }

    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed.version === 2 || parsed.version === 3) &&
      parsed.by_owner &&
      typeof parsed.by_owner === 'object'
    ) {
      const byOwner: Record<string, WishlistItem[]> = {};
      for (const [key, value] of Object.entries(parsed.by_owner as Record<string, unknown>)) {
        const resolvedKey = resolveOwnerKey(key);
        const parsedOwner = parseWishlistOwnerKey(resolvedKey);
        const canonicalKey = buildWishlistOwnerKey({
          name: parsedOwner.name,
          realm: parsedOwner.realm,
          region: parsedOwner.region,
        });
        byOwner[canonicalKey] = dedupeItemList([
          ...(byOwner[canonicalKey] || []),
          ...normalizeItemList(value),
        ]);
      }
      return {
        version: 3,
        by_owner: byOwner,
      };
    }

    return emptyStorage();
  } catch {
    return emptyStorage();
  }
}

function writeStorage(storage: WishlistStorageV3): void {
  if (!canUseStorage()) return;
  localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(storage));
}

export function buildWishlistOwnerKey(owner: WishlistOwnerInput): string {
  const name = (owner.name || '').trim().toLowerCase();
  const realm = (owner.realm || '').trim().toLowerCase();
  const region = (owner.region || '').trim().toLowerCase();

  // Canonical owner key: character identity only.
  // Excluding class avoids duplicate buckets when class labels drift.
  if (!name && !realm && !region) return GLOBAL_WISHLIST_OWNER_KEY;
  return `${region}:${realm}:${name}`;
}

export function buildWishlistHref(owner: WishlistOwnerInput): string {
  return `/wishlist?owner=${encodeURIComponent(buildWishlistOwnerKey(owner))}`;
}

export function parseWishlistOwnerKey(ownerKey: string): WishlistOwnerInput {
  const key = resolveOwnerKey(ownerKey);
  if (key === GLOBAL_WISHLIST_OWNER_KEY) return {};
  const parts = key.split(':');
  return {
    region: parts[0] || undefined,
    realm: parts[1] || undefined,
    name: parts[2] || undefined,
    className: parts.slice(3).join(':') || undefined,
  };
}

function ownerLabel(ownerKey: string): string {
  const parsed = parseWishlistOwnerKey(ownerKey);
  if (!parsed.name && !parsed.realm && !parsed.region && !parsed.className) {
    return 'Global Wishlist';
  }
  return parsed.name || 'Character Wishlist';
}

export function loadWishlist(ownerKey?: string): WishlistItem[] {
  const storage = readStorage();
  if (canUseStorage()) {
    try {
      const raw = localStorage.getItem(WISHLIST_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) || (parsed && typeof parsed === 'object' && parsed.version === 2)) {
        writeStorage(storage);
      }
    } catch {
      // Keep the normalized in-memory view when legacy storage cannot be rewritten.
    }
  }
  const key = canonicalOwnerKey(ownerKey);
  return dedupeItemList(normalizeItemList(storage.by_owner[key]));
}

export function loadDropWishlist(ownerKey?: string): WishlistItem[] {
  return loadWishlist(ownerKey).filter((item) => item.roadmap_source !== 'owned-upgrade');
}

export function saveWishlist(items: WishlistItem[], ownerKey?: string): void {
  const storage = readStorage();
  const key = canonicalOwnerKey(ownerKey);
  storage.by_owner[key] = dedupeItemList(normalizeItemList(items));
  writeStorage(storage);
}

export function saveRoadmapEntry(entry: WishlistItem, ownerKey?: string): WishlistItem[] {
  const current = loadWishlist(ownerKey);
  const normalized: WishlistItem = {
    ...entry,
    roadmap_source: entry.roadmap_source || 'drop',
  };
  normalized.roadmap_id = entry.roadmap_id || getRoadmapItemId(normalized);
  const index = current.findIndex((item) => item.roadmap_id === normalized.roadmap_id);
  if (index >= 0) current[index] = { ...current[index], ...normalized };
  else current.push(normalized);
  saveWishlist(current, ownerKey);
  return current;
}

export function setRoadmapCompleted(
  roadmapId: string,
  completed: boolean,
  ownerKey?: string
): WishlistItem[] {
  const next = loadWishlist(ownerKey).map((item) =>
    item.roadmap_id === roadmapId ? { ...item, roadmap_completed: completed } : item
  );
  saveWishlist(next, ownerKey);
  return next;
}

export function removeRoadmapEntry(roadmapId: string, ownerKey?: string): WishlistItem[] {
  const next = loadWishlist(ownerKey).filter((item) => item.roadmap_id !== roadmapId);
  saveWishlist(next, ownerKey);
  return next;
}

export function clearWishlist(ownerKey?: string): void {
  const storage = readStorage();
  const key = canonicalOwnerKey(ownerKey);
  delete storage.by_owner[key];
  writeStorage(storage);
}

export function clearDropWishlist(ownerKey?: string): void {
  saveWishlist(
    loadWishlist(ownerKey).filter((item) => item.roadmap_source === 'owned-upgrade'),
    ownerKey
  );
}

export function isWishlisted(itemId: number, ownerKey?: string, ilvl?: number): boolean {
  const targetIlvl = Number(ilvl ?? 0);
  return loadDropWishlist(ownerKey).some((item) => {
    const itemIlvl = Number(item.wishlist_ilvl ?? item.ilevel ?? 0);
    return item.item_id === itemId && itemIlvl === targetIlvl;
  });
}

export function removeFromWishlist(
  itemId: number,
  ownerKey?: string,
  ilvl?: number
): WishlistItem[] {
  const targetIlvl = Number(ilvl ?? 0);
  const next = loadWishlist(ownerKey).filter((item) => {
    const itemIlvl = Number(item.wishlist_ilvl ?? item.ilevel ?? 0);
    return !(
      item.roadmap_source !== 'owned-upgrade' &&
      item.item_id === itemId &&
      itemIlvl === targetIlvl
    );
  });
  saveWishlist(next, ownerKey);
  return next;
}

export function toggleWishlistItem(
  item: DropItem,
  slot?: string,
  ownerKey?: string
): WishlistItem[] {
  const current = loadWishlist(ownerKey);
  const targetIlvl = Number(item.ilevel || 0);
  const exists = current.some(
    (entry) =>
      entry.roadmap_source !== 'owned-upgrade' &&
      entry.item_id === item.item_id &&
      getWishlistItemLevel(entry) === targetIlvl
  );
  const next = exists
    ? current.filter(
        (entry) =>
          !(
            entry.roadmap_source !== 'owned-upgrade' &&
            entry.item_id === item.item_id &&
            getWishlistItemLevel(entry) === targetIlvl
          )
      )
    : [
        ...current,
        {
          ...item,
          wishlist_slot: slot,
          added_at: Date.now(),
          roadmap_source: 'drop' as const,
          roadmap_id: getRoadmapItemId({
            ...item,
            wishlist_slot: slot,
            roadmap_source: 'drop',
          }),
        },
      ];
  saveWishlist(next, ownerKey);
  return next;
}

export function addItemsToWishlist(
  entries: Array<{
    item: DropItem;
    slot?: string;
    meta?: { ilvl?: number; bonusId?: number; upgradeLabel?: string };
  }>,
  ownerKey?: string
): { items: WishlistItem[]; added: number; skipped: number } {
  const current = loadWishlist(ownerKey);
  const existingKeys = new Set(
    current
      .filter((entry) => entry.roadmap_source !== 'owned-upgrade')
      .map((entry) => `${entry.item_id}:${Number(entry.wishlist_ilvl ?? entry.ilevel ?? 0)}`)
  );
  const next = [...current];
  let added = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry?.item || typeof entry.item.item_id !== 'number') continue;
    const key = `${entry.item.item_id}:${Number(entry.meta?.ilvl ?? entry.item.ilevel ?? 0)}`;
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }
    next.push({
      ...entry.item,
      wishlist_slot: entry.slot,
      added_at: Date.now(),
      wishlist_ilvl: entry.meta?.ilvl,
      wishlist_bonus_id: entry.meta?.bonusId,
      wishlist_upgrade_label: entry.meta?.upgradeLabel,
      roadmap_source: 'drop',
      roadmap_id: getRoadmapItemId({
        ...entry.item,
        wishlist_slot: entry.slot,
        wishlist_ilvl: entry.meta?.ilvl,
        wishlist_bonus_id: entry.meta?.bonusId,
        roadmap_source: 'drop',
      }),
    });
    existingKeys.add(key);
    added += 1;
  }

  saveWishlist(next, ownerKey);
  return { items: next, added, skipped };
}

export function toggleWishlistEntry(
  entry: {
    item: DropItem;
    slot?: string;
    meta?: { ilvl?: number; bonusId?: number; upgradeLabel?: string };
  },
  ownerKey?: string
): WishlistItem[] {
  const current = loadWishlist(ownerKey);
  const targetIlvl = Number(entry.meta?.ilvl ?? entry.item.ilevel ?? 0);
  const exists = current.some(
    (it) =>
      it.roadmap_source !== 'owned-upgrade' &&
      it.item_id === entry.item.item_id &&
      getWishlistItemLevel(it) === targetIlvl
  );
  const next = exists
    ? current.filter(
        (it) =>
          !(
            it.roadmap_source !== 'owned-upgrade' &&
            it.item_id === entry.item.item_id &&
            getWishlistItemLevel(it) === targetIlvl
          )
      )
    : [
        ...current,
        {
          ...entry.item,
          wishlist_slot: entry.slot,
          added_at: Date.now(),
          wishlist_ilvl: entry.meta?.ilvl,
          wishlist_bonus_id: entry.meta?.bonusId,
          wishlist_upgrade_label: entry.meta?.upgradeLabel,
          roadmap_source: 'drop' as const,
          roadmap_id: getRoadmapItemId({
            ...entry.item,
            wishlist_slot: entry.slot,
            wishlist_ilvl: entry.meta?.ilvl,
            wishlist_bonus_id: entry.meta?.bonusId,
            roadmap_source: 'drop',
          }),
        },
      ];
  saveWishlist(next, ownerKey);
  return next;
}

export function listWishlistOwners(): WishlistOwnerSummary[] {
  const storage = readStorage();
  return Object.entries(storage.by_owner)
    .map(([key, items]) => {
      const resolvedKey = resolveOwnerKey(key);
      const parsed = parseWishlistOwnerKey(resolvedKey);
      return {
        key: resolvedKey,
        count: dedupeItemList(normalizeItemList(items)).length,
        name: parsed.name || undefined,
        realm: parsed.realm || undefined,
        region: parsed.region || undefined,
        className: parsed.className || undefined,
        label: ownerLabel(resolvedKey),
      };
    })
    .sort((a, b) => {
      if (a.key === GLOBAL_WISHLIST_OWNER_KEY) return 1;
      if (b.key === GLOBAL_WISHLIST_OWNER_KEY) return -1;
      return a.label.localeCompare(b.label);
    });
}

import type { ResolveGearResponse, ResolvedItem } from './types';
import { slotCandidatesFromWishlistSlot, slotFromInventoryType } from './gear-utils';
import { getRoadmapItemId, getWishlistItemLevel, type WishlistItem } from './wishlist';

export type UpgradeMode = 'highest_affordable' | 'all_affordable' | 'highest_any' | 'all_any';

export interface UpgradeCandidate {
  uid: string;
  slot: string;
  item_id: number;
  bonus_ids?: number[];
  ilevel: number;
  target_ilevel: number;
  costs: Record<string, number>;
  currency_id?: number | null;
  discounted?: boolean;
  is_equipped?: boolean;
}

export interface UpgradeCurrency {
  id: number;
  amount: number;
  name: string;
  icon: string;
}

export interface UpgradePrepareResponse {
  candidates: UpgradeCandidate[];
  currencies: Record<string, UpgradeCurrency>;
}

export type RoadmapStatus = 'to_obtain' | 'ready_to_upgrade' | 'complete';

export interface RoadmapStatusResult {
  status: RoadmapStatus;
  candidate?: UpgradeCandidate;
  ownedItem?: ResolvedItem;
}

export interface RoadmapUpgradeItemInfo {
  name?: string;
  icon?: string;
  quality?: number;
  inventory_type?: number;
}

export interface LegacyUpgradePlanEntry {
  uid: string;
  completed: boolean;
}

export interface LegacyUpgradePlanMigrationResult {
  items: WishlistItem[];
  unmatched: LegacyUpgradePlanEntry[];
  migratedCount: number;
}

export function readLegacyUpgradePlan(raw: string | null): LegacyUpgradePlanEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is { uid: string; completed?: boolean } =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as { uid?: unknown }).uid === 'string'
      )
      .map((entry) => ({ uid: entry.uid, completed: entry.completed === true }));
  } catch {
    return [];
  }
}

export function buildOwnedUpgradeRoadmapEntry(
  candidate: UpgradeCandidate,
  info?: RoadmapUpgradeItemInfo
): WishlistItem {
  const entry: WishlistItem = {
    item_id: candidate.item_id,
    name: info?.name || `Item ${candidate.item_id}`,
    icon: info?.icon || 'inv_misc_questionmark',
    quality: info?.quality || 0,
    ilevel: candidate.ilevel,
    encounter: '',
    source_type: 'Current gear',
    inventory_type: info?.inventory_type,
    bonus_ids: candidate.bonus_ids || [],
    wishlist_slot: candidate.slot,
    wishlist_ilvl: candidate.target_ilevel,
    wishlist_upgrade_label: `Upgrade to ${candidate.target_ilevel}`,
    roadmap_source: 'owned-upgrade',
    roadmap_completed: false,
  };
  entry.roadmap_id = getRoadmapItemId(entry);
  return entry;
}

export function mergeLegacyUpgradePlan(
  current: WishlistItem[],
  legacyEntries: LegacyUpgradePlanEntry[],
  candidates: UpgradeCandidate[],
  itemInfo: Record<number, RoadmapUpgradeItemInfo>
): LegacyUpgradePlanMigrationResult {
  const items = [...current];
  const unmatched: LegacyUpgradePlanEntry[] = [];
  let migratedCount = 0;

  for (const legacy of legacyEntries) {
    const candidate = candidates.find((item) => item.uid === legacy.uid);
    if (!candidate) {
      unmatched.push(legacy);
      continue;
    }

    const entry = buildOwnedUpgradeRoadmapEntry(candidate, itemInfo[candidate.item_id]);
    const existingIndex = items.findIndex((item) => item.roadmap_id === entry.roadmap_id);
    if (existingIndex >= 0) {
      items[existingIndex] = {
        ...items[existingIndex],
        roadmap_completed: items[existingIndex].roadmap_completed || legacy.completed,
      };
    } else {
      items.push({ ...entry, roadmap_completed: legacy.completed });
    }
    migratedCount += 1;
  }

  return { items, unmatched, migratedCount };
}

function candidateSlots(item: Pick<WishlistItem, 'wishlist_slot' | 'inventory_type'>): string[] {
  if (item.inventory_type === 11) return ['finger1', 'finger2'];
  if (item.inventory_type === 12) return ['trinket1', 'trinket2'];
  const mapped = slotFromInventoryType(item.inventory_type);
  if (mapped) return [mapped];
  return slotCandidatesFromWishlistSlot(item.wishlist_slot || '');
}

function targetBonusIds(item: WishlistItem): number[] {
  if (Array.isArray(item.bonus_ids) && item.bonus_ids.length > 0) return item.bonus_ids;
  return item.wishlist_bonus_id ? [item.wishlist_bonus_id] : [];
}

function matchesItemIdAndSlot(item: ResolvedItem | UpgradeCandidate, entry: WishlistItem): boolean {
  const slots = candidateSlots(entry);
  return item.item_id === entry.item_id && (slots.length === 0 || slots.includes(item.slot));
}

function hasBonusOverlap(item: ResolvedItem | UpgradeCandidate, entry: WishlistItem): boolean {
  const wanted = targetBonusIds(entry);
  if (wanted.length === 0) return false;
  return wanted.some((bonusId) => (item.bonus_ids || []).includes(bonusId));
}

function findBestMatch<T extends ResolvedItem | UpgradeCandidate>(
  items: T[],
  entry: WishlistItem
): T | undefined {
  const compatible = items.filter((item) => matchesItemIdAndSlot(item, entry));
  return compatible.find((item) => hasBonusOverlap(item, entry)) || compatible[0];
}

function flattenResolvedItems(resolved: ResolveGearResponse | null): ResolvedItem[] {
  if (!resolved) return [];
  return Object.values(resolved.slots).flatMap((slot) => [
    ...(slot.equipped ? [slot.equipped] : []),
    ...slot.alternatives,
  ]);
}

export function getRoadmapStatus(
  entry: WishlistItem,
  resolved: ResolveGearResponse | null,
  candidates: UpgradeCandidate[]
): RoadmapStatusResult {
  if (entry.roadmap_completed) return { status: 'complete' };

  const ownedItem = findBestMatch(flattenResolvedItems(resolved), entry);
  if (!ownedItem) return { status: 'to_obtain' };

  const candidate = findBestMatch(candidates, entry);
  const targetLevel = getWishlistItemLevel(entry);
  if (entry.roadmap_source === 'owned-upgrade' && ownedItem.ilevel < targetLevel) {
    return { status: 'ready_to_upgrade', candidate, ownedItem };
  }
  if (ownedItem.ilevel < targetLevel && !candidate) {
    return { status: 'to_obtain', ownedItem };
  }
  if (candidate && (candidate.ilevel < targetLevel || candidate.target_ilevel > candidate.ilevel)) {
    return { status: 'ready_to_upgrade', candidate, ownedItem };
  }

  return { status: 'complete', ownedItem, candidate };
}

export function getRoadmapCandidateIds(
  entries: WishlistItem[],
  candidates: UpgradeCandidate[]
): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    const result = getRoadmapStatus(entry, null, candidates);
    if (result.candidate) ids.add(result.candidate.uid);
  }
  return ids;
}

export function getCandidateRoadmapId(
  candidate: Pick<UpgradeCandidate, 'item_id' | 'slot' | 'target_ilevel' | 'ilevel'> & {
    bonus_ids?: number[];
  }
): string {
  return getRoadmapItemId({
    item_id: candidate.item_id,
    wishlist_slot: candidate.slot,
    wishlist_ilvl: candidate.target_ilevel,
    ilevel: candidate.ilevel,
    bonus_ids: candidate.bonus_ids || [],
    roadmap_source: 'owned-upgrade',
  });
}

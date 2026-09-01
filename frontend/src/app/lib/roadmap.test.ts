import { describe, expect, it } from 'vitest';
import type { ResolveGearResponse, ResolvedItem } from './types';
import {
  buildOwnedUpgradeRoadmapEntry,
  getRoadmapStatus,
  mergeLegacyUpgradePlan,
  type UpgradeCandidate,
} from './roadmap';
import type { WishlistItem } from './wishlist';

const candidate: UpgradeCandidate = {
  uid: 'gear:head:100',
  slot: 'head',
  item_id: 100,
  bonus_ids: [7],
  ilevel: 626,
  target_ilevel: 639,
  costs: { '200': 15 },
  currency_id: 200,
  is_equipped: true,
};

const roadmapEntry = (overrides: Partial<WishlistItem> = {}): WishlistItem => ({
  item_id: 100,
  name: 'Target Helm',
  icon: 'inv_helmet',
  quality: 4,
  ilevel: 639,
  encounter: 'Boss',
  wishlist_slot: 'head',
  wishlist_ilvl: 639,
  bonus_ids: [7],
  roadmap_source: 'drop',
  roadmap_completed: false,
  roadmap_id: 'drop:100:head:639:7',
  ...overrides,
});

const resolvedItem = (ilevel: number): ResolvedItem =>
  ({
    uid: `resolved:${ilevel}`,
    slot: 'head',
    item_id: 100,
    ilevel,
    bonus_ids: [7],
  }) as ResolvedItem;

const resolved = (item: ResolvedItem): ResolveGearResponse =>
  ({
    slots: { head: { equipped: item, alternatives: [] } },
  }) as unknown as ResolveGearResponse;

describe('gear roadmap status', () => {
  it('derives missing, ready, and automatic complete states', () => {
    const entry = roadmapEntry();

    expect(getRoadmapStatus(entry, null, [candidate]).status).toBe('to_obtain');
    expect(getRoadmapStatus(entry, resolved(resolvedItem(626)), [candidate])).toMatchObject({
      status: 'ready_to_upgrade',
      candidate,
    });
    expect(getRoadmapStatus(entry, resolved(resolvedItem(639)), []).status).toBe('complete');
  });

  it('lets manual completion override status and reopening restore automatic status', () => {
    const completed = roadmapEntry({ roadmap_completed: true });
    expect(getRoadmapStatus(completed, null, [candidate]).status).toBe('complete');
    expect(
      getRoadmapStatus({ ...completed, roadmap_completed: false }, resolved(resolvedItem(626)), [
        candidate,
      ]).status
    ).toBe('ready_to_upgrade');
  });

  it('keeps a saved owned upgrade ready even before crest candidates are loaded', () => {
    const entry = buildOwnedUpgradeRoadmapEntry(candidate);
    expect(getRoadmapStatus(entry, resolved(resolvedItem(626)), []).status).toBe(
      'ready_to_upgrade'
    );
    expect(getRoadmapStatus(entry, resolved(resolvedItem(639)), []).status).toBe('complete');
  });
});

describe('legacy upgrade-plan migration', () => {
  it('merges matched entries, preserves completion, and reports unmatched entries', () => {
    const result = mergeLegacyUpgradePlan(
      [],
      [
        { uid: candidate.uid, completed: true },
        { uid: 'missing-uid', completed: false },
      ],
      [candidate],
      { 100: { name: 'Target Helm', icon: 'inv_helmet', quality: 4, inventory_type: 1 } }
    );

    expect(result.migratedCount).toBe(1);
    expect(result.unmatched).toEqual([{ uid: 'missing-uid', completed: false }]);
    expect(result.items[0]).toMatchObject({
      roadmap_source: 'owned-upgrade',
      roadmap_completed: true,
      wishlist_slot: 'head',
      wishlist_ilvl: 639,
    });
  });

  it('does not clear completion already recorded on a roadmap entry', () => {
    const entry = buildOwnedUpgradeRoadmapEntry(candidate);
    const result = mergeLegacyUpgradePlan(
      [{ ...entry, roadmap_completed: true }],
      [{ uid: candidate.uid, completed: false }],
      [candidate],
      {}
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].roadmap_completed).toBe(true);
  });
});

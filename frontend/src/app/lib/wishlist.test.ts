import { beforeEach, describe, expect, it } from 'vitest';
import {
  WISHLIST_STORAGE_KEY,
  buildWishlistOwnerKey,
  clearDropWishlist,
  loadDropWishlist,
  loadWishlist,
  saveWishlist,
  toggleWishlistEntry,
} from './wishlist';

const dropItem = (ilevel: number) => ({
  item_id: 100,
  name: `Target ${ilevel}`,
  icon: 'inv_helmet',
  quality: 4,
  ilevel,
  encounter: 'Boss',
  bonus_ids: [ilevel],
});

describe('wishlist roadmap storage', () => {
  beforeEach(() => localStorage.clear());

  it('migrates v2 owner buckets to roadmap entries and writes v3 on save', () => {
    const ownerKey = buildWishlistOwnerKey({ name: 'Hero', realm: 'Realm', region: 'US' });
    localStorage.setItem(
      WISHLIST_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        by_owner: { [ownerKey]: [dropItem(639)] },
      })
    );

    const loaded = loadWishlist(ownerKey);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      item_id: 100,
      roadmap_source: 'drop',
      roadmap_completed: false,
    });
    expect(loaded[0].roadmap_id).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(WISHLIST_STORAGE_KEY) || '{}').version).toBe(3);
  });

  it('preserves v3 owned-upgrade metadata and completion state', () => {
    const entry = {
      ...dropItem(626),
      roadmap_id: 'owned-upgrade:100:head:639:7',
      roadmap_source: 'owned-upgrade',
      roadmap_completed: true,
      wishlist_slot: 'head',
      wishlist_ilvl: 639,
    };
    localStorage.setItem(
      WISHLIST_STORAGE_KEY,
      JSON.stringify({ version: 3, by_owner: { global: [entry] } })
    );

    expect(loadWishlist('global')[0]).toMatchObject({
      roadmap_id: entry.roadmap_id,
      roadmap_source: 'owned-upgrade',
      roadmap_completed: true,
      wishlist_slot: 'head',
      wishlist_ilvl: 639,
    });
  });

  it('keeps separate roadmap entries for different target levels', () => {
    toggleWishlistEntry({ item: dropItem(626), slot: 'head', meta: { ilvl: 626 } });
    toggleWishlistEntry({ item: dropItem(639), slot: 'head', meta: { ilvl: 639 } });

    expect(loadWishlist()).toHaveLength(2);
  });

  it('keeps drop-only helpers from removing crest-owned roadmap entries', () => {
    saveWishlist([
      { ...dropItem(639), roadmap_source: 'drop' },
      { ...dropItem(626), roadmap_source: 'owned-upgrade' },
    ]);

    expect(loadDropWishlist()).toHaveLength(1);
    clearDropWishlist();
    expect(loadDropWishlist()).toHaveLength(0);
    expect(loadWishlist()).toHaveLength(1);
  });
});

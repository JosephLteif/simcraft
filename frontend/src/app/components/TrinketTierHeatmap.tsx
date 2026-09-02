'use client';

import Link from 'next/link';
import { Heart, Search } from 'lucide-react';
import { useState } from 'react';
import type { DropItem } from '../drop-finder/types';
import { getIconUrl, getWowheadData, getWowheadUrl, useItemInfo } from '../lib/useItemInfo';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import {
  addItemsToWishlist,
  buildWishlistHref,
  buildWishlistOwnerKey,
  isWishlisted,
  removeFromWishlist,
} from '../lib/wishlist';

type HeatmapResult = {
  name: string;
  dps: number;
  delta: number;
  items: Array<Record<string, unknown>>;
};

type TrinketPairItem = {
  label: string;
  itemId: number;
  name: string;
  ilevel: number;
  bonusIds: number[];
};

type WishlistPairEntry = {
  item: DropItem;
  slot: string;
  meta: { ilvl: number; bonusId?: number; upgradeLabel?: string };
};

type AnchoredComparisonRow = {
  key: string;
  item: TrinketPairItem;
  delta: number;
  result: HeatmapResult;
};

const TIER_SLOTS = ['head', 'shoulder', 'chest', 'hands', 'legs'] as const;
const TIER_SLOT_LABELS: Record<string, string> = {
  head: 'Head',
  shoulder: 'Shoulder',
  chest: 'Chest',
  hands: 'Hands',
  legs: 'Legs',
};

function deltaToBg(delta: number, maxAbs: number): string {
  if (maxAbs <= 0) return 'rgba(63,63,70,0.35)';
  const normalized = Math.min(1, Math.abs(delta) / maxAbs);
  if (delta >= 0) {
    return `rgba(52, 211, 153, ${0.18 + normalized * 0.42})`;
  }
  return `rgba(248, 113, 113, ${0.18 + normalized * 0.42})`;
}

function itemLabel(item: Record<string, unknown>): string {
  const name = typeof item.name === 'string' ? item.name : 'Unknown';
  const ilvl = typeof item.ilevel === 'number' ? item.ilevel : 0;
  return `${name} (${ilvl})`;
}

function parseTrinketPairItem(item: Record<string, unknown>): TrinketPairItem {
  const itemId = typeof item.item_id === 'number' ? item.item_id : 0;
  const name = typeof item.name === 'string' ? item.name : 'Unknown';
  const ilevel = typeof item.ilevel === 'number' ? item.ilevel : 0;
  const bonusIds = Array.isArray(item.bonus_ids)
    ? item.bonus_ids.filter((v): v is number => typeof v === 'number')
    : [];
  return {
    label: `${name} (${ilevel})`,
    itemId,
    name,
    ilevel,
    bonusIds,
  };
}

function trinketItemsFromResult(result: HeatmapResult): Array<Record<string, unknown>> {
  return (result.items || []).filter(isTrinketItem);
}

function isTrinketItem(item: Record<string, unknown>): boolean {
  const slot = typeof item.slot === 'string' ? item.slot : '';
  return slot === 'trinket1' || slot === 'trinket2';
}

function pairMatchesSearch(
  pair: { leftItem: TrinketPairItem; rightItem: TrinketPairItem },
  query: string
): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const searchable = `${pair.leftItem.label} + ${pair.rightItem.label}`.toLowerCase();
  return terms.every((term) => searchable.includes(term));
}

function wishlistEntryForTrinket(item: Record<string, unknown>): WishlistPairEntry | null {
  const itemId = Number(item.item_id || 0);
  const ilevel = Number(item.ilevel || 0);
  if (!Number.isFinite(itemId) || itemId <= 0 || !Number.isFinite(ilevel) || ilevel <= 0) {
    return null;
  }

  const bonusIds = Array.isArray(item.bonus_ids)
    ? item.bonus_ids.filter((value): value is number => typeof value === 'number')
    : [];
  const dropItem: DropItem = {
    item_id: itemId,
    name: typeof item.name === 'string' ? item.name : 'Unknown Trinket',
    icon: typeof item.icon === 'string' ? item.icon : 'inv_misc_questionmark',
    quality: Number(item.quality || 4),
    ilevel,
    encounter: typeof item.encounter === 'string' ? item.encounter : 'Trinket Matrix',
    instance_name: typeof item.instance_name === 'string' ? item.instance_name : undefined,
    source_type: typeof item.source_type === 'string' ? item.source_type : 'Trinket Matrix',
    inventory_type: 12,
    bonus_ids: bonusIds,
  };

  return {
    item: dropItem,
    slot: 'trinket',
    meta: {
      ilvl: ilevel,
      bonusId: bonusIds[0],
      upgradeLabel: typeof item.upgrade === 'string' ? item.upgrade : undefined,
    },
  };
}

function wishlistEntriesForResult(result: HeatmapResult): WishlistPairEntry[] {
  return trinketItemsFromResult(result)
    .filter((item) => item.origin !== 'equipped' && item.is_kept !== true)
    .map(wishlistEntryForTrinket)
    .filter((entry): entry is WishlistPairEntry => entry !== null);
}

function trinketResultIsCurrentSeason(result: HeatmapResult): boolean {
  const trinkets = trinketItemsFromResult(result);

  // Equipped items are the fixed side of a locked-slot comparison, not a
  // candidate from the drop pool. Missing metadata is kept for old jobs.
  return trinkets
    .filter((item) => item.origin !== 'equipped')
    .every((item) => item.current_season !== false);
}

export default function TrinketTierHeatmap({
  baseDps,
  results,
  elapsedSeconds,
  allowLegacyToggle = false,
  playerName,
  playerRealm,
  playerRegion,
}: {
  baseDps: number;
  results: HeatmapResult[];
  elapsedSeconds?: number;
  allowLegacyToggle?: boolean;
  playerName?: string;
  playerRealm?: string;
  playerRegion?: string;
}) {
  const [includeLegacyTrinkets, setIncludeLegacyTrinkets] = useState(false);
  const [trinketSearch, setTrinketSearch] = useState('');
  const [wishlistFeedback, setWishlistFeedback] = useState('');
  const [wishlistRefreshTick, setWishlistRefreshTick] = useState(0);
  const wishlistOwnerKey = buildWishlistOwnerKey({
    name: playerName,
    realm: playerRealm,
    region: playerRegion,
  });
  const wishlistHref = buildWishlistHref({
    name: playerName,
    realm: playerRealm,
    region: playerRegion,
  });
  const allTrinketResults = results.filter((result) => {
    const items = Array.isArray(result.items) ? result.items : [];
    return items.some((i) => i.heatmap_kind === 'trinket');
  });
  const trinketResults = allTrinketResults.filter(
    (result) => (allowLegacyToggle && includeLegacyTrinkets) || trinketResultIsCurrentSeason(result)
  );

  const tierResults = results.filter((result) => {
    const items = Array.isArray(result.items) ? result.items : [];
    return items.some((i) => i.heatmap_kind === 'tier');
  });

  const baselineResult = results.find((result) => {
    const items = Array.isArray(result.items) ? result.items : [];
    const trinketCount = items.filter((item) => {
      const slot = typeof item.slot === 'string' ? item.slot : '';
      return slot === 'trinket1' || slot === 'trinket2';
    }).length;
    return trinketCount >= 2 && Math.abs(result.delta || 0) < 0.0001;
  });
  const baselineTrinkets = (baselineResult?.items || [])
    .filter(isTrinketItem)
    .map(parseTrinketPairItem)
    .sort((a, b) => {
      const aSlot = (baselineResult?.items || []).find((x) => x.item_id === a.itemId)?.slot;
      const bSlot = (baselineResult?.items || []).find((x) => x.item_id === b.itemId)?.slot;
      return String(aSlot).localeCompare(String(bSlot));
    })
    .slice(0, 2);

  const trinketLabels = new Set<string>();
  const trinketCells = new Map<string, HeatmapResult>();
  let maxAbsTrinketDelta = 0;

  for (const result of trinketResults) {
    const trinkets = trinketItemsFromResult(result);
    if (trinkets.length < 2) continue;
    const labelA = itemLabel(trinkets[0]);
    const labelB = itemLabel(trinkets[1]);
    trinketLabels.add(labelA);
    trinketLabels.add(labelB);
    const key = [labelA, labelB].sort().join('||');
    const existing = trinketCells.get(key);
    if (!existing || result.dps > existing.dps) {
      trinketCells.set(key, result);
    }
    maxAbsTrinketDelta = Math.max(maxAbsTrinketDelta, Math.abs(result.delta || 0));
  }

  const trinketAxes = [...trinketLabels].sort((a, b) => a.localeCompare(b));
  const totalTrinketPairs =
    trinketAxes.length >= 2 ? (trinketAxes.length * (trinketAxes.length - 1)) / 2 : 0;
  const simulatedTrinketPairs = trinketCells.size;
  const missingTrinketPairs = Math.max(0, totalTrinketPairs - simulatedTrinketPairs);
  const rankedTrinketPairs = [...trinketCells.entries()]
    .map(([key, result]) => {
      const trinkets = trinketItemsFromResult(result)
        .map(parseTrinketPairItem)
        .sort((a, b) => a.label.localeCompare(b.label));
      const leftItem = trinkets[0] || {
        label: 'Unknown',
        itemId: 0,
        name: 'Unknown',
        ilevel: 0,
        bonusIds: [],
      };
      const rightItem = trinkets[1] || {
        label: 'Unknown',
        itemId: 0,
        name: 'Unknown',
        ilevel: 0,
        bonusIds: [],
      };
      const delta = result?.delta || 0;
      return {
        key,
        leftItem,
        rightItem,
        delta,
        result,
      };
    })
    .sort((a, b) => b.delta - a.delta);

  const labelFrequency = new Map<string, number>();
  for (const pair of rankedTrinketPairs) {
    labelFrequency.set(pair.leftItem.label, (labelFrequency.get(pair.leftItem.label) || 0) + 1);
    labelFrequency.set(pair.rightItem.label, (labelFrequency.get(pair.rightItem.label) || 0) + 1);
  }
  const [anchorLabel, anchorCount] = [...labelFrequency.entries()].sort(
    (a, b) => b[1] - a[1]
  )[0] || ['', 0];
  const shouldUseAnchoredCompactView =
    trinketAxes.length >= 3 &&
    missingTrinketPairs > 0 &&
    anchorCount >= Math.max(2, Math.floor((trinketAxes.length * 2) / 3));

  const anchoredRows: AnchoredComparisonRow[] = shouldUseAnchoredCompactView
    ? rankedTrinketPairs
        .filter(
          (pair) => pair.leftItem.label === anchorLabel || pair.rightItem.label === anchorLabel
        )
        .map((pair) => {
          const item = pair.leftItem.label === anchorLabel ? pair.rightItem : pair.leftItem;
          return {
            key: pair.key,
            item,
            delta: pair.delta,
            result: pair.result,
          };
        })
        .sort((a, b) => b.delta - a.delta)
    : [];

  const anchorItem =
    shouldUseAnchoredCompactView && rankedTrinketPairs.length > 0
      ? (() => {
          const firstPair = rankedTrinketPairs.find(
            (pair) => pair.leftItem.label === anchorLabel || pair.rightItem.label === anchorLabel
          );
          if (!firstPair) return null;
          return firstPair.leftItem.label === anchorLabel
            ? firstPair.leftItem
            : firstPair.rightItem;
        })()
      : null;

  const maxAbsAnchoredDelta =
    anchoredRows.length > 0 ? Math.max(...anchoredRows.map((r) => Math.abs(r.delta)), 1) : 1;

  const searchQuery = trinketSearch.trim();
  const filteredRankedTrinketPairs = rankedTrinketPairs.filter((pair) =>
    pairMatchesSearch(pair, searchQuery)
  );
  const showAnchoredCompactView = shouldUseAnchoredCompactView && searchQuery.length === 0;
  const positiveTrinketPairs = filteredRankedTrinketPairs
    .filter((pair) => pair.delta > 0)
    .slice(0, 12);
  const topPairsSplitIndex = Math.ceil(positiveTrinketPairs.length / 2);
  const topPairsColA = positiveTrinketPairs.slice(0, topPairsSplitIndex);
  const topPairsColB = positiveTrinketPairs.slice(topPairsSplitIndex);
  const rankedPairItemQueries = rankedTrinketPairs.flatMap((pair) => [
    { item_id: pair.leftItem.itemId, bonus_ids: pair.leftItem.bonusIds },
    { item_id: pair.rightItem.itemId, bonus_ids: pair.rightItem.bonusIds },
  ]);
  const topPairItemQueries = positiveTrinketPairs.flatMap((pair) => [
    { item_id: pair.leftItem.itemId, bonus_ids: pair.leftItem.bonusIds },
    { item_id: pair.rightItem.itemId, bonus_ids: pair.rightItem.bonusIds },
  ]);
  const anchoredItemQueries =
    anchorItem && showAnchoredCompactView
      ? [
          { item_id: anchorItem.itemId, bonus_ids: anchorItem.bonusIds },
          ...anchoredRows.map((row) => ({
            item_id: row.item.itemId,
            bonus_ids: row.item.bonusIds,
          })),
        ]
      : [];
  const baselineItemQueries = baselineTrinkets.map((item) => ({
    item_id: item.itemId,
    bonus_ids: item.bonusIds,
  }));
  const topPairItemInfo = useItemInfo([
    ...rankedPairItemQueries,
    ...topPairItemQueries,
    ...anchoredItemQueries,
    ...baselineItemQueries,
  ]);
  useWowheadTooltips([
    positiveTrinketPairs,
    topPairItemInfo,
    anchoredRows,
    anchorItem,
    baselineTrinkets,
  ]);

  const togglePairWishlist = (result: HeatmapResult) => {
    const entries = wishlistEntriesForResult(result);
    if (entries.length === 0) {
      setWishlistFeedback('No trinket upgrades in this pair to save.');
      return;
    }

    const allWishlisted = entries.every((entry) =>
      isWishlisted(entry.item.item_id, wishlistOwnerKey, entry.meta.ilvl)
    );
    if (allWishlisted) {
      for (const entry of entries) {
        removeFromWishlist(entry.item.item_id, wishlistOwnerKey, entry.meta.ilvl);
      }
      setWishlistFeedback(
        `Removed ${entries.length} trinket${entries.length === 1 ? '' : 's'} from wishlist.`
      );
      setWishlistRefreshTick((value) => value + 1);
      return;
    }

    const { added, skipped } = addItemsToWishlist(entries, wishlistOwnerKey);
    if (added > 0 && skipped > 0) {
      setWishlistFeedback(
        `Added ${added} trinket${added === 1 ? '' : 's'}; ${skipped} already saved.`
      );
    } else if (added > 0) {
      setWishlistFeedback(`Added ${added} trinket${added === 1 ? '' : 's'} to wishlist.`);
    } else {
      setWishlistFeedback('This trinket pair is already in your wishlist.');
    }
    setWishlistRefreshTick((value) => value + 1);
  };

  const isPairWishlisted = (result: HeatmapResult) => {
    void wishlistRefreshTick;
    const entries = wishlistEntriesForResult(result);
    return (
      entries.length > 0 &&
      entries.every((entry) => isWishlisted(entry.item.item_id, wishlistOwnerKey, entry.meta.ilvl))
    );
  };

  const wishlistButton = (result: HeatmapResult) => {
    const saved = isPairWishlisted(result);
    return (
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          togglePairWishlist(result);
        }}
        title={saved ? 'Remove trinket pair from wishlist' : 'Add trinket pair to wishlist'}
        aria-label={saved ? 'Remove trinket pair from wishlist' : 'Add trinket pair to wishlist'}
        className={`inline-flex items-center justify-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
          saved
            ? 'border-rose-400/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
            : 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300 hover:bg-zinc-500/20'
        }`}
      >
        <Heart className="h-3.5 w-3.5" fill={saved ? 'currentColor' : 'none'} strokeWidth={1.7} />
        {saved ? 'Saved' : 'Save pair'}
      </button>
    );
  };

  const tierRows = new Map<number, Record<string, { total: number; count: number }>>();
  let maxAbsTierDelta = 0;
  for (const result of tierResults) {
    const meta = (result.items || []).find((item) => item.heatmap_kind === 'tier') || {};
    const pieceCount =
      typeof meta.tier_pieces === 'number'
        ? meta.tier_pieces
        : (result.items || []).filter((item) => {
            const slot = typeof item.slot === 'string' ? item.slot : '';
            return TIER_SLOTS.includes(slot as (typeof TIER_SLOTS)[number]);
          }).length;
    if (!pieceCount) continue;
    if (!tierRows.has(pieceCount)) {
      tierRows.set(pieceCount, {});
    }
    const row = tierRows.get(pieceCount)!;
    for (const item of result.items || []) {
      const slot = typeof item.slot === 'string' ? item.slot : '';
      if (!TIER_SLOTS.includes(slot as (typeof TIER_SLOTS)[number])) continue;
      if (!row[slot]) row[slot] = { total: 0, count: 0 };
      row[slot].total += result.delta || 0;
      row[slot].count += 1;
      maxAbsTierDelta = Math.max(maxAbsTierDelta, Math.abs(result.delta || 0));
    }
  }

  const tierPieceCounts = [...tierRows.keys()].sort((a, b) => a - b);

  const tierSlotPriority = TIER_SLOTS.map((slot) => {
    let total = 0;
    let count = 0;
    for (const pieceCount of tierPieceCounts) {
      const row = tierRows.get(pieceCount) || {};
      const entry = row[slot];
      if (!entry || entry.count === 0) continue;
      total += entry.total;
      count += entry.count;
    }
    const score = count > 0 ? total / count : Number.NEGATIVE_INFINITY;
    return { slot, score };
  })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-6">
      <div className="card border-gold/10 bg-gold/[0.02] p-5">
        <h3 className="text-sm font-semibold text-zinc-100">
          Personalized Trinket / Tier Heatmaps
        </h3>
        <p className="mt-1 text-xs text-zinc-400">
          Baseline DPS: {Math.round(baseDps).toLocaleString()}.
        </p>
        {typeof elapsedSeconds === 'number' && elapsedSeconds > 0 ? (
          <p className="mt-1 text-xs text-zinc-500">
            Elapsed: {(elapsedSeconds / 60).toFixed(1)} minutes
          </p>
        ) : null}
      </div>

      {allowLegacyToggle && allTrinketResults.length > 0 && (
        <div className="card border-gold/10 bg-gold/[0.02] p-4">
          <label className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-zinc-100">
                Include Old-Season / Turbulent Trinkets
              </span>
              <span className="mt-1 block text-xs text-zinc-400">
                Off by default: show only trinkets from the current season raid and dungeon
                rotation.
              </span>
            </span>
            <input
              type="checkbox"
              aria-label="Include old-season and Turbulent trinkets"
              checked={includeLegacyTrinkets}
              onChange={(event) => setIncludeLegacyTrinkets(event.target.checked)}
              className="accent-gold h-5 w-5 shrink-0"
            />
          </label>
          {trinketResults.length === 0 ? (
            <p className="mt-3 text-xs text-amber-200">
              No current-season trinket results are available in this run. Enable the toggle to show
              older sources.
            </p>
          ) : null}
        </div>
      )}

      {trinketAxes.length > 0 && (
        <div className="card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-muted text-xs font-medium tracking-widest uppercase">
                Trinket Pair Matrix
              </h4>
              <p className="mt-1 text-xs text-zinc-400">
                Simulated pairs: {simulatedTrinketPairs.toLocaleString()} /{' '}
                {totalTrinketPairs.toLocaleString()}
                {searchQuery ? (
                  <span className="text-zinc-300">
                    {' '}
                    · Matching pairs: {filteredRankedTrinketPairs.length.toLocaleString()}
                  </span>
                ) : null}
                {missingTrinketPairs > 0 ? (
                  <span className="text-amber-300">
                    {' '}
                    ({missingTrinketPairs.toLocaleString()} missing from this run)
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="trinket-pair-search">
                Search trinkets or combinations
              </label>
              <div className="relative min-w-[min(100%,18rem)]">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-zinc-500"
                  aria-hidden="true"
                />
                <input
                  id="trinket-pair-search"
                  type="search"
                  value={trinketSearch}
                  onChange={(event) => setTrinketSearch(event.target.value)}
                  placeholder="Search trinkets or combinations..."
                  className="border-border bg-surface-2 w-full rounded border py-1.5 pr-3 pl-8 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
                />
              </div>
              <Link
                href={wishlistHref}
                className="border-border bg-surface-2 rounded border px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white"
              >
                Open Wishlist
              </Link>
            </div>
          </div>
          {wishlistFeedback ? (
            <p className="-mt-2 mb-3 text-xs text-zinc-300" role="status">
              {wishlistFeedback}
            </p>
          ) : null}

          {positiveTrinketPairs.length > 0 && (
            <div className="border-border bg-surface-2 mb-4 rounded-md border p-3">
              {baselineTrinkets.length === 2 && (
                <div className="mb-3 rounded-lg border border-sky-400/35 bg-sky-400/[0.08] px-3 py-2.5 shadow-[0_0_0_1px_rgba(56,189,248,0.10)_inset]">
                  <p className="mb-1 text-[11px] font-semibold tracking-wider text-sky-200 uppercase">
                    Base Trinket Pair
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-100">
                    {baselineTrinkets.map((item, idx) => {
                      const info = topPairItemInfo[item.itemId];
                      const whData = item.itemId
                        ? `item=${item.itemId}${(() => {
                            const extra = getWowheadData(
                              item.bonusIds,
                              item.ilevel || info?.ilevel || 0
                            );
                            return extra ? `&${extra}` : '';
                          })()}`
                        : undefined;
                      return (
                        <span
                          key={`${item.itemId}-${idx}`}
                          className="inline-flex items-center gap-2"
                        >
                          <a
                            href={item.itemId > 0 ? getWowheadUrl(item.itemId) : '#'}
                            target="_blank"
                            rel="noreferrer"
                            data-wowhead={whData}
                            className="inline-flex items-center gap-1.5 hover:underline"
                          >
                            <img
                              src={getIconUrl(info?.icon || 'inv_misc_questionmark')}
                              alt={item.name}
                              className="h-4 w-4 rounded-sm border border-white/10"
                            />
                            {item.label}
                          </a>
                          {idx === 0 ? <span className="text-zinc-500">+</span> : null}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              <h5 className="mb-2 text-[11px] font-medium tracking-wider text-zinc-400 uppercase">
                Top Upgrade Pairs
              </h5>
              <div className="grid gap-2 md:grid-cols-2">
                {[topPairsColA, topPairsColB].map((column, colIdx) => (
                  <div key={`top-col-${colIdx}`} className="space-y-2">
                    {column.map((pair, rowIdx) => {
                      const idx = colIdx === 0 ? rowIdx : topPairsSplitIndex + rowIdx;
                      const leftInfo = topPairItemInfo[pair.leftItem.itemId];
                      const rightInfo = topPairItemInfo[pair.rightItem.itemId];
                      const leftIcon = getIconUrl(leftInfo?.icon || 'inv_misc_questionmark');
                      const rightIcon = getIconUrl(rightInfo?.icon || 'inv_misc_questionmark');
                      const leftWhData = pair.leftItem.itemId
                        ? `item=${pair.leftItem.itemId}${(() => {
                            const extra = getWowheadData(
                              pair.leftItem.bonusIds,
                              pair.leftItem.ilevel || leftInfo?.ilevel || 0
                            );
                            return extra ? `&${extra}` : '';
                          })()}`
                        : undefined;
                      const rightWhData = pair.rightItem.itemId
                        ? `item=${pair.rightItem.itemId}${(() => {
                            const extra = getWowheadData(
                              pair.rightItem.bonusIds,
                              pair.rightItem.ilevel || rightInfo?.ilevel || 0
                            );
                            return extra ? `&${extra}` : '';
                          })()}`
                        : undefined;

                      return (
                        <div
                          key={pair.key}
                          className="border-border/60 flex items-center justify-between gap-3 rounded border bg-black/10 px-2 py-1.5"
                        >
                          <span className="flex items-center gap-2 text-xs text-zinc-300">
                            <span>{idx + 1}.</span>
                            <a
                              href={
                                pair.leftItem.itemId > 0 ? getWowheadUrl(pair.leftItem.itemId) : '#'
                              }
                              target="_blank"
                              rel="noreferrer"
                              data-wowhead={leftWhData}
                              className="inline-flex items-center gap-1.5 hover:underline"
                            >
                              <img
                                src={leftIcon}
                                alt={pair.leftItem.name}
                                className="h-4 w-4 rounded-sm border border-white/10"
                              />
                              {pair.leftItem.label}
                            </a>
                            <span>+</span>
                            <a
                              href={
                                pair.rightItem.itemId > 0
                                  ? getWowheadUrl(pair.rightItem.itemId)
                                  : '#'
                              }
                              target="_blank"
                              rel="noreferrer"
                              data-wowhead={rightWhData}
                              className="inline-flex items-center gap-1.5 hover:underline"
                            >
                              <img
                                src={rightIcon}
                                alt={pair.rightItem.name}
                                className="h-4 w-4 rounded-sm border border-white/10"
                              />
                              {pair.rightItem.label}
                            </a>
                          </span>
                          <div className="flex items-center gap-2">
                            {wishlistButton(pair.result)}
                            <span className="text-xs font-medium text-emerald-300">
                              +{Math.round(pair.delta).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          {showAnchoredCompactView && anchorItem && (
            <div className="border-border bg-surface-2 mt-3 rounded-md border p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/35 bg-amber-300/[0.10] px-3 py-2 shadow-[0_0_0_1px_rgba(252,211,77,0.10)_inset]">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold tracking-wider text-amber-200 uppercase">
                    Active Anchor
                  </p>
                  <a
                    href={anchorItem.itemId > 0 ? getWowheadUrl(anchorItem.itemId) : '#'}
                    target="_blank"
                    rel="noreferrer"
                    data-wowhead={
                      anchorItem.itemId
                        ? `item=${anchorItem.itemId}${(() => {
                            const extra = getWowheadData(anchorItem.bonusIds, anchorItem.ilevel);
                            return extra ? `&${extra}` : '';
                          })()}`
                        : undefined
                    }
                    className="mt-0.5 inline-flex max-w-full items-center gap-2 text-sm font-semibold text-zinc-50 hover:underline"
                  >
                    <img
                      src={getIconUrl(
                        topPairItemInfo[anchorItem.itemId]?.icon || 'inv_misc_questionmark'
                      )}
                      alt={anchorItem.name}
                      className="h-5 w-5 rounded-sm border border-white/10"
                    />
                    <span className="truncate">{anchorItem.label}</span>
                  </a>
                </div>
                <p className="text-[11px] text-amber-100/85">
                  Compact view enabled for sparse anchor-style sims.
                </p>
              </div>

              <div className="space-y-1.5">
                {anchoredRows.map((row) => {
                  const pct = Math.min(1, Math.abs(row.delta) / maxAbsAnchoredDelta);
                  const whData = row.item.itemId
                    ? `item=${row.item.itemId}${(() => {
                        const extra = getWowheadData(row.item.bonusIds, row.item.ilevel);
                        return extra ? `&${extra}` : '';
                      })()}`
                    : undefined;
                  return (
                    <div
                      key={row.key}
                      className="border-border/60 grid grid-cols-[minmax(220px,1fr)_minmax(260px,2fr)_110px] items-center gap-2 rounded border bg-black/10 px-2 py-1.5"
                    >
                      <a
                        href={row.item.itemId > 0 ? getWowheadUrl(row.item.itemId) : '#'}
                        target="_blank"
                        rel="noreferrer"
                        data-wowhead={whData}
                        className="inline-flex min-w-0 items-center gap-2 text-xs text-zinc-200 hover:underline"
                      >
                        <img
                          src={getIconUrl(
                            topPairItemInfo[row.item.itemId]?.icon || 'inv_misc_questionmark'
                          )}
                          alt={row.item.name}
                          className="h-4 w-4 rounded-sm border border-white/10"
                        />
                        <span className="truncate">{row.item.label}</span>
                      </a>

                      <div className="border-border/60 relative h-6 rounded border bg-zinc-950/70">
                        <span className="absolute inset-y-0 left-1/2 w-px bg-zinc-600" />
                        {row.delta >= 0 ? (
                          <span
                            className="absolute top-0.5 bottom-0.5 left-1/2 rounded-r bg-emerald-400/75"
                            style={{ width: `${pct * 50}%` }}
                          />
                        ) : (
                          <span
                            className="absolute top-0.5 right-1/2 bottom-0.5 rounded-l bg-red-300/75"
                            style={{ width: `${pct * 50}%` }}
                          />
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        {wishlistButton(row.result)}
                        <span
                          className={`text-right text-xs font-semibold ${row.delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}
                        >
                          {row.delta >= 0 ? '+' : ''}
                          {Math.round(row.delta).toLocaleString()} DPS
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {!showAnchoredCompactView && (
            <div className="border-border bg-surface-2 mt-3 rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium tracking-wider text-zinc-400 uppercase">
                  Ranked Pair Results
                </p>
                <p className="text-[11px] text-zinc-500">
                  Two trinkets per row, sorted by DPS gain.
                </p>
              </div>
              <div className="space-y-1.5">
                {filteredRankedTrinketPairs.length === 0 ? (
                  <p className="border-border rounded border border-dashed px-3 py-4 text-center text-xs text-zinc-500">
                    No trinket pairs match &quot;{searchQuery}&quot;.
                  </p>
                ) : (
                  filteredRankedTrinketPairs.map((pair) => {
                    const pct = Math.min(1, Math.abs(pair.delta) / Math.max(1, maxAbsTrinketDelta));
                    const leftInfo = topPairItemInfo[pair.leftItem.itemId];
                    const rightInfo = topPairItemInfo[pair.rightItem.itemId];
                    const leftWhData = pair.leftItem.itemId
                      ? `item=${pair.leftItem.itemId}${(() => {
                          const extra = getWowheadData(
                            pair.leftItem.bonusIds,
                            pair.leftItem.ilevel || leftInfo?.ilevel || 0
                          );
                          return extra ? `&${extra}` : '';
                        })()}`
                      : undefined;
                    const rightWhData = pair.rightItem.itemId
                      ? `item=${pair.rightItem.itemId}${(() => {
                          const extra = getWowheadData(
                            pair.rightItem.bonusIds,
                            pair.rightItem.ilevel || rightInfo?.ilevel || 0
                          );
                          return extra ? `&${extra}` : '';
                        })()}`
                      : undefined;

                    return (
                      <div
                        key={pair.key}
                        className="border-border/60 grid grid-cols-[minmax(320px,1.3fr)_minmax(260px,1fr)_110px] items-center gap-2 rounded border bg-black/10 px-2 py-1.5"
                      >
                        <div className="inline-flex min-w-0 items-center gap-2 text-xs text-zinc-200">
                          <a
                            href={
                              pair.leftItem.itemId > 0 ? getWowheadUrl(pair.leftItem.itemId) : '#'
                            }
                            target="_blank"
                            rel="noreferrer"
                            data-wowhead={leftWhData}
                            className="inline-flex min-w-0 items-center gap-1.5 hover:underline"
                          >
                            <img
                              src={getIconUrl(leftInfo?.icon || 'inv_misc_questionmark')}
                              alt={pair.leftItem.name}
                              className="h-4 w-4 rounded-sm border border-white/10"
                            />
                            <span className="truncate">{pair.leftItem.label}</span>
                          </a>
                          <span className="text-zinc-500">+</span>
                          <a
                            href={
                              pair.rightItem.itemId > 0 ? getWowheadUrl(pair.rightItem.itemId) : '#'
                            }
                            target="_blank"
                            rel="noreferrer"
                            data-wowhead={rightWhData}
                            className="inline-flex min-w-0 items-center gap-1.5 hover:underline"
                          >
                            <img
                              src={getIconUrl(rightInfo?.icon || 'inv_misc_questionmark')}
                              alt={pair.rightItem.name}
                              className="h-4 w-4 rounded-sm border border-white/10"
                            />
                            <span className="truncate">{pair.rightItem.label}</span>
                          </a>
                        </div>

                        <div className="border-border/60 relative h-6 rounded border bg-zinc-950/70">
                          <span className="absolute inset-y-0 left-1/2 w-px bg-zinc-600" />
                          {pair.delta >= 0 ? (
                            <span
                              className="absolute top-0.5 bottom-0.5 left-1/2 rounded-r bg-emerald-400/75"
                              style={{ width: `${pct * 50}%` }}
                            />
                          ) : (
                            <span
                              className="absolute top-0.5 right-1/2 bottom-0.5 rounded-l bg-red-300/75"
                              style={{ width: `${pct * 50}%` }}
                            />
                          )}
                        </div>

                        <div className="flex flex-col items-end gap-1">
                          {wishlistButton(pair.result)}
                          <span
                            className={`text-right text-xs font-semibold ${pair.delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}
                          >
                            {pair.delta >= 0 ? '+' : ''}
                            {Math.round(pair.delta).toLocaleString()} DPS
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tierResults.length > 0 && (
        <div className="card p-5">
          <h4 className="text-muted mb-3 text-xs font-medium tracking-widest uppercase">
            Tier Slot Impact Matrix
          </h4>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="overflow-auto">
              <table className="min-w-[560px] border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="border-border bg-surface-2 border px-3 py-2 text-left text-zinc-300">
                      Tier Pieces
                    </th>
                    {TIER_SLOTS.map((slot) => (
                      <th
                        key={slot}
                        className="border-border bg-surface-2 border px-3 py-2 text-zinc-300"
                      >
                        {TIER_SLOT_LABELS[slot]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tierPieceCounts.map((count) => {
                    const row = tierRows.get(count) || {};
                    return (
                      <tr key={count}>
                        <th className="border-border bg-surface-2 border px-3 py-2 text-left font-medium text-zinc-300">
                          {count}p
                        </th>
                        {TIER_SLOTS.map((slot) => {
                          const entry = row[slot];
                          const avg = entry && entry.count > 0 ? entry.total / entry.count : 0;
                          return (
                            <td
                              key={slot}
                              className="border-border border px-3 py-2 text-center text-zinc-100"
                              style={{ backgroundColor: deltaToBg(avg, maxAbsTierDelta) }}
                            >
                              {entry
                                ? `${avg >= 0 ? '+' : ''}${Math.round(avg).toLocaleString()}`
                                : '-'}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="border-border bg-surface-2 rounded-md border p-3">
              <h5 className="mb-2 text-[11px] font-medium tracking-wider text-zinc-400 uppercase">
                Tier Priority
              </h5>
              {tierSlotPriority.length === 0 ? (
                <p className="text-xs text-zinc-500">Not enough tier data yet.</p>
              ) : (
                <ol className="space-y-1.5 text-xs text-zinc-200">
                  {tierSlotPriority.map((entry, idx) => (
                    <li key={entry.slot} className="flex items-center justify-between gap-2">
                      <span className="text-zinc-300">
                        {idx + 1}. {TIER_SLOT_LABELS[entry.slot]}
                      </span>
                      <span className={entry.score >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                        {entry.score >= 0 ? '+' : ''}
                        {Math.round(entry.score).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

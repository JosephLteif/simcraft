import Link from 'next/link';
import { ArrowDown, ArrowUp, Check, ClipboardList, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SLOT_LABELS } from '../lib/types';
import { getIconUrl } from '../lib/useItemInfo';
import {
  buildOwnedUpgradeRoadmapEntry,
  getCandidateRoadmapId,
  mergeLegacyUpgradePlan,
  readLegacyUpgradePlan,
} from '../lib/roadmap';
import {
  WISHLIST_STORAGE_KEY,
  loadDropWishlist,
  loadWishlist,
  removeRoadmapEntry,
  saveWishlist,
  setRoadmapCompleted,
  type WishlistItem,
} from '../lib/wishlist';

export interface UpgradePlanCandidate {
  uid: string;
  slot: string;
  item_id: number;
  bonus_ids?: number[];
  ilevel: number;
  target_ilevel: number;
  costs: Record<string, number>;
  is_equipped?: boolean;
  discounted?: boolean;
}

export interface UpgradePlanCurrency {
  id: number;
  amount: number;
  name: string;
  icon: string;
}

interface UpgradePlanItemInfo {
  name: string;
  icon: string;
}

interface UpgradePlanProps {
  storageKey: string;
  wishlistOwnerKey: string;
  candidates: UpgradePlanCandidate[];
  selectedUids: Set<string>;
  itemInfo: Record<number, UpgradePlanItemInfo>;
  currencies: Record<string, UpgradePlanCurrency>;
  effectiveCurrencies: Record<string, UpgradePlanCurrency>;
}

function getCurrencyIconUrl(iconName: string): string {
  const raw = String(iconName || '').trim();
  if (!raw) return getIconUrl('inv_misc_questionmark');
  if (/^https?:\/\//i.test(raw)) return raw;
  const noExt = raw.replace(/\.(jpg|jpeg|png|webp)$/i, '');
  const base = noExt.split('/').pop() || noExt;
  return `https://wow.zamimg.com/images/wow/icons/large/${base}.jpg`;
}

function formatCandidateCost(
  candidate: UpgradePlanCandidate,
  currencies: Record<string, UpgradePlanCurrency>
): string {
  const entries = Object.entries(candidate.costs)
    .filter(([, amount]) => amount > 0)
    .sort(([a], [b]) => Number(a) - Number(b));
  if (entries.length === 0) return candidate.discounted ? 'Free (discounted)' : 'Cost unavailable';
  return entries
    .map(([cid, amount]) => `${currencies[cid]?.name || `Currency ${cid}`} x${amount}`)
    .join(', ');
}

export default function UpgradePlan({
  storageKey,
  wishlistOwnerKey,
  candidates,
  selectedUids,
  itemInfo,
  currencies,
  effectiveCurrencies,
}: UpgradePlanProps) {
  const [entries, setEntries] = useState<WishlistItem[]>([]);
  const [wishlistCount, setWishlistCount] = useState(0);
  const candidateByRoadmapId = useMemo(
    () => new Map(candidates.map((candidate) => [getCandidateRoadmapId(candidate), candidate])),
    [candidates]
  );
  const planEntries = useMemo(
    () =>
      entries.flatMap((entry) => {
        const candidate = candidateByRoadmapId.get(entry.roadmap_id || '');
        return candidate ? [{ entry, candidate }] : [];
      }),
    [candidateByRoadmapId, entries]
  );
  const planUids = useMemo(
    () => new Set(planEntries.map(({ candidate }) => candidate.uid)),
    [planEntries]
  );
  const selectedCandidates = useMemo(
    () => candidates.filter((candidate) => selectedUids.has(candidate.uid)),
    [candidates, selectedUids]
  );
  const addableSelectedCount = selectedCandidates.filter(
    (candidate) => !planUids.has(candidate.uid)
  ).length;
  const completedCount = planEntries.filter(({ entry }) => entry.roadmap_completed).length;
  const wishlistHref = useMemo(
    () => `/wishlist?owner=${encodeURIComponent(wishlistOwnerKey)}`,
    [wishlistOwnerKey]
  );

  const plannedCosts = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const { candidate } of planEntries) {
      for (const [currencyId, amount] of Object.entries(candidate.costs)) {
        if (amount > 0) totals[currencyId] = (totals[currencyId] || 0) + amount;
      }
    }
    return Object.entries(totals).sort(([a], [b]) => Number(a) - Number(b));
  }, [planEntries]);

  useEffect(() => {
    let current = loadWishlist(wishlistOwnerKey);
    try {
      const legacyEntries = readLegacyUpgradePlan(window.localStorage.getItem(storageKey));
      if (legacyEntries.length > 0 && candidates.length > 0) {
        const migration = mergeLegacyUpgradePlan(current, legacyEntries, candidates, itemInfo);
        if (migration.migratedCount > 0) {
          saveWishlist(migration.items, wishlistOwnerKey);
          current = migration.items;
        }
        if (migration.unmatched.length === 0) {
          window.localStorage.removeItem(storageKey);
        }
      }
    } catch {
      // The roadmap remains usable for this session if storage is unavailable.
    }
    setEntries(current.filter((entry) => entry.roadmap_source === 'owned-upgrade'));
  }, [candidates, itemInfo, storageKey, wishlistOwnerKey]);

  useEffect(() => {
    const refreshWishlistCount = () => {
      setWishlistCount(loadDropWishlist(wishlistOwnerKey).length);
    };
    refreshWishlistCount();
    const onStorage = (event: StorageEvent) => {
      if (event.key === WISHLIST_STORAGE_KEY) refreshWishlistCount();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [wishlistOwnerKey]);

  const addSelected = () => {
    if (addableSelectedCount === 0) return;
    const current = loadWishlist(wishlistOwnerKey);
    const existingIds = new Set(
      current
        .filter((entry) => entry.roadmap_source === 'owned-upgrade')
        .map((entry) => entry.roadmap_id)
    );
    const next = [...current];
    for (const candidate of selectedCandidates) {
      const entry = buildOwnedUpgradeRoadmapEntry(candidate, itemInfo[candidate.item_id]);
      if (!existingIds.has(entry.roadmap_id)) next.push(entry);
    }
    saveWishlist(next, wishlistOwnerKey);
    setEntries(next.filter((entry) => entry.roadmap_source === 'owned-upgrade'));
  };

  const toggleCompleted = (uid: string) => {
    const entry = planEntries.find(({ candidate }) => candidate.uid === uid)?.entry;
    if (!entry?.roadmap_id) return;
    const next = setRoadmapCompleted(entry.roadmap_id, !entry.roadmap_completed, wishlistOwnerKey);
    setEntries(next.filter((item) => item.roadmap_source === 'owned-upgrade'));
  };

  const removeEntry = (uid: string) => {
    const entry = planEntries.find(({ candidate }) => candidate.uid === uid)?.entry;
    if (!entry?.roadmap_id) return;
    const next = removeRoadmapEntry(entry.roadmap_id, wishlistOwnerKey);
    setEntries(next.filter((item) => item.roadmap_source === 'owned-upgrade'));
  };

  const moveEntry = (uid: string, direction: -1 | 1) => {
    const index = entries.findIndex((entry) => {
      const candidate = candidateByRoadmapId.get(entry.roadmap_id || '');
      return candidate?.uid === uid;
    });
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= entries.length) return;
    const orderedEntries = [...entries];
    [orderedEntries[index], orderedEntries[nextIndex]] = [
      orderedEntries[nextIndex],
      orderedEntries[index],
    ];
    const current = loadWishlist(wishlistOwnerKey);
    let entryIndex = 0;
    const next = current.map((item) => {
      if (item.roadmap_source !== 'owned-upgrade') return item;
      return orderedEntries[entryIndex++] || item;
    });
    saveWishlist(next, wishlistOwnerKey);
    setEntries(next.filter((item) => item.roadmap_source === 'owned-upgrade'));
  };

  const clearCompleted = () => {
    const current = loadWishlist(wishlistOwnerKey);
    const next = current.filter(
      (entry) => entry.roadmap_source !== 'owned-upgrade' || !entry.roadmap_completed
    );
    saveWishlist(next, wishlistOwnerKey);
    setEntries(next.filter((entry) => entry.roadmap_source === 'owned-upgrade'));
  };

  const clearPlan = () => {
    const next = loadWishlist(wishlistOwnerKey).filter(
      (entry) => entry.roadmap_source !== 'owned-upgrade'
    );
    saveWishlist(next, wishlistOwnerKey);
    setEntries([]);
  };

  return (
    <section
      className="card overflow-hidden"
      aria-labelledby="upgrade-plan-title"
      data-tour="upgrade-plan"
    >
      <div className="border-border/70 flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="text-gold h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          <div>
            <div className="flex items-center gap-2">
              <h2 id="upgrade-plan-title" className="text-sm font-semibold text-zinc-100">
                Saved upgrade targets
              </h2>
              {planEntries.length > 0 && (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                  {completedCount}/{planEntries.length} complete
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Save owned upgrade targets to your shared Wishlist roadmap; simulate them here.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addSelected}
            disabled={addableSelectedCount === 0}
            className="border-gold/40 bg-gold/[0.08] text-gold hover:bg-gold/[0.14] disabled:border-border inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:bg-transparent disabled:text-zinc-600"
            title={
              selectedCandidates.length === 0
                ? 'Select upgrade candidates below first'
                : 'Add selected upgrade candidates to your plan'
            }
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Add selected{addableSelectedCount > 0 ? ` (${addableSelectedCount})` : ''}
          </button>
          {completedCount > 0 && (
            <button
              type="button"
              onClick={clearCompleted}
              className="rounded-md px-2 py-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200"
            >
              Clear completed
            </button>
          )}
          {planEntries.length > 0 && (
            <button
              type="button"
              onClick={clearPlan}
              className="rounded-md px-2 py-1.5 text-[11px] text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
            >
              Clear plan
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div className="border-border bg-surface-2/40 flex flex-col gap-2 rounded-md border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-muted text-[11px] font-medium tracking-widest uppercase">
              Gear Roadmap
            </p>
            <p className="mt-0.5 text-[13px] text-zinc-300">
              {wishlistCount > 0
                ? `${wishlistCount} item${wishlistCount === 1 ? '' : 's'} to acquire before upgrading.`
                : 'No acquisition targets saved yet.'}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Add targets from{' '}
              <Link
                href="/drop-finder"
                className="decoration-border hover:text-gold text-zinc-300 underline"
              >
                Drop Finder
              </Link>
              . When one appears in a later SimC export, it becomes an owned upgrade you can select
              below.
            </p>
          </div>
          <Link
            href={wishlistHref}
            className="border-border hover:border-gold/40 hover:bg-gold/[0.08] hover:text-gold inline-flex shrink-0 items-center justify-center rounded-md border px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors"
          >
            Open Wishlist
          </Link>
        </div>

        {planEntries.length === 0 ? (
          <div className="border-border bg-surface-2/40 rounded-md border border-dashed px-3 py-3">
            <p className="text-[13px] text-zinc-300">
              Select items you already own{' '}
              <a
                href="#upgradeable-items"
                className="decoration-border hover:text-gold text-zinc-200 underline"
              >
                below
              </a>{' '}
              and add them here to build your prioritized upgrade list.
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">
              Wishlist is the shared roadmap for drops and upgrades; this page is where you simulate
              crest spending.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted text-[11px] font-medium tracking-widest uppercase">
                Planned cost
              </span>
              {plannedCosts.length === 0 ? (
                <span className="text-[11px] text-zinc-500">No cost data</span>
              ) : (
                plannedCosts.map(([currencyId, spent]) => {
                  const currency = effectiveCurrencies[currencyId] || currencies[currencyId];
                  const budget = effectiveCurrencies[currencyId]?.amount;
                  const overBudget = budget != null && spent > budget;
                  return (
                    <span
                      key={currencyId}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
                        overBudget
                          ? 'border-red-400/40 bg-red-500/10 text-red-200'
                          : 'border-border bg-surface-2 text-zinc-300'
                      }`}
                      title={
                        budget == null
                          ? 'No parsed budget for this currency'
                          : `${spent} planned of ${budget} available`
                      }
                    >
                      <img
                        src={getCurrencyIconUrl(currency?.icon || '')}
                        alt=""
                        className="h-3.5 w-3.5 rounded-sm"
                      />
                      <span>{currency?.name || `Currency ${currencyId}`}</span>
                      <span className="font-mono tabular-nums">
                        {spent}
                        {budget != null ? ` / ${budget}` : ''}
                      </span>
                    </span>
                  );
                })
              )}
            </div>

            <ol className="space-y-2">
              {planEntries.map(({ entry, candidate }, index) => {
                const info = itemInfo[candidate.item_id];
                return (
                  <li
                    key={entry.roadmap_id}
                    className={`flex items-start gap-2 rounded-md border px-2.5 py-2 transition-colors ${
                      entry.roadmap_completed
                        ? 'border-emerald-400/20 bg-emerald-500/[0.04]'
                        : 'border-border bg-surface-2/50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleCompleted(candidate.uid)}
                      aria-label={
                        entry.roadmap_completed
                          ? 'Mark upgrade incomplete'
                          : 'Mark upgrade complete'
                      }
                      aria-pressed={entry.roadmap_completed}
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                        entry.roadmap_completed
                          ? 'border-emerald-400/60 bg-emerald-400/80 text-black'
                          : 'border-zinc-600 text-transparent hover:border-zinc-400'
                      }`}
                    >
                      <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                    </button>
                    <img
                      src={getIconUrl(info?.icon || 'inv_misc_questionmark')}
                      alt=""
                      className="mt-0.5 h-8 w-8 shrink-0 rounded ring-1 ring-white/10"
                      loading="lazy"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span
                          className={`text-[13px] font-medium ${
                            entry.roadmap_completed ? 'text-zinc-500 line-through' : 'text-zinc-200'
                          }`}
                        >
                          {info?.name || `Item ${candidate.item_id}`}
                        </span>
                        <span className="text-[11px] text-zinc-500">
                          {SLOT_LABELS[candidate.slot] || candidate.slot}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
                        <span>
                          {candidate.ilevel} → {candidate.target_ilevel}
                        </span>
                        <span>{formatCandidateCost(candidate, currencies)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveEntry(candidate.uid, -1)}
                        disabled={index === 0}
                        aria-label="Move upgrade earlier"
                        className="rounded p-1 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-700"
                      >
                        <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveEntry(candidate.uid, 1)}
                        disabled={index === planEntries.length - 1}
                        aria-label="Move upgrade later"
                        className="rounded p-1 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-700"
                      >
                        <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeEntry(candidate.uid)}
                        aria-label="Remove upgrade from plan"
                        className="rounded p-1 text-zinc-600 transition-colors hover:bg-red-500/10 hover:text-red-300"
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

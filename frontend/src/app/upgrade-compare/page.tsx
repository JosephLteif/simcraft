'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import ErrorAlert from '../components/ErrorAlert';
import ComboSummary from '../components/ComboSummary';
import GearItemRow from '../components/GearItemRow';
import SimulationLaunchButton from '../components/SimulationLaunchButton';
import StickyPageHeader from '../components/StickyPageHeader';
import UpgradePlan from '../components/UpgradePlan';
import { useSimContext } from '../components/SimContext';
import SimReturnNotice from '../components/shared/SimReturnNotice';
import { API_URL } from '../lib/api';
import { SLOT_LABELS } from '../lib/types';
import { getIconUrl, type ItemQuery, QUALITY_COLORS, useItemInfo } from '../lib/useItemInfo';
import { useSimSubmit } from '../lib/useSimSubmit';
import { buildWishlistOwnerKey } from '../lib/wishlist';
import { parseCharacterInfo } from '@/lib/simc-parser';
import {
  consumeSimAgainState,
  consumeSimReturnNotice,
  type SimReturnNotice as SimReturnNoticeType,
} from '../lib/sim-return';

const UPGRADE_COMPARE_SIM_AGAIN_KEY = 'upgrade-compare';

interface UpgradeCompareSimAgainState {
  selectedSlots?: string[];
  upgradeMode?: 'highest_affordable' | 'all_affordable' | 'highest_any' | 'all_any';
  budgetOverride?: Record<string, string>;
}

// ---- Types ----

interface PrepareCandidate {
  uid: string;
  slot: string;
  item_id: number;
  bonus_ids: number[];
  ilevel: number;
  target_ilevel: number;
  costs: Record<string, number>;
  currency_id?: number | null;
  discounted?: boolean;
  is_equipped: boolean;
}

interface CurrencyMeta {
  id: number;
  amount: number;
  name: string;
  icon: string;
}

interface PrepareResponse {
  candidates: PrepareCandidate[];
  currencies: Record<string, CurrencyMeta>;
}

// ---- Helpers ----

function getCurrencyIconUrl(iconName: string): string {
  const raw = String(iconName || '').trim();
  if (!raw) return getIconUrl('inv_misc_questionmark');
  if (/^https?:\/\//i.test(raw)) return raw;
  const noExt = raw.replace(/\.(jpg|jpeg|png|webp)$/i, '');
  const base = noExt.split('/').pop() || noExt;
  return `https://wow.zamimg.com/images/wow/icons/large/${base}.jpg`;
}

function formatCosts(
  costs: Record<string, number>,
  currencies: Record<string, CurrencyMeta>,
  discounted: boolean
): string {
  const entries = Object.entries(costs)
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  if (entries.length === 0) return discounted ? 'Free (discounted)' : 'Cost unavailable';
  return entries
    .map(([cid, amount]) => {
      const name = currencies[cid]?.name;
      return name ? `${name} x${amount}` : `${cid}x${amount}`;
    })
    .join(', ');
}

function getUpgradePlanStorageKey(simcInput: string): string {
  const character = parseCharacterInfo(simcInput);
  if (character?.kind !== 'character') return 'whylowdps_upgrade_plan:default';
  const identity = [character.region, character.server, character.name]
    .map((part) =>
      encodeURIComponent(
        String(part || '')
          .trim()
          .toLowerCase()
      )
    )
    .join('|');
  return `whylowdps_upgrade_plan:${identity}`;
}

function getWishlistOwnerKey(simcInput: string): string {
  const character = parseCharacterInfo(simcInput);
  if (character?.kind !== 'character') return buildWishlistOwnerKey({});
  return buildWishlistOwnerKey({
    name: character.name,
    realm: character.server,
    region: character.region,
    className: character.className,
  });
}

// ---- Data Hook (single endpoint) ----

function useUpgradeData(simcInput: string) {
  const [data, setData] = useState<PrepareResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (simcInput.trim().length < 10) {
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/upgrade-compare/prepare`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ simc_input: simcInput }),
        });
        if (!res.ok || cancelled) return;
        const result: PrepareResponse = await res.json();
        if (!cancelled) setData(result);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [simcInput]);

  return { data, loading };
}

// ---- Page ----

export default function UpgradeComparePage() {
  const { simcInput, maxCombinations } = useSimContext();

  const { data, loading } = useUpgradeData(simcInput);
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [comboCount, setComboCount] = useState(0);
  const [comboComputing, setComboComputing] = useState(false);
  const [comboCountComputed, setComboCountComputed] = useState(false);
  const [comboLimitReached, setComboLimitReached] = useState(false);
  const [comboError, setComboError] = useState('');
  const [upgradeMode, setUpgradeMode] = useState<
    'highest_affordable' | 'all_affordable' | 'highest_any' | 'all_any'
  >('highest_affordable');
  const [budgetOverride, setBudgetOverride] = useState<Record<string, string>>({});
  const [returnNotice, setReturnNotice] = useState<SimReturnNoticeType | null>(null);
  const skipNextDataResetRef = useRef(false);
  const effectiveMaxCombinations = maxCombinations ?? 500;

  useEffect(() => {
    const restored = consumeSimAgainState<UpgradeCompareSimAgainState>(
      UPGRADE_COMPARE_SIM_AGAIN_KEY
    );
    const notice = consumeSimReturnNotice(UPGRADE_COMPARE_SIM_AGAIN_KEY);
    if (notice) setReturnNotice(notice);
    if (!restored) return;
    if (Array.isArray(restored.selectedSlots)) {
      setSelectedSlots(
        new Set(restored.selectedSlots.filter((slot) => typeof slot === 'string' && slot.length > 0))
      );
    }
    if (
      restored.upgradeMode === 'highest_affordable' ||
      restored.upgradeMode === 'all_affordable' ||
      restored.upgradeMode === 'highest_any' ||
      restored.upgradeMode === 'all_any'
    ) {
      setUpgradeMode(restored.upgradeMode);
    }
    if (restored.budgetOverride && typeof restored.budgetOverride === 'object') {
      const next: Record<string, string> = {};
      for (const [cid, value] of Object.entries(restored.budgetOverride)) {
        if (typeof value === 'string') next[cid] = value;
      }
      setBudgetOverride(next);
    }
    skipNextDataResetRef.current = true;
  }, []);

  const candidates = useMemo(() => data?.candidates ?? [], [data]);
  const currencies = useMemo(() => data?.currencies ?? {}, [data]);
  const hasCurrencies = Object.keys(currencies).length > 0;
  const effectiveCurrencies = useMemo(() => {
    const out = { ...currencies };
    for (const [cid, raw] of Object.entries(budgetOverride)) {
      const parsed = parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 0 || !out[cid]) continue;
      out[cid] = { ...out[cid], amount: parsed };
    }
    return out;
  }, [currencies, budgetOverride]);
  const budgetOverridePayload = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [cid, raw] of Object.entries(budgetOverride)) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= 0) out[cid] = parsed;
    }
    return out;
  }, [budgetOverride]);

  // Reset selection when candidates change
  useEffect(() => {
    if (skipNextDataResetRef.current) {
      if (!data) return;
      skipNextDataResetRef.current = false;
      return;
    }
    setSelectedSlots(new Set());
    setComboCount(0);
    setComboComputing(false);
    setComboCountComputed(false);
    setComboLimitReached(false);
    setComboError('');
    setBudgetOverride({});
  }, [data]);

  // Item info for display
  const infoQueries = useMemo<ItemQuery[]>(
    () => candidates.map((c) => ({ item_id: c.item_id, bonus_ids: c.bonus_ids })),
    [candidates]
  );
  const itemInfo = useItemInfo(infoQueries);

  // Debounced combo count
  const comboTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const comboRequestSeqRef = useRef(0);
  useEffect(() => {
    const requestSeq = ++comboRequestSeqRef.current;
    if (selectedSlots.size === 0 || !simcInput.trim()) {
      setComboCount(0);
      setComboComputing(false);
      setComboCountComputed(false);
      setComboLimitReached(false);
      setComboError('');
      return;
    }

    if (comboTimer.current) clearTimeout(comboTimer.current);
    const controller = new AbortController();
    setComboComputing(true);
    setComboCountComputed(false);
    setComboLimitReached(false);
    setComboError('');
    comboTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/upgrade-compare/combo-count`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            simc_input: simcInput,
            selected_slots: [...selectedSlots],
            upgrade_depth:
              upgradeMode === 'all_affordable' || upgradeMode === 'all_any'
                ? 'all_levels'
                : 'highest_only',
            budget_mode:
              upgradeMode === 'highest_any' || upgradeMode === 'all_any'
                ? 'ignore_budget'
                : 'max_affordability',
            upgrade_budget_override: budgetOverridePayload,
            ...(maxCombinations != null ? { max_combinations: maxCombinations } : {}),
          }),
          signal: controller.signal,
        });
        const result = await res.json();
        if (requestSeq !== comboRequestSeqRef.current) return;
        const count = result.combo_count ?? 0;
        const displayCount = count + 1;
        const limitReached =
          result.limit_reached === true || displayCount > effectiveMaxCombinations;
        setComboCount(count);
        setComboComputing(false);
        setComboCountComputed(true);
        setComboLimitReached(limitReached);
        setComboError(
          limitReached
            ? `Cannot start a simulation: ${displayCount.toLocaleString()} combinations exceeds the configured limit of ${effectiveMaxCombinations.toLocaleString()}. Please deselect some items.`
            : result.error ?? ''
        );
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') return;
        if (requestSeq !== comboRequestSeqRef.current) return;
        setComboCount(0);
        setComboComputing(false);
        setComboCountComputed(false);
        setComboLimitReached(false);
        setComboError('Failed to calculate combinations. Try again.');
      }
    }, 300);

    return () => {
      if (comboTimer.current) clearTimeout(comboTimer.current);
      controller.abort();
    };
  }, [simcInput, selectedSlots, effectiveMaxCombinations, upgradeMode, budgetOverridePayload]);

  // Sim submission
  const buildPayload = useCallback(() => {
    if (selectedSlots.size === 0) return null;
    return {
      simc_input: simcInput,
      selected_slots: [...selectedSlots],
      upgrade_depth:
        upgradeMode === 'all_affordable' || upgradeMode === 'all_any'
          ? 'all_levels'
          : 'highest_only',
      budget_mode:
        upgradeMode === 'highest_any' || upgradeMode === 'all_any'
          ? 'ignore_budget'
          : 'max_affordability',
      upgrade_budget_override: budgetOverridePayload,
      max_combinations: maxCombinations,
    };
  }, [simcInput, selectedSlots, maxCombinations, upgradeMode, budgetOverridePayload]);

  const validate = useCallback(() => {
    if (selectedSlots.size === 0) return 'Select at least one upgradeable item.';
    if (comboComputing || !comboCountComputed) {
      return comboError || 'Combination count is still being computed. Please wait.';
    }
    if (comboLimitReached) {
      return comboError || 'Cannot start a simulation: the combination count exceeds the configured limit.';
    }
    if (comboCount === 0) return 'No valid upgrade combinations found.';
    if (comboError) return comboError;
    return null;
  }, [
    selectedSlots,
    comboComputing,
    comboCountComputed,
    comboLimitReached,
    comboError,
    comboCount,
  ]);

  const {
    submit,
    submitting,
    error,
    buttonLabel,
  } = useSimSubmit({
    endpoint: '/api/upgrade-compare/sim',
    buildPayload,
    validate,
    simAgain: {
      pageKey: UPGRADE_COMPARE_SIM_AGAIN_KEY,
      captureState: () => ({
        selectedSlots: [...selectedSlots],
        upgradeMode,
        budgetOverride,
      }),
    },
  });

  const handleSubmit = useCallback((threadsOverride?: number) => {
    void submit({ threadsOverride });
  }, [submit]);

  // Group candidates by primary upgrade currency
  const candidateGroups = useMemo(() => {
    // Find which currencies are actually upgrade currencies (have cost data on candidates)
    const upgradeCurrencyIds = new Set<number>();
    for (const c of candidates) {
      for (const cid of Object.keys(c.costs).map(Number)) {
        if (currencies[String(cid)]) upgradeCurrencyIds.add(cid);
      }
    }

    const groups = new Map<number, PrepareCandidate[]>();
    for (const c of candidates) {
      const cid = c.currency_id ?? Object.keys(c.costs)
        .map(Number)
        .find((id) => upgradeCurrencyIds.has(id));
      if (!cid) continue;
      const list = groups.get(cid) || [];
      list.push(c);
      groups.set(cid, list);
    }
    return [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([cid, items]) => ({
        currencyId: cid,
        currency: currencies[String(cid)],
        candidates: items,
      }));
  }, [candidates, currencies]);

  const hasCharacter = simcInput.trim().length >= 10;
  const upgradePlanStorageKey = useMemo(() => getUpgradePlanStorageKey(simcInput), [simcInput]);
  const wishlistOwnerKey = useMemo(() => getWishlistOwnerKey(simcInput), [simcInput]);
  const displayComboCount =
    selectedSlots.size > 0
      ? comboLimitReached
        ? effectiveMaxCombinations
        : comboCount + 1
      : 0;
  const modeLabel =
    upgradeMode === 'highest_affordable'
      ? 'Highest Affordable'
      : upgradeMode === 'all_affordable'
        ? 'All Affordable'
        : upgradeMode === 'highest_any'
          ? 'Highest Regardless'
          : 'All Regardless';

  const toggleGroup = (groupCandidates: PrepareCandidate[]) => {
    const itemUids = groupCandidates.map((c) => c.uid);
    const allSelected = itemUids.every((uid) => selectedSlots.has(uid));
    const next = new Set(selectedSlots);
    for (const uid of itemUids) {
      if (allSelected) next.delete(uid);
      else next.add(uid);
    }
    setSelectedSlots(next);
  };

  const toggleAll = () => {
    const allItemUids = candidates.map((c) => c.uid);
    const anyMissing = allItemUids.some((uid) => !selectedSlots.has(uid));
    if (anyMissing) {
      setSelectedSlots(new Set(allItemUids));
    } else {
      setSelectedSlots(new Set());
    }
  };

  const toggleAllEquipped = () => {
    const equippedItemUids = candidates.filter((c) => c.is_equipped).map((c) => c.uid);
    const allSelected =
      equippedItemUids.length > 0 && equippedItemUids.every((uid) => selectedSlots.has(uid));
    const next = new Set(selectedSlots);
    for (const uid of equippedItemUids) {
      if (allSelected) next.delete(uid);
      else next.add(uid);
    }
    setSelectedSlots(next);
  };

  if (!hasCharacter) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        Paste your SimC addon export above to begin.
      </p>
    );
  }

  const submitLabel = !hasCurrencies
    ? 'No upgrade currencies found'
    : selectedSlots.size === 0
      ? 'Select items to upgrade'
      : buttonLabel(
          comboComputing
            ? `Sim Upgrades (computing combinations, ${modeLabel})`
            : `Sim Upgrades (${displayComboCount} combos, ${modeLabel})`
        );

  return (
    <div className="mobile-page-bottom space-y-6 pb-28">
      {returnNotice ? (
        <SimReturnNotice
          title={returnNotice.title}
          message={returnNotice.message}
          onDismiss={() => setReturnNotice(null)}
        />
      ) : null}
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">Crest Upgrades</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Compare owned-item upgrade paths and find the best way to spend your crests.
        </p>
      </div>
      {/* Explainer */}
      <div className="rounded-lg border border-border/50 bg-surface-2/50 px-4 py-3">
        <p className="text-[15px] leading-relaxed text-zinc-400">
          Find the best way to spend your{' '}
          <span className="font-medium text-gold/80">upgrade currencies</span>. Select
          which equipped or bag items to consider, and WhyLowDps will test every valid upgrade
          combination within your budget to find which gives the most DPS.
        </p>
      </div>

      <UpgradePlan
        storageKey={upgradePlanStorageKey}
        wishlistOwnerKey={wishlistOwnerKey}
        candidates={candidates}
        selectedUids={selectedSlots}
        itemInfo={itemInfo}
        currencies={currencies}
        effectiveCurrencies={effectiveCurrencies}
      />

      <div data-tour="upgrade-mode" className="space-y-2">
        <p className="text-[12px] font-medium uppercase tracking-widest text-muted">Upgrade Mode</p>
        <div className="grid gap-2 md:grid-cols-2">
          {[
            ['highest_affordable', 'Highest Affordable', 'Only the highest tier you can afford.'],
            ['all_affordable', 'All Affordable', 'Every upgrade tier you can afford.'],
            ['highest_any', 'Highest Regardless', 'Only the highest tier, even if unaffordable.'],
            ['all_any', 'All Regardless', 'Every tier, even if unaffordable.'],
          ].map(([key, label, desc]) => (
            <button
              key={key}
              type="button"
              onClick={() => setUpgradeMode(key as typeof upgradeMode)}
              className={`rounded-md border px-3 py-2 text-left transition-colors ${
                upgradeMode === key
                  ? 'border-gold/40 bg-gold/[0.08] text-zinc-100'
                  : 'border-border bg-surface-2 text-zinc-300 hover:border-zinc-600'
              }`}
            >
              <div className="text-xs font-semibold">{label}</div>
              <div className="mt-0.5 text-[10px] text-zinc-400">{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {hasCurrencies && (
        <div className="card space-y-3 p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-medium uppercase tracking-widest text-muted">
              Override Budget
            </p>
            <p className="text-[11px] text-zinc-500">
              Leave blank to use the parsed export amounts.
            </p>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {Object.values(currencies)
              .filter((c) => c.name)
              .sort((a, b) => a.id - b.id)
              .map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-300">
                    {c.name}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={budgetOverride[String(c.id)] ?? ''}
                    onChange={(e) =>
                      setBudgetOverride((prev) => ({ ...prev, [String(c.id)]: e.target.value }))
                    }
                    placeholder={String(c.amount)}
                    className="w-24 rounded border border-border bg-surface px-2 py-1 text-right font-mono text-xs tabular-nums text-white [appearance:textfield] focus:border-gold/50 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </label>
              ))}
          </div>
        </div>
      )}

      {/* Currency Budget */}
      {hasCurrencies && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-medium uppercase tracking-widest text-muted">
            Budget
          </span>
          {Object.values(currencies)
            .filter((c) => c.name)
            .sort((a, b) => a.id - b.id)
            .map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1"
              >
                <img
                  src={getCurrencyIconUrl(c.icon)}
                  alt=""
                  className="h-4 w-4 shrink-0 rounded-sm"
                />
                <span className="text-[13px] text-gray-400">{c.name}</span>
                <span className="font-mono text-[13px] tabular-nums text-white">
                  {effectiveCurrencies[String(c.id)]?.amount ?? c.amount}
                </span>
              </div>
            ))}
        </div>
      )}

      {/* Upgradeable Items */}
      <div id="upgradeable-items" data-tour="upgrade-items" className="space-y-4">
        <StickyPageHeader
          left={
            <div className="flex flex-wrap items-center gap-4">
              <p className="text-xs font-medium uppercase tracking-widest text-muted">
                Select Items to Upgrade
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleAll}
                  data-tour-action="upgrade-item-choice"
                  className="text-[11px] font-bold text-gold/80 transition-colors hover:text-gold"
                >
                  All
                </button>
                <span className="h-3 w-px bg-zinc-700" />
                <button
                  type="button"
                  onClick={toggleAllEquipped}
                  data-tour-action="upgrade-item-choice"
                  className="text-[11px] font-bold text-zinc-300 transition-colors hover:text-white"
                >
                  Equipped
                </button>
                <span className="h-3 w-px bg-zinc-700" />
                <button
                  type="button"
                  onClick={() => setSelectedSlots(new Set())}
                  className="text-[11px] font-bold text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  Clear
                </button>
              </div>
              {hasCurrencies && (
                <div className="hidden flex-wrap items-center gap-1.5 xl:flex">
                  {Object.values(currencies)
                    .filter((c) => c.name)
                    .sort((a, b) => a.id - b.id)
                    .map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1"
                      >
                        <img
                          src={getCurrencyIconUrl(c.icon)}
                          alt=""
                          className="h-3.5 w-3.5 shrink-0 rounded-sm"
                        />
                        <span className="max-w-24 truncate text-[11px] text-zinc-300">{c.name}</span>
                        <span className="font-mono text-[11px] tabular-nums text-zinc-100">
                          {effectiveCurrencies[String(c.id)]?.amount ?? c.amount}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          }
          right={
            <ComboSummary
              comboCount={displayComboCount}
              maxCombinations={effectiveMaxCombinations}
              isComputing={comboComputing}
              limitReached={comboLimitReached}
              breakdown={
                !comboComputing && !comboLimitReached && comboCount !== 0
                  ? `${comboCount.toLocaleString()} normal combos | +1 Currently Equipped`
                  : null
              }
            />
          }
        />

        {loading ? (
          <div className="card flex justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-gold" strokeWidth={2} />
          </div>
        ) : candidates.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-sm text-muted">No upgradeable items found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {candidateGroups.map((group) => {
              const groupItemUids = group.candidates.map((c) => c.uid);
              const allSelected =
                groupItemUids.length > 0 && groupItemUids.every((uid) => selectedSlots.has(uid));

              return (
                <div key={group.currencyId} className="card space-y-1 p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <img
                        src={getCurrencyIconUrl(group.currency?.icon || '')}
                        alt=""
                        className="h-4 w-4 shrink-0 rounded-sm"
                      />
                      <p className="text-[13px] font-semibold uppercase tracking-widest text-muted">
                        {group.currency?.name || `Currency ${group.currencyId}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.candidates)}
                      data-tour-action="upgrade-item-choice"
                      className="text-[12px] text-zinc-500 hover:text-zinc-300"
                    >
                      {allSelected ? 'Deselect' : 'Select all'}
                    </button>
                  </div>

                  {group.candidates.map((c) => {
                    const info = itemInfo[c.item_id];
                    const qc = info ? QUALITY_COLORS[info.quality] || '#fff' : '#fff';
                    const isEquipped = c.is_equipped;

                    return (
                      <div key={c.uid} data-tour-action="upgrade-item-choice">
                        <GearItemRow
                          icon={info?.icon || 'inv_misc_questionmark'}
                          name={info?.name || `Item ${c.item_id}`}
                          nameColor={qc}
                          details={[
                            { text: SLOT_LABELS[c.slot] || c.slot },
                            {
                              text: isEquipped ? 'Equipped' : 'Not Equipped',
                              color: isEquipped ? 'text-emerald-300' : 'text-zinc-500',
                            },
                            { text: `${c.ilevel} -> ${c.target_ilevel}` },
                            {
                              text: formatCosts(c.costs, effectiveCurrencies, c.discounted === true),
                              color: 'text-gold/70',
                            },
                          ]}
                          ilevel={c.ilevel}
                          selectable
                          checked={selectedSlots.has(c.uid)}
                          onToggle={() => {
                            const next = new Set(selectedSlots);
                            if (selectedSlots.has(c.uid)) next.delete(c.uid);
                            else next.add(c.uid);
                            setSelectedSlots(next);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ErrorAlert message={comboError || error} />

      <div className="mobile-safe-bottom sticky bottom-0 z-50 -mx-4 bg-gradient-to-t from-[#111] via-[#111] to-transparent px-4 pb-4 pt-6">
        <SimulationLaunchButton
          onSubmit={handleSubmit}
          dataTour="upgrade-submit"
          submitting={submitting}
          disabled={
            selectedSlots.size === 0 ||
            !hasCurrencies ||
            comboComputing ||
            !comboCountComputed ||
            comboLimitReached ||
            comboCount === 0
          }
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              Starting sim...
            </>
          ) : (
            submitLabel
          )}
        </SimulationLaunchButton>
      </div>
    </div>
  );
}

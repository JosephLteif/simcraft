'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EmbellishmentOption, EnchantInfo, GemInfo, ItemInfo, ItemQuery } from '../lib/useItemInfo';
import {
  enchantAvailabilityItemKey,
  getIconUrl,
  getWowheadData,
  getWowheadUrl,
  QUALITY_COLORS,
  useEmbellishmentOptions,
  useEnchantAvailability,
  useEnchantInfo,
  useGemInfo,
  useItemInfo,
} from '../lib/useItemInfo';
import { API_URL, fetchJson } from '../lib/api';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import type { Instance } from '../drop-finder/types';
import { buildSourceTagLinks } from '../lib/source-navigation';
import { getItemExtraEffects, useItemExtraEffects } from '../lib/itemExtraEffect';
import {
  formatUpgradePreviewLabel,
  labelsEqual,
  normalizeUpgradeLabel,
} from '../lib/upgrade-preview';
import GearItemRow from './GearItemRow';
import { ASCENDANT_VOIDCORE_BADGE_CLASS, EMBELLISHMENT_BADGE_CLASS } from './shared/itemBadgeClasses';

export interface GearItem {
  slot: string;
  item_id: number;
  ilevel: number;
  name: string;
  bonus_ids?: number[];
  enchant_id?: number;
  gem_id?: number;
  gem_ids?: number[];
  is_kept?: boolean;
  upgrade_levels?: number;
  origin?: string;
  upgrade?: string;
  source_type?: string;
  encounter?: string;
  instance_name?: string;
  embellishment_item_id?: number;
  embellishment_name?: string;
  embellishment_icon?: string;
  embellishment_bonus_ids?: number[];
}

const GEAR_ORDER_LEFT = ['head', 'neck', 'shoulder', 'back', 'chest', 'wrist'];
const GEAR_ORDER_RIGHT = [
  'hands',
  'waist',
  'legs',
  'feet',
  'finger1',
  'finger2',
  'trinket1',
  'trinket2',
];
const GEAR_ORDER_STACKED = [...GEAR_ORDER_LEFT, ...GEAR_ORDER_RIGHT, 'main_hand', 'off_hand'];
const RAIDBOTS_PAPERDOLL_BASE = 'https://www.raidbots.com/images/paperdoll';

function getEmptySlotIcon(slot: string): string {
  const normalized = String(slot || '').toLowerCase();
  const slotIconName =
    {
      head: 'Head',
      neck: 'Neck',
      shoulder: 'Shoulder',
      back: 'Chest',
      chest: 'Chest',
      wrist: 'Wrists',
      hands: 'Hands',
      waist: 'Waist',
      legs: 'Legs',
      feet: 'Feet',
      finger1: 'Finger',
      finger2: 'Finger',
      trinket1: 'Trinket',
      trinket2: 'Trinket',
      main_hand: 'MainHand',
      off_hand: 'SecondaryHand',
    }[normalized] || '';

  return slotIconName
    ? `${RAIDBOTS_PAPERDOLL_BASE}/UI-PaperDoll-Slot-${slotIconName}.png`
    : 'inv_misc_questionmark';
}

function dropBaselineKey(item: GearItem): string {
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

function normalizeEmbellishmentName(value?: string | null): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\s*\((quality|rank|q)\s*\d+\)\s*$/i, '')
    .replace(/\s*\(\d+\)\s*$/i, '')
    .replace(/[^a-z0-9]/g, '');
}

function upgradeTierClass(label: string): string {
  const targetTier = label.split('->').pop()?.trim().toLowerCase() || label.toLowerCase();

  if (targetTier.includes('myth')) {
    return 'border-orange-400/55 bg-orange-500/15 text-orange-200';
  }
  if (targetTier.includes('hero')) {
    return 'border-teal-400/45 bg-teal-500/12 text-teal-200';
  }
  if (targetTier.includes('champion')) {
    return 'border-emerald-400/45 bg-emerald-500/12 text-emerald-200';
  }
  if (targetTier.includes('veteran')) {
    return 'border-sky-400/45 bg-sky-500/12 text-sky-200';
  }
  if (targetTier.includes('adventurer')) {
    return 'border-lime-400/45 bg-lime-500/12 text-lime-200';
  }
  if (targetTier.includes('explorer')) {
    return 'border-zinc-400/45 bg-zinc-500/12 text-zinc-200';
  }

  return 'border-teal-400/40 bg-teal-500/10 text-teal-200';
}

function tierPalette(label: string): { border: string; bg: string; text: string } {
  const tier = label.trim().toLowerCase();
  if (tier.includes('myth')) return { border: 'border-orange-400/55', bg: 'bg-orange-500/15', text: 'text-orange-200' };
  if (tier.includes('hero')) return { border: 'border-sky-400/45', bg: 'bg-sky-500/12', text: 'text-sky-200' };
  if (tier.includes('champion')) return { border: 'border-emerald-400/45', bg: 'bg-emerald-500/12', text: 'text-emerald-200' };
  if (tier.includes('veteran')) return { border: 'border-cyan-400/45', bg: 'bg-cyan-500/12', text: 'text-cyan-200' };
  if (tier.includes('adventurer')) return { border: 'border-lime-400/45', bg: 'bg-lime-500/12', text: 'text-lime-200' };
  if (tier.includes('explorer')) return { border: 'border-zinc-400/45', bg: 'bg-zinc-500/12', text: 'text-zinc-200' };
  return { border: 'border-teal-400/40', bg: 'bg-teal-500/10', text: 'text-teal-200' };
}

function tierColorHex(label: string): string {
  const tier = label.trim().toLowerCase();
  if (tier.includes('myth')) return 'rgba(249, 115, 22, 0.35)';
  if (tier.includes('hero')) return 'rgba(56, 189, 248, 0.32)';
  if (tier.includes('champion')) return 'rgba(16, 185, 129, 0.32)';
  if (tier.includes('veteran')) return 'rgba(34, 211, 238, 0.30)';
  if (tier.includes('adventurer')) return 'rgba(132, 204, 22, 0.30)';
  if (tier.includes('explorer')) return 'rgba(113, 113, 122, 0.30)';
  return 'rgba(20, 184, 166, 0.28)';
}

function splitTierTransition(label: string): { from: string; to: string } | null {
  const segments = label
    .split('->')
    .map((s) => s.trim())
    .filter(Boolean);
  const to = segments[segments.length - 1] || '';
  const from = segments.length > 1 ? segments[segments.length - 2] : '';
  if (!from || !to || labelsEqual(from, to)) return null;
  return { from, to };
}

function tierTransitionClass(label: string): string {
  const segments = label
    .split('->')
    .map((s) => s.trim())
    .filter(Boolean);
  const to = segments[segments.length - 1] || '';
  const from = segments.length > 1 ? segments[segments.length - 2] : '';
  if (!from || !to || labelsEqual(from, to)) return upgradeTierClass(label);
  const fromPalette = tierPalette(from);
  const toPalette = tierPalette(to);
  const fromKey = from.toLowerCase();
  const toKey = to.toLowerCase();
  const gradientByPair: Array<[string, string, string]> = [
    ['myth', 'hero', 'from-orange-500/15 to-sky-500/12'],
    ['myth', 'champion', 'from-orange-500/15 to-emerald-500/12'],
    ['hero', 'champion', 'from-sky-500/12 to-emerald-500/12'],
    ['champion', 'hero', 'from-emerald-500/12 to-sky-500/12'],
    ['hero', 'veteran', 'from-sky-500/12 to-cyan-500/12'],
    ['champion', 'veteran', 'from-emerald-500/12 to-cyan-500/12'],
    ['veteran', 'adventurer', 'from-cyan-500/12 to-lime-500/12'],
    ['adventurer', 'explorer', 'from-lime-500/12 to-zinc-500/12'],
  ];
  const explicit = gradientByPair.find(([a, b]) => fromKey.includes(a) && toKey.includes(b))?.[2];
  const fallback = `${fromPalette.bg.replace('bg-', 'from-')} ${toPalette.bg.replace('bg-', 'to-')}`;
  return `${toPalette.border} ${toPalette.text} bg-gradient-to-r ${explicit || fallback}`;
}

interface GearOverviewProps {
  gear: Record<string, GearItem>;
  title?: string;
  characterRenderUrl?: string | null;
  characterBackgroundUrl?: string | null;
  characterClassName?: string | null;
  equippedGear?: Record<string, GearItem>;
  dropBaselineIlevelByKey?: Record<string, number>;
  upgradeSlots?: Set<string>;
  downgradeSlots?: Set<string>;
  currencies?: Record<string, { id: number; name: string; icon: string }>;
  framed?: boolean;
  fullWidth?: boolean;
  comparisonMode?: 'result' | 'provenance';
  sourceInstances?: Instance[];
}

export default function GearOverview({
  gear,
  title = 'Equipped Gear',
  characterRenderUrl,
  characterBackgroundUrl,
  characterClassName,
  equippedGear,
  dropBaselineIlevelByKey = {},
  upgradeSlots,
  downgradeSlots,
  currencies,
  framed = true,
  fullWidth = false,
  comparisonMode = 'provenance',
  sourceInstances,
}: GearOverviewProps) {
  const [loadedSourceInstances, setLoadedSourceInstances] = useState<Instance[]>([]);
  const effectiveSourceInstances = sourceInstances ?? loadedSourceInstances;
  const hasCharacterImage = Boolean(characterBackgroundUrl || characterRenderUrl);

  useEffect(() => {
    if (sourceInstances) return;
    let cancelled = false;
    fetchJson<Instance[]>(`${API_URL}/api/instances`)
      .then((response) => {
        if (cancelled) return;
        setLoadedSourceInstances(Array.isArray(response) ? response : []);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadedSourceInstances([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceInstances]);

  const allItemQueries = useMemo(() => {
    const seen = new Set<string>();
    const queries: ItemQuery[] = [];
    for (const it of Object.values(gear)) {
      if (it.item_id <= 0) continue;
      const key = `${it.item_id}:${(it.bonus_ids || []).sort().join(':')}`;
      if (!seen.has(key)) {
        seen.add(key);
        queries.push({ item_id: it.item_id, bonus_ids: it.bonus_ids });
      }
    }
    return queries;
  }, [gear]);

  const itemInfoMap = useItemInfo(allItemQueries);
  const extraEffectsByKey = useItemExtraEffects(allItemQueries);

  const allEnchantIds = useMemo(() => {
    const ids = new Set<number>();
    for (const it of Object.values(gear)) {
      if (it.enchant_id && it.enchant_id > 0) ids.add(it.enchant_id);
    }
    return [...ids];
  }, [gear]);

  const enchantInfoMap = useEnchantInfo(allEnchantIds);
  const enchantAvailabilityBySlot = useEnchantAvailability(
    Object.values(gear)
      .filter((it) => it.item_id > 0)
      .map((it) => ({
        slot: it.slot,
        className: characterClassName,
        itemId: it.item_id,
        bonusIds: it.bonus_ids,
        seasonId: undefined,
      }))
  );

  const allGemIds = useMemo(() => {
    const ids = new Set<number>();
    for (const it of Object.values(gear)) {
      for (const gemId of it.gem_ids || []) {
        if (gemId > 0) ids.add(gemId);
      }
      if (it.gem_id && it.gem_id > 0) ids.add(it.gem_id);
    }
    return [...ids];
  }, [gear]);

  const gemInfoMap = useGemInfo(allGemIds);
  const embellishmentOptionsByItemId = useEmbellishmentOptions(
    Object.values(gear)
      .map((it) => Number(it.item_id || 0))
      .filter((id) => id > 0)
  );
  useWowheadTooltips([itemInfoMap]);

  const totalCostsDisplay = useMemo(() => {
    if (!currencies) return null;

    const manual: Record<string, number> = {};
    let foundAny = false;
    for (const it of Object.values(gear)) {
      const upgradeCosts = (it as any).upgrade_costs || (it as any).costs;
      if (!it.is_kept && upgradeCosts) {
        for (const [cid, amt] of Object.entries(upgradeCosts)) {
          manual[cid] = (manual[cid] || 0) + (amt as number);
          foundAny = true;
        }
      }
    }

    if (!foundAny) return null;

    const entries = Object.entries(manual).sort((a, b) => Number(a[0]) - Number(b[0]));
    if (entries.length === 0) return null;

    return (
      <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-border/50 bg-black/20 px-4 py-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">
          Total Upgrade Cost
        </span>
        <div className="flex flex-wrap items-center gap-4">
          {entries.map(([cid, amount]) => {
            const meta = currencies[cid];
            if (!meta) return null;
            return (
              <a
                key={cid}
                href={`https://www.wowhead.com/currency=${cid}`}
                className="flex items-center gap-2 font-mono text-[14px] text-gold/90 no-underline"
                data-wowhead={`currency=${cid}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.preventDefault()}
              >
                <img
                  src={getIconUrl(meta.icon)}
                  alt={meta.name}
                  className="h-5 w-5 rounded-sm border border-gold/30 shadow-sm"
                />
                <span>{amount}</span>
              </a>
            );
          })}
        </div>
      </div>
    );
  }, [gear, currencies]);

  if (Object.keys(gear).length === 0) return null;

  return (
    <div
      className={`${framed ? `card ${fullWidth ? '' : 'mx-auto max-w-6xl'} p-4 sm:p-5` : ''} relative w-full overflow-hidden`}
    >
      {characterBackgroundUrl && (
        <img
          src={characterBackgroundUrl}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden h-full w-full object-cover object-center opacity-[0.75] md:block"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-black/20 via-[#0c0a0f]/55 to-[#0c0c0f]/95"
      />
      {characterRenderUrl && (
        <img
          src={characterRenderUrl}
          alt=""
          className="pointer-events-none absolute inset-0 z-[2] mx-auto hidden h-[120%] w-auto -translate-y-[8%] object-contain opacity-100 md:block"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      <div className="relative z-10">
        <div className="mb-4 flex items-center justify-between gap-4">
          <p className="text-sm font-medium uppercase tracking-widest text-muted">{title}</p>
          {totalCostsDisplay && <div className="hidden md:block">{totalCostsDisplay}</div>}
        </div>
        {totalCostsDisplay && <div className="mb-4 md:hidden">{totalCostsDisplay}</div>}

        <div className="space-y-2 md:hidden">
          {GEAR_ORDER_STACKED.map((slot) => (
            <GearSlotRow
              key={slot}
              slot={slot}
              item={gear[slot]}
              equippedItem={equippedGear?.[slot]}
              dropBaselineIlevelByKey={dropBaselineIlevelByKey}
              isUpgrade={upgradeSlots?.has(slot)}
              isDowngrade={downgradeSlots?.has(slot)}
              comparisonMode={comparisonMode}
              itemInfoMap={itemInfoMap}
              enchantInfoMap={enchantInfoMap}
              gemInfoMap={gemInfoMap}
              characterClassName={characterClassName}
              enchantAvailabilityBySlot={enchantAvailabilityBySlot}
              embellishmentOptionsByItemId={embellishmentOptionsByItemId}
              extraEffectsByKey={extraEffectsByKey}
              sourceInstances={effectiveSourceInstances}
            />
          ))}
        </div>

        <div
          className={`hidden md:grid ${hasCharacterImage ? 'md:grid-cols-[1fr_200px_1fr] lg:grid-cols-[1fr_230px_1fr] xl:grid-cols-[1fr_260px_1fr]' : 'md:grid-cols-2'} md:gap-x-4 lg:gap-x-6`}
        >
          <div className="space-y-2">
            {GEAR_ORDER_LEFT.map((slot) => (
              <GearSlotRow
                key={slot}
                slot={slot}
                item={gear[slot]}
                equippedItem={equippedGear?.[slot]}
                dropBaselineIlevelByKey={dropBaselineIlevelByKey}
                isUpgrade={upgradeSlots?.has(slot)}
                isDowngrade={downgradeSlots?.has(slot)}
                comparisonMode={comparisonMode}
                itemInfoMap={itemInfoMap}
                enchantInfoMap={enchantInfoMap}
                gemInfoMap={gemInfoMap}
                characterClassName={characterClassName}
                enchantAvailabilityBySlot={enchantAvailabilityBySlot}
                embellishmentOptionsByItemId={embellishmentOptionsByItemId}
                extraEffectsByKey={extraEffectsByKey}
                sourceInstances={effectiveSourceInstances}
              />
            ))}
          </div>
          {hasCharacterImage && <div className="hidden md:block" />}
          <div className="space-y-2">
            {GEAR_ORDER_RIGHT.map((slot) => (
              <GearSlotRow
                key={slot}
                slot={slot}
                item={gear[slot]}
                equippedItem={equippedGear?.[slot]}
                dropBaselineIlevelByKey={dropBaselineIlevelByKey}
                isUpgrade={upgradeSlots?.has(slot)}
                isDowngrade={downgradeSlots?.has(slot)}
                comparisonMode={comparisonMode}
                itemInfoMap={itemInfoMap}
                enchantInfoMap={enchantInfoMap}
                gemInfoMap={gemInfoMap}
                characterClassName={characterClassName}
                enchantAvailabilityBySlot={enchantAvailabilityBySlot}
                embellishmentOptionsByItemId={embellishmentOptionsByItemId}
                extraEffectsByKey={extraEffectsByKey}
                reverse
                sourceInstances={effectiveSourceInstances}
              />
            ))}
          </div>
        </div>

        <div className="hidden md:flex md:justify-center">
          <div className="grid w-full max-w-4xl grid-cols-2 gap-6 pt-4">
            <div className="w-full max-w-md justify-self-end">
              <GearSlotRow
                slot="main_hand"
                item={gear.main_hand}
                equippedItem={equippedGear?.main_hand}
                dropBaselineIlevelByKey={dropBaselineIlevelByKey}
                isUpgrade={upgradeSlots?.has('main_hand')}
                isDowngrade={downgradeSlots?.has('main_hand')}
                comparisonMode={comparisonMode}
                itemInfoMap={itemInfoMap}
                enchantInfoMap={enchantInfoMap}
                gemInfoMap={gemInfoMap}
                characterClassName={characterClassName}
                enchantAvailabilityBySlot={enchantAvailabilityBySlot}
                embellishmentOptionsByItemId={embellishmentOptionsByItemId}
                extraEffectsByKey={extraEffectsByKey}
                reverse
                sourceInstances={effectiveSourceInstances}
              />
            </div>
            <div className="w-full max-w-md justify-self-start">
              <GearSlotRow
                slot="off_hand"
                item={gear.off_hand}
                equippedItem={equippedGear?.off_hand}
                dropBaselineIlevelByKey={dropBaselineIlevelByKey}
                isUpgrade={upgradeSlots?.has('off_hand')}
                isDowngrade={downgradeSlots?.has('off_hand')}
                comparisonMode={comparisonMode}
                itemInfoMap={itemInfoMap}
                enchantInfoMap={enchantInfoMap}
                gemInfoMap={gemInfoMap}
                characterClassName={characterClassName}
                enchantAvailabilityBySlot={enchantAvailabilityBySlot}
                embellishmentOptionsByItemId={embellishmentOptionsByItemId}
                extraEffectsByKey={extraEffectsByKey}
                sourceInstances={effectiveSourceInstances}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GearSlotRow({
  slot,
  item,
  equippedItem,
  dropBaselineIlevelByKey = {},
  isUpgrade,
  isDowngrade,
  comparisonMode = 'provenance',
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  characterClassName,
  enchantAvailabilityBySlot,
  embellishmentOptionsByItemId,
  extraEffectsByKey,
  reverse = false,
  sourceInstances = [],
}: {
  slot: string;
  item?: GearItem;
  equippedItem?: GearItem;
  dropBaselineIlevelByKey?: Record<string, number>;
  isUpgrade?: boolean;
  isDowngrade?: boolean;
  comparisonMode?: 'result' | 'provenance';
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  characterClassName?: string | null;
  enchantAvailabilityBySlot: Record<string, boolean>;
  embellishmentOptionsByItemId: Record<number, EmbellishmentOption[]>;
  extraEffectsByKey: Record<string, Array<'Leech' | 'Speed' | 'Avoidance' | 'Indestructible'>>;
  reverse?: boolean;
  sourceInstances?: Instance[];
}) {
  const router = useRouter();
  if (!item || item.item_id <= 0) {
    return (
      <div className="rounded-lg">
        <GearItemRow
          icon={getEmptySlotIcon(slot)}
          name="Empty"
          nameColor="#d4d4d8"
          showCheckbox={false}
          dimmed
          reverse={reverse}
          iconSize={38}
        />
      </div>
    );
  }

  const info = itemInfoMap[item.item_id];
  const enchant = item.enchant_id ? enchantInfoMap[item.enchant_id] : undefined;
  const gemIds = [...new Set((item.gem_ids || []).filter((id) => id > 0))];
  if (gemIds.length === 0 && item.gem_id && item.gem_id > 0) {
    gemIds.push(item.gem_id);
  }
  const gems = gemIds.map((id) => gemInfoMap[id]).filter(Boolean);
  const qc = info ? QUALITY_COLORS[info.quality] || '#fff' : '#fff';
  const name = info?.name || item.name || `Item ${item.item_id}`;
  const icon = info?.icon || 'inv_misc_questionmark';
  const upgradeLabel = normalizeUpgradeLabel(item.upgrade || info?.upgrade);
  const equippedInfo = equippedItem?.item_id ? itemInfoMap[equippedItem.item_id] : undefined;
  const equippedUpgradeLabel = normalizeUpgradeLabel(
    equippedItem?.upgrade || equippedInfo?.upgrade
  );
  const displayedUpgradeLabel = upgradeLabel
    ? formatUpgradePreviewLabel({
        upgradeLabel,
        equippedUpgradeLabel,
        itemIlevel: Number(item.ilevel || 0),
        equippedIlevel: Number(equippedItem?.ilevel || 0),
        upgradeLevels: Number(item.upgrade_levels || 0),
        sourceType: item.source_type,
      })
    : '';
  const whData =
    item.item_id > 0
      ? getWowheadData(item.bonus_ids, item.ilevel, item.enchant_id, gemIds)
      : undefined;

  const baselineDropIlevel = Number(dropBaselineIlevelByKey[dropBaselineKey(item)] || 0);
  const needsUpgrade =
    Number(item.upgrade_levels || 0) > 0 ||
    (baselineDropIlevel > 0 && Number(item.ilevel || 0) > baselineDropIlevel);
  const levelChanged =
    Number(equippedItem?.ilevel || 0) > 0 &&
    Number(equippedItem?.ilevel || 0) !== Number(item.ilevel || 0);
  const ilevelTagText =
    Number(item.ilevel || 0) > 0
      ? levelChanged
        ? `iLvl ${Number(equippedItem?.ilevel || 0)} -> ${Number(item.ilevel || 0)}`
        : `iLvl ${Number(item.ilevel || 0)}`
      : '';
  const ilevelTagClass =
    levelChanged && Number(item.ilevel || 0) < Number(equippedItem?.ilevel || 0)
      ? 'bg-red-500/12 border-red-400/45 text-red-200'
      : levelChanged && Number(item.ilevel || 0) > Number(equippedItem?.ilevel || 0)
        ? 'bg-emerald-500/12 border-emerald-400/45 text-emerald-200'
        : 'border-zinc-500/40 bg-zinc-500/10 text-zinc-200';
  const comparisonState: 'upgrade' | 'downgrade' | null = isDowngrade
    ? 'downgrade'
    : isUpgrade
      ? 'upgrade'
      : levelChanged
        ? Number(item.ilevel || 0) > Number(equippedItem?.ilevel || 0)
          ? 'upgrade'
          : 'downgrade'
        : null;
  const provenanceState: 'upgrade' | 'downgrade' | null = needsUpgrade
    ? 'upgrade'
    : levelChanged
      ? Number(item.ilevel || 0) > Number(equippedItem?.ilevel || 0)
        ? 'upgrade'
        : 'downgrade'
      : null;
  const upgradeState = comparisonMode === 'result' ? comparisonState : provenanceState;

  const socketCount = Number((info as any)?.sockets || 0);
  const gemEligible = socketCount > 0 || gemIds.length > 0;
  const enchantEligible =
    enchantAvailabilityBySlot[
      enchantAvailabilityItemKey(slot, characterClassName, item.item_id, item.bonus_ids)
    ] || false;
  const embellishmentOptions = embellishmentOptionsByItemId[item.item_id] || [];
  const normalizedEmbellishmentName = normalizeEmbellishmentName(item.embellishment_name);
  const inferredEmbellishment =
    embellishmentOptions.find((opt) => opt.item_id === item.embellishment_item_id) ||
    embellishmentOptions.find(
      (opt) =>
        Array.isArray(opt.bonus_ids) &&
        opt.bonus_ids.length > 0 &&
        opt.bonus_ids.every((bid) => (item.bonus_ids || []).includes(bid))
    ) ||
    (normalizedEmbellishmentName
      ? embellishmentOptions.find(
          (opt) => normalizeEmbellishmentName(opt.name) === normalizedEmbellishmentName
        )
      : undefined);
  const embellishmentName = item.embellishment_name || inferredEmbellishment?.name || '';
  const embellishmentIcon =
    item.embellishment_icon ||
    inferredEmbellishment?.icon ||
    (inferredEmbellishment?.item_id
      ? itemInfoMap[inferredEmbellishment.item_id]?.icon
      : undefined) ||
    '';
  const embellishmentItemId = item.embellishment_item_id || inferredEmbellishment?.item_id || 0;

  const details: Array<{
    text: string;
    kind?: 'text' | 'gemIcon' | 'plain' | 'iconText';
    badgeVariant?: 'neutral' | 'gem' | 'enchant' | 'embellishment' | 'mod' | 'source';
    color?: string;
    tooltip?: string;
    icon?: string;
    href?: string;
    wowheadData?: string;
  }> = [];
  const sourceTags = buildSourceTagLinks(item, sourceInstances);
  for (const gem of gems) {
    details.push({
      text: gem.name,
      kind: 'iconText',
      badgeVariant: 'gem',
      icon: gem.icon || 'inv_misc_gem_variety_01',
      href: gem.gem_id ? getWowheadUrl(gem.gem_id) : undefined,
      wowheadData: gem.gem_id ? `item=${gem.gem_id}` : undefined,
      color: 'text-sky-200 border-sky-400/45 bg-sky-500/10',
    });
  }
  const emptySocketCount = Math.max(0, socketCount - gemIds.length);
  if (gems.length === 0 && gemEligible) {
    details.push({
      text: emptySocketCount > 1 ? `${emptySocketCount} Empty Sockets` : 'Empty Socket',
      kind: 'iconText',
      badgeVariant: 'gem',
      icon: 'inv_misc_gem_variety_01',
      color: 'text-zinc-200 border-dashed border-zinc-500/60 bg-zinc-500/8',
    });
  } else if (emptySocketCount > 0) {
    details.push({
      text: emptySocketCount > 1 ? `${emptySocketCount} Empty Sockets` : 'Empty Socket',
      kind: 'iconText',
      badgeVariant: 'gem',
      icon: 'inv_misc_gem_variety_01',
      color: 'text-zinc-200 border-dashed border-zinc-500/60 bg-zinc-500/8',
    });
  }
  if (enchant?.name) {
    details.push({
      text: enchant.name,
      kind: 'iconText',
      badgeVariant: 'enchant',
      icon: enchant.icon || 'inv_enchant_shardprismaticsmall',
      href: enchant.item_id
        ? getWowheadUrl(enchant.item_id)
        : enchant.enchant_id
          ? `https://www.wowhead.com/spell=${enchant.enchant_id}`
          : undefined,
      wowheadData: enchant.item_id
        ? `item=${enchant.item_id}`
        : enchant.enchant_id
          ? `spell=${enchant.enchant_id}`
          : undefined,
      color: 'text-emerald-200 border-emerald-400/45 bg-emerald-500/10',
    });
  } else if (enchantEligible) {
    details.push({
      text: 'No Enchant',
      kind: 'iconText',
      badgeVariant: 'enchant',
      icon: 'inv_enchant_shardprismaticsmall',
      color: 'text-zinc-200 border-dashed border-zinc-500/60 bg-zinc-500/8',
    });
  }
  if (embellishmentName) {
    details.push({
      text: embellishmentName,
      kind: 'iconText',
      badgeVariant: 'embellishment',
      icon: embellishmentIcon || 'inv_misc_questionmark',
      href: embellishmentItemId > 0 ? getWowheadUrl(embellishmentItemId) : undefined,
      wowheadData: embellishmentItemId > 0 ? `item=${embellishmentItemId}` : undefined,
      tooltip: embellishmentName,
      color: EMBELLISHMENT_BADGE_CLASS,
    });
  }
  for (const effect of getItemExtraEffects(
    {
      item_id: item.item_id,
      bonus_ids: item.bonus_ids || [],
      source_type: item.source_type || '',
      extra_effects: info?.extra_effects,
    },
    extraEffectsByKey
  )) {
    details.push({
      text: effect,
      badgeVariant: 'mod',
      color: 'text-cyan-200 border-cyan-300/40 bg-cyan-500/10',
    });
  }
  const hasAscendantVoidcore =
    /(?:^|\s)mod:268552(?:\s|$)/i.test(String(item.source_type || '')) ||
    String(item.source_type || '')
      .toLowerCase()
      .includes('ascendant_voidcore') ||
    String(item.name || '')
      .toLowerCase()
      .includes('ascendant');
  if (hasAscendantVoidcore) {
    details.push({
      text: 'Ascendant Voidcore',
      kind: 'iconText' as const,
      badgeVariant: 'mod',
      icon: 'inv_1205_voidforge_sovereignvoidcores_cosmicvoid',
      href: 'https://www.wowhead.com/item=268552/ascendant-voidcore',
      wowheadData: 'item=268552',
      color: ASCENDANT_VOIDCORE_BADGE_CLASS,
    });
  }

  return (
    <div
      className={`rounded-lg ${
        upgradeState === 'upgrade'
          ? 'bg-emerald-500/[0.08] ring-2 ring-inset ring-emerald-400/45'
          : upgradeState === 'downgrade'
            ? 'bg-red-500/[0.08] ring-1 ring-inset ring-red-500/25'
            : ''
      }`}
    >
      <GearItemRow
        icon={icon}
        overline={
          <>
            {upgradeState === 'upgrade'
              ? sourceTags.map((tag) => (
                  <button
                    key={`${tag.path}:${tag.text}`}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      router.push(tag.path);
                    }}
                    className="rounded border border-amber-400/45 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold leading-none text-amber-200 transition-colors hover:bg-amber-500/20"
                  >
                    {tag.text}
                  </button>
                ))
              : null}
            {ilevelTagText ? (
              <span
                className={`rounded border px-2 py-0.5 text-[11px] font-semibold leading-none ${ilevelTagClass}`}
                title={
                  levelChanged
                    ? `${slot}: ${Number(equippedItem?.ilevel || 0)} -> ${item.ilevel}`
                    : undefined
                }
              >
                {ilevelTagText}
              </span>
            ) : null}
            {displayedUpgradeLabel ? (
              (() => {
                const split = splitTierTransition(displayedUpgradeLabel);
                if (!split) {
                  return (
                    <span
                      className={`rounded border px-2 py-0.5 text-[11px] font-semibold leading-none ${tierTransitionClass(displayedUpgradeLabel)}`}
                    >
                      {displayedUpgradeLabel}
                    </span>
                  );
                }
                return (
                  <span
                    className={`rounded border px-2 py-0.5 text-[11px] font-semibold leading-none ${tierPalette(split.to).border} ${tierPalette(split.to).text}`}
                    style={{
                      backgroundImage: `linear-gradient(90deg, ${tierColorHex(split.from)} 0%, ${tierColorHex(split.from)} 50%, ${tierColorHex(split.to)} 50%, ${tierColorHex(split.to)} 100%)`,
                    }}
                  >
                    {displayedUpgradeLabel}
                  </span>
                );
              })()
            ) : null}
          </>
        }
        name={name}
        nameColor={qc}
        details={details}
        selectable={false}
        showCheckbox={false}
        reverse={reverse}
        vault={item.origin === 'vault'}
        href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
        wowheadData={whData}
        iconSize={38}
      />
    </div>
  );
}

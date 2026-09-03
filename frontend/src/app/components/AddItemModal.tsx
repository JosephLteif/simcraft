'use client';

import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { API_URL } from '../lib/api';
import { INVENTORY_TYPE_TO_SLOT } from '../lib/gear-utils';
import {
  DEFAULT_TRACK_BADGE_CLASS,
  RAID_TRACK_BY_DIFFICULTY,
  TRACK_COLORS,
} from '../lib/loot-track';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { getWowheadData, QUALITY_COLORS } from '../lib/useItemInfo';
import { wowExpansions, wowMythicPlusDungeons, wowSeasons } from '../lib/wow-season-content';
import {
  type GemDisplay,
  isPvpCraftedItem,
  normalizeSlotFilter,
  type RawGem,
  SLOT_FILTER_OPTIONS,
} from './add-item/addItemDomain';
import {
  type EmbellishmentOption,
  type ExternalItem,
  type MissiveOption,
  useAddItemState,
} from './add-item/useAddItemState';
import { useAddItemDerivedState } from './add-item/useAddItemDerivedState';
import AddItemDifficultyToggle from './add-item/AddItemDifficultyToggle';
import AddItemInstanceSidebar from './add-item/AddItemInstanceSidebar';
import CustomSelect from './shared/CustomSelect';
import WowIcon from './shared/WowIcon';
import { useDismissOnOutside } from '../lib/useDismissOnOutside';

interface AddItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (
    item: ExternalItem,
    difficulty: string,
    overrides?: {
      bonus_ids: number[];
      ilvl: number;
      track_name: string;
      level: number;
      max_level?: number;
      quality?: number;
      crafted_stats?: string[];
      crafted_selected_bonus_ids?: number[];
      crafted_variable_bonus_pool?: number[];
      embellishment?: {
        item_id: number;
        name: string;
        icon: string;
        bonus_ids: number[];
      };
      gem?: {
        gem_id: number;
        name: string;
        icon: string;
        quality: number;
      };
      ascendant_voidcore?: boolean;
    }
  ) => void;
  className?: string | null;
  spec?: string | null;
  canUseOffhand?: boolean;
  preferredSlot?: string | null;
}

const UPGRADE_TRACK_MAX_LEVEL = 6;

interface SeasonDescriptor {
  expansionName: string | null;
  seasonNumber: number | null;
  label: string;
}

function parseSeasonDescriptor(seasonName: string | null | undefined): SeasonDescriptor {
  const normalized = seasonName?.trim() || '';
  const match =
    normalized.match(/\(([^()]+?)\s+Season\s+(\d+)\)\s*$/i) ||
    normalized.match(/^(?:Mythic\+\s+)?(.+?)\s+Season\s+(\d+)\s*$/i);
  if (!match) return { expansionName: null, seasonNumber: null, label: normalized };
  return {
    expansionName: match[1].trim(),
    seasonNumber: Number(match[2]),
    label: `${match[1].trim()} Season ${match[2]}`,
  };
}

function buildSeasonByInstanceId() {
  const byInstanceId = new Map<number, SeasonDescriptor>();
  for (const season of wowSeasons) {
    const descriptor = parseSeasonDescriptor(season.name);
    for (const instanceId of season.raidInstanceIds) {
      byInstanceId.set(instanceId, descriptor);
    }
    for (const mythicPlusId of season.mythicPlusDungeonIds) {
      const journalInstanceId = wowMythicPlusDungeons.find(
        (mapping) => mapping.mythicPlusDungeonId === mythicPlusId
      )?.journalInstanceId;
      if (journalInstanceId != null) byInstanceId.set(journalInstanceId, descriptor);
    }
  }
  return byInstanceId;
}

function isSameSeason(left: SeasonDescriptor, right: SeasonDescriptor): boolean {
  if (left.seasonNumber == null || right.seasonNumber == null) {
    return left.label.toLowerCase() === right.label.toLowerCase();
  }
  return (
    left.seasonNumber === right.seasonNumber &&
    left.expansionName?.toLowerCase() === right.expansionName?.toLowerCase()
  );
}

function seasonFilterUsesCurrentSeasonUpgradeValues(
  selectedInstance: number,
  instances: Array<{ id: number; name?: string }>,
  currentSeason: SeasonDescriptor
): boolean | null {
  if (selectedInstance >= 0 || currentSeason.seasonNumber == null) return null;

  const selectedFilter = instances.find((instance) => instance.id === selectedInstance);
  const seasonNumber = selectedFilter?.name?.match(/^Season\s+(\d+)\s+Raids$/i)?.[1];
  if (seasonNumber == null) return null;

  return Number(seasonNumber) === currentSeason.seasonNumber;
}

function itemUsesCurrentSeasonUpgradeValues(
  item: ExternalItem,
  instances: Array<{
    id: number;
    name?: string;
    type?: string;
    expansion?: number;
    expansion_name?: string;
    encounters?: Array<{ id: number }>;
  }>,
  selectedInstance: number,
  seasonByInstanceId: Map<number, SeasonDescriptor>,
  currentSeason: SeasonDescriptor,
  expansionNames: Map<number, string>,
  currentExpansionId: number,
  useActiveRotationUpgradeValues = true
): boolean {
  const selectedInstanceEntry = instances.find((instance) => instance.id === selectedInstance);
  const activeDungeonBucket = instances.find(
    (instance) => instance.type === 'mplus-chest' && instance.id < 0
  );
  const isActiveDungeonSelection = activeDungeonBucket?.encounters?.some(
    (encounter) => encounter.id === selectedInstance
  );
  if (
    useActiveRotationUpgradeValues &&
    (selectedInstanceEntry?.type === 'mplus-chest' || isActiveDungeonSelection)
  ) {
    return true;
  }

  const seasonFilterOverride = seasonFilterUsesCurrentSeasonUpgradeValues(
    selectedInstance,
    instances,
    currentSeason
  );
  if (seasonFilterOverride != null) return seasonFilterOverride;

  const instanceId = Number(item.instance_id);
  if (!Number.isFinite(instanceId) || instanceId < 0) return true;

  const knownSeason = seasonByInstanceId.get(instanceId);
  if (knownSeason) return isSameSeason(knownSeason, currentSeason);

  const instance = instances.find((candidate) => candidate.id === instanceId);
  if (!instance) return false;

  const expansionId = Number(instance.expansion);
  if (Number.isFinite(expansionId) && expansionId > 0 && expansionNames.has(expansionId)) {
    return expansionId === currentExpansionId;
  }

  // New Raidbots instances can arrive before the static season catalog knows
  // their expansion. Treat those rows as current content until metadata catches up.
  return true;
}

/**
 * Fixed track tiers for Delves, Prey, and PvP.
 * These categories don't use raid difficulty_info — they have fixed loot tracks
 * sourced from dungeon_info on each item.
 *
 *   Prey  → Adventurer, Champion
 *   Delve → Adventurer, Champion, Hero
 *   PvP   → Champion (fixed)
 */
const DELVE_TRACKS = [
  { key: 'adventurer', label: 'Adventurer', infoSource: 'dungeon_info', infoDiff: 'heroic' },
  { key: 'champion', label: 'Champion', infoSource: 'dungeon_info', infoDiff: 'mythic' },
  { key: 'hero', label: 'Hero', infoSource: 'difficulty_info', infoDiff: 'heroic' },
] as const;

const PREY_TRACKS = [
  { key: 'adventurer', label: 'Adventurer', infoSource: 'dungeon_info', infoDiff: 'heroic' },
  { key: 'champion', label: 'Champion', infoSource: 'dungeon_info', infoDiff: 'mythic' },
] as const;

/** PvP items all drop at a single fixed track level. */
const PVP_TRACKS = [
  { key: 'champion', label: 'Champion', infoSource: 'dungeon_info', infoDiff: 'mythic' },
] as const;

type FixedTrackDef = { key: string; label: string; infoSource: string; infoDiff: string };

function getFixedTracksForCategory(category: string, item: ExternalItem): FixedTrackDef[] | null {
  const instName = (item.instance_name || item.encounter || '').toLowerCase();
  if (category === 'delves') {
    // If the item is from Prey, restrict to Prey tracks
    if (instName.includes('prey') || item.source_type?.toLowerCase().includes('prey')) {
      return PREY_TRACKS as unknown as FixedTrackDef[];
    }
    return DELVE_TRACKS as unknown as FixedTrackDef[];
  }
  if (category === 'pvp') return PVP_TRACKS as unknown as FixedTrackDef[];
  return null;
}

/** Track colors – mirrors the Drop Finder page to keep the app consistent. */
const DEFAULT_BADGE = DEFAULT_TRACK_BADGE_CLASS;

function isWorldBossInstance(inst: { name?: string; type?: string }): boolean {
  const name = String(inst.name || '').toLowerCase();
  const type = String(inst.type || '').toLowerCase();
  return name.includes('world boss') || type.includes('world-boss') || type.includes('world_boss');
}

function isDelveInstance(inst: { type?: string }): boolean {
  return String(inst.type || '')
    .toLowerCase()
    .includes('delve');
}

function isPvpInstance(inst: { type?: string }): boolean {
  return String(inst.type || '')
    .toLowerCase()
    .includes('pvp');
}

function isCraftedInstance(inst: { type?: string }): boolean {
  return String(inst.type || '')
    .toLowerCase()
    .includes('profession');
}

function isPreyInstance(inst: { type?: string }): boolean {
  return String(inst.type || '')
    .toLowerCase()
    .includes('prey');
}

function isDungeonType(type: string): boolean {
  return type === 'dungeon' || type === 'expansion-dungeon' || type === 'mplus-chest';
}

/** Categories in the Loot Browser — order matters for the tab row. */
const LOOT_CATEGORIES = [
  { key: 'raid', label: 'RAID' },
  { key: 'dungeon', label: 'DUNGEON' },
  { key: 'tier', label: 'TIER' },
  { key: 'crafted', label: 'CRAFTED' },
  { key: 'delves', label: 'DELVES/PREY' },
  { key: 'pvp', label: 'PVP' },
  { key: 'world_bosses', label: 'WORLD BOSSES' },
] as const;

type LootCategory = (typeof LOOT_CATEGORIES)[number]['key'];

function isWeaponOrTrinketInventoryType(inventoryType: number): boolean {
  return [12, 13, 14, 17, 21, 22, 23].includes(Number(inventoryType));
}

function isAscendantEligible(item: ExternalItem, tier: any): boolean {
  if (!tier || !isWeaponOrTrinketInventoryType(item.inventory_type)) return false;
  const track = String(tier.track || '').toLowerCase();
  return track.includes('hero') || track.includes('myth');
}

function isActualCraftedItem(item: ExternalItem): boolean {
  const sourceType = String(item.source_type || '').toLowerCase();
  return (
    sourceType.includes('profession') ||
    (Array.isArray(item.crafted_base_bonus_ids) && item.crafted_base_bonus_ids.length > 0) ||
    Number(item.missive_count || 0) > 0 ||
    Array.isArray(item.embellishment_options)
  );
}

function missivesForItem(item: ExternalItem, missives: MissiveOption[]): MissiveOption[] {
  if (!isActualCraftedItem(item)) return [];

  const secondaryStatIds = new Set([24, 25, 32, 36, 40, 49]);
  const itemSecondaryStatCount =
    item.stats?.filter((stat) => secondaryStatIds.has(Number(stat.id))).length || 0;
  const explicitMissiveCount = Number(item.missive_count || 0);
  const expectedCount = explicitMissiveCount > 0 ? explicitMissiveCount : itemSecondaryStatCount;
  if (expectedCount <= 0) return [];

  if (expectedCount === 1) {
    const labels: Record<string, string> = {
      crit: 'Critical Strike',
      haste: 'Haste',
      mastery: 'Mastery',
      versatility: 'Versatility',
    };
    const byToken = new Map<string, MissiveOption>();
    for (const missive of missives) {
      const tokens = missive.token.split('/').filter(Boolean);
      for (const token of tokens) {
        if (!labels[token] || byToken.has(token)) continue;
        byToken.set(token, {
          token,
          label: labels[token],
          stat_count: 1,
        });
      }
    }
    const singles = Array.from(byToken.values()).sort((a, b) => a.label.localeCompare(b.label));
    if (singles.length > 0) return singles;
  }

  const matching = missives.filter((missive) => {
    const statCount = Number(missive.stat_count || missive.token.split('/').filter(Boolean).length);
    return statCount === expectedCount;
  });
  return matching.length > 0 ? matching : missives;
}

function getDisplayQuality(
  item: ExternalItem,
  tierQuality: number | undefined,
  category: LootCategory
): number {
  const effective = tierQuality ?? item.quality;
  const sourceType = String(item.source_type || '').toLowerCase();
  // Crafted quality rank (Q5) is not item rarity; keep crafted items in Epic color unless explicitly lower.
  if ((category === 'crafted' || sourceType.includes('profession')) && effective >= 5) {
    return 4;
  }
  return effective;
}

function instanceMatchesCategory(inst: { name?: string; type?: string }, cat: string): boolean {
  const type = String(inst.type || '').toLowerCase();
  switch (cat) {
    case 'raid':
      return type === 'raid' && !isWorldBossInstance(inst);
    case 'dungeon':
      return isDungeonType(type);
    case 'tier':
      return type === 'catalyst';
    case 'delves':
      return isDelveInstance(inst) || isPreyInstance(inst);
    case 'pvp':
      return isPvpInstance(inst);
    case 'crafted':
      return isCraftedInstance(inst);
    case 'world_bosses':
      return isWorldBossInstance(inst);
    default:
      return false;
  }
}

const getMappedTrackName = (
  selectedDifficulty: string,
  info: { track?: string } | null | undefined
): string => {
  const raidTrack = RAID_TRACK_BY_DIFFICULTY[selectedDifficulty?.toLowerCase()];
  return info?.track || raidTrack || '';
};

function dungeonDifficultyKeyCandidates(selectedDifficulty: string): string[] {
  const raw = String(selectedDifficulty || '').trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const out = new Set<string>([raw, lower]);
  if (lower.startsWith('mythic+')) {
    const level = lower.replace('mythic+', '');
    out.add(`+${level}`);
    out.add(`mythic_plus_${level}`);
    out.add(`mythic-plus-${level}`);
  } else if (/^\+\d+$/.test(lower)) {
    const level = lower.slice(1);
    out.add(`mythic+${level}`);
    out.add(`mythic_plus_${level}`);
    out.add(`mythic-plus-${level}`);
  } else if (lower.startsWith('mythic_plus_')) {
    const level = lower.replace('mythic_plus_', '');
    out.add(`mythic+${level}`);
    out.add(`+${level}`);
  }
  return Array.from(out);
}

function resolveInfoForDifficulty(
  item: ExternalItem,
  selectedDifficulty: string,
  category: string
): any {
  if (category !== 'dungeon') {
    return (
      item.difficulty_info?.[selectedDifficulty] || item.dungeon_info?.[selectedDifficulty] || null
    );
  }

  for (const key of dungeonDifficultyKeyCandidates(selectedDifficulty)) {
    if (item.dungeon_info?.[key]) return item.dungeon_info[key];
  }
  for (const key of dungeonDifficultyKeyCandidates(selectedDifficulty)) {
    if (item.difficulty_info?.[key]) return item.difficulty_info[key];
  }
  return null;
}

function hasAvailableDifficulty(item: ExternalItem, difficulty: string, category: string): boolean {
  return !!resolveInfoForDifficulty(item, difficulty, category);
}

function collectCraftedIlevels(
  item: ExternalItem,
  upgradeTracks: Record<string, any>
): Array<{ ilvl: number; bonus_id: number; key: string }> {
  if (Array.isArray(item.crafted_levels) && item.crafted_levels.length > 0) {
    return Array.from(new Set(item.crafted_levels))
      .filter((ilvl) => Number.isFinite(ilvl) && ilvl > 0)
      .sort((a, b) => a - b)
      .map((ilvl, index) => ({
        ilvl,
        bonus_id: 0,
        key: `crafted_${index + 1}`,
      }));
  }

  const out = [];
  const canAddGildedStep = !isPvpCraftedItem(item) && !item.difficulty_info?.lfr;
  if (item.difficulty_info) {
    for (const [key, entry] of Object.entries(item.difficulty_info)) {
      if (entry?.ilvl && entry.ilvl > 0) {
        out.push({ ilvl: entry.ilvl, bonus_id: entry.bonus_id || 0, key });
        if (canAddGildedStep && key === 'mythic' && entry.track && upgradeTracks[entry.track]) {
          const track = upgradeTracks[entry.track];
          // Crests typically allow crafting up to maxLevel - 1 of their respective track
          const maxTrackLevel = Math.max(...track.map((t: any) => t.max || 0));
          const gilded = track.find((t: any) => t.level === maxTrackLevel - 1);
          if (gilded) {
            out.push({
              ilvl: gilded.ilvl || gilded.itemLevel || 0,
              bonus_id: gilded.bonus_id || gilded.bonusIds?.[0] || 0,
              key: 'gilded',
            });
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.ilvl - b.ilvl);
}

const getEffectiveTier = (
  item: ExternalItem,
  selectedDifficulty: string,
  itemTiers: Record<number, number>,
  upgradeTracks: Record<string, any>,
  category: string
) => {
  // ── Fixed-track categories (delves, prey, pvp) ──────────────────
  const fixedTracks = getFixedTracksForCategory(category, item);
  if (fixedTracks) {
    // Pick track based on selectedDifficulty. If not available, fallback to the highest track.
    let chosenIdx = fixedTracks.findIndex((t) => t.key === selectedDifficulty);
    if (chosenIdx === -1) {
      chosenIdx = fixedTracks.length - 1;
    }
    const chosen = fixedTracks[chosenIdx];
    const infoBlock =
      chosen.infoSource === 'dungeon_info'
        ? item.dungeon_info?.[chosen.infoDiff]
        : item.difficulty_info?.[chosen.infoDiff];
    if (!infoBlock) return null;

    const trackName = infoBlock.track || chosen.label;
    const track = upgradeTracks[trackName];
    const trackMaxLevel = track ? track[track.length - 1].level : UPGRADE_TRACK_MAX_LEVEL;
    const baseLevel = infoBlock.level || 1;
    const defaultLevel = Math.max(1, Math.min(baseLevel, trackMaxLevel));
    const currentLevel = Math.max(
      1,
      Math.min(itemTiers[item.item_id] || defaultLevel, trackMaxLevel)
    );

    const levelInfo = track?.find((t: any) => t.level === currentLevel);

    return {
      track: trackName,
      level: currentLevel,
      maxLevel: track ? track[track.length - 1].level : UPGRADE_TRACK_MAX_LEVEL,
      ilvl: levelInfo?.ilvl || infoBlock.ilvl,
      baseLevel: 1,
      baseIlvl: infoBlock.ilvl,
      bonus_id: infoBlock.bonus_id || 0,
      quality: infoBlock.quality ?? item.quality,
    };
  }

  const info = resolveInfoForDifficulty(item, selectedDifficulty, category);

  if (category === 'crafted') {
    const levels = collectCraftedIlevels(item, upgradeTracks);
    if (levels.length === 0) return null;

    const currentLevel = itemTiers[item.item_id] || 1;
    const boundedLevel = Math.min(levels.length, Math.max(1, currentLevel));
    const levelInfo = levels[boundedLevel - 1];

    return {
      track: 'Crafted',
      level: boundedLevel,
      maxLevel: levels.length,
      ilvl: levelInfo.ilvl,
      baseLevel: 1,
      baseIlvl: levels[0].ilvl,
      bonus_id: levelInfo.bonus_id,
      crafted_key: levelInfo.key,
      quality: item.quality,
    };
  }

  const trackName = getMappedTrackName(selectedDifficulty, info);
  if (!info || !trackName) return null;

  const track = upgradeTracks[trackName];
  if (!track || !Array.isArray(track)) return null;
  const trackMaxLevel = track[track.length - 1].level;
  const baseLevel = info.level || 1;
  const defaultLevel = Math.max(1, Math.min(baseLevel, trackMaxLevel));
  const currentLevel = Math.max(
    1,
    Math.min(itemTiers[item.item_id] || defaultLevel, trackMaxLevel)
  );

  const levelInfo = track.find((t: any) => t.level === currentLevel);
  return {
    track: trackName,
    level: currentLevel,
    maxLevel: track[track.length - 1].level,
    ilvl: levelInfo?.ilvl || info.ilvl,
    baseLevel: 1,
    baseIlvl: info.ilvl,
    bonus_id: info.bonus_id,
    quality: info.quality || item.quality,
  };
};

export default function AddItemModal({
  isOpen,
  onClose,
  onAdd,
  className,
  spec,
  canUseOffhand = true,
  preferredSlot,
}: AddItemModalProps) {
  const state = useAddItemState(isOpen, className, spec, preferredSlot);
  const modalRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutside(modalRef, isOpen, onClose);
  const [embellishmentOptionsByItem, setEmbellishmentOptionsByItem] = useState<
    Record<number, EmbellishmentOption[]>
  >({});
  const [rawGems, setRawGems] = useState<RawGem[]>([]);
  const [itemGems, setItemGems] = useState<Record<number, GemDisplay | null>>({});
  const [craftedFilterSlot, setCraftedFilterSlot] = useState<string | null>(null);
  const [focusedDungeonExpansionId, setFocusedDungeonExpansionId] = useState<number | null>(null);

  const inventoryTypeToSlot = INVENTORY_TYPE_TO_SLOT;

  const {
    instances,
    selectedInstance,
    setSelectedInstance,
    drops,
    loading,
    isGlobalLoading,
    globalSearch,
    setGlobalSearch,
    localSearch,
    seasonConfig,
    selectedDifficulty,
    setSelectedDifficulty,
    filterSlot,
    setFilterSlot,
    category,
    setCategory,
    upgradeTracks,
    itemTiers,
    setItemTiers,
    groupBy,
    setGroupBy,
    missives,
    itemMissives,
    setItemMissives,
    itemEmbellishments,
    setItemEmbellishments,
  } = state;

  const slotFilterOptions = useMemo(
    () => SLOT_FILTER_OPTIONS.filter((entry) => canUseOffhand || entry.value !== 'off_hand'),
    [canUseOffhand]
  );

  const expansionNames = useMemo(
    () => new Map(wowExpansions.map((expansion) => [expansion.id, expansion.name])),
    []
  );
  const seasonByInstanceId = useMemo(() => buildSeasonByInstanceId(), []);
  const currentSeasonDescriptor = useMemo(
    () => parseSeasonDescriptor(seasonConfig?.season),
    [seasonConfig?.season]
  );
  const currentExpansionId =
    wowExpansions.find(
      (expansion) =>
        expansion.name.toLowerCase() === currentSeasonDescriptor.expansionName?.toLowerCase()
    )?.id ?? Math.max(...wowExpansions.map((expansion) => expansion.id), 0);

  const usesCurrentSeasonUpgradeValues = useMemo(
    () => (item: ExternalItem) =>
      itemUsesCurrentSeasonUpgradeValues(
        item,
        instances,
        selectedInstance,
        seasonByInstanceId,
        currentSeasonDescriptor,
        expansionNames,
        currentExpansionId,
        focusedDungeonExpansionId == null
      ),
    [
      currentExpansionId,
      currentSeasonDescriptor,
      expansionNames,
      focusedDungeonExpansionId,
      instances,
      seasonByInstanceId,
      selectedInstance,
    ]
  );

  useEffect(() => {
    if (!canUseOffhand && filterSlot === 'off_hand') {
      setFilterSlot(null);
    }
    if (!canUseOffhand && craftedFilterSlot === 'off_hand') {
      setCraftedFilterSlot(null);
    }
  }, [canUseOffhand, craftedFilterSlot, filterSlot, setFilterSlot]);

  const {
    craftedSidebarFilters,
    filteredInstances,
    activeFilterSlotLabel,
    craftedSidebarSelectedId,
    filteredDrops,
    orderedFilteredDropEntries,
    difficulties,
    seasonalGems,
  } = useAddItemDerivedState({
    category,
    instances,
    selectedInstance,
    craftedFilterSlot,
    filterSlot,
    drops,
    groupBy,
    globalSearch,
    localSearch,
    selectedDifficulty,
    canUseOffhand,
    seasonConfig,
    rawGems,
    inventoryTypeToSlot,
    instanceMatchesCategory,
    hasAvailableDifficulty,
  });

  const handleSidebarSelect = (id: number) => {
    setFocusedDungeonExpansionId(null);
    if (category === 'crafted') {
      const entry = craftedSidebarFilters.find((opt) => opt.id === id);
      if (entry) {
        setCraftedFilterSlot(entry.filter);
        return;
      }
    }
    setSelectedInstance(id);
  };

  const handleSidebarExpansionSelect = (id: number, expansionId: number) => {
    setFocusedDungeonExpansionId(expansionId);
    setSelectedInstance(id);
  };

  useEffect(() => {
    setFocusedDungeonExpansionId(null);
  }, [category]);

  const effectiveDifficulty =
    category === 'world_bosses' || category === 'pvp' || category === 'crafted'
      ? 'normal'
      : selectedDifficulty;
  const isSearchingAcrossCategory = globalSearch.trim().length > 0;
  const isDropListLoading = loading || (isSearchingAcrossCategory && isGlobalLoading);

  // Reset per-item ilvl slider selections when top filters change.
  useEffect(() => {
    setItemTiers({});
    setItemMissives({});
    setItemEmbellishments({});
    setItemGems({});
  }, [
    category,
    selectedDifficulty,
    globalSearch,
    setItemTiers,
    setItemMissives,
    setItemEmbellishments,
  ]);

  useEffect(() => {
    if (isOpen) {
      setCraftedFilterSlot(preferredSlot || null);
    }
  }, [isOpen, preferredSlot]);

  // Ensure selected difficulty is valid for the current instance/category
  useEffect(() => {
    if (category === 'world_bosses') {
      if (selectedDifficulty !== 'normal') setSelectedDifficulty('normal');
      return;
    }
    if (difficulties.length > 0) {
      const isValid = difficulties.some((d: any) => d.key === selectedDifficulty);
      if (!isValid) {
        // Default to heroic for raids, or a middle ground for dungeons
        const defaultDiff =
          category === 'raid'
            ? difficulties.find((d: any) => d.key === 'heroic') || difficulties[0]
            : difficulties.find((d: any) => d.key === '+10') || difficulties[0];
        if (defaultDiff) {
          setSelectedDifficulty(defaultDiff.key);
        }
      }
    }
  }, [difficulties, category, selectedDifficulty, setSelectedDifficulty]);

  useWowheadTooltips([drops, selectedDifficulty, category, seasonalGems.length]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/gear/gem-options`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setRawGems(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setRawGems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    const itemIds = new Set<number>();
    Object.values(drops).forEach((items) => {
      items.forEach((item) => {
        if (
          item.item_id > 0 &&
          !((item.embellishment_options || []).length > 0) &&
          embellishmentOptionsByItem[item.item_id] === undefined
        ) {
          itemIds.add(item.item_id);
        }
      });
    });
    const idsToFetch = Array.from(itemIds);
    if (idsToFetch.length === 0) return;
    let cancelled = false;
    (async () => {
      const fetched = await Promise.all(
        idsToFetch.map(async (itemId) => {
          try {
            const res = await fetch(
              `${API_URL}/api/gear/embellishment-options?item_id=${encodeURIComponent(String(itemId))}`,
              { credentials: 'include' }
            );
            if (!res.ok) return [itemId, [] as EmbellishmentOption[]] as const;
            const data = await res.json();
            return [itemId, Array.isArray(data) ? (data as EmbellishmentOption[]) : []] as const;
          } catch {
            return [itemId, [] as EmbellishmentOption[]] as const;
          }
        })
      );
      if (cancelled) return;
      setEmbellishmentOptionsByItem((prev) => {
        const next = { ...prev };
        for (const [itemId, options] of fetched) {
          next[itemId] = options;
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [drops, isOpen, category, embellishmentOptionsByItem]);

  const handleAdd = (item: ExternalItem) => {
    const canSelectIlvl = usesCurrentSeasonUpgradeValues(item);
    const resolvedTier = getEffectiveTier(
      item,
      effectiveDifficulty,
      itemTiers,
      upgradeTracks,
      category
    );
    const effectiveTier = canSelectIlvl ? resolvedTier : null;
    const selectedRawLevel = itemTiers[item.item_id] || effectiveTier?.level || 1;
    const ascendantLevel = effectiveTier ? effectiveTier.maxLevel + 1 : 0;
    const ascendantApplied =
      Boolean(effectiveTier) &&
      isAscendantEligible(item, effectiveTier) &&
      selectedRawLevel === ascendantLevel;
    const ascendantBonusIlvl = ascendantApplied ? 9 : 0;
    const selectedLevel = effectiveTier
      ? Math.max(effectiveTier.baseLevel || 1, Math.min(effectiveTier.maxLevel, selectedRawLevel))
      : selectedRawLevel;
    const selectedEmbellishment = itemEmbellishments[item.item_id] || null;
    const selectedGem = itemGems[item.item_id] || null;
    const availableMissives = missivesForItem(item, missives);
    const gemOverride = selectedGem
      ? {
          gem_id: selectedGem.gem_id,
          name: selectedGem.name,
          icon: selectedGem.icon,
          quality: selectedGem.quality,
        }
      : undefined;
    const embellishmentBonusIds = selectedEmbellishment?.bonus_ids || [];
    const withEmbellishment = (baseBonusIds: number[]) =>
      Array.from(new Set([...baseBonusIds, ...embellishmentBonusIds]));
    const embellishmentOverride = selectedEmbellishment
      ? {
          item_id: selectedEmbellishment.item_id,
          name: selectedEmbellishment.name,
          icon: selectedEmbellishment.icon,
          bonus_ids: selectedEmbellishment.bonus_ids,
        }
      : undefined;
    const missiveTokens =
      (itemMissives[item.item_id] || []).length > 0
        ? itemMissives[item.item_id]
        : availableMissives.length > 0
          ? availableMissives[0].token.split('/')
          : [];
    const selectedMissiveToken = [...missiveTokens].sort().join('/');
    const selectedMissive = availableMissives.find(
      (m: MissiveOption) => m.token === selectedMissiveToken
    );
    const missiveBonusIds = selectedMissive?.bonus_ids || [];
    const missivePoolBonusIds = Array.from(
      new Set(
        missives.flatMap((m: MissiveOption) => (Array.isArray(m.bonus_ids) ? m.bonus_ids : []))
      )
    );
    const embellishmentPoolBonusIds = Array.from(
      new Set(
        (
          ((item.embellishment_options || []).length > 0
            ? item.embellishment_options
            : embellishmentOptionsByItem[item.item_id] || []) as EmbellishmentOption[]
        ).flatMap((opt) => (Array.isArray(opt.bonus_ids) ? opt.bonus_ids : []))
      )
    );
    const craftedVariableBonusPool = Array.from(
      new Set([...missivePoolBonusIds, ...embellishmentPoolBonusIds])
    );
    const craftedSelectedBonusIds = Array.from(
      new Set([...(missiveBonusIds || []), ...(embellishmentBonusIds || [])])
    );
    const withCraftingBonuses = (baseBonusIds: number[]) =>
      Array.from(new Set([...baseBonusIds, ...missiveBonusIds]));

    if (!canSelectIlvl) {
      onAdd(item, effectiveDifficulty, {
        bonus_ids: withEmbellishment(withCraftingBonuses([])),
        ilvl: item.ilevel,
        track_name: '',
        level: 0,
        quality: item.quality,
        crafted_stats: missiveTokens.length > 0 ? missiveTokens : undefined,
        crafted_selected_bonus_ids: craftedSelectedBonusIds,
        crafted_variable_bonus_pool: craftedVariableBonusPool,
        embellishment: embellishmentOverride,
        gem: gemOverride,
      });
      return;
    }

    // Fixed-track categories: resolve from getEffectiveTier directly
    const fixedTracks = getFixedTracksForCategory(category, item);
    if (fixedTracks) {
      const tier = getEffectiveTier(item, effectiveDifficulty, itemTiers, upgradeTracks, category);
      if (tier) {
        onAdd(item, 'normal', {
          bonus_ids: withEmbellishment(withCraftingBonuses(tier.bonus_id ? [tier.bonus_id] : [])),
          ilvl: tier.ilvl + ascendantBonusIlvl,
          track_name: tier.track,
          level: tier.level,
          max_level: tier.maxLevel,
          quality: tier.quality,
          crafted_stats: missiveTokens.length > 0 ? missiveTokens : undefined,
          crafted_selected_bonus_ids: craftedSelectedBonusIds,
          crafted_variable_bonus_pool: craftedVariableBonusPool,
          embellishment: embellishmentOverride,
          gem: gemOverride,
          ascendant_voidcore: ascendantApplied,
        });
      } else {
        onAdd(item, 'normal', {
          bonus_ids: withEmbellishment(withCraftingBonuses([])),
          ilvl: item.ilevel + ascendantBonusIlvl,
          track_name: '',
          level: 0,
          crafted_stats: missiveTokens.length > 0 ? missiveTokens : undefined,
          crafted_selected_bonus_ids: craftedSelectedBonusIds,
          crafted_variable_bonus_pool: craftedVariableBonusPool,
          embellishment: embellishmentOverride,
          gem: gemOverride,
          ascendant_voidcore: ascendantApplied,
        });
      }
      return;
    }

    const info = resolveInfoForDifficulty(item, effectiveDifficulty, category);
    const trackName = getMappedTrackName(effectiveDifficulty, info);
    const baseBonusIds = info?.bonus_id ? [info.bonus_id] : [];

    if (category === 'crafted') {
      const levels = collectCraftedIlevels(item, upgradeTracks);
      const boundedLevel = Math.min(levels.length, Math.max(1, selectedLevel));
      const levelInfo = levels[boundedLevel - 1] || {
        ilvl: item.ilevel,
        bonus_id: 0,
        key: 'normal',
      };
      const craftedBaseBonusIds = Array.isArray(item.crafted_base_bonus_ids)
        ? item.crafted_base_bonus_ids
        : [];

      onAdd(item, levelInfo.key, {
        bonus_ids: withEmbellishment(withCraftingBonuses(craftedBaseBonusIds)),
        ilvl: levelInfo.ilvl + ascendantBonusIlvl,
        track_name: 'Radiance Crafted',
        level: boundedLevel,
        max_level: levels.length,
        quality: getDisplayQuality(item, undefined, category as LootCategory),
        crafted_stats: missiveTokens.length > 0 ? missiveTokens : undefined,
        crafted_selected_bonus_ids: craftedSelectedBonusIds,
        crafted_variable_bonus_pool: craftedVariableBonusPool,
        embellishment: embellishmentOverride,
        gem: gemOverride,
        ascendant_voidcore: ascendantApplied,
      });
      return;
    }

    if (trackName && selectedLevel && upgradeTracks[trackName]) {
      const track = upgradeTracks[trackName];
      const levelInfo = track.find((t: any) => t.level === selectedLevel);
      if (levelInfo) {
        onAdd(item, effectiveDifficulty, {
          bonus_ids: withEmbellishment(
            withCraftingBonuses(Array.from(new Set([...baseBonusIds, levelInfo.bonus_id])))
          ),
          ilvl: levelInfo.ilvl + ascendantBonusIlvl,
          track_name: trackName,
          level: selectedLevel,
          max_level: effectiveTier?.maxLevel,
          quality: levelInfo.quality ?? info?.quality,
          crafted_stats: missiveTokens.length > 0 ? missiveTokens : undefined,
          crafted_selected_bonus_ids: craftedSelectedBonusIds,
          crafted_variable_bonus_pool: craftedVariableBonusPool,
          embellishment: embellishmentOverride,
          gem: gemOverride,
          ascendant_voidcore: ascendantApplied,
        });
        return;
      }
    }
    onAdd(
      item,
      effectiveDifficulty,
      info
        ? {
            bonus_ids: withEmbellishment(withCraftingBonuses(baseBonusIds)),
            ilvl: info.ilvl,
            track_name: info.track || '',
            level: info.level || 0,
            max_level: info.max_level || effectiveTier?.maxLevel,
            quality: info.quality,
            crafted_stats: missiveTokens.length > 0 ? missiveTokens : undefined,
            crafted_selected_bonus_ids: craftedSelectedBonusIds,
            crafted_variable_bonus_pool: craftedVariableBonusPool,
            embellishment: embellishmentOverride,
            gem: gemOverride,
            ascendant_voidcore: ascendantApplied,
          }
        : {
            bonus_ids: withEmbellishment(withCraftingBonuses([])),
            ilvl: item.ilevel,
            track_name: '',
            level: 0,
            crafted_stats: missiveTokens.length > 0 ? missiveTokens : undefined,
            crafted_selected_bonus_ids: craftedSelectedBonusIds,
            crafted_variable_bonus_pool: craftedVariableBonusPool,
            embellishment: embellishmentOverride,
            gem: gemOverride,
            ascendant_voidcore: ascendantApplied,
          }
    );
  };

  const handleCardClick = (item: ExternalItem, event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-stop-add="true"]')) return;
    if (target.closest('button,input,a,select,textarea')) return;

    const selection = window.getSelection?.();
    if (selection && selection.toString().trim().length > 0) return;

    handleAdd(item);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-x-0 top-[var(--app-header-height)] bottom-0 z-[100] flex items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={onClose} />
      <div
        ref={modalRef}
        data-tour="loot-browser"
        tabIndex={-1}
        className="mobile-modal-shell animate-in fade-in zoom-in border-border bg-bg relative flex h-full max-h-[calc(100dvh-var(--app-header-height))] min-h-0 w-full max-w-[88rem] flex-col overflow-hidden rounded-2xl border shadow-2xl duration-200 sm:max-h-[calc(100dvh-var(--app-header-height)-2rem)]"
      >
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="border-border bg-surface/80 relative z-10 shrink-0 border-b px-4 py-3 sm:px-5 sm:py-4">
          <div className="mb-3 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
              {/* Title */}
              <div>
                <h2 className="text-lg font-bold tracking-tight text-white">Loot Browser</h2>
              </div>
              {/* Category Switcher */}
              <div className="border-border bg-surface-2 flex max-w-full overflow-x-auto rounded-lg border p-0.5">
                {LOOT_CATEGORIES.map((cat) => (
                  <button
                    key={cat.key}
                    onClick={() => {
                      setCategory(cat.key);
                      setGlobalSearch('');
                      if (cat.key === 'crafted') {
                        setSelectedInstance(0);
                        return;
                      }
                      const first =
                        cat.key === 'dungeon'
                          ? instances.find((i) => i.type === 'mplus-chest') ||
                            instances.find((i) => instanceMatchesCategory(i, cat.key))
                          : instances.find((i) => instanceMatchesCategory(i, cat.key));
                      if (first) setSelectedInstance(first.id);
                    }}
                    className={`rounded-md px-3 py-1.5 text-[11px] font-bold tracking-wide transition-all ${category === cat.key ? 'bg-gold text-black shadow-sm' : 'text-zinc-300 hover:text-white'}`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
              {/* Group-by toggle for raids */}
              {!['dungeon', 'delves', 'pvp', 'tier'].includes(category) && (
                <div className="flex items-center gap-3">
                  <div className="border-border bg-surface-2 flex rounded-lg border p-0.5">
                    {[
                      { id: 'slot', label: 'Slot' },
                      { id: 'boss', label: category === 'crafted' ? 'Profession' : 'Boss' },
                    ].map((mode: any) => (
                      <button
                        key={mode.id}
                        onClick={() => setGroupBy(mode.id)}
                        className={`rounded-md px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase transition-all ${
                          groupBy === mode.id
                            ? 'bg-gold border-transparent text-black shadow-sm'
                            : 'border-transparent text-zinc-300 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              {category !== 'crafted' && (
                <div className="w-full shrink-0 sm:w-48">
                  <CustomSelect
                    variant="header"
                    value={normalizeSlotFilter(filterSlot) || ''}
                    placeholder="All Item Types"
                    options={slotFilterOptions.map((slot) => ({
                      value: slot.value,
                      label: slot.label,
                    }))}
                    onChange={(val) => setFilterSlot(val || null)}
                  />
                </div>
              )}
              <button
                onClick={onClose}
                data-tour="loot-browser-close"
                className="border-border bg-surface-2 flex h-10 w-10 items-center justify-center self-end rounded-lg border text-zinc-500 transition-all hover:border-red-500/30 hover:bg-red-500/10 hover:text-white sm:h-8 sm:w-8 sm:self-auto"
                aria-label="Close loot browser"
              >
                <X className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
          </div>
          {/* Search + Difficulty */}
          <div className="relative flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="group relative flex-1">
              <input
                type="text"
                autoFocus
                placeholder="Search by item name, boss, or type..."
                value={globalSearch}
                onChange={(e) => {
                  setGlobalSearch(e.target.value);
                }}
                className="input-field w-full py-2.5 pr-4 pl-10 text-sm"
              />
              <Search
                className="group-focus-within:text-gold absolute top-3 left-3.5 h-4 w-4 text-zinc-500 transition-colors"
                strokeWidth={2}
              />
            </div>
            {(category === 'raid' ||
              category === 'dungeon' ||
              category === 'tier' ||
              (category === 'delves' && difficulties.length > 1)) && (
              <AddItemDifficultyToggle
                difficulties={difficulties}
                selectedDifficulty={selectedDifficulty}
                onSelect={setSelectedDifficulty}
                label={category === 'delves' || category === 'tier' ? 'Track' : 'Difficulty'}
              />
            )}
          </div>
        </div>

        {/* ── Body ────────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
          <AddItemInstanceSidebar
            instances={filteredInstances}
            selectedInstance={craftedSidebarSelectedId}
            onSelect={handleSidebarSelect}
            onSelectExpansion={handleSidebarExpansionSelect}
            focusedExpansionId={category === 'dungeon' ? focusedDungeonExpansionId : null}
            currentSeasonName={seasonConfig?.season}
            isDungeonBrowser={category === 'dungeon'}
          />
          <div className="bg-bg flex-1 scrollbar-thin scrollbar-thumb-white/10 overflow-y-auto p-6">
            {isDropListLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="border-border border-t-gold h-12 w-12 animate-spin rounded-full border-[3px]" />
              </div>
            ) : Object.keys(filteredDrops).length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="text-xl font-bold tracking-tight text-white">
                  {activeFilterSlotLabel
                    ? `No ${activeFilterSlotLabel} items match your filters`
                    : 'No loot items match your filters'}
                </div>
                <div className="mt-2 max-w-xl text-sm font-medium text-zinc-300">
                  Try changing the item type, category, difficulty, or search terms.
                </div>
              </div>
            ) : (
              <div>
                {orderedFilteredDropEntries.map(([slot, items]) => (
                  <section
                    key={slot}
                    className="grid grid-cols-1 gap-4 border-t border-white/35 py-7 first:border-t-0 lg:grid-cols-[5.75rem_minmax(0,1fr)] xl:grid-cols-[6.5rem_minmax(0,1fr)]"
                  >
                    <div className="flex items-center lg:justify-center">
                      <div className="min-w-20 lg:text-center">
                        <div className="text-gold/85 text-xs leading-tight font-black tracking-[0.16em] break-words whitespace-normal uppercase sm:text-sm xl:text-[0.95rem]">
                          {slot}
                        </div>
                        <div className="mt-2 text-[10px] font-bold tracking-[0.18em] text-white uppercase">
                          {items.length} item{items.length === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                      {items.map((item, index) => {
                        const canSelectIlvl = usesCurrentSeasonUpgradeValues(item);
                        const tier = canSelectIlvl
                          ? getEffectiveTier(
                              item,
                              effectiveDifficulty,
                              itemTiers,
                              upgradeTracks,
                              category
                            )
                          : null;
                        const ascendantEligible = Boolean(tier) && isAscendantEligible(item, tier);
                        const ascendantLevel = tier ? tier.maxLevel + 1 : 0;
                        const rawSliderLevel = tier ? itemTiers[item.item_id] || tier.level : 0;
                        const ascendantApplied =
                          Boolean(tier) && ascendantEligible && rawSliderLevel === ascendantLevel;
                        const currentIlvl = canSelectIlvl
                          ? (tier?.ilvl || item.ilevel) + (ascendantApplied ? 9 : 0)
                          : item.ilevel;
                        const trackName = tier?.track || '';
                        const tc = trackName ? TRACK_COLORS[trackName] : null;
                        const badgeClass = tc?.badge || DEFAULT_BADGE;
                        const displayQuality = getDisplayQuality(
                          item,
                          tier?.quality,
                          category as LootCategory
                        );
                        const availableMissives = missivesForItem(item, missives);
                        const defaultMissive =
                          availableMissives.length > 0 ? availableMissives[0] : null;
                        const effectiveMissiveTokens =
                          (itemMissives[item.item_id] || []).length > 0
                            ? itemMissives[item.item_id]
                            : defaultMissive
                              ? defaultMissive.token.split('/')
                              : [];
                        const selectedMissiveToken = [...effectiveMissiveTokens].sort().join('/');
                        const selectedMissive = availableMissives.find(
                          (m: MissiveOption) => m.token === selectedMissiveToken
                        );
                        const selectedEmbellishment = itemEmbellishments[item.item_id] || null;
                        const selectedGem = itemGems[item.item_id] || null;
                        const canSocketItem =
                          Number(item.socket_count || 0) > 0 || Boolean(item.hasSockets);
                        const tooltipBonusIds =
                          category === 'crafted'
                            ? Array.from(
                                new Set([
                                  ...(item.crafted_base_bonus_ids || []),
                                  ...((selectedMissive?.bonus_ids as number[]) || []),
                                  ...((selectedEmbellishment?.bonus_ids as number[]) || []),
                                ])
                              )
                            : tier?.bonus_id
                              ? [tier.bonus_id]
                              : [];
                        const whData = getWowheadData(
                          tooltipBonusIds,
                          currentIlvl,
                          undefined,
                          selectedGem?.gem_id
                        );
                        const embellishmentOptions = (
                          (item.embellishment_options || []).length > 0
                            ? item.embellishment_options || []
                            : embellishmentOptionsByItem[item.item_id] || []
                        ).filter(
                          (opt): opt is EmbellishmentOption =>
                            !!opt &&
                            Number.isFinite(opt.item_id) &&
                            Number.isFinite(opt.id) &&
                            Array.isArray(opt.bonus_ids) &&
                            opt.bonus_ids.length > 0
                        );
                        return (
                          <div
                            key={`${item.item_id}-${item.encounter}-${item.instance_name}-${item.inventory_type}-${index}`}
                            className="group card hover:border-gold hover:shadow-card-hover cursor-pointer p-2.5 transition-all"
                            onClick={(event) => handleCardClick(item, event)}
                          >
                            <div className="flex items-center gap-3">
                              <a
                                href={`https://www.wowhead.com/item=${item.item_id}`}
                                data-wowhead={`item=${item.item_id}&${whData}`}
                                onClick={(e) => e.preventDefault()}
                                className="shrink-0"
                              >
                                <WowIcon
                                  icon={item.icon}
                                  className="border-border h-10 w-10 rounded-lg border shadow-sm"
                                  alt=""
                                />
                              </a>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span
                                    className="group-hover:text-gold truncate text-xs font-bold transition-colors"
                                    style={{ color: QUALITY_COLORS[displayQuality] || '#f4f4f5' }}
                                  >
                                    {item.name}
                                  </span>
                                  <span
                                    className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-black ${badgeClass}`}
                                  >
                                    {currentIlvl}
                                  </span>
                                </div>
                                <div className="truncate text-[12px] font-medium text-zinc-300">
                                  {item.encounter}
                                </div>
                              </div>
                            </div>
                            {category === 'crafted' && (
                              <div
                                className="mt-2 space-y-2 border-t border-white/5 pt-2"
                                data-stop-add="true"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                                    Embellishment
                                  </span>
                                </div>
                                <CustomSelect
                                  value={
                                    itemEmbellishments[item.item_id]
                                      ? String(itemEmbellishments[item.item_id]?.item_id || '')
                                      : ''
                                  }
                                  placeholder="No Embellishment"
                                  options={[
                                    { value: '', label: 'No Embellishment' },
                                    ...embellishmentOptions.map((opt) => ({
                                      value: String(opt.item_id),
                                      label: opt.name,
                                      icon: opt.icon,
                                      href: `https://www.wowhead.com/item=${opt.item_id}`,
                                      wowheadData: `item=${opt.item_id}`,
                                    })),
                                  ]}
                                  onChange={(val) => {
                                    if (!val) {
                                      setItemEmbellishments({
                                        ...itemEmbellishments,
                                        [item.item_id]: null,
                                      });
                                      return;
                                    }
                                    const selected =
                                      embellishmentOptions.find(
                                        (opt) => String(opt.item_id) === val
                                      ) || null;
                                    setItemEmbellishments({
                                      ...itemEmbellishments,
                                      [item.item_id]: selected,
                                    });
                                  }}
                                />
                              </div>
                            )}
                            {category === 'crafted' && canSocketItem && (
                              <div
                                className="mt-2 space-y-2 border-t border-white/5 pt-2"
                                data-stop-add="true"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                                    Gem
                                  </span>
                                </div>
                                <CustomSelect
                                  value={selectedGem ? String(selectedGem.gem_id) : ''}
                                  placeholder="Empty Socket"
                                  options={[
                                    { value: '', label: 'Empty Socket' },
                                    ...seasonalGems.map((gem) => ({
                                      value: String(gem.gem_id),
                                      label: gem.name,
                                      icon: gem.icon,
                                      href: `https://www.wowhead.com/item=${gem.gem_id}`,
                                      wowheadData: `item=${gem.gem_id}`,
                                    })),
                                  ]}
                                  onChange={(val) => {
                                    if (!val) {
                                      setItemGems({ ...itemGems, [item.item_id]: null });
                                      return;
                                    }
                                    const gem =
                                      seasonalGems.find(
                                        (candidate) => String(candidate.gem_id) === val
                                      ) || null;
                                    setItemGems({ ...itemGems, [item.item_id]: gem });
                                  }}
                                />
                              </div>
                            )}
                            {availableMissives.length > 0 && (
                              <div
                                className="mt-2 space-y-2 border-t border-white/5 pt-2"
                                data-stop-add="true"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                                    Stats
                                  </span>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                  <CustomSelect
                                    value={effectiveMissiveTokens.join('/')}
                                    placeholder="Select Stats..."
                                    options={availableMissives.map((m) => ({
                                      value: m.token,
                                      label: m.label,
                                    }))}
                                    onChange={(val) => {
                                      const stats = val ? val.split('/') : [];
                                      setItemMissives({ ...itemMissives, [item.item_id]: stats });
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                            {canSelectIlvl && tier && tier.maxLevel > 1 && (
                              <div className="mt-2 space-y-1">
                                {(() => {
                                  const sliderMin = tier.baseLevel || 1;
                                  const sliderMax = ascendantEligible
                                    ? tier.maxLevel + 1
                                    : tier.maxLevel;
                                  const rawSliderValue = itemTiers[item.item_id] || tier.level;
                                  const sliderValue = Math.max(
                                    sliderMin,
                                    Math.min(sliderMax, rawSliderValue)
                                  );
                                  const displayIlvl = tier.ilvl + (ascendantApplied ? 9 : 0);
                                  const trackText =
                                    tier.track === 'Crafted'
                                      ? `Quality ${tier.level}/${tier.maxLevel}`
                                      : ascendantApplied
                                        ? `${tier.track} ${tier.maxLevel}/${tier.maxLevel} + Ascendant Voidcore`
                                        : `${tier.track} ${sliderValue}/${tier.maxLevel}`;
                                  return (
                                    <>
                                      <div className="flex items-center justify-between text-[11px] font-semibold text-white">
                                        <span>{trackText}</span>
                                        <span className="font-mono">{displayIlvl} ilvl</span>
                                      </div>
                                      <input
                                        type="range"
                                        min={sliderMin}
                                        max={sliderMax}
                                        step={1}
                                        value={sliderValue}
                                        onChange={(e) => {
                                          const nextLevel = Number(e.target.value);
                                          const boundedLevel = Math.max(
                                            sliderMin,
                                            Math.min(sliderMax, nextLevel)
                                          );
                                          setItemTiers((prev) => ({
                                            ...prev,
                                            [item.item_id]: boundedLevel,
                                          }));
                                        }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onClick={(e) => e.stopPropagation()}
                                        className="w-full"
                                      />
                                      <div className="flex items-center justify-between px-1 pt-0.5">
                                        {Array.from(
                                          { length: Math.max(0, sliderMax - sliderMin + 1) },
                                          (_, index) => {
                                            const level = sliderMin + index;
                                            const active = level <= sliderValue;
                                            return (
                                              <span
                                                key={`${item.item_id}-tier-dot-${level}`}
                                                className={`h-1.5 w-1.5 rounded-full ${
                                                  active ? 'bg-gold/90' : 'bg-zinc-600/70'
                                                }`}
                                              />
                                            );
                                          }
                                        )}
                                      </div>
                                    </>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

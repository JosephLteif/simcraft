'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import ComboSummary from '../components/ComboSummary';
import ErrorAlert from '../components/ErrorAlert';
import SimulationLaunchButton from '../components/SimulationLaunchButton';
import { useSimContext } from '../components/SimContext';
import SimReturnNotice from '../components/shared/SimReturnNotice';
import ToggleOptionCard from '../components/shared/ToggleOptionCard';
import { API_URL, fetchJson, getGameContext, type GameContext } from '../lib/api';
import { slotFromInventoryType, slotLabelToSimSlot } from '../lib/gear-utils';
import { TRACK_COLORS } from '../lib/loot-track';
import { useSimSubmit } from '../lib/useSimSubmit';
import {
  consumeSimAgainState,
  consumeSimReturnNotice,
  type SimReturnNotice as SimReturnNoticeType,
} from '../lib/sim-return';
import { getAppDefaultOption, getCharacterDefaultsKeyFromSimcInput } from '../lib/default-options';
import type { DifficultyDef } from '../lib/types';
import CategorySelector from './CategorySelector';
import DropSlotList from './DropSlotList';
import DungeonGrid from './DungeonGrid';
import UpgradeSimulationModeSelector, {
  UPGRADE_SIMULATION_MODE_OPTIONS,
  type UpgradeSimulationMode,
} from './UpgradeSimulationModeSelector';
import { useDropFinderData } from './useDropFinderData';
import {
  encodeInstanceSelectionIds,
  getDroptimizerCandidateSlots,
  getRaidDifficultyDisplayLevel,
  getTrackLevels,
  getTrackMaxLevel,
  parseInstanceSelectionIds,
  TRACK_SHORT,
} from './utils';
import {
  detectClass,
  detectSpec,
  type DropItem,
  formatSpecName,
  getClassId,
  getClassSpecs,
  getSpecId,
  type RuntimeClassInfo,
  getTrackInfo,
  itemMatchesActiveLootSpec,
  resolveUpgrade,
} from './types';
import { parseCharacterInfo } from '@/lib/simc-parser';
import {
  buildWishlistOwnerKey,
  loadDropWishlist,
  toggleWishlistEntry,
} from '../lib/wishlist';

type Category = 'raids' | string;
type SimDropItem = DropItem & { slot?: string };

const DROP_FINDER_SIM_AGAIN_KEY = 'drop-finder';

interface DropFinderSimAgainState {
  activeSpecs?: string[];
  selected?: number[];
  difficulty?: string;
  dungeonDiff?: string;
  upgradeLevel?: number;
  upgradeSimulationMode?: UpgradeSimulationMode;
  simHighestTrackLevel?: boolean;
  category?: string;
  selectedId?: string;
  autoCatalyze?: boolean;
  copyEnchantsGems?: boolean;
}

// --- Spinner ---

function Spinner() {
  return (
    <div className="flex justify-center py-8">
      <Loader2 className="h-6 w-6 animate-spin text-gold" strokeWidth={2} />
    </div>
  );
}

// --- Page ---

export default function DropFinderPage() {
  const { simcInput, maxCombinations } = useSimContext();
  const characterDefaultsKey = getCharacterDefaultsKeyFromSimcInput(simcInput);
  // Spec selection: main spec on by default, off-specs toggleable
  const parsedCharacter = useMemo(() => parseCharacterInfo(simcInput), [simcInput]);
  const detectedClass = useMemo(() => {
    const detected = detectClass(simcInput);
    if (detected) return detected;
    if (parsedCharacter?.kind !== 'character') return null;
    const raw = parsedCharacter.className.trim().toLowerCase();
    if (!raw) return null;
    if (raw === 'deathknight') return 'death_knight';
    if (raw === 'demonhunter') return 'demon_hunter';
    return raw.replace(/[\s-]+/g, '_');
  }, [simcInput, parsedCharacter]);
  const detectedSpec = useMemo(() => {
    const detected = detectSpec(simcInput);
    if (detected) return detected;
    if (parsedCharacter?.kind !== 'character' || parsedCharacter.spec === 'unknown') return null;
    return parsedCharacter.spec.trim().toLowerCase().replace(/[\s-]+/g, '_');
  }, [simcInput, parsedCharacter]);
  const [runtimeClasses, setRuntimeClasses] = useState<RuntimeClassInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    getGameContext()
      .then((context: GameContext) => {
        if (!cancelled) setRuntimeClasses((context.classes || []) as RuntimeClassInfo[]);
      })
      .catch(() => {
        // Static class metadata remains available when the runtime snapshot is offline.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const allSpecs = useMemo(
    () => (detectedClass ? getClassSpecs(detectedClass, runtimeClasses) : []),
    [detectedClass, runtimeClasses]
  );
  const [activeSpecs, setActiveSpecs] = useState<Set<string>>(new Set());

  const activeSpecIds = useMemo(
    () =>
      detectedClass
        ? [...activeSpecs]
            .map((spec) => getSpecId(detectedClass, spec, runtimeClasses))
            .filter((id): id is number => id != null)
        : [],
    [detectedClass, activeSpecs, runtimeClasses]
  );
  const classSpecIds = useMemo(
    () =>
      detectedClass
        ? getClassSpecs(detectedClass, runtimeClasses)
            .map((spec) => getSpecId(detectedClass, spec, runtimeClasses))
            .filter((id): id is number => id != null)
        : [],
    [detectedClass, runtimeClasses]
  );
  const classId = useMemo(
    () => (detectedClass ? getClassId(detectedClass, runtimeClasses) : null),
    [detectedClass, runtimeClasses]
  );

  function toggleSpec(spec: string) {
    setActiveSpecs((prev) => {
      const next = new Set(prev);
      if (next.has(spec)) {
        // Don't allow deselecting the last spec
        if (next.size <= 1) return prev;
        next.delete(spec);
      } else {
        next.add(spec);
      }
      return next;
    });
  }

  const {
    instances,
    seasonConfig,
    upgradeTracks,
    selectedId,
    setSelectedId,
    drops,
    loading,
    raids,
    dungeonCats,
    className,
  } = useDropFinderData(simcInput, activeSpecs);

  const hasCharacter = simcInput.trim().length >= 10;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [wishlistIds, setWishlistIds] = useState<Set<number>>(new Set());
  const [difficulty, setDifficulty] = useState('heroic');
  const [dungeonDiff, setDungeonDiff] = useState('mythic+10');
  const [upgradeLevel, setUpgradeLevel] = useState(0);
  const [upgradeSimulationMode, setUpgradeSimulationMode] = useState<UpgradeSimulationMode>(() =>
    getAppDefaultOption('dropfinder.upgradeMode', {
      characterKey: characterDefaultsKey,
    }) as UpgradeSimulationMode
  );
  const [autoCatalyze, setAutoCatalyze] = useState(() =>
    getAppDefaultOption('dropfinder.autoCatalyst', { characterKey: characterDefaultsKey })
  );
  const [copyEnchantsGems, setCopyEnchantsGems] = useState(() =>
    getAppDefaultOption('dropfinder.copyEnchants', { characterKey: characterDefaultsKey })
  );
  const [returnNotice, setReturnNotice] = useState<SimReturnNoticeType | null>(null);
  const [category, setCategory] = useState<Category | ''>('');
  const skipNextDetectedSpecSyncRef = useRef(false);
  const skipNextDropsResetRef = useRef(false);
  const previousSimcInputRef = useRef(simcInput);

  const wishlistOwnerKey = useMemo(() => {
    const parsed = parseCharacterInfo(simcInput);
    if (parsed?.kind === 'character') {
      return buildWishlistOwnerKey({
        name: parsed.name,
        realm: parsed.server,
        region: parsed.region,
        className: parsed.className,
      });
    }
    return buildWishlistOwnerKey({
      className: className || detectedClass || undefined,
    });
  }, [simcInput, className, detectedClass]);

  useEffect(() => {
    if (simcInput === previousSimcInputRef.current) return;
    previousSimcInputRef.current = simcInput;
    setUpgradeSimulationMode(
      getAppDefaultOption('dropfinder.upgradeMode', {
        characterKey: characterDefaultsKey,
      }) as UpgradeSimulationMode
    );
    setAutoCatalyze(
      getAppDefaultOption('dropfinder.autoCatalyst', { characterKey: characterDefaultsKey })
    );
    setCopyEnchantsGems(
      getAppDefaultOption('dropfinder.copyEnchants', { characterKey: characterDefaultsKey })
    );
  }, [simcInput, characterDefaultsKey]);

  useEffect(() => {
    const restored = consumeSimAgainState<DropFinderSimAgainState>(DROP_FINDER_SIM_AGAIN_KEY);
    const notice = consumeSimReturnNotice(DROP_FINDER_SIM_AGAIN_KEY);
    if (notice) setReturnNotice(notice);
    if (!restored) return;

    if (Array.isArray(restored.activeSpecs) && restored.activeSpecs.length > 0) {
      setActiveSpecs(new Set(restored.activeSpecs.filter((spec) => typeof spec === 'string')));
      skipNextDetectedSpecSyncRef.current = true;
    }
    if (Array.isArray(restored.selected)) {
      setSelected(new Set(restored.selected.filter((id) => Number.isFinite(id))));
      skipNextDropsResetRef.current = true;
    }
    if (typeof restored.difficulty === 'string' && restored.difficulty.length > 0) {
      setDifficulty(restored.difficulty);
    }
    if (typeof restored.dungeonDiff === 'string' && restored.dungeonDiff.length > 0) {
      setDungeonDiff(restored.dungeonDiff);
    }
    if (typeof restored.upgradeLevel === 'number' && Number.isFinite(restored.upgradeLevel)) {
      setUpgradeLevel(Math.max(0, Math.floor(restored.upgradeLevel)));
    }
    if (
      restored.upgradeSimulationMode === 'current' ||
      restored.upgradeSimulationMode === 'highest' ||
      restored.upgradeSimulationMode === 'both'
    ) {
      setUpgradeSimulationMode(restored.upgradeSimulationMode);
    } else if (typeof restored.simHighestTrackLevel === 'boolean') {
      // Backward compatibility for previously saved state.
      setUpgradeSimulationMode(restored.simHighestTrackLevel ? 'both' : 'current');
    }
    if (typeof restored.autoCatalyze === 'boolean') {
      setAutoCatalyze(restored.autoCatalyze);
    }
    if (typeof restored.copyEnchantsGems === 'boolean') {
      setCopyEnchantsGems(restored.copyEnchantsGems);
    }
    if (typeof restored.category === 'string') setCategory(restored.category);
    if (typeof restored.selectedId === 'string') setSelectedId(restored.selectedId);
  }, [setSelectedId]);

  useEffect(() => {
    if (skipNextDetectedSpecSyncRef.current) {
      skipNextDetectedSpecSyncRef.current = false;
      return;
    }
    setActiveSpecs(detectedSpec ? new Set([detectedSpec]) : new Set());
  }, [detectedSpec]);

  useEffect(() => {
    if (skipNextDropsResetRef.current) {
      if (!drops) return;
      skipNextDropsResetRef.current = false;
      return;
    }
    setSelected(new Set());
  }, [drops]);

  useEffect(() => {
    setWishlistIds(new Set(loadDropWishlist(wishlistOwnerKey).map((item) => item.item_id)));
  }, [wishlistOwnerKey]);

  const isRaid = category === 'raids';
  const activeDungeonCat = dungeonCats.find((dc) => dc.cat.key === category);
  const isDungeon = !!activeDungeonCat;
  const dungeonInstances = useMemo(() => activeDungeonCat?.instances ?? [], [activeDungeonCat]);
  const activeInstances = isRaid ? raids : dungeonInstances;
  const hasImages = activeInstances.some((i) => i.id > 0 || !!i.image_url?.trim());

  const dungeonPoolId = activeDungeonCat?.cat.poolInstanceId;
  const hasDungeonPool =
    dungeonPoolId != null && instances.some((instance) => instance.id === dungeonPoolId);
  const allKey = isRaid
    ? encodeInstanceSelectionIds(raids.map((instance) => String(instance.id)))
    : hasDungeonPool
      ? String(dungeonPoolId)
      : encodeInstanceSelectionIds(dungeonInstances.map((instance) => String(instance.id)));

  const selectedDungeonIds = useMemo(() => {
    if (!isDungeon) return new Set<string>();
    if (selectedId === allKey) return new Set<string>();
    return new Set(parseInstanceSelectionIds(selectedId));
  }, [isDungeon, selectedId, allKey]);

  const selectedRaidIds = useMemo(() => {
    if (!isRaid) return new Set<string>();
    if (selectedId === allKey) return new Set<string>();
    return new Set(parseInstanceSelectionIds(selectedId));
  }, [isRaid, selectedId, allKey]);

  const allDungeonsSelected = isDungeon && selectedId === allKey;
  const allRaidsSelected = isRaid && selectedId === allKey;

  const selectedInstance =
    selectedId &&
    !selectedId.startsWith('type:') &&
    !selectedId.startsWith('ids:')
      ? instances.find((i) => String(i.id) === selectedId)
      : null;

  const activeDifficulties: DifficultyDef[] = useMemo(() => {
    if (!seasonConfig) return [];
    if (isRaid) return seasonConfig.raid_difficulties;
    if (activeDungeonCat) return activeDungeonCat.cat.difficulties;
    return [];
  }, [seasonConfig, isRaid, activeDungeonCat]);

  const currentDiffKey = isRaid ? difficulty : dungeonDiff;
  const selectedDifficultyDef = useMemo(
    () => activeDifficulties.find((d) => d.key === currentDiffKey) ?? null,
    [activeDifficulties, currentDiffKey]
  );

  const currentTrackInfo = useMemo(() => {
    if (selectedDifficultyDef?.track) {
      const levels = getTrackLevels(selectedDifficultyDef.track, upgradeTracks);
      if (levels && levels.length > 0) {
        return {
          name: selectedDifficultyDef.track,
          levels,
          minLevel: Math.max(1, selectedDifficultyDef.level || 1),
        };
      }
    }

    if (!drops) return null;
    for (const items of Object.values(drops)) {
      for (const item of items) {
        const info = getTrackInfo(item, difficulty, dungeonDiff);
        if (info?.track) {
          const levels = getTrackLevels(info.track, upgradeTracks);
          if (levels && levels.length > 0) {
            return { name: info.track, levels, minLevel: Math.max(1, info.level || 1) };
          }
        }
      }
    }
    return null;
  }, [selectedDifficultyDef, upgradeTracks, drops, difficulty, dungeonDiff]);

  const upgradeLevelOptions = useMemo(() => {
    if (!currentTrackInfo) return [];
    const filtered = currentTrackInfo.levels.filter(
      (lvl) => lvl.level >= (currentTrackInfo.minLevel || 1)
    );
    if (filtered.length === 0) return [];
    return [
      ...filtered.map((lvl) => ({
        key: lvl.level,
        label: `${currentTrackInfo.name} ${lvl.level}/${lvl.max_level || getTrackMaxLevel(currentTrackInfo.name, upgradeTracks) || '?'}`,
        sublabel: String(lvl.ilvl),
      })),
    ];
  }, [currentTrackInfo, upgradeTracks]);

  useEffect(() => {
    if (!currentTrackInfo || upgradeLevelOptions.length === 0) return;
    const minLevel = currentTrackInfo.minLevel || 1;
    const optionLevels = new Set(upgradeLevelOptions.map((opt) => Number(opt.key)));
    setUpgradeLevel((prev) => {
      if (optionLevels.has(prev) && prev >= minLevel) return prev;
      return minLevel;
    });
  }, [currentTrackInfo, upgradeLevelOptions]);

  const highestUpgradeLevel = useMemo(() => {
    if (!currentTrackInfo || upgradeLevelOptions.length === 0) return null;
    return upgradeLevelOptions.reduce((max, opt) => Math.max(max, Number(opt.key)), 0);
  }, [currentTrackInfo, upgradeLevelOptions]);

  const simulationUpgradeLevels = useMemo(() => {
    const levels = new Set<number>();
    const hasHighest = highestUpgradeLevel != null && highestUpgradeLevel > 0;

    if (upgradeSimulationMode === 'current' || upgradeSimulationMode === 'both') {
      levels.add(upgradeLevel);
    }
    if (upgradeSimulationMode === 'highest' || upgradeSimulationMode === 'both') {
      levels.add(hasHighest ? highestUpgradeLevel : upgradeLevel);
    }
    if (levels.size === 0) {
      levels.add(upgradeLevel);
    }

    return [...levels].sort((a, b) => a - b);
  }, [upgradeSimulationMode, highestUpgradeLevel, upgradeLevel]);

  const estimatedComboBreakdown = useMemo(() => {
    if (!drops || selected.size === 0) return 0;

    const seen = new Set<string>();
    let gearCombos = 0;
    let autoCatalystCombos = 0;

    for (const [slot, items] of Object.entries(drops)) {
      for (const item of items) {
        if (!selected.has(item.item_id)) continue;
        if (!itemMatchesActiveLootSpec(item.specs, activeSpecIds, classId)) continue;

        const candidateSlots = getDroptimizerCandidateSlots(slot, item.inventory_type);
        if (candidateSlots.length === 0) continue;

        for (const candidateLevel of simulationUpgradeLevels) {
          const resolved = resolveUpgrade(
            item,
            difficulty,
            dungeonDiff,
            candidateLevel,
            upgradeTracks
          );
          const baseBonus = resolved.bonus_id ? [resolved.bonus_id] : [];
          const baseBonusKey = [...baseBonus].sort((a, b) => a - b).join(':');

          for (const candidateSlot of candidateSlots) {
            const baseKey = [
              candidateSlot,
              item.item_id,
              resolved.ilvl,
              baseBonusKey,
              item.inventory_type ?? 0,
              0,
            ].join('|');
            if (!seen.has(baseKey)) {
              seen.add(baseKey);
              gearCombos += 1;
            }
          }

          if (autoCatalyze && item.can_catalyst) {
            const convertSlot =
              slot === 'Other' ? slotFromInventoryType(item.inventory_type) : slotLabelToSimSlot(slot);
            if (!convertSlot) continue;
            // Catalyst conversion for a given class/slot resolves to the same tier target item.
            // Count one catalyst candidate per resulting slot+upgrade state, not per source item.
            const catalystKey = [
              convertSlot,
              resolved.ilvl,
              baseBonusKey,
              1,
            ].join('|');
            if (!seen.has(catalystKey)) {
              seen.add(catalystKey);
              autoCatalystCombos += 1;
            }
          }
        }
      }
    }

    return {
      gearCombos,
      autoCatalystCombos,
      totalWithoutBaseline: gearCombos + autoCatalystCombos,
      totalWithBaseline: gearCombos + autoCatalystCombos + 1,
    };
  }, [
    drops,
    selected,
    activeSpecIds,
    classId,
    difficulty,
    dungeonDiff,
    simulationUpgradeLevels,
    upgradeTracks,
    autoCatalyze,
  ]);

  const estimatedComboCount =
    typeof estimatedComboBreakdown === 'number'
      ? estimatedComboBreakdown
      : estimatedComboBreakdown.totalWithBaseline;

  function selectAll(itemIds: number[]) {
    setSelected(new Set(itemIds));
  }

  const toggleAllRaids = useCallback(() => {
    if (!isRaid) return;
    if (allRaidsSelected) {
      setSelectedId('');
      return;
    }
    setSelectedId(allKey);
  }, [isRaid, allRaidsSelected, allKey, setSelectedId]);

  const toggleAllDungeons = useCallback(() => {
    if (!isDungeon) return;
    if (allDungeonsSelected) {
      setSelectedId('');
      return;
    }
    setSelectedId(allKey);
  }, [isDungeon, allDungeonsSelected, allKey, setSelectedId]);

  const toggleDungeonSelection = useCallback(
    (instanceId: string) => {
      if (!isDungeon) return;
      const next =
        selectedId === allKey ? new Set<string>() : new Set(selectedDungeonIds);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);

      if (next.size === 0) {
        setSelectedId('');
        return;
      }
      if (next.size === dungeonInstances.length && dungeonInstances.length > 0) {
        setSelectedId(allKey);
        return;
      }
      setSelectedId(encodeInstanceSelectionIds([...next]));
    },
    [isDungeon, selectedId, selectedDungeonIds, dungeonInstances.length, allKey, setSelectedId]
  );

  const toggleRaidSelection = useCallback(
    (instanceId: string) => {
      if (!isRaid) return;
      const next = selectedId === allKey ? new Set<string>() : new Set(selectedRaidIds);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);

      if (next.size === 0) {
        setSelectedId('');
        return;
      }
      if (next.size === raids.length && raids.length > 0) {
        setSelectedId(allKey);
        return;
      }
      setSelectedId(encodeInstanceSelectionIds([...next]));
    },
    [isRaid, selectedId, selectedRaidIds, raids.length, allKey, setSelectedId]
  );

  const selectionSummaryLabel = useMemo(() => {
    if (isRaid) {
      if (allRaidsSelected) return 'All Raids selected';
      if (selectedRaidIds.size > 0) return `${selectedRaidIds.size} selected`;
      return 'No raids selected';
    }
    if (isDungeon) {
      const label = activeDungeonCat?.cat.label ?? 'Dungeons';
      if (allDungeonsSelected) return `All ${label} selected`;
      if (selectedDungeonIds.size > 0) return `${selectedDungeonIds.size} selected`;
      return `No ${label.toLowerCase()} selected`;
    }
    return '';
  }, [
    isRaid,
    allRaidsSelected,
    selectedRaidIds.size,
    isDungeon,
    activeDungeonCat,
    allDungeonsSelected,
    selectedDungeonIds.size,
  ]);

  const selectionChips = useMemo(() => {
    if (isRaid) {
      if (allRaidsSelected) return ['All Raids'];
      return raids
        .filter((inst) => selectedRaidIds.has(String(inst.id)))
        .map((inst) => inst.name);
    }
    if (isDungeon) {
      const allLabel = `All ${activeDungeonCat?.cat.label ?? 'Dungeons'}`;
      if (allDungeonsSelected) return [allLabel];
      return dungeonInstances
        .filter((inst) => selectedDungeonIds.has(String(inst.id)))
        .map((inst) => inst.name);
    }
    return [];
  }, [
    isRaid,
    allRaidsSelected,
    raids,
    selectedRaidIds,
    isDungeon,
    activeDungeonCat,
    allDungeonsSelected,
    dungeonInstances,
    selectedDungeonIds,
  ]);

  const headerLabel = useMemo(() => {
    if (selectedInstance?.name) return selectedInstance.name;
    if (selectedId.startsWith('type:')) return `All ${isRaid ? 'Raids' : 'Dungeons'}`;
    if (isRaid && selectedId === allKey) return 'All Raids';
    if (isRaid && selectedRaidIds.size > 1) return `${selectedRaidIds.size} Raids`;
    if (isRaid && selectedRaidIds.size === 1) {
      const [onlyId] = [...selectedRaidIds];
      const inst = raids.find((item) => String(item.id) === onlyId);
      return inst?.name ?? '';
    }
    if (isDungeon && selectedId === allKey) return `All ${activeDungeonCat?.cat.label ?? 'Dungeons'}`;
    if (isDungeon && selectedDungeonIds.size > 1) return `${selectedDungeonIds.size} Dungeons`;
    if (isDungeon && selectedDungeonIds.size === 1) {
      const [onlyId] = [...selectedDungeonIds];
      const inst = dungeonInstances.find((item) => String(item.id) === onlyId);
      return inst?.name ?? '';
    }
    return '';
  }, [
    selectedInstance,
    selectedId,
    isRaid,
    selectedRaidIds,
    raids,
    isDungeon,
    allKey,
    activeDungeonCat,
    selectedDungeonIds,
    dungeonInstances,
  ]);

  // Sim submission
  const buildPayload = useCallback(async () => {
    if (!drops || selected.size === 0) return null;
    const dropItems: SimDropItem[] = [];
    const seenCandidates = new Set<string>();
    const dedupeKey = (candidate: SimDropItem) => {
      const bonus = [...(candidate.bonus_ids ?? [])].sort((a, b) => a - b).join(':');
      return [
        candidate.slot || '',
        candidate.item_id,
        candidate.ilevel,
        bonus,
        candidate.inventory_type ?? 0,
        candidate.is_catalyst ? 1 : 0,
      ].join('|');
    };
    const pushCandidate = (candidate: SimDropItem) => {
      const key = dedupeKey(candidate);
      if (seenCandidates.has(key)) return;
      seenCandidates.add(key);
      dropItems.push(candidate);
    };

    for (const [slot, items] of Object.entries(drops)) {
      for (const item of items) {
        if (selected.has(item.item_id)) {
          if (!itemMatchesActiveLootSpec(item.specs, activeSpecIds, classId)) {
            continue;
          }
          for (const candidateLevel of simulationUpgradeLevels) {
            const resolved = resolveUpgrade(
              item,
              difficulty,
              dungeonDiff,
              candidateLevel,
              upgradeTracks
            );
            const simItem: SimDropItem = {
              ...item,
              ilevel: resolved.ilvl,
              quality: resolved.quality,
              bonus_ids: resolved.bonus_id ? [resolved.bonus_id] : [],
              slot,
            };

            // Always keep the original selected item in the sim pool.
            pushCandidate(simItem);

            // Auto Catalyst should add an extra converted candidate, not replace the original.
            if (autoCatalyze && item.can_catalyst) {
              const convertSlot =
                slot === 'Other'
                  ? slotFromInventoryType(item.inventory_type)
                  : slotLabelToSimSlot(slot);
              if (convertSlot) {
                try {
                  const catalyzed = await fetchJson<SimDropItem>(`${API_URL}/api/gear/catalyst-convert`, {
                    method: 'POST',
                    body: JSON.stringify({
                      class_name: className,
                      slot: convertSlot,
                      item: {
                        ...item,
                        ilevel: resolved.ilvl,
                        quality: resolved.quality,
                        bonus_ids: resolved.bonus_id ? [resolved.bonus_id] : [],
                      },
                    }),
                  });
                  pushCandidate({
                    ...catalyzed,
                    slot: catalyzed.slot || convertSlot,
                  });
                } catch {
                  // Keep original candidate only when conversion fails.
                }
              }
            }
          }
        }
      }
    }
    return {
      simc_input: simcInput,
      drop_items: dropItems,
      copy_enchants: copyEnchantsGems,
    };
  }, [
    drops,
    selected,
    simcInput,
    difficulty,
    dungeonDiff,
    simulationUpgradeLevels,
    autoCatalyze,
    copyEnchantsGems,
    upgradeTracks,
    activeSpecIds,
    classId,
    className,
  ]);

  const validate = useCallback(() => {
    if (!drops || selected.size === 0) return 'Select at least one item to sim.';
    return null;
  }, [drops, selected]);

  const {
    submit,
    submitting,
    error,
    buttonLabel,
  } = useSimSubmit({
    endpoint: '/api/droptimizer/sim',
    buildPayload,
    validate,
    simAgain: {
      pageKey: DROP_FINDER_SIM_AGAIN_KEY,
      captureState: () => ({
        activeSpecs: [...activeSpecs],
        selected: [...selected],
        difficulty,
        dungeonDiff,
        upgradeLevel,
        upgradeSimulationMode,
        autoCatalyze,
        copyEnchantsGems,
        category,
        selectedId,
      }),
    },
  });

  const handleSubmit = useCallback((threadsOverride?: number) => {
    void submit({ threadsOverride });
  }, [submit]);

  const submitLabel = !hasCharacter
    ? 'Paste SimC export to simulate'
    : selected.size === 0
      ? 'Select items to simulate'
      : buttonLabel(`Find Upgrades (${selected.size} items)`);

  return (
    <div className="mobile-page-bottom space-y-6 pb-28">
      {returnNotice ? (
        <SimReturnNotice
          title={returnNotice.title}
          message={returnNotice.message}
          onDismiss={() => setReturnNotice(null)}
        />
      ) : null}
      <CategorySelector
        category={category}
        onChange={(key) => {
          setCategory(key);
          setSelectedId('');
        }}
        dungeonCats={dungeonCats}
      />

      {category && hasImages ? (
        <>
          <DungeonGrid
            value={selectedId}
            onChange={setSelectedId}
            multi={isRaid || isDungeon}
            selectedValues={isRaid ? selectedRaidIds : isDungeon ? selectedDungeonIds : undefined}
            allSelected={isRaid ? allRaidsSelected : isDungeon ? allDungeonsSelected : undefined}
            onToggleValue={
              isRaid ? toggleRaidSelection : isDungeon ? toggleDungeonSelection : undefined
            }
            onToggleAll={isRaid ? toggleAllRaids : isDungeon ? toggleAllDungeons : undefined}
            instances={activeInstances}
            allKey={allKey}
            allLabel={isRaid ? 'All Raids' : `All ${activeDungeonCat?.cat.label ?? 'Dungeons'}`}
          />
          {(isRaid || isDungeon) && (
            <div className="card space-y-3 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                {selectionSummaryLabel}
              </p>
              {selectionChips.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectionChips.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-md border border-gold/30 bg-gold/10 px-2 py-1 text-xs font-semibold text-gold"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : category ? (
        <div data-tour="drop-finder-selection" className="card p-5">
          <label className="label-text">{isRaid ? 'Select Raids' : 'Select Dungeons'}</label>
          {isRaid ? (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={toggleAllRaids}
                className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-all duration-150 ${
                  allRaidsSelected
                    ? 'border-gold/40 bg-gold/[0.08] text-gold'
                    : 'border-border bg-surface-2 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
                }`}
              >
                All Raids
              </button>
              {raids.map((inst) => {
                const active = selectedRaidIds.has(String(inst.id));
                return (
                  <button
                    key={inst.id}
                    onClick={() => toggleRaidSelection(String(inst.id))}
                    className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-all duration-150 ${
                      active
                        ? 'border-gold/40 bg-gold/[0.08] text-gold'
                        : 'border-border bg-surface-2 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
                    }`}
                  >
                    {inst.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={toggleAllDungeons}
                className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-all duration-150 ${
                  allDungeonsSelected
                    ? 'border-gold/40 bg-gold/[0.08] text-gold'
                    : 'border-border bg-surface-2 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
                }`}
              >
                {`All ${activeDungeonCat?.cat.label ?? 'Dungeons'}`}
              </button>
              {dungeonInstances.map((inst) => {
                const active = selectedDungeonIds.has(String(inst.id));
                return (
                  <button
                    key={inst.id}
                    onClick={() => toggleDungeonSelection(String(inst.id))}
                    className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-all duration-150 ${
                      active
                        ? 'border-gold/40 bg-gold/[0.08] text-gold'
                        : 'border-border bg-surface-2 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
                    }`}
                  >
                    {inst.name}
                  </button>
                );
              })}
            </div>
          )}
          {(isRaid || isDungeon) && (
            <div className="mt-4 space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                {selectionSummaryLabel}
              </p>
              {selectionChips.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectionChips.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-md border border-gold/30 bg-gold/10 px-2 py-1 text-xs font-semibold text-gold"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      {(isRaid || isDungeon) && selectedId && activeDifficulties.length > 0 && (
        <div data-tour="drop-finder-settings" className="card space-y-4 p-4 sm:p-6">
          <div>
            <label className="label-text">Difficulty</label>
            <div className="flex flex-wrap gap-2">
              {activeDifficulties.map((d) => {
                const isActive = currentDiffKey === d.key;
                const trackLevels = d.track ? getTrackLevels(d.track, upgradeTracks) : null;
                const displayLevel = isRaid ? getRaidDifficultyDisplayLevel(d.key) : d.level;
                const trackMax =
                  d.track && trackLevels && trackLevels.length > 0
                    ? trackLevels.reduce((max, lvl) => Math.max(max, lvl.max_level || 0), 0)
                    : 0;
                const ilvl = trackLevels?.find((t) => t.level === d.level)?.ilvl ?? d.fixedIlvl;
                const tc = d.track ? TRACK_COLORS[d.track] : null;
                return (
                  <button
                    key={d.key}
                    onClick={() => {
                      if (isRaid) setDifficulty(d.key);
                      else setDungeonDiff(d.key);
                      setUpgradeLevel(Math.max(1, d.level || 1));
                    }}
                    className={`flex min-w-[5rem] flex-col items-center rounded-lg border px-2.5 py-2.5 text-center transition-all duration-150 sm:min-w-[5.25rem] sm:px-3.5 ${
                      isActive && tc
                        ? `${tc.border} ${tc.bg}`
                        : isActive
                          ? 'border-gold/40 bg-gold/[0.08]'
                          : 'border-border bg-surface-2 hover:border-zinc-600'
                    }`}
                  >
                    <span
                      className={`text-lg font-black leading-none ${isActive && tc ? tc.text : isActive ? 'text-gold' : 'text-zinc-200'}`}
                    >
                      {d.label}
                    </span>
                    {ilvl && (
                      <span
                        className={`mt-1.5 text-[13px] font-semibold tabular-nums tracking-wide ${isActive ? 'text-zinc-100' : 'text-zinc-300'}`}
                      >
                        ilvl {ilvl}
                      </span>
                    )}
                    {d.track ? (
                      <span
                        className={`mt-1 text-xs font-semibold ${tc?.text ?? 'text-zinc-300'} ${isActive ? 'opacity-100' : 'opacity-90'}`}
                      >
                        {isRaid
                          ? d.track
                          : `${TRACK_SHORT[d.track] ?? d.track} ${displayLevel}/${trackMax || '?'}`}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

        </div>
      )}

      {(isRaid || isDungeon) && selectedId && activeDifficulties.length > 0 && (
        <div className="card p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex-1">
              <div className="flex min-h-[72px] flex-col justify-center">
                <div className="min-w-0 flex-1">
                  <UpgradeSimulationModeSelector
                    value={upgradeSimulationMode}
                    onChange={setUpgradeSimulationMode}
                    showDescription={false}
                  />
                </div>
                <div className="mt-1.5 flex flex-col gap-1 text-[13px] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <p className="truncate text-zinc-300">
                    {
                      UPGRADE_SIMULATION_MODE_OPTIONS.find((mode) => mode.value === upgradeSimulationMode)
                        ?.desc
                    }
                  </p>
                  {currentTrackInfo?.name && (
                    <p className="text-zinc-300 sm:whitespace-nowrap">{`Track: ${currentTrackInfo.name}`}</p>
                  )}
                </div>
              </div>
            </div>
            <ToggleOptionCard
              checked={autoCatalyze}
              onToggle={() => setAutoCatalyze((prev) => !prev)}
              title="Auto Catalyst"
              description="Add catalyst-converted alternatives for eligible items."
              titleClassName="text-[15px] font-medium text-zinc-100 transition-colors group-hover:text-white"
              descriptionClassName="text-[13px] text-zinc-300"
            />
            <ToggleOptionCard
              checked={copyEnchantsGems}
              onToggle={() => setCopyEnchantsGems((prev) => !prev)}
              title="Copy Enchants/Gems"
              description="Apply equipped enchants and gems to items that don't have one."
              titleClassName="text-[15px] font-medium text-zinc-100 transition-colors group-hover:text-white"
              descriptionClassName="text-[13px] text-zinc-300"
            />
          </div>
        </div>
      )}

      {className ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-zinc-300">
            Showing loot for{' '}
            <span className="font-semibold text-gold">{className.replace('_', ' ')}</span>
          </p>
          {allSpecs.length > 1 && (
            <>
              <span className="h-3.5 w-px bg-border" />
              <div className="flex flex-wrap gap-1">
                {allSpecs.map((spec) => {
                  const isActive = activeSpecs.has(spec);
                  const isMain = spec === detectedSpec;
                  return (
                    <button
                      key={spec}
                      onClick={() => toggleSpec(spec)}
                      className={`rounded-md border px-2.5 py-1.5 text-sm font-medium transition-all duration-150 ${
                        isActive
                          ? 'border-gold/40 bg-gold/[0.08] text-gold'
                          : 'border-border bg-surface-2 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
                      }`}
                    >
                      {formatSpecName(spec)}
                      {isMain && <span className="ml-1 text-sm opacity-70">main</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">
          Paste a SimC export above to filter drops for your class.
        </p>
      )}

      {loading && !drops && <Spinner />}

      {loading && drops && (
        <div className="flex items-center justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-gold" strokeWidth={2} />
        </div>
      )}

      {!loading && selectedId && !drops && (
        <p className="py-6 text-center text-sm text-muted">
          No equippable drops found for this instance.
        </p>
      )}

      {drops && (
        <>
          <DropSlotList
            drops={drops}
            selected={selected}
            onToggle={(id) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onSelectAll={selectAll}
            onClear={() => setSelected(new Set())}
            classSpecIds={classSpecIds}
            classId={classId}
            difficulty={difficulty}
            dungeonDiff={dungeonDiff}
            upgradeLevel={upgradeLevel}
            upgradeTracks={upgradeTracks}
            headerLabel={headerLabel}
            headerBreakdown={
              typeof estimatedComboBreakdown !== 'number'
                ? `${estimatedComboBreakdown.gearCombos.toLocaleString()} normal${
                    estimatedComboBreakdown.gearCombos === 1 ? ' combo' : ' combos'
                  } | +1 Currently Equipped${
                    estimatedComboBreakdown.autoCatalystCombos > 0
                      ? ` | ${estimatedComboBreakdown.autoCatalystCombos} Auto Catalyst`
                      : ''
                  }`
                : null
            }
            headerActions={
              <ComboSummary
                comboCount={estimatedComboCount}
                maxCombinations={maxCombinations ?? undefined}
                size="md"
                glowWhenActive
              />
            }
            isWishlisted={(itemId) => wishlistIds.has(itemId)}
            onToggleWishlist={(item, slotLabel, meta) => {
              const next = toggleWishlistEntry({ item, slot: slotLabel, meta }, wishlistOwnerKey);
              setWishlistIds(
                new Set(
                  next
                    .filter((entry) => entry.roadmap_source !== 'owned-upgrade')
                    .map((entry) => entry.item_id)
                )
              );
            }}
          />

          <ErrorAlert message={error} />

          <div className="mobile-safe-bottom sticky bottom-0 z-50 -mx-4 bg-gradient-to-t from-[#111] via-[#111] to-transparent px-4 pb-4 pt-6 sm:-mx-6 sm:px-6">
            <SimulationLaunchButton
              onSubmit={handleSubmit}
              dataTour="drop-finder-submit"
              submitting={submitting}
              disabled={selected.size === 0 || !hasCharacter}
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
        </>
      )}

      {!selectedId && !loading && !category && (
        <p className="py-6 text-center text-sm text-muted">Select a category to get started.</p>
      )}
    </div>
  );
}

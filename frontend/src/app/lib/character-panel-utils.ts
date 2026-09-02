import { characterHref } from './routes';
import type { MythicKeystoneDungeonDetail, RaiderIoData } from './api';
import type {
  CharacterNamedValue,
  CharacterRunMember,
  CharacterProfession,
  CharacterProfessionsPayload,
  MythicPlusPayload,
  MythicRun,
  RaidEncounterProgress,
  RaidEncountersPayload,
} from './character-domain-types';
import { MYTHIC_VAULT_THRESHOLDS } from './game-rules';

export function getCharacterValueLabel(value: unknown): string | null {
  if (typeof value === 'string') {
    const label = value.trim();
    return label || null;
  }
  if (!value || typeof value !== 'object') return null;
  const named = value as CharacterNamedValue;
  const label = String(named.name || named.type || '').trim();
  return label || null;
}

export function normalizeCharacterSlug(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u0027\u2019]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

export function normalizeRealmSlug(value: unknown): string {
  return normalizeCharacterSlug(value);
}

export type CharacterExternalLinks = {
  armoryUrl: string;
  warcraftLogsUrl: string;
  raiderIoUrl: string;
};

export function buildCharacterExternalLinks(
  region: string,
  realm: string,
  name: string
): CharacterExternalLinks {
  const regionSlug = normalizeCharacterSlug(region) || 'us';
  const realmSlug = normalizeRealmSlug(realm);
  const characterSlug = normalizeCharacterSlug(name);
  const segments = [regionSlug, realmSlug, characterSlug].map(encodeURIComponent);
  const armoryLocale =
    regionSlug === 'eu'
      ? 'en-gb'
      : regionSlug === 'kr'
        ? 'ko-kr'
        : regionSlug === 'tw'
          ? 'zh-tw'
          : regionSlug === 'cn'
            ? 'zh-cn'
            : 'en-us';

  return {
    armoryUrl: `https://worldofwarcraft.blizzard.com/${armoryLocale}/character/${segments.join('/')}`,
    warcraftLogsUrl: `https://www.warcraftlogs.com/character/${segments.join('/')}`,
    raiderIoUrl: `https://raider.io/characters/${segments.join('/')}`,
  };
}

function isRunLike(value: unknown): value is MythicRun {
  if (!value || typeof value !== 'object') return false;
  const run = value as MythicRun;
  const level = Number(
    run.keystone_level ??
      run.keystoneLevel ??
      run.key_level ??
      run.keyLevel ??
      run.mythic_plus_level ??
      run.mythicLevel ??
      run.level ??
      0
  );
  return (
    (Number.isFinite(level) && level > 0) ||
    !!run.keystone_dungeon ||
    !!run.dungeon ||
    !!run.dungeon_name ||
    !!run.dungeonName ||
    !!run.completed_challenge_mode
  );
}

function collectRuns(root: unknown): MythicRun[] {
  const out: MythicRun[] = [];
  const stack: unknown[] = [root];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      if (current.some((item) => isRunLike(item)))
        out.push(...current.filter((item) => isRunLike(item)));
      else for (const item of current) if (item && typeof item === 'object') stack.push(item);
      continue;
    }
    if (typeof current === 'object') {
      if (isRunLike(current)) out.push(current);
      for (const value of Object.values(current as Record<string, unknown>)) {
        if (value && typeof value === 'object') stack.push(value);
      }
    }
  }
  return out;
}

function collectKnownMythicRuns(root: unknown): MythicRun[] {
  if (!root || typeof root !== 'object') return [];
  const rootObject = root as Record<string, unknown>;
  const currentPeriod =
    rootObject.current_period && typeof rootObject.current_period === 'object'
      ? (rootObject.current_period as Record<string, unknown>)
      : rootObject.currentPeriod && typeof rootObject.currentPeriod === 'object'
        ? (rootObject.currentPeriod as Record<string, unknown>)
        : null;
  const sources = [
    rootObject.best_runs,
    rootObject.bestRuns,
    rootObject.recent_runs,
    rootObject.recentRuns,
    rootObject.weekly_best_runs,
    rootObject.weeklyBestRuns,
    currentPeriod?.best_runs,
    currentPeriod?.bestRuns,
  ];
  const runs: MythicRun[] = [];
  const seen = new Set<unknown>();
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      if (isRunLike(item) && !seen.has(item)) {
        seen.add(item);
        runs.push(item);
      }
    }
  }
  return runs;
}

function collectMythicRuns(root: unknown): MythicRun[] {
  const knownRuns = collectKnownMythicRuns(root);
  return knownRuns.length > 0 ? knownRuns : collectRuns(root);
}

function getRunLevel(run: MythicRun): number {
  return Number(
    run?.keystone_level ??
      run?.keystoneLevel ??
      run?.key_level ??
      run?.keyLevel ??
      run?.mythic_plus_level ??
      run?.mythicLevel ??
      run?.level ??
      0
  );
}

function getRunTimestamp(run: MythicRun): number {
  return Number(
    run?.completed_timestamp ??
      run?.completedTimestamp ??
      run?.end_timestamp ??
      run?.endTimestamp ??
      run?.start_timestamp ??
      run?.startTimestamp ??
      run?.timestamp ??
      0
  );
}

function periodTimestampMs(value: unknown): number {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0)
      return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

export function getWeeklyResetStartMs(
  regionRaw: string | null | undefined,
  now = new Date(),
  periods?: Array<Record<string, unknown>>
): number {
  const nowMs = now.getTime();
  const periodStarts = (periods ?? [])
    .map((period) =>
      periodTimestampMs(
        period.start_time ?? period.startTime ?? period.period_start ?? period.start
      )
    )
    .filter((start) => start > 0 && start <= nowMs);
  if (periodStarts.length > 0) return Math.max(...periodStarts);

  const region = String(regionRaw || 'us').toLowerCase();
  const resetDayUtc = region === 'eu' ? 3 : region === 'asia' ? 4 : 2;
  const resetHourUtc = region === 'eu' ? 4 : region === 'us' ? 15 : 7;
  const current = new Date(now);
  const todayReset = new Date(
    Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth(),
      current.getUTCDate(),
      resetHourUtc,
      0,
      0,
      0
    )
  );
  const dayDiff = (current.getUTCDay() - resetDayUtc + 7) % 7;
  const reset = new Date(todayReset);
  reset.setUTCDate(reset.getUTCDate() - dayDiff);
  if (current.getUTCDay() === resetDayUtc && current.getUTCHours() < resetHourUtc) {
    reset.setUTCDate(reset.getUTCDate() - 7);
  }
  return reset.getTime();
}

export function computeMythicVaultProgress(
  mythicPlus: MythicPlusPayload,
  region?: string,
  periods?: Array<Record<string, unknown>>
): {
  runsForVault: number;
  slotThresholds: number[];
  slots: Array<{
    slot: number;
    threshold: number;
    unlocked: boolean;
    remaining: number;
    progress: number;
  }>;
} {
  if (!mythicPlus || typeof mythicPlus !== 'object') {
    const thresholds = [...MYTHIC_VAULT_THRESHOLDS];
    return {
      runsForVault: 0,
      slotThresholds: thresholds,
      slots: thresholds.map((threshold, idx) => ({
        slot: idx + 1,
        threshold,
        unlocked: false,
        remaining: threshold,
        progress: 0,
      })),
    };
  }

  const allRuns = collectRuns(mythicPlus).filter((run) => getRunLevel(run) > 0);
  const recentSource = Array.isArray(mythicPlus?.recent_runs) ? mythicPlus.recent_runs : allRuns;
  const recentRuns = [...recentSource]
    .sort((a, b) => getRunTimestamp(b) - getRunTimestamp(a))
    .slice(0, 20);
  const weekStart = getWeeklyResetStartMs(region, new Date(), periods);
  const recentWeekCount = recentRuns.filter((run) => {
    const ts = getRunTimestamp(run);
    const tsMs = ts > 0 && ts < 1_000_000_000_000 ? ts * 1000 : ts;
    return tsMs > 0 && tsMs >= weekStart;
  }).length;
  const currentPeriodCount = collectRuns(mythicPlus?.current_period || {}).filter((run) => {
    const ts = getRunTimestamp(run);
    const tsMs = ts > 0 && ts < 1_000_000_000_000 ? ts * 1000 : ts;
    return tsMs > 0 && tsMs >= weekStart;
  }).length;
  const runsForVault = Math.max(recentWeekCount, currentPeriodCount);

  const slotThresholds = [...MYTHIC_VAULT_THRESHOLDS];
  const slots = slotThresholds.map((threshold, idx) => ({
    slot: idx + 1,
    threshold,
    unlocked: runsForVault >= threshold,
    remaining: Math.max(0, threshold - runsForVault),
    progress: Math.min(1, runsForVault / threshold),
  }));

  return { runsForVault, slotThresholds, slots };
}

export type CharacterMythicPlusSummary = {
  score: number | null;
  runs: number;
  bestLevel: number | null;
  bestDungeonName: string | null;
  recentRuns: Array<{
    id: string;
    dungeon: string;
    level: number;
    duration: string;
    timed: boolean | null;
    clockDelta: string | null;
    timestamp: number;
    members: CharacterRunMember[];
    dungeonId: number | null;
    keystoneUpgrades: MythicKeystoneDungeonDetail['keystone_upgrades'];
  }>;
  timedRuns: number;
  depletedRuns: number;
  hasTimedStatusData: boolean;
  vaultSlots: Array<{
    slot: number;
    threshold: number;
    unlocked: boolean;
    keyLevel: number | null;
    rewardIlvl: number | null;
    progress: number;
  }>;
  vaultProgressCount: number;
  hasAnyVaultIlvl: boolean;
};

export function mergeMythicPlusDisplay(
  summary: CharacterMythicPlusSummary | null,
  raiderIo: RaiderIoData | null
): Pick<CharacterMythicPlusSummary, 'score' | 'runs' | 'bestLevel' | 'bestDungeonName'> {
  const bestRaiderIoRun = (raiderIo?.best_runs || [])
    .filter((run) => run.level !== null && run.level > 0 && run.dungeon.trim())
    .reduce<RaiderIoData['best_runs'][number] | null>((best, run) => {
      if (!best) return run;
      if ((run.level || 0) !== (best.level || 0)) {
        return (run.level || 0) > (best.level || 0) ? run : best;
      }
      return (run.score || 0) > (best.score || 0) ? run : best;
    }, null);

  return {
    score: summary?.score ?? raiderIo?.score ?? null,
    runs: summary?.runs || raiderIo?.best_runs.length || 0,
    bestLevel: summary?.bestLevel ?? bestRaiderIoRun?.level ?? null,
    bestDungeonName: summary?.bestDungeonName ?? bestRaiderIoRun?.dungeon ?? null,
  };
}

function getMythicRunName(run: MythicRun): string {
  const candidates = [
    run?.keystone_dungeon,
    run?.dungeon,
    run?.completed_challenge_mode,
    run?.dungeon_name,
    run?.dungeonName,
    run?.name,
  ];
  return candidates.map(getCharacterValueLabel).find(Boolean) || 'Dungeon';
}

function getMythicRunDurationMs(run: MythicRun): number {
  return Number(run?.duration ?? run?.run_duration ?? 0);
}

function formatMythicDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function getMythicDungeonDetail(
  run: MythicRun,
  dungeonDetailsByName: Record<string, MythicKeystoneDungeonDetail>
): MythicKeystoneDungeonDetail | null {
  const key = getMythicRunName(run).trim().toLowerCase();
  return key ? dungeonDetailsByName[key] || null : null;
}

function getMythicRunTimed(
  run: MythicRun,
  dungeonDetailsByName: Record<string, MythicKeystoneDungeonDetail>
): boolean | null {
  if (typeof run?.is_completed_within_time === 'boolean') {
    return run.is_completed_within_time;
  }
  if (typeof run?.is_completed_within_timeout === 'boolean') {
    return run.is_completed_within_timeout;
  }
  if (typeof run?.completed_in_time === 'boolean') return run.completed_in_time;
  if (typeof run?.completedWithinTime === 'boolean') return run.completedWithinTime;

  const detail = getMythicDungeonDetail(run, dungeonDetailsByName);
  const qualifyingDuration = detail?.keystone_upgrades?.find(
    (upgrade) => Number(upgrade?.upgrade_level) === 1
  )?.qualifying_duration;
  const durationMs = getMythicRunDurationMs(run);
  if (!qualifyingDuration || !durationMs) return null;
  return durationMs <= qualifyingDuration;
}

function formatMythicClockDelta(
  run: MythicRun,
  dungeonDetailsByName: Record<string, MythicKeystoneDungeonDetail>
): string | null {
  const detail = getMythicDungeonDetail(run, dungeonDetailsByName);
  const timerMs = detail?.keystone_upgrades?.find(
    (upgrade) => Number(upgrade?.upgrade_level) === 1
  )?.qualifying_duration;
  const durationMs = getMythicRunDurationMs(run);
  if (!timerMs || !durationMs) return null;
  const diff = timerMs - durationMs;
  const absSec = Math.floor(Math.abs(diff) / 1000);
  const min = Math.floor(absSec / 60);
  const sec = absSec % 60;
  return `${diff >= 0 ? '+' : '-'}${min}:${String(sec).padStart(2, '0')}`;
}

function collectMythicRewardMap(root: unknown): Map<number, number> {
  const map = new Map<number, number>();
  const stack: unknown[] = [root];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current) || typeof current !== 'object') continue;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    const currentObj = current as Record<string, unknown>;
    const level = Number(
      currentObj.keystone_level ?? currentObj.keystoneLevel ?? currentObj.level ?? 0
    );
    const ilvl = Number(
      currentObj.item_level ??
        currentObj.itemLevel ??
        currentObj.reward_item_level ??
        currentObj.rewardItemLevel ??
        0
    );
    if (level > 0 && ilvl > 0) map.set(level, Math.max(ilvl, map.get(level) || 0));
    for (const value of Object.values(currentObj)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return map;
}

export function summarizeMythicPlus(
  mythicPlus: MythicPlusPayload,
  region?: string,
  periods?: Array<Record<string, unknown>>,
  dungeonDetailsByName: Record<string, MythicKeystoneDungeonDetail> = {}
): CharacterMythicPlusSummary | null {
  if (!mythicPlus || typeof mythicPlus !== 'object') return null;
  const mythicPlusObj = mythicPlus as Record<string, unknown>;
  if (Object.keys(mythicPlusObj).length === 0) return null;
  const allRuns = collectMythicRuns(mythicPlus).filter((run) => getRunLevel(run) > 0);
  const byDungeon = new Map<string, MythicRun>();
  for (const run of allRuns) {
    const key = getMythicRunName(run).trim().toLowerCase();
    const existing = byDungeon.get(key);
    if (!existing || getRunLevel(run) > getRunLevel(existing)) byDungeon.set(key, run);
  }
  const bestRuns = Array.from(byDungeon.values());
  const computedBestLevel = bestRuns.reduce((acc, run) => Math.max(acc, getRunLevel(run)), 0);
  const currentPeriod =
    mythicPlusObj.current_period && typeof mythicPlusObj.current_period === 'object'
      ? (mythicPlusObj.current_period as Record<string, unknown>)
      : mythicPlusObj.currentPeriod && typeof mythicPlusObj.currentPeriod === 'object'
        ? (mythicPlusObj.currentPeriod as Record<string, unknown>)
        : null;
  const providedBestLevel = [
    mythicPlusObj.highest_key,
    mythicPlusObj.highestKey,
    mythicPlusObj.best_level,
    mythicPlusObj.bestLevel,
    currentPeriod?.highest_key,
    currentPeriod?.highestKey,
    currentPeriod?.best_level,
    currentPeriod?.bestLevel,
  ]
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value > 0);
  const bestLevel = Math.max(computedBestLevel, providedBestLevel || 0);
  const bestDungeon = bestRuns.find((run) => getRunLevel(run) === bestLevel);
  const providedBestDungeon = [
    mythicPlusObj.top_dungeon,
    mythicPlusObj.topDungeon,
    mythicPlusObj.best_dungeon,
    mythicPlusObj.bestDungeon,
    currentPeriod?.top_dungeon,
    currentPeriod?.topDungeon,
    currentPeriod?.best_dungeon,
    currentPeriod?.bestDungeon,
  ]
    .map(getCharacterValueLabel)
    .find(Boolean);
  const recentSource = Array.isArray(mythicPlusObj.recent_runs)
    ? (mythicPlusObj.recent_runs as MythicRun[])
    : Array.isArray(mythicPlusObj.recentRuns)
      ? (mythicPlusObj.recentRuns as MythicRun[])
      : allRuns;
  const recentRuns = [...recentSource]
    .sort((a, b) => getRunTimestamp(b) - getRunTimestamp(a))
    .slice(0, 20);
  const timedRuns = recentRuns.filter(
    (run) => getMythicRunTimed(run, dungeonDetailsByName) === true
  ).length;
  const depletedRuns = recentRuns.filter(
    (run) => getMythicRunTimed(run, dungeonDetailsByName) === false
  ).length;
  const timedStatusKnownCount = recentRuns.filter(
    (run) => getMythicRunTimed(run, dungeonDetailsByName) !== null
  ).length;

  const vaultProgress = computeMythicVaultProgress(mythicPlus, region, periods);
  const topLevels = [...recentRuns].map(getRunLevel).sort((a, b) => b - a);
  const rewardMap = collectMythicRewardMap(mythicPlusObj.current_period || mythicPlus);
  const vaultSlots = vaultProgress.slotThresholds.map((threshold, index) => {
    const keyLevel = topLevels[threshold - 1] || null;
    return {
      slot: index + 1,
      threshold,
      unlocked: vaultProgress.runsForVault >= threshold,
      keyLevel,
      rewardIlvl: keyLevel ? rewardMap.get(keyLevel) || null : null,
      progress: Math.min(1, vaultProgress.runsForVault / threshold),
    };
  });
  const currentRating =
    mythicPlusObj.current_mythic_rating && typeof mythicPlusObj.current_mythic_rating === 'object'
      ? (mythicPlusObj.current_mythic_rating as Record<string, unknown>)
      : null;
  const currentRatingAlt =
    mythicPlusObj.currentMythicRating && typeof mythicPlusObj.currentMythicRating === 'object'
      ? (mythicPlusObj.currentMythicRating as Record<string, unknown>)
      : null;
  const score = Number(
    currentRating?.rating ?? currentRatingAlt?.rating ?? currentRating?.value ?? 0
  );

  return {
    score: score > 0 ? Math.round(score) : null,
    runs: bestRuns.length,
    bestLevel: bestLevel > 0 ? bestLevel : null,
    bestDungeonName: bestDungeon ? getMythicRunName(bestDungeon) : providedBestDungeon || null,
    recentRuns: recentRuns.map((run, index) => {
      const detail = getMythicDungeonDetail(run, dungeonDetailsByName);
      return {
        id: `${getMythicRunName(run)}-${getRunLevel(run)}-${getRunTimestamp(run)}-${index}`,
        dungeon: getMythicRunName(run),
        level: getRunLevel(run),
        duration: formatMythicDuration(getMythicRunDurationMs(run)),
        timed: getMythicRunTimed(run, dungeonDetailsByName),
        clockDelta: formatMythicClockDelta(run, dungeonDetailsByName),
        timestamp: getRunTimestamp(run),
        members: Array.isArray(run?.members) ? run.members : [],
        dungeonId: detail?.id ?? null,
        keystoneUpgrades: detail?.keystone_upgrades ?? [],
      };
    }),
    timedRuns,
    depletedRuns,
    hasTimedStatusData: timedStatusKnownCount > 0,
    vaultSlots,
    vaultProgressCount: vaultProgress.runsForVault,
    hasAnyVaultIlvl: vaultSlots.some((slot) => slot.rewardIlvl != null),
  };
}

export type CharacterProfessionSummary = {
  name: string;
  skillPoints: number | null;
  maxSkillPoints: number | null;
};

function parseOptionalNumber(value: unknown): number | null {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseCharacterProfessions(
  professions: CharacterProfessionsPayload,
  category: 'primaries' | 'secondaries'
): CharacterProfessionSummary[] {
  const entries = professions?.[category];
  if (!Array.isArray(entries)) return [];

  return entries.flatMap((entry: CharacterProfession) => {
    const entryObject = entry && typeof entry === 'object' ? entry : null;
    const name = getCharacterValueLabel(entryObject?.profession ?? entry);
    if (!name) return [];
    const skillPoints = parseOptionalNumber(entryObject?.skill_points);
    const maxSkillPoints = parseOptionalNumber(entryObject?.max_skill_points);
    return [
      {
        name,
        skillPoints,
        maxSkillPoints,
      },
    ];
  });
}

export function isCurrentExpansionPlaceholder(value: unknown): boolean {
  const lower = String(value ?? '')
    .trim()
    .toLowerCase();
  return lower === 'current season' || lower === 'current expansion';
}

export function isLikelyCurrentExpansionLabel(value: unknown): boolean {
  const lower = String(value ?? '')
    .trim()
    .toLowerCase();
  return lower === 'current season' || lower === 'current expansion';
}

export type CharacterRaidExpansionOption = {
  key: string;
  label: string;
};

export function getRaidExpansionOptions(
  raidEncounters: RaidEncountersPayload
): CharacterRaidExpansionOption[] {
  const expansions = Array.isArray(raidEncounters?.expansions) ? raidEncounters.expansions : [];
  const options = new Map<string, string>();
  for (const expansion of expansions) {
    const raw =
      expansion?.expansion?.name ||
      expansion?.expansion_name ||
      expansion?.label ||
      expansion?.name ||
      'Unknown expansion';
    const label = String(raw).trim() || 'Unknown expansion';
    if (isCurrentExpansionPlaceholder(label)) continue;
    const key = label.toLowerCase().replace(/[\s_]+/g, '-') || 'unknown-expansion';
    if (!options.has(key)) options.set(key, label);
  }

  return [
    { key: 'all', label: 'All expansions' },
    ...Array.from(options.entries()).map(([key, label]) => ({ key, label })),
  ];
}

export function raidMatchesActiveIds(raid: unknown, activeIds?: number[]): boolean {
  if (!activeIds) return true;

  const ids = new Set(activeIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)));
  if (ids.size === 0) return false;

  const instance = (raid || {}) as Record<string, any>;
  const instanceId = Number(instance.instance?.id ?? instance.id ?? 0);
  if (ids.has(instanceId)) return true;

  const modes = Array.isArray(instance.modes) ? instance.modes : [];
  return modes.some((mode: any) => {
    const progress = mode?.progress ?? {};
    const encounters = Array.isArray(progress.encounters)
      ? progress.encounters
      : Array.isArray(mode?.encounters)
        ? mode.encounters
        : [];
    return encounters.some((encounter: any) => {
      const encounterId = Number(
        encounter?.encounter?.id ?? encounter?.id ?? encounter?.journal_encounter_id ?? 0
      );
      return ids.has(encounterId);
    });
  });
}

function normalizeRaidKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function computeWeeklyRaidBossKills(
  raidEncounters: RaidEncountersPayload,
  region?: string,
  periods?: Array<Record<string, unknown>>
): number {
  const expansions = Array.isArray(raidEncounters?.expansions) ? raidEncounters.expansions : [];
  const weekStart = getWeeklyResetStartMs(region, new Date(), periods);
  const killedBosses = new Set<string>();

  for (const expansion of expansions) {
    for (const instance of Array.isArray(expansion?.instances) ? expansion.instances : []) {
      const raidName = instance?.instance?.name || instance?.name || 'raid';
      const raidKey = normalizeRaidKey(raidName);
      for (const mode of Array.isArray(instance?.modes) ? instance.modes : []) {
        const encounters = Array.isArray(mode?.progress?.encounters)
          ? mode.progress.encounters
          : [];
        for (let index = 0; index < encounters.length; index += 1) {
          const encounter = encounters[index] as any;
          const ts = Number(encounter?.last_kill_timestamp ?? 0);
          const tsMs = ts > 0 && ts < 1_000_000_000_000 ? ts * 1000 : ts;
          if (!(tsMs >= weekStart)) continue;
          const bossId = Number(encounter?.encounter?.id ?? encounter?.id ?? 0);
          const bossName =
            encounter?.encounter?.name || encounter?.name || encounter?.encounter_name || '';
          const stableBossKey =
            bossId > 0
              ? `id:${bossId}`
              : `name:${normalizeRaidKey(bossName || `boss-${index + 1}`)}`;
          killedBosses.add(`${raidKey}::${stableBossKey}`);
        }
      }
    }
  }

  return killedBosses.size;
}

export type RaidDifficultyKey = 'lfr' | 'normal' | 'heroic' | 'mythic';
export const RAID_DIFFICULTIES: RaidDifficultyKey[] = ['lfr', 'normal', 'heroic', 'mythic'];

export type RaidBossDifficultyStats = {
  kills: number;
  lastKillTs: number;
};

export type CharacterRaidBossProgress = {
  key: string;
  id: number | null;
  name: string;
  order: number;
  lastKillTs: number;
  totalKills: number;
  byDifficulty: Record<RaidDifficultyKey, RaidBossDifficultyStats>;
};

export type CharacterRaidProgression = {
  key: string;
  name: string;
  expansionKey: string;
  expansionLabel: string;
  lastKillTs: number;
  bosses: CharacterRaidBossProgress[];
  progressionBossKey: string | null;
};

export type RaidDifficultyTotals = Record<RaidDifficultyKey, number>;

export type CharacterRaidProgressionData = {
  raids: CharacterRaidProgression[];
  totalsByExpansion: Record<string, RaidDifficultyTotals>;
  expansionOrder: string[];
};

export function raidAcronym(name: string): string {
  const cleaned = String(name || '').trim();
  if (!cleaned) return '';
  const words = cleaned
    .split(/[\s'’-]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((word) => word[0]?.toUpperCase() || '')
    .join('');
}

function toRaidTimestampMs(input: unknown): number {
  const value = Number(input ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function normalizeRaidDifficulty(input: unknown): RaidDifficultyKey | null {
  const raw = String(input ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (raw.includes('raid_finder') || raw === 'lfr' || raw.includes('finder')) return 'lfr';
  if (raw.includes('mythic')) return 'mythic';
  if (raw.includes('heroic')) return 'heroic';
  if (raw.includes('normal')) return 'normal';
  return null;
}

function normalizeRaidSlug(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

function parseRaidNumber(input: unknown): number {
  const value = Number(input ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function getRaidProgressionBossKey(bosses: CharacterRaidBossProgress[]): string | null {
  if (bosses.length === 0) return null;
  const nonFinal = bosses.slice(0, -1);
  const candidates = nonFinal.length > 0 ? nonFinal : bosses;
  const sorted = [...candidates]
    .filter((boss) => boss.lastKillTs > 0)
    .sort((a, b) => b.lastKillTs - a.lastKillTs);
  return sorted[0]?.key ?? null;
}

export function parseRaidProgressionData(
  raidEncounters: RaidEncountersPayload,
  activeRaidInstanceIds?: number[]
): CharacterRaidProgressionData {
  const expansions = Array.isArray(raidEncounters?.expansions) ? raidEncounters.expansions : [];
  const raids = new Map<string, CharacterRaidProgression>();
  const totalsByExpansion: Record<string, RaidDifficultyTotals> = {};
  const expansionOrder: string[] = [];

  for (const expansion of expansions) {
    const rawExpansion =
      expansion?.expansion?.name ||
      expansion?.expansion_name ||
      expansion?.label ||
      expansion?.name;
    const expansionLabel = isCurrentExpansionPlaceholder(rawExpansion)
      ? 'Current expansion'
      : String(rawExpansion ?? '').trim() || 'Unknown expansion';
    const expansionKey = normalizeRaidSlug(expansionLabel) || 'unknown-expansion';
    if (!expansionOrder.includes(expansionKey)) expansionOrder.push(expansionKey);
    if (!totalsByExpansion[expansionKey]) {
      totalsByExpansion[expansionKey] = { lfr: 0, normal: 0, heroic: 0, mythic: 0 };
    }

    const instances = Array.isArray(expansion?.instances) ? expansion.instances : [];
    for (const instance of instances) {
      if (!raidMatchesActiveIds(instance, activeRaidInstanceIds)) continue;
      const raidName =
        String(instance?.instance?.name || instance?.name || 'Raid').trim() || 'Raid';
      const raidKey = `${expansionKey}::${normalizeRaidSlug(raidName)}`;
      if (!raids.has(raidKey)) {
        raids.set(raidKey, {
          key: raidKey,
          name: raidName,
          expansionKey,
          expansionLabel,
          lastKillTs: 0,
          bosses: [],
          progressionBossKey: null,
        });
      }

      const raid = raids.get(raidKey)!;
      const bossByKey = new Map<string, CharacterRaidBossProgress>(
        raid.bosses.map((boss) => [boss.key, boss])
      );
      const modes = Array.isArray(instance?.modes) ? instance.modes : [];
      for (const mode of modes) {
        const difficultyValues =
          mode?.difficulty && typeof mode.difficulty === 'object'
            ? [mode.difficulty.type, mode.difficulty.name]
            : [mode?.difficulty];
        const difficulty = difficultyValues.map(normalizeRaidDifficulty).find(Boolean) || null;
        if (!difficulty) continue;

        const progress = mode?.progress;
        totalsByExpansion[expansionKey][difficulty] += parseRaidNumber(
          progress?.encounters_defeated ?? progress?.completed_count
        );

        const encounters = Array.isArray(progress?.encounters)
          ? progress.encounters
          : Array.isArray(mode?.encounters)
            ? mode.encounters
            : [];
        encounters.forEach((encounter: RaidEncounterProgress, index: number) => {
          const rawId = parseRaidNumber(
            encounter?.encounter?.id ?? encounter?.id ?? encounter?.journal_encounter_id
          );
          const id = rawId > 0 ? rawId : null;
          const name = String(
            encounter?.encounter?.name ||
              encounter?.name ||
              encounter?.encounter_name ||
              `Boss ${index + 1}`
          );
          const order =
            parseRaidNumber(encounter?.display_order ?? encounter?.order_index) || index;
          const key = `${raidKey}::${id ?? normalizeRaidSlug(name)}`;
          const kills = parseRaidNumber(encounter?.completed_count);
          const lastKillTs = toRaidTimestampMs(
            encounter?.last_kill_timestamp ?? encounter?.lastKillTimestamp
          );

          if (!bossByKey.has(key)) {
            bossByKey.set(key, {
              key,
              id,
              name,
              order,
              lastKillTs,
              totalKills: kills,
              byDifficulty: {
                lfr: { kills: 0, lastKillTs: 0 },
                normal: { kills: 0, lastKillTs: 0 },
                heroic: { kills: 0, lastKillTs: 0 },
                mythic: { kills: 0, lastKillTs: 0 },
              },
            });
          }

          const boss = bossByKey.get(key)!;
          boss.byDifficulty[difficulty].kills = Math.max(
            boss.byDifficulty[difficulty].kills,
            kills
          );
          boss.byDifficulty[difficulty].lastKillTs = Math.max(
            boss.byDifficulty[difficulty].lastKillTs,
            lastKillTs
          );
          boss.lastKillTs = Math.max(boss.lastKillTs, lastKillTs);
          boss.totalKills = Math.max(
            boss.totalKills,
            RAID_DIFFICULTIES.reduce(
              (sum, currentDifficulty) => sum + boss.byDifficulty[currentDifficulty].kills,
              0
            )
          );
        });
      }

      raid.bosses = Array.from(bossByKey.values()).sort((a, b) => a.order - b.order);
      raid.lastKillTs = raid.bosses.reduce(
        (max, boss) => Math.max(max, boss.lastKillTs),
        raid.lastKillTs
      );
      raid.progressionBossKey = getRaidProgressionBossKey(raid.bosses);
    }
  }

  return {
    raids: Array.from(raids.values()).sort((a, b) => b.lastKillTs - a.lastKillTs),
    totalsByExpansion,
    expansionOrder,
  };
}

export type CharacterRaidOverview = {
  expansionLabel: string;
  clearedBosses: number;
  totalBosses: number;
  weeklyBossKills: number;
};

export function summarizeCurrentRaidProgress(
  raidEncounters: RaidEncountersPayload,
  region?: string,
  periods?: Array<Record<string, unknown>>,
  activeRaidInstanceIds?: number[]
): CharacterRaidOverview | null {
  const parsed = parseRaidProgressionData(raidEncounters, activeRaidInstanceIds);
  const raidExpansionKeys = parsed.expansionOrder.filter((key) =>
    parsed.raids.some((raid) => raid.expansionKey === key)
  );
  const concreteExpansionKeys = raidExpansionKeys.filter((key) =>
    parsed.raids.some(
      (raid) => raid.expansionKey === key && !isCurrentExpansionPlaceholder(raid.expansionLabel)
    )
  );
  const currentExpansionKey = concreteExpansionKeys.at(-1) || raidExpansionKeys.at(-1);
  const currentRaids = parsed.raids.filter((raid) => raid.expansionKey === currentExpansionKey);
  const bosses = currentRaids.flatMap((raid) => raid.bosses);
  if (bosses.length === 0) return null;

  const weekStart = getWeeklyResetStartMs(region, new Date(), periods);
  return {
    expansionLabel: currentRaids[0]?.expansionLabel || 'Current expansion',
    clearedBosses: bosses.filter((boss) =>
      RAID_DIFFICULTIES.some((difficulty) => boss.byDifficulty[difficulty].kills > 0)
    ).length,
    totalBosses: bosses.length,
    weeklyBossKills: bosses.filter((boss) =>
      RAID_DIFFICULTIES.some((difficulty) => boss.byDifficulty[difficulty].lastKillTs >= weekStart)
    ).length,
  };
}

function normalizeCharacterName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function normalizeRegionCode(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function tryDecodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function getMemberProfileHref(
  member: CharacterRunMember | null | undefined,
  fallbackRegion?: string
): { href: string; external: boolean } | null {
  if (!member) return null;
  const memberName =
    member?.linked_name ||
    member?.profile?.name ||
    member?.character?.name ||
    member?.character_name ||
    member?.name ||
    '';
  const memberRegion =
    member?.linked_region ||
    member?.profile?.region ||
    member?.character?.region ||
    member?.region ||
    member?.profile?.realm?.region ||
    fallbackRegion;
  const rawRealm =
    member?.linked_realm ||
    member?.profile?.realm?.slug ||
    member?.profile?.realm?.name ||
    member?.character?.realm?.slug ||
    member?.character?.realm?.name ||
    member?.realm;
  const memberRegionCode = normalizeRegionCode(memberRegion);
  const memberNameSlug = normalizeCharacterName(memberName);
  const realmSlug = normalizeRealmSlug(rawRealm);

  if (memberNameSlug && memberRegionCode && realmSlug) {
    return {
      href: characterHref(memberRegionCode, realmSlug, memberNameSlug),
      external: false,
    };
  }

  const externalUrl =
    member?.linked_profile_url || member?.profile?.url || member?.character?.url || member?.url;
  if (typeof externalUrl === 'string' && externalUrl.startsWith('http')) {
    const match = externalUrl.match(/\/character\/([^/]+)\/([^/]+)\/([^/?#]+)/i);
    if (match) {
      const parsedRegion = normalizeRegionCode(tryDecodeSegment(String(match[1] || '')));
      const parsedRealm = normalizeRealmSlug(tryDecodeSegment(String(match[2] || '')));
      const parsedName = normalizeCharacterName(tryDecodeSegment(String(match[3] || '')));
      if (parsedRegion && parsedRealm && parsedName) {
        return {
          href: characterHref(parsedRegion, parsedRealm, parsedName),
          external: false,
        };
      }
    }
  }

  if (typeof externalUrl === 'string' && externalUrl.startsWith('http')) {
    return { href: externalUrl, external: true };
  }
  return null;
}

export type ParsedVaultRewardItem = {
  slot: string;
  itemId: string;
  ilevel: string;
  bonusIds: number[];
};

export function parseVaultRewardsFromSimcInput(
  latestSimcInput: string | null | undefined
): ParsedVaultRewardItem[] {
  const input = String(latestSimcInput || '');
  if (!input.trim()) return [];

  const lines = input.split(/\r?\n/);
  const blocks: string[][] = [];
  let currentBlock: string[] | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const lower = line.toLowerCase();
    if (
      lower.includes('weekly reward choices') &&
      !lower.includes('end of weekly reward choices')
    ) {
      currentBlock = [];
      blocks.push(currentBlock);
      continue;
    }
    if (lower.includes('end of weekly reward choices')) {
      currentBlock = null;
      continue;
    }
    if (currentBlock) currentBlock.push(line);
  }

  const parseItemLines = (itemLines: string[]): ParsedVaultRewardItem[] => {
    const parsed: ParsedVaultRewardItem[] = [];
    const seen = new Set<string>();
    for (const line of itemLines) {
      const body = line.replace(/^#\s*/, '').trim();
      const match = body.match(/^([a-z0-9_]+)\s*=\s*(.+)$/i);
      if (!match) continue;
      const slot = match[1].trim();
      const simc = match[2].trim();
      const idMatch = simc.match(/id=(\d+)/i);
      if (!idMatch) continue;
      const ilevelMatch = simc.match(/ilevel=(\d+)/i);
      const bonusMatch = simc.match(/bonus_id=([0-9/]+)/i);
      const bonusIds = bonusMatch
        ? bonusMatch[1]
            .split('/')
            .map((v) => Number(v))
            .filter((v) => Number.isFinite(v) && v > 0)
        : [];
      const item = { slot, itemId: idMatch[1], ilevel: ilevelMatch?.[1] || '-', bonusIds };
      const key = `${item.slot}|${item.itemId}|${item.ilevel}|${item.bonusIds.join('/')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parsed.push(item);
    }
    return parsed;
  };

  if (blocks.length > 0) {
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const parsed = parseItemLines(blocks[i]);
      if (parsed.length > 0) return parsed;
    }
    return [];
  }

  return [];
}

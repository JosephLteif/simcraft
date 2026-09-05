'use client';

import { useEffect, useMemo, useState } from 'react';
import { getWarcraftLogsGuideUrl, normalizeEncounterName } from '../lib/warcraft-logs-guides';
import type { MythicPlusPayload, RaidEncountersPayload } from '../lib/character-domain-types';
import type { WarcraftLogsBossRanking, WarcraftLogsData } from '../lib/api';
import {
  getWeeklyResetStartMs,
  parseRaidProgressionData,
  RAID_DIFFICULTIES as DIFFICULTIES,
  raidAcronym,
} from '../lib/character-panel-utils';
import type { RaidDifficultyKey as DifficultyKey } from '../lib/character-panel-utils';
import VaultTrack, { useVaultTrackerData } from './shared/VaultTracker';

type RaidParseMode = 'needed' | 'all' | 'custom';

type RaidParsePreferences = {
  mode: RaidParseMode;
  difficulties: DifficultyKey[];
};

const RAID_PARSE_PREFERENCES_STORAGE_KEY = 'whylowdps_raid_parse_preferences';
const DEFAULT_RAID_PARSE_PREFERENCES: RaidParsePreferences = {
  mode: 'needed',
  difficulties: [],
};
const RAID_DIFFICULTY_LABELS: Record<DifficultyKey, string> = {
  lfr: 'LFR',
  normal: 'Normal',
  heroic: 'Heroic',
  mythic: 'Mythic',
};
const RAID_DIFFICULTY_BADGE_CLASSES: Record<DifficultyKey, string> = {
  lfr: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200',
  normal: 'border-sky-300/30 bg-sky-400/10 text-sky-200',
  heroic: 'border-amber-300/30 bg-amber-400/10 text-amber-200',
  mythic: 'border-violet-300/30 bg-violet-400/10 text-violet-200',
};

function readRaidParsePreferences(): RaidParsePreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_RAID_PARSE_PREFERENCES };

  try {
    const raw = window.localStorage.getItem(RAID_PARSE_PREFERENCES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RAID_PARSE_PREFERENCES };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_RAID_PARSE_PREFERENCES };

    const record = parsed as { mode?: unknown; difficulties?: unknown };
    const storedDifficulties = Array.isArray(record.difficulties) ? record.difficulties : [];
    const difficulties = DIFFICULTIES.filter((difficulty) =>
      storedDifficulties.includes(difficulty)
    );
    if (record.mode === 'all') return { mode: 'all', difficulties: [] };
    if (record.mode === 'custom' && difficulties.length > 0) {
      return { mode: 'custom', difficulties };
    }
  } catch {
    // Ignore malformed or unavailable browser storage.
  }

  return { ...DEFAULT_RAID_PARSE_PREFERENCES };
}

export default function RaidProgressionGrid({
  mythicPlus,
  raidEncounters,
  region,
  periods,
  activeRaidInstanceIds,
  selectedExpansion,
  selectedRaidName,
  onActiveRaidNameChange,
  warcraftLogs,
}: {
  mythicPlus?: MythicPlusPayload;
  raidEncounters: RaidEncountersPayload;
  region?: string;
  periods?: Array<Record<string, unknown>>;
  activeRaidInstanceIds?: number[];
  selectedExpansion: string;
  selectedRaidName?: string;
  onActiveRaidNameChange?: (raidName: string | null) => void;
  warcraftLogs?: WarcraftLogsData | null;
}) {
  const vaultTrackerData = useVaultTrackerData({
    mythicPlus,
    raidEncounters,
    region,
    periods,
    activeRaidInstanceIds,
  });
  const parsed = useMemo(
    () => parseRaidProgressionData(raidEncounters, activeRaidInstanceIds),
    [activeRaidInstanceIds, raidEncounters]
  );
  const [selectedRaidGroup, setSelectedRaidGroup] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'overall' | 'weekly'>('overall');
  const [parsePreferences, setParsePreferences] = useState<RaidParsePreferences>(
    DEFAULT_RAID_PARSE_PREFERENCES
  );
  const [parsePreferencesLoaded, setParsePreferencesLoaded] = useState(false);

  useEffect(() => {
    setParsePreferences(readRaidParsePreferences());
    setParsePreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!parsePreferencesLoaded) return;
    try {
      window.localStorage.setItem(
        RAID_PARSE_PREFERENCES_STORAGE_KEY,
        JSON.stringify(parsePreferences)
      );
    } catch {
      // Ignore unavailable browser storage.
    }
  }, [parsePreferences, parsePreferencesLoaded]);

  const visibleRaids = useMemo(() => {
    if (selectedExpansion === 'all') return parsed.raids;
    return parsed.raids.filter((raid) => raid.expansionKey === selectedExpansion);
  }, [parsed.raids, selectedExpansion]);

  const groupOptions = useMemo(() => {
    const raidCodes = Array.from(
      new Set(visibleRaids.map((r) => raidAcronym(r.name)).filter(Boolean))
    );
    const currentExpansionKey = parsed.expansionOrder[0];
    const currentExpansion = visibleRaids.find((raid) => raid.expansionKey === currentExpansionKey);
    const hasCurrentTier =
      visibleRaids.filter((raid) => raid.expansionKey === currentExpansionKey).length > 1;
    const currentGroupKey = currentExpansion ? `expansion:${currentExpansionKey}` : null;
    const options = [
      'all',
      ...(hasCurrentTier && currentGroupKey ? [currentGroupKey] : []),
      ...raidCodes,
    ].filter((value, index, values) => values.indexOf(value) === index);
    return options;
  }, [parsed.expansionOrder, visibleRaids]);

  useEffect(() => {
    if (selectedRaidGroup === 'all') return;
    if (!groupOptions.includes(selectedRaidGroup)) {
      setSelectedRaidGroup('all');
    }
  }, [groupOptions, selectedRaidGroup]);

  const groupedRaids = useMemo(() => {
    if (selectedRaidGroup === 'all') return visibleRaids;
    if (selectedRaidGroup.startsWith('expansion:')) {
      return visibleRaids.filter((raid) => `expansion:${raid.expansionKey}` === selectedRaidGroup);
    }
    return visibleRaids.filter((raid) => raidAcronym(raid.name) === selectedRaidGroup);
  }, [visibleRaids, selectedRaidGroup]);

  const weekCutoffTs = getWeeklyResetStartMs(region, new Date(), periods);

  useEffect(() => {
    if (!onActiveRaidNameChange) return;
    if (selectedRaidName && selectedRaidName !== 'all') {
      onActiveRaidNameChange(selectedRaidName);
      return;
    }
    onActiveRaidNameChange(null);
  }, [onActiveRaidNameChange, selectedRaidName]);

  const groupedRaidsWithViewBosses = useMemo(() => {
    return groupedRaids.map((raid) => ({ ...raid, bosses: raid.bosses }));
  }, [groupedRaids]);

  const bossProgressSummary = useMemo(() => {
    const allBosses = groupedRaidsWithViewBosses.flatMap((raid) => raid.bosses);
    const totalBosses = allBosses.length;
    const fullyCleared = allBosses.filter((boss) => {
      if (viewMode === 'overall') {
        return DIFFICULTIES.some((diff) => boss.byDifficulty[diff].kills > 0);
      }
      return DIFFICULTIES.some((diff) => boss.byDifficulty[diff].lastKillTs >= weekCutoffTs);
    }).length;
    return { totalBosses, fullyCleared };
  }, [groupedRaidsWithViewBosses, viewMode, weekCutoffTs]);

  if (groupedRaidsWithViewBosses.length === 0) {
    return (
      <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
        <p className="text-[11px] text-zinc-600 italic">
          No per-boss raid progression available yet.
        </p>
      </div>
    );
  }

  const hasWarcraftLogs = (warcraftLogs?.boss_rankings.length ?? 0) > 0;
  const parseFilterButtonClass = (active: boolean) =>
    `rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
      active ? 'bg-gold/20 text-gold' : 'text-zinc-300 hover:bg-white/10'
    }`;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-md border border-white/10 bg-black/20 p-1">
            <button
              type="button"
              onClick={() => setViewMode('overall')}
              className={parseFilterButtonClass(viewMode === 'overall')}
            >
              Overall
            </button>
            <button
              type="button"
              onClick={() => setViewMode('weekly')}
              className={parseFilterButtonClass(viewMode === 'weekly')}
            >
              Weekly kills
            </button>
          </div>
          <select
            aria-label="Raid group"
            value={selectedRaidGroup}
            onChange={(e) => setSelectedRaidGroup(e.target.value)}
            className="input-field h-9 w-full px-2 py-1 text-[11px] text-zinc-100 sm:w-[180px]"
            style={{ colorScheme: 'dark' }}
          >
            {groupOptions.map((group) => (
              <option key={group} value={group}>
                {group === 'all'
                  ? 'All raid groups'
                  : group.startsWith('expansion:')
                    ? visibleRaids.find((raid) => `expansion:${raid.expansionKey}` === group)
                        ?.expansionLabel || group
                    : group}
              </option>
            ))}
          </select>
        </div>
        {hasWarcraftLogs ? (
          <div
            className="flex flex-wrap items-center gap-1 rounded-md border border-white/10 bg-black/20 p-1"
            role="group"
            aria-label="Warcraft Logs parse difficulty filter"
          >
            <span className="px-1.5 text-[10px] font-bold tracking-wide text-zinc-500 uppercase">
              Parses
            </span>
            <button
              type="button"
              aria-pressed={parsePreferences.mode === 'needed'}
              title="Show parses for difficulties where this character has killed the boss"
              onClick={() => setParsePreferences({ mode: 'needed', difficulties: [] })}
              className={parseFilterButtonClass(parsePreferences.mode === 'needed')}
            >
              Needed difficulties
            </button>
            <button
              type="button"
              aria-pressed={parsePreferences.mode === 'all'}
              title="Show parses for every available raid difficulty"
              onClick={() => setParsePreferences({ mode: 'all', difficulties: [] })}
              className={parseFilterButtonClass(parsePreferences.mode === 'all')}
            >
              All difficulties
            </button>
            {DIFFICULTIES.map((difficulty) => (
              <button
                key={difficulty}
                type="button"
                aria-pressed={
                  parsePreferences.mode === 'custom' &&
                  parsePreferences.difficulties.includes(difficulty)
                }
                title={`Show ${RAID_DIFFICULTY_LABELS[difficulty]} parses`}
                onClick={() =>
                  setParsePreferences((previous) => {
                    const selected =
                      previous.mode === 'custom' ? previous.difficulties : ([] as DifficultyKey[]);
                    if (selected.includes(difficulty)) {
                      if (selected.length === 1) return previous;
                      return {
                        mode: 'custom',
                        difficulties: selected.filter((item) => item !== difficulty),
                      };
                    }
                    return {
                      mode: 'custom',
                      difficulties: [...selected, difficulty],
                    };
                  })
                }
                className={parseFilterButtonClass(
                  parsePreferences.mode === 'custom' &&
                    parsePreferences.difficulties.includes(difficulty)
                )}
              >
                {RAID_DIFFICULTY_LABELS[difficulty]}
              </button>
            ))}
            <span className="basis-full px-1 text-[10px] text-zinc-500">
              Needed follows this character&apos;s cleared difficulty for each boss.
            </span>
          </div>
        ) : null}
      </div>

      <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
        <div className="mb-3 rounded-md border border-white/10 bg-black/20 p-3">
          <VaultTrack kind="raid" data={vaultTrackerData} />
        </div>
        <p className="mb-2 text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
          Bosses by raid
        </p>
        <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-400">
          <span>{`${bossProgressSummary.fullyCleared}/${bossProgressSummary.totalBosses} fully cleared`}</span>
          <span className="font-mono text-zinc-300">{`${bossProgressSummary.totalBosses} total`}</span>
        </div>
        <div className="mb-2 grid grid-cols-[minmax(240px,1fr)_repeat(4,36px)_60px] items-center gap-2 border-b border-white/10 pb-1 text-[10px] font-bold tracking-wide text-zinc-500 uppercase">
          <span>Boss</span>
          <span className="text-center">LFR</span>
          <span className="text-center">N</span>
          <span className="text-center">H</span>
          <span className="text-center">M</span>
          <span className="text-right">Kills</span>
        </div>
        <div className="space-y-4">
          {groupedRaidsWithViewBosses.map((raid) => (
            <div key={raid.key} className="space-y-2">
              <div className="rounded-md border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] font-bold tracking-wide text-zinc-300 uppercase">
                {raid.name}
              </div>
              {raid.bosses.map((boss) => {
                const totalKills = DIFFICULTIES.reduce(
                  (sum, diff) => sum + boss.byDifficulty[diff].kills,
                  0
                );
                const weeklyKills = DIFFICULTIES.reduce(
                  (sum, diff) => sum + (boss.byDifficulty[diff].lastKillTs >= weekCutoffTs ? 1 : 0),
                  0
                );
                const guideUrl = getWarcraftLogsGuideUrl(boss.name);
                const warcraftLogsRankings = findWarcraftLogsBossRanking(
                  boss.name,
                  warcraftLogs?.boss_rankings ?? []
                );
                const requestedParseDifficulties =
                  parsePreferences.mode === 'all'
                    ? DIFFICULTIES
                    : parsePreferences.mode === 'custom'
                      ? parsePreferences.difficulties
                      : DIFFICULTIES.filter((diff) => boss.byDifficulty[diff].kills > 0);
                const visibleWarcraftLogsRankings = warcraftLogsRankings.filter(
                  (ranking) =>
                    ranking.difficulty !== null &&
                    ranking.difficulty !== undefined &&
                    requestedParseDifficulties.includes(ranking.difficulty)
                );
                const dotClass = (active: boolean, diff: DifficultyKey) => {
                  if (!active) return 'bg-zinc-700/60 ring-white/10';
                  if (diff === 'mythic') return 'bg-violet-400 ring-violet-300/60';
                  if (diff === 'heroic') return 'bg-amber-400 ring-amber-300/60';
                  if (diff === 'normal') return 'bg-sky-400 ring-sky-300/60';
                  return 'bg-emerald-400 ring-emerald-300/60';
                };
                return (
                  <div
                    key={boss.key}
                    className="rounded-md border border-white/10 bg-black/20 px-3 py-2"
                  >
                    <div className="grid grid-cols-[minmax(240px,1fr)_repeat(4,36px)_60px] items-center gap-2">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-sm font-semibold text-zinc-100">
                            {boss.name}
                          </p>
                          {guideUrl ? (
                            <a
                              href={guideUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gold hover:text-gold/80 shrink-0 text-xs font-semibold"
                              aria-label={`Warcraft Logs guide for ${boss.name}`}
                            >
                              Guide
                            </a>
                          ) : null}
                        </div>
                        {visibleWarcraftLogsRankings.map((ranking, index) => (
                          <WarcraftLogsBossParse
                            key={`${boss.key}-${ranking.difficulty ?? 'unknown'}-${index}`}
                            ranking={ranking}
                          />
                        ))}
                      </div>
                      {DIFFICULTIES.map((diff) => {
                        const killed =
                          viewMode === 'overall'
                            ? boss.byDifficulty[diff].kills > 0
                            : boss.byDifficulty[diff].lastKillTs >= weekCutoffTs;
                        return (
                          <span key={`${boss.key}-${diff}`} className="flex justify-center">
                            <span
                              className={`h-3 w-3 rounded-full ring-1 ${dotClass(killed, diff)}`}
                              title={killed ? `${diff} cleared` : `${diff} not cleared`}
                            />
                          </span>
                        );
                      })}
                      <span className="justify-self-end rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] font-bold text-zinc-300">
                        {viewMode === 'weekly' ? weeklyKills : totalKills}x
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function findWarcraftLogsBossRanking(
  bossName: string,
  rankings: WarcraftLogsBossRanking[]
): WarcraftLogsBossRanking[] {
  const normalizedBossName = normalizeEncounterName(bossName);
  const directMatches = rankings.filter(
    (ranking) => normalizeEncounterName(ranking.encounter_name) === normalizedBossName
  );
  if (directMatches.length > 0) return directMatches;

  const guideUrl = getWarcraftLogsGuideUrl(bossName);
  if (!guideUrl) return [];
  const guideMatches = rankings.filter(
    (ranking) => getWarcraftLogsGuideUrl(ranking.encounter_name) === guideUrl
  );
  return guideMatches;
}

function WarcraftLogsBossParse({ ranking }: { ranking: WarcraftLogsBossRanking }) {
  const hasPercentiles = ranking.rank_percent !== null || ranking.median_percent !== null;
  const metric = ranking.metric?.trim().toUpperCase();
  const amount = ranking.best_amount === null ? null : formatParseAmount(ranking.best_amount);
  const difficultyLabel = ranking.difficulty
    ? RAID_DIFFICULTY_LABELS[ranking.difficulty]
    : 'Highest';
  const difficultyBadgeClass = ranking.difficulty
    ? RAID_DIFFICULTY_BADGE_CLASSES[ranking.difficulty]
    : 'border-white/15 bg-white/[0.04] text-zinc-300';

  return (
    <p
      className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-300"
      aria-label={`Warcraft Logs ${difficultyLabel} parses for ${ranking.encounter_name}`}
    >
      <span className="rounded bg-sky-400/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-sky-200">
        WCL
      </span>
      <span
        className={`rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${difficultyBadgeClass}`}
      >
        {difficultyLabel}
      </span>
      {hasPercentiles ? (
        <>
          <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5">
            <span className="text-zinc-400">Best parse</span>{' '}
            <strong className="font-semibold text-amber-200">
              {formatParsePercent(ranking.rank_percent)}
            </strong>
          </span>
          <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5">
            <span className="text-zinc-400">Median parse</span>{' '}
            <strong className="font-semibold text-white">
              {formatParsePercent(ranking.median_percent)}
            </strong>
          </span>
        </>
      ) : (
        <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-zinc-400">
          No public parse
        </span>
      )}
      {ranking.total_kills !== null ? (
        <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5">
          <strong className="font-semibold text-zinc-200">
            {formatParseCount(ranking.total_kills)}
          </strong>{' '}
          <span className="text-zinc-400">public kills</span>
        </span>
      ) : null}
      {amount !== null ? (
        <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5">
          <span className="text-zinc-400">Best amount</span>{' '}
          <strong className="font-semibold text-zinc-200">{amount}</strong>{' '}
          <span className="text-zinc-400">{metric || 'amount'}</span>
        </span>
      ) : null}
      {ranking.spec ? (
        <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5">
          <span className="text-zinc-400">Spec</span>{' '}
          <strong className="font-semibold text-zinc-200">{ranking.spec}</strong>
        </span>
      ) : null}
    </p>
  );
}

function formatParsePercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;
}

function formatParseCount(value: number): string {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)).toLocaleString() : '—';
}

function formatParseAmount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

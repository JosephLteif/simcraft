'use client';

import { useEffect, useMemo, useState } from 'react';
import { getWarcraftLogsGuideUrl } from '../lib/warcraft-logs-guides';
import { RAID_VAULT_THRESHOLDS } from '../lib/game-rules';
import { getWeeklyResetStartMs, raidMatchesActiveIds } from '../lib/character-panel-utils';

type DifficultyKey = 'lfr' | 'normal' | 'heroic' | 'mythic';

type BossDifficultyStats = {
  kills: number;
  lastKillTs: number;
};

type BossProgress = {
  key: string;
  id: number | null;
  name: string;
  order: number;
  lastKillTs: number;
  totalKills: number;
  byDifficulty: Record<DifficultyKey, BossDifficultyStats>;
};

type RaidProgression = {
  key: string;
  name: string;
  expansionKey: string;
  expansionLabel: string;
  lastKillTs: number;
  bosses: BossProgress[];
  progressionBossKey: string | null;
};

type DifficultyTotals = Record<DifficultyKey, number>;

const DIFFICULTIES: DifficultyKey[] = ['lfr', 'normal', 'heroic', 'mythic'];
function toTimestampMs(input: unknown): number {
  const value = Number(input ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function normalizeDifficulty(input: unknown): DifficultyKey | null {
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

function normalizeSlug(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

function normalizeExpansionLabel(input: unknown): string {
  const raw = String(input ?? '').trim();
  if (!raw) return 'Unknown expansion';
  const lower = raw.toLowerCase();
  if (lower === 'current season' || lower === 'current expansion') return 'Current expansion';
  return raw;
}

function parseNumber(input: unknown): number {
  const value = Number(input ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function raidAcronym(name: string): string {
  const cleaned = String(name || '').trim();
  if (!cleaned) return '';
  const words = cleaned
    .split(/[\s'’-]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');
}

function getProgressionBossKey(bosses: BossProgress[]): string | null {
  if (bosses.length === 0) return null;
  const nonFinal = bosses.slice(0, -1);
  const candidates = nonFinal.length > 0 ? nonFinal : bosses;
  const sorted = [...candidates]
    .filter((boss) => boss.lastKillTs > 0)
    .sort((a, b) => b.lastKillTs - a.lastKillTs);
  return sorted[0]?.key ?? null;
}

function parseRaidData(raidEncounters: any, activeRaidInstanceIds?: number[]): {
  raids: RaidProgression[];
  totalsByExpansion: Record<string, DifficultyTotals>;
  expansionOrder: string[];
} {
  const expansions = Array.isArray(raidEncounters?.expansions) ? raidEncounters.expansions : [];
  const raids = new Map<string, RaidProgression>();
  const totalsByExpansion: Record<string, DifficultyTotals> = {};
  const expansionOrder: string[] = [];
  for (const expansion of expansions) {
    const rawExpansion =
      expansion?.expansion?.name || expansion?.expansion_name || expansion?.label || expansion?.name;
    const expansionLabel = normalizeExpansionLabel(rawExpansion);
    const expansionKey = normalizeSlug(expansionLabel) || 'unknown-expansion';
    if (!expansionOrder.includes(expansionKey)) expansionOrder.push(expansionKey);
    if (!totalsByExpansion[expansionKey]) {
      totalsByExpansion[expansionKey] = { lfr: 0, normal: 0, heroic: 0, mythic: 0 };
    }

    const instances = Array.isArray(expansion?.instances) ? expansion.instances : [];
    for (const instance of instances) {
      if (!raidMatchesActiveIds(instance, activeRaidInstanceIds)) continue;
      const raidName = String(instance?.instance?.name || instance?.name || 'Raid').trim() || 'Raid';
      const raidKey = `${expansionKey}::${normalizeSlug(raidName)}`;

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
      const bossByKey = new Map<string, BossProgress>(raid.bosses.map((boss) => [boss.key, boss]));

      const modes = Array.isArray(instance?.modes) ? instance.modes : [];
      for (const mode of modes) {
        const difficulty =
          normalizeDifficulty(mode?.difficulty?.type) ||
          normalizeDifficulty(mode?.difficulty?.name) ||
          normalizeDifficulty(mode?.difficulty);
        if (!difficulty) continue;

        const progress = mode?.progress ?? {};
        totalsByExpansion[expansionKey][difficulty] += parseNumber(
          progress?.encounters_defeated ?? progress?.completed_count,
        );

        const encounters = Array.isArray(progress?.encounters)
          ? progress.encounters
          : Array.isArray(mode?.encounters)
            ? mode.encounters
            : [];

        encounters.forEach((encounter: any, index: number) => {
          const rawId = parseNumber(
            encounter?.encounter?.id ?? encounter?.id ?? encounter?.journal_encounter_id,
          );
          const id = rawId > 0 ? rawId : null;
          const name = String(
            encounter?.encounter?.name || encounter?.name || encounter?.encounter_name || `Boss ${index + 1}`,
          );
          const order = parseNumber(encounter?.display_order ?? encounter?.order_index) || index;
          const key = `${raidKey}::${id ?? normalizeSlug(name)}`;
          const kills = parseNumber(encounter?.completed_count);
          const lastKillTs = toTimestampMs(
            encounter?.last_kill_timestamp ?? encounter?.lastKillTimestamp,
          );

          const existing = bossByKey.get(key);
          if (!existing) {
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
          boss.byDifficulty[difficulty].kills = Math.max(boss.byDifficulty[difficulty].kills, kills);
          boss.byDifficulty[difficulty].lastKillTs = Math.max(
            boss.byDifficulty[difficulty].lastKillTs,
            lastKillTs,
          );
          boss.lastKillTs = Math.max(boss.lastKillTs, lastKillTs);
          boss.totalKills = Math.max(
            boss.totalKills,
            DIFFICULTIES.reduce((sum, diff) => sum + boss.byDifficulty[diff].kills, 0),
          );
        });
      }

      raid.bosses = Array.from(bossByKey.values()).sort((a, b) => a.order - b.order);
      raid.lastKillTs = raid.bosses.reduce((max, boss) => Math.max(max, boss.lastKillTs), raid.lastKillTs);
      raid.progressionBossKey = getProgressionBossKey(raid.bosses);
    }
  }

  return {
    raids: Array.from(raids.values()).sort((a, b) => b.lastKillTs - a.lastKillTs),
    totalsByExpansion,
    expansionOrder,
  };
}

export default function RaidProgressionGrid({
  raidEncounters,
  region,
  periods,
  activeRaidInstanceIds,
  selectedExpansion,
  selectedRaidName,
  onActiveRaidNameChange,
}: {
  raidEncounters: any;
  region?: string;
  periods?: Array<Record<string, unknown>>;
  activeRaidInstanceIds?: number[];
  selectedExpansion: string;
  selectedRaidName?: string;
  onActiveRaidNameChange?: (raidName: string | null) => void;
}) {
  const parsed = useMemo(
    () => parseRaidData(raidEncounters, activeRaidInstanceIds),
    [activeRaidInstanceIds, raidEncounters],
  );
  const [selectedRaidGroup, setSelectedRaidGroup] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'overall' | 'weekly'>('overall');

  const visibleRaids = useMemo(() => {
    if (selectedExpansion === 'all') return parsed.raids;
    return parsed.raids.filter((raid) => raid.expansionKey === selectedExpansion);
  }, [parsed.raids, selectedExpansion]);

  const groupOptions = useMemo(() => {
    const raidCodes = Array.from(new Set(visibleRaids.map((r) => raidAcronym(r.name)).filter(Boolean)));
    const currentExpansionKey = parsed.expansionOrder[0];
    const currentExpansion = visibleRaids.find((raid) => raid.expansionKey === currentExpansionKey);
    const hasCurrentTier = visibleRaids.filter((raid) => raid.expansionKey === currentExpansionKey).length > 1;
    const currentGroupKey = currentExpansion ? `expansion:${currentExpansionKey}` : null;
    const options = ['all', ...(hasCurrentTier && currentGroupKey ? [currentGroupKey] : []), ...raidCodes]
      .filter((value, index, values) => values.indexOf(value) === index);
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

  const raidVaultSummary = useMemo(() => {
    const allBosses = groupedRaidsWithViewBosses.flatMap((raid) => raid.bosses);
    const weeklyBossKills = allBosses.filter((boss) =>
      DIFFICULTIES.some((diff) => boss.byDifficulty[diff].lastKillTs >= weekCutoffTs),
    ).length;
    const slotThresholds = [...RAID_VAULT_THRESHOLDS];
    const slots = slotThresholds.map((threshold, i) => {
      const unlocked = weeklyBossKills >= threshold;
      return {
        slot: i + 1,
        threshold,
        unlocked,
        progress: Math.min(1, weeklyBossKills / threshold),
      };
    });
    return { weeklyBossKills, slots };
  }, [groupedRaidsWithViewBosses, weekCutoffTs]);

  if (groupedRaidsWithViewBosses.length === 0) {
    return (
      <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
        <p className="text-[11px] italic text-zinc-600">No per-boss raid progression available yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-md border border-white/10 bg-black/20 p-1">
          <button
            type="button"
            onClick={() => setViewMode('overall')}
            className={`rounded px-2 py-1 text-[11px] font-semibold ${viewMode === 'overall' ? 'bg-gold/20 text-gold' : 'text-zinc-300 hover:bg-white/10'}`}
          >
            Overall
          </button>
          <button
            type="button"
            onClick={() => setViewMode('weekly')}
            className={`rounded px-2 py-1 text-[11px] font-semibold ${viewMode === 'weekly' ? 'bg-gold/20 text-gold' : 'text-zinc-300 hover:bg-white/10'}`}
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
                  ? visibleRaids.find((raid) => `expansion:${raid.expansionKey}` === group)?.expansionLabel || group
                  : group}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
        <div className="mb-3 rounded-md border border-white/10 bg-black/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              Weekly Vault Tracker (Raid)
            </p>
            <span className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] font-bold text-zinc-300">
              {raidVaultSummary.weeklyBossKills} bosses this week
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {raidVaultSummary.slots.map((slot) => (
              <div key={slot.slot} className="rounded border border-white/10 bg-black/25 p-2">
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-zinc-200">Slot {slot.slot}</span>
                  <span className={slot.unlocked ? 'font-bold text-emerald-400' : 'text-zinc-500'}>
                    {slot.unlocked ? 'Unlocked' : `${slot.threshold - raidVaultSummary.weeklyBossKills} more`}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full ${slot.unlocked ? 'bg-emerald-400' : 'bg-gold/70'}`}
                    style={{ width: `${Math.max(6, slot.progress * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-zinc-500">Requires {slot.threshold} weekly boss kills</p>
              </div>
            ))}
          </div>
        </div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
          Bosses by raid
        </p>
        <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-400">
          <span>{`${bossProgressSummary.fullyCleared}/${bossProgressSummary.totalBosses} fully cleared`}</span>
          <span className="font-mono text-zinc-300">{`${bossProgressSummary.totalBosses} total`}</span>
        </div>
        <div className="mb-2 grid grid-cols-[minmax(240px,1fr)_repeat(4,36px)_60px] items-center gap-2 border-b border-white/10 pb-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
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
              <div className="rounded-md border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-zinc-300">
                {raid.name}
              </div>
              {raid.bosses.map((boss) => {
                const totalKills = DIFFICULTIES.reduce((sum, diff) => sum + boss.byDifficulty[diff].kills, 0);
                const weeklyKills = DIFFICULTIES.reduce(
                  (sum, diff) => sum + (boss.byDifficulty[diff].lastKillTs >= weekCutoffTs ? 1 : 0),
                  0,
                );
                const guideUrl = getWarcraftLogsGuideUrl(boss.name);
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
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-sm font-semibold text-zinc-100">{boss.name}</p>
                        {guideUrl ? (
                          <a
                            href={guideUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-xs font-semibold text-gold hover:text-gold/80"
                            aria-label={`Warcraft Logs guide for ${boss.name}`}
                          >
                            Guide
                          </a>
                        ) : null}
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

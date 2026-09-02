'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import TalentTree from './TalentTree';
import { type TalentTreeData, useTalentTree } from '../lib/useTalentTree';
import CharacterQuickLinks from './character/CharacterQuickLinks';
import CharacterOverviewCard from './character/CharacterOverviewCard';
import CharacterPageTabs, { type CharacterPageTab } from './character/CharacterPageTabs';
import RaidProgressionGrid from './RaidProgressionGrid';
import GearOverview, { type GearItem as OverviewGearItem } from './GearOverview';
import VaultRewardsGrid, { type VaultRewardItem } from './VaultRewardsGrid';
import SectionCard from './shared/SectionCard';
import ProgressSlotCard from './shared/ProgressSlotCard';
import { RAID_VAULT_THRESHOLDS } from '../lib/game-rules';
import { buildCharacterTalentString } from '../lib/character-panel-talent';
import type {
  CharacterPanelEquipment,
  CharacterRunMember,
  CharacterProfilePayload,
  CharacterProfessionsPayload,
  CharacterSpecialization,
  CharacterSpecializationsPayload,
  CharacterStatisticsPayload,
  CharacterTalentLoadout,
  CharacterTalentSelection,
  MythicPlusPayload,
  RaidEncountersPayload,
  RaidMode,
} from '../lib/character-domain-types';
import {
  buildCharacterExternalLinks,
  computeMythicVaultProgress,
  computeWeeklyRaidBossKills,
  getRaidExpansionOptions,
  getMemberProfileHref,
  isCurrentExpansionPlaceholder,
  parseVaultRewardsFromSimcInput,
  raidMatchesActiveIds,
  summarizeMythicPlus,
} from '../lib/character-panel-utils';
import { parseTalentLoadouts, type TalentLoadoutParsed } from '../lib/types';
import { useMythicDungeonDetails } from '../lib/useMythicDungeonDetails';
import { useGameContext } from '../lib/useGameContext';
import type { RaiderIoData, WarcraftLogsData } from '../lib/api';
import {
  RaidIntegrationCards,
  RaiderIoMythicPlusCard,
  type CharacterIntegrationState,
} from './character/ExternalIntegrationCards';

function getUpgradeLabel(item: Record<string, any>): string {
  const upgrade = item?.upgrade;
  if (!upgrade) return '';
  if (typeof upgrade === 'string') return upgrade;
  return String(upgrade.display_string || upgrade.displayString || upgrade.name || '').trim();
}

interface CharacterPanelProps {
  name: string;
  realm: string;
  region: string;
  profile: CharacterProfilePayload;
  characterClass: string;
  race: string;
  level: number;
  equipment: CharacterPanelEquipment;
  statistics: CharacterStatisticsPayload;
  specializations: CharacterSpecializationsPayload | null;
  professions: CharacterProfessionsPayload;
  mythicPlus: MythicPlusPayload;
  raidEncounters: RaidEncountersPayload;
  dungeons?: unknown;
  characterMediaUrl?: string | null;
  latestSimcInput?: string | null;
  initialTab?: 'profile' | 'raiding' | 'mythic' | 'vault';
  raiderIoIntegration?: CharacterIntegrationState<RaiderIoData> | null;
  warcraftLogsIntegration?: CharacterIntegrationState<WarcraftLogsData> | null;
  onRefreshIntegrations?: () => void;
}

export default function CharacterPanel({
  name,
  realm,
  region,
  profile,
  characterClass,
  equipment,
  statistics,
  specializations,
  professions,
  mythicPlus,
  raidEncounters,
  characterMediaUrl,
  latestSimcInput,
  initialTab,
  raiderIoIntegration = null,
  warcraftLogsIntegration = null,
  onRefreshIntegrations,
}: CharacterPanelProps) {
  const gameContext = useGameContext();
  const seasonPeriods = gameContext?.active_season?.periods;

  // --- Talent & Spec Logic (Lifted for SimC Generation) ---
  const activeSpec = useMemo(() => {
    if (!specializations?.specializations) return null;
    const list = specializations.specializations;
    const activeId = specializations.active_specialization?.id;
    if (activeId) {
      return (
        list.find((spec: CharacterSpecialization) => spec.specialization?.id === activeId) || null
      );
    }
    return (
      list.find((spec: CharacterSpecialization) =>
        (spec.loadouts || []).some((loadout: CharacterTalentLoadout) => loadout.is_active)
      ) || null
    );
  }, [specializations]);

  const activeLoadout = useMemo(() => {
    if (!activeSpec?.loadouts) return null;
    return activeSpec.loadouts.find((loadout: CharacterTalentLoadout) => loadout.is_active) || null;
  }, [activeSpec]);

  const specId = activeSpec?.specialization?.id ?? null;
  const tree = useTalentTree(specId);

  const talentString = useMemo(() => {
    return buildCharacterTalentString({
      tree,
      specId,
      activeLoadout,
      activeSpec,
    });
  }, [activeLoadout, tree, specId, activeSpec]);
  // --- End Talent & SimC Logic ---

  const profileGear = useMemo(() => {
    const normalized: Record<string, OverviewGearItem> = {};
    for (const it of equipment.equipped_items || []) {
      const rawSlot = String(it.slot?.type || '').toUpperCase();
      if (!rawSlot) continue;
      const slot = rawSlot.toLowerCase().replace(/_([12])$/i, '$1');
      normalized[slot] = {
        slot,
        item_id: Number(it.item?.id || 0),
        ilevel: Number(it.level?.value || 0),
        name: it.name || '',
        upgrade: getUpgradeLabel(it),
        bonus_ids: Array.isArray(it.bonus_list) ? it.bonus_list : [],
        enchant_id: Number(it.enchantments?.[0]?.enchantment_id || 0) || undefined,
        gem_ids: Array.isArray(it.sockets)
          ? it.sockets.map((socket) => Number(socket?.item?.id || 0)).filter((id) => id > 0)
          : undefined,
        gem_id: Number(it.sockets?.[0]?.item?.id || 0) || undefined,
      };
    }
    return normalized;
  }, [equipment]);
  const [pageTab, setPageTab] = useState<CharacterPageTab>(initialTab || 'profile');
  const quickLinks = useMemo(
    () => buildCharacterExternalLinks(region, realm, name),
    [name, realm, region]
  );

  return (
    <div className="flex flex-col gap-6">
      <CharacterQuickLinks {...quickLinks} characterLabel={`${name} - ${realm}`} />
      <CharacterPageTabs value={pageTab} onChange={setPageTab} />

      {pageTab === 'profile' && (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-6">
            <GearOverview
              gear={profileGear}
              title="Equipped Gear"
              characterRenderUrl={characterMediaUrl}
              characterClassName={characterClass}
            />

            <TalentsCard
              activeSpec={activeSpec}
              activeLoadout={activeLoadout}
              talentString={talentString}
              specId={specId}
              tree={tree}
              latestSimcInput={latestSimcInput}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <StatsCard statistics={statistics} />
            <CharacterOverviewCard
              profile={profile}
              activeSpecName={
                activeSpec?.specialization?.name || specializations?.active_specialization?.name
              }
              professions={professions}
              mythicPlus={mythicPlus}
              raidEncounters={raidEncounters}
              region={region}
              periods={seasonPeriods}
              activeRaidInstanceIds={gameContext?.pool_members?.raids}
              layout="stacked"
            />
          </div>
        </div>
      )}

      {pageTab === 'mythic' && (
        <MythicPlusCard
          mythicPlus={mythicPlus}
          region={region}
          periods={seasonPeriods}
          realm={realm}
          name={name}
          raiderIo={raiderIoIntegration}
          onRefreshIntegrations={onRefreshIntegrations}
        />
      )}

      {pageTab === 'raiding' && (
        <RaidSectionCard
          raidEncounters={raidEncounters}
          region={region}
          periods={seasonPeriods}
          activeRaidInstanceIds={gameContext?.pool_members?.raids}
          realm={realm}
          name={name}
          raiderIo={raiderIoIntegration}
          warcraftLogs={warcraftLogsIntegration}
          onRefreshIntegrations={onRefreshIntegrations}
        />
      )}
      {pageTab === 'vault' && (
        <VaultOverviewCard
          mythicPlus={mythicPlus}
          raidEncounters={raidEncounters}
          latestSimcInput={latestSimcInput}
          region={region}
          periods={seasonPeriods}
        />
      )}
    </div>
  );
}

function VaultOverviewCard({
  mythicPlus,
  raidEncounters,
  latestSimcInput,
  region,
  periods,
}: {
  mythicPlus: MythicPlusPayload;
  raidEncounters: RaidEncountersPayload;
  latestSimcInput?: string | null;
  region?: string;
  periods?: Array<Record<string, unknown>>;
}) {
  useMemo(
    () => computeMythicVaultProgress(mythicPlus, region, periods).runsForVault,
    [mythicPlus, periods, region]
  );
  const raidBossesThisWeek = useMemo(() => {
    return computeWeeklyRaidBossKills(raidEncounters, region, periods);
  }, [periods, raidEncounters, region]);

  const vaultItems = useMemo(
    () => parseVaultRewardsFromSimcInput(latestSimcInput) as VaultRewardItem[],
    [latestSimcInput]
  );
  const mythicVaultProgress = useMemo(
    () => computeMythicVaultProgress(mythicPlus, region, periods),
    [mythicPlus, periods, region]
  );
  const mythicSlots = mythicVaultProgress.slots;

  const raidSlots = useMemo(
    () =>
      RAID_VAULT_THRESHOLDS.map((threshold, idx) => ({
        slot: idx + 1,
        threshold,
        unlocked: raidBossesThisWeek >= threshold,
        remaining: Math.max(0, threshold - raidBossesThisWeek),
        progress: Math.min(1, raidBossesThisWeek / threshold),
      })),
    [raidBossesThisWeek]
  );

  return (
    <div className="card space-y-4 p-5">
      <h3 className="text-xs font-bold tracking-wider text-zinc-500 uppercase">
        Overall Vault Progress
      </h3>

      <div className="grid grid-cols-1 gap-3">
        <SectionCard title="Mythic+ Track">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {mythicSlots.map((slot) => (
              <ProgressSlotCard
                key={`mplus-${slot.slot}`}
                slotLabel={`Slot ${slot.slot}`}
                statusLabel={slot.unlocked ? 'Unlocked' : 'Locked'}
                tone={slot.unlocked ? 'success' : 'neutral'}
                description={
                  slot.unlocked
                    ? `Based on ${mythicVaultProgress.runsForVault} runs`
                    : `${slot.remaining} more runs`
                }
                progress={slot.progress}
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            {mythicVaultProgress.runsForVault} runs completed this week.
          </p>
        </SectionCard>

        <SectionCard title="Raid Track">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {raidSlots.map((slot) => (
              <ProgressSlotCard
                key={`raid-${slot.slot}`}
                slotLabel={`Slot ${slot.slot}`}
                statusLabel={slot.unlocked ? 'Unlocked' : `${slot.remaining} more`}
                tone={slot.unlocked ? 'success' : 'neutral'}
                description={
                  slot.unlocked
                    ? `Based on ${raidBossesThisWeek} boss kills`
                    : `Requires ${slot.threshold} boss kills`
                }
                progress={slot.progress}
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            {raidBossesThisWeek} boss kills completed this week.
          </p>
        </SectionCard>
      </div>

      {vaultItems.length > 0 && (
        <SectionCard title="Vault item choices">
          <VaultRewardsGrid items={vaultItems} />
        </SectionCard>
      )}
    </div>
  );
}

function MythicPlusCard({
  mythicPlus,
  region,
  periods,
  raiderIo,
  onRefreshIntegrations,
}: {
  mythicPlus: MythicPlusPayload;
  region?: string;
  periods?: Array<Record<string, unknown>>;
  realm: string;
  name: string;
  raiderIo: CharacterIntegrationState<RaiderIoData> | null;
  onRefreshIntegrations?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'runs'>('overview');
  const mplusDungeonDetailsByName = useMythicDungeonDetails('us');

  const summary = useMemo(
    () => summarizeMythicPlus(mythicPlus, region, periods, mplusDungeonDetailsByName),
    [mplusDungeonDetailsByName, mythicPlus, periods, region]
  );

  const formatRelative = (timestamp: number) => {
    if (!timestamp || timestamp <= 0) return 'Unknown time';
    const deltaMs = Date.now() - timestamp;
    if (deltaMs <= 0) return 'Just now';
    const hours = Math.floor(deltaMs / (60 * 60 * 1000));
    if (hours < 24) return `${hours || 1}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };
  useMemo(() => {
    const out: Record<string, number> = {};
    for (const detail of Object.values(mplusDungeonDetailsByName || {})) {
      const name = String(detail?.name || '')
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, ' ')
        .replace(/[^a-z0-9 ]+/g, '')
        .replace(/\s+/g, ' ');
      const timerMs = detail?.keystone_upgrades?.find(
        (upgrade) => Number(upgrade?.upgrade_level) === 1
      )?.qualifying_duration;
      if (name && Number(timerMs) > 0) out[name] = Math.round(Number(timerMs) / 1000);
    }
    return out;
  }, [mplusDungeonDetailsByName]);
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-xs font-bold tracking-wider text-zinc-500 uppercase">Mythic+</h3>
          <div className="inline-flex rounded-md border border-white/10 bg-black/20 p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`rounded px-2 py-1 text-[11px] font-bold ${
                activeTab === 'overview'
                  ? 'bg-gold/20 text-gold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('runs')}
              className={`rounded px-2 py-1 text-[11px] font-bold ${
                activeTab === 'runs' ? 'bg-gold/20 text-gold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Recent Runs
            </button>
          </div>
        </div>
        {summary ? (
          activeTab === 'overview' ? (
            <div className="space-y-3">
              <StatRow
                label="Current Score"
                value={summary.score ? summary.score.toLocaleString() : '-'}
              />
              <StatRow label="Best Runs (Period)" value={summary.runs.toString()} />
              <StatRow
                label="Highest Key"
                value={summary.bestLevel ? `+${summary.bestLevel}` : '-'}
              />
              <StatRow label="Top Dungeon" value={summary.bestDungeonName || '-'} />
              <div className="my-2 h-px bg-white/5" />
              <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
                <p className="mb-2 text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
                  Weekly Vault Tracker
                </p>
                <p className="mb-3 text-[11px] text-zinc-400">
                  Completed runs counted:{' '}
                  <span className="font-bold text-zinc-200">{summary.vaultProgressCount}</span>
                </p>
                <div className="space-y-2">
                  {summary.vaultSlots.map((slot) => (
                    <ProgressSlotCard
                      key={slot.slot}
                      slotLabel={`Slot ${slot.slot}`}
                      statusLabel={
                        slot.unlocked
                          ? 'Unlocked'
                          : `${slot.threshold - summary.vaultProgressCount} more`
                      }
                      tone={slot.unlocked ? 'success' : 'neutral'}
                      description={slot.keyLevel ? `Based on +${slot.keyLevel}` : 'Run more keys'}
                      progress={slot.progress}
                      footerRight={
                        summary.hasAnyVaultIlvl && slot.rewardIlvl
                          ? `iLvl ${slot.rewardIlvl}`
                          : undefined
                      }
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>Showing {summary.recentRuns.length} recent runs</span>
                {summary.hasTimedStatusData ? (
                  <span>
                    <span className="text-emerald-300">{summary.timedRuns} timed</span> ·{' '}
                    <span className="text-red-300">{summary.depletedRuns} depleted</span>
                  </span>
                ) : null}
              </div>
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {summary.recentRuns.map((run) => {
                  const runStatus =
                    run.timed === true ? 'Timed' : run.timed === false ? 'Depleted' : null;
                  const statusOrDelta = run.clockDelta || runStatus;
                  return (
                    <div
                      key={run.id}
                      className="rounded-md border border-white/5 bg-white/[0.02] p-2.5"
                    >
                      <div className="flex items-center gap-2">
                        {run.timed !== null ? (
                          <span
                            className={`h-7 w-1.5 shrink-0 rounded-full ${
                              run.timed
                                ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]'
                                : 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.6)]'
                            }`}
                          />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-semibold text-zinc-100">
                            {run.dungeon} <span className="text-gold font-mono">+{run.level}</span>
                          </p>
                          <p className="text-[10px] text-zinc-500">{formatRelative(run.timestamp)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-[11px] text-zinc-200">{run.duration}</p>
                          {statusOrDelta ? (
                            <p
                              className={`text-[10px] font-bold ${
                                run.timed === true
                                  ? 'text-emerald-300'
                                  : run.timed === false
                                    ? 'text-red-300'
                                    : run.clockDelta?.startsWith('+')
                                      ? 'text-emerald-300'
                                      : run.clockDelta?.startsWith('-')
                                        ? 'text-red-300'
                                        : 'text-zinc-400'
                              }`}
                            >
                              {statusOrDelta}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      {run.members.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {run.members.slice(0, 5).map((member: CharacterRunMember, idx: number) => {
                              const memberName =
                                member?.profile?.name ||
                                member?.character?.name ||
                                member?.character_name ||
                                member?.name ||
                                'Player';
                              const memberRealm =
                                member?.profile?.realm?.slug ||
                                member?.profile?.realm?.name ||
                                member?.character?.realm?.slug ||
                                member?.character?.realm?.name ||
                                member?.realm ||
                                '';
                              const memberClass =
                                member?.profile?.character_class?.name ||
                                member?.specialization?.name ||
                                member?.character_class?.name ||
                                (typeof member?.class === 'object'
                                  ? member.class?.name
                                  : member?.class) ||
                                '';
                              const memberProfile = getMemberProfileHref(member, region);
                              const memberLabel = `${memberName}${memberClass ? ` (${memberClass})` : ''}`;
                              return memberProfile ? (
                                memberProfile.external ? (
                                  <a
                                    key={`${memberName}-${idx}`}
                                    href={memberProfile.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:border-gold/40 hover:text-gold rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-zinc-300 transition-colors"
                                    title={`Open ${memberName} profile`}
                                  >
                                    {memberLabel}
                                    {memberRealm ? ` - ${memberRealm}` : ''}
                                  </a>
                                ) : (
                                  <Link
                                    key={`${memberName}-${idx}`}
                                    href={memberProfile.href}
                                    className="hover:border-gold/40 hover:text-gold rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-zinc-300 transition-colors"
                                    title={`Open ${memberName} profile`}
                                  >
                                    {memberLabel}
                                    {memberRealm ? ` - ${memberRealm}` : ''}
                                  </Link>
                                )
                              ) : (
                                <span
                                  key={`${memberName}-${idx}`}
                                  className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-zinc-300"
                                >
                                  {memberLabel}
                                  {memberRealm ? ` - ${memberRealm}` : ''}
                                </span>
                              );
                            })}
                          {run.members.length > 5 && (
                            <span className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-zinc-400">
                              +{run.members.length - 5} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )
        ) : (
          <p className="text-[11px] text-zinc-600 italic">Mythic+ data unavailable.</p>
        )}
      </div>
      <RaiderIoMythicPlusCard state={raiderIo} onRefresh={onRefreshIntegrations} />
    </div>
  );
}

function RaidSectionCard({
  raidEncounters,
  region,
  periods,
  activeRaidInstanceIds,
  raiderIo,
  warcraftLogs,
  onRefreshIntegrations,
}: {
  raidEncounters: RaidEncountersPayload;
  region: string;
  periods?: Array<Record<string, unknown>>;
  activeRaidInstanceIds?: number[];
  realm: string;
  name: string;
  raiderIo: CharacterIntegrationState<RaiderIoData> | null;
  warcraftLogs: CharacterIntegrationState<WarcraftLogsData> | null;
  onRefreshIntegrations?: () => void;
}) {
  const [selectedExpansion, setSelectedExpansion] = useState<string>('all');
  const [hasInitializedExpansion, setHasInitializedExpansion] = useState(false);

  const expansionOptions = useMemo(() => getRaidExpansionOptions(raidEncounters), [raidEncounters]);

  useEffect(() => {
    const latestExpansion = [...expansionOptions].reverse().find((opt) => opt.key !== 'all');
    if (!latestExpansion) {
      setSelectedExpansion('all');
      return;
    }
    if (
      !hasInitializedExpansion ||
      !expansionOptions.some((opt) => opt.key === selectedExpansion)
    ) {
      setSelectedExpansion(latestExpansion.key);
    }
    setHasInitializedExpansion(true);
  }, [expansionOptions, hasInitializedExpansion, selectedExpansion]);

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-xs font-bold tracking-wider text-zinc-500 uppercase">Raid</h3>
          <div className="flex items-center gap-2">
            <select
              aria-label="Raid expansion"
              value={selectedExpansion}
              onChange={(e) => setSelectedExpansion(e.target.value)}
              className="input-field h-9 w-full px-2 py-1 text-[11px] text-zinc-100 sm:w-[180px]"
              style={{ colorScheme: 'dark' }}
            >
              {expansionOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
          <RaidProgressCard
            raidEncounters={raidEncounters}
            embedded
            region={region}
            periods={periods}
            activeRaidInstanceIds={activeRaidInstanceIds}
            selectedExpansion={selectedExpansion}
            selectedRaidName="all"
            warcraftLogs={
              warcraftLogs?.snapshot?.status === 'ok' ? warcraftLogs.snapshot.data : null
            }
          />
        </div>
      </div>
      <RaidIntegrationCards
        raiderIo={raiderIo}
        warcraftLogs={warcraftLogs}
        onRefresh={onRefreshIntegrations}
      />
    </div>
  );
}

function RaidProgressCard({
  raidEncounters,
  embedded = false,
  region,
  periods,
  activeRaidInstanceIds,
  selectedExpansion = 'all',
  selectedRaidName = 'all',
  onActiveRaidNameChange,
  warcraftLogs,
}: {
  raidEncounters: RaidEncountersPayload;
  embedded?: boolean;
  region?: string;
  periods?: Array<Record<string, unknown>>;
  activeRaidInstanceIds?: number[];
  selectedExpansion?: string;
  selectedRaidName?: string;
  onActiveRaidNameChange?: (raidName: string | null) => void;
  warcraftLogs?: WarcraftLogsData | null;
}) {
  const raids = useMemo(() => {
    if (!raidEncounters || typeof raidEncounters !== 'object') return [];
    const expansions = Array.isArray(raidEncounters.expansions) ? raidEncounters.expansions : [];
    const byName = new Map<
      string,
      {
        name: string;
        expansionKey: string;
        expansionLabel: string;
        placeholderExpansion?: boolean;
        normal: string;
        heroic: string;
        mythic: string;
        lfr: string;
      }
    >();

    const mergeProgress = (a: string, b: string) => {
      const parse = (v: string) => {
        const m = /^(\d+)\/(\d+)$/.exec(v || '');
        if (!m) return null;
        return { k: Number(m[1]), t: Number(m[2]) };
      };
      const pa = parse(a);
      const pb = parse(b);
      if (!pa) return b;
      if (!pb) return a;
      if (pb.t > pa.t) return b;
      if (pb.t < pa.t) return a;
      return pb.k > pa.k ? b : a;
    };

    const flattened: Array<{
      name: string;
      expansionKey: string;
      expansionLabel: string;
      placeholderExpansion?: boolean;
      normal: string;
      heroic: string;
      mythic: string;
      lfr: string;
    }> = [];

    const normalize = (value: unknown) =>
      String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-');

    const canonicalExpansionKey = (value: string | null) => {
      if (isCurrentExpansionPlaceholder(value || '')) return 'current-expansion';
      return normalize(value);
    };

    const canonicalExpansionLabel = (value: string | null) => {
      const raw = (value || '').trim();
      if (!raw) return 'Unknown expansion';
      if (isCurrentExpansionPlaceholder(raw)) return 'Current expansion';
      return raw;
    };

    const isPlaceholderExpansion = (value: string | null) => {
      return isCurrentExpansionPlaceholder(value || '');
    };

    for (const exp of expansions) {
      const rawExpansionLabel =
        exp?.expansion?.name || exp?.expansion_name || exp?.label || exp?.name || null;
      const expansionLabel = canonicalExpansionLabel(rawExpansionLabel);
      // Keep filtering stable even when backend keys/slugs are inconsistent:
      // use the same canonical label for both display and grouping/filter keys.
      const expansionKey = normalize(expansionLabel) || canonicalExpansionKey(rawExpansionLabel);
      const instances = Array.isArray(exp?.instances) ? exp.instances : [];
      for (const inst of instances) {
        if (!raidMatchesActiveIds(inst, activeRaidInstanceIds)) continue;
        const modes = Array.isArray(inst?.modes) ? inst.modes : [];
        const getMode = (modeName: string) =>
          modes.find((mode: RaidMode) => {
            const difficulty =
              mode?.difficulty && typeof mode.difficulty === 'object'
                ? mode.difficulty.type || mode.difficulty.name
                : mode?.difficulty;
            return String(difficulty || '').toLowerCase() === modeName;
          });
        const fmtProgress = (mode: RaidMode | undefined) => {
          const p = mode?.progress;
          const k = Number(p?.encounters_defeated ?? p?.completed_count ?? 0);
          const t = Number(p?.total_encounters ?? p?.total_count ?? 0);
          return t > 0 ? `${k}/${t}` : '-';
        };

        flattened.push({
          name: inst?.instance?.name || inst?.name || 'Raid',
          expansionKey: expansionKey || 'unknown-expansion',
          expansionLabel: expansionLabel || 'Unknown expansion',
          // Track whether this row came from a generic "current season/expansion" bucket.
          placeholderExpansion: isPlaceholderExpansion(rawExpansionLabel),
          normal: fmtProgress(getMode('normal')),
          heroic: fmtProgress(getMode('heroic')),
          mythic: fmtProgress(getMode('mythic')),
          lfr: fmtProgress(getMode('lfr')),
        });
      }
    }
    const byRaidNameHasConcrete = new Set(
      flattened
        .filter((row) => !row.placeholderExpansion && row.expansionKey !== 'unknown-expansion')
        .map((row) => row.name.trim().toLowerCase().replace(/\s+/g, ' '))
    );

    for (const raid of flattened) {
      const normalizedRaidName = raid.name.trim().toLowerCase().replace(/\s+/g, ' ');
      if (raid.placeholderExpansion && byRaidNameHasConcrete.has(normalizedRaidName)) {
        // Prefer concrete expansion labels over generic current-season placeholders.
        continue;
      }
      const key = `${raid.expansionKey}::${normalizedRaidName}`;
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, raid);
        continue;
      }
      existing.lfr = mergeProgress(existing.lfr, raid.lfr);
      existing.normal = mergeProgress(existing.normal, raid.normal);
      existing.heroic = mergeProgress(existing.heroic, raid.heroic);
      existing.mythic = mergeProgress(existing.mythic, raid.mythic);
    }

    return Array.from(byName.values());
  }, [activeRaidInstanceIds, raidEncounters]);

  const visibleRaids = useMemo(
    () =>
      raids.filter(
        (raid) => selectedExpansion === 'all' || raid.expansionKey === selectedExpansion
      ),
    [raids, selectedExpansion]
  );

  const content = (
    <>
      {!embedded && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {!embedded && (
            <h3 className="text-xs font-bold tracking-wider text-zinc-500 uppercase">
              Raid Progress
            </h3>
          )}
        </div>
      )}
      {visibleRaids.length > 0 ? (
        <RaidProgressionGrid
          raidEncounters={raidEncounters}
          region={region}
          periods={periods}
          activeRaidInstanceIds={activeRaidInstanceIds}
          selectedExpansion={selectedExpansion}
          selectedRaidName={selectedRaidName}
          onActiveRaidNameChange={onActiveRaidNameChange}
          warcraftLogs={warcraftLogs}
        />
      ) : (
        <p className="text-[11px] text-zinc-600 italic">
          Raid progression data unavailable for the selected filter.
        </p>
      )}
    </>
  );

  if (embedded) return content;
  return <div className="card p-5">{content}</div>;
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[13px]">
      <span className="text-zinc-400">{label}</span>
      <span className="font-mono font-bold text-zinc-200">{value}</span>
    </div>
  );
}

function StatsCard({ statistics }: { statistics: CharacterStatisticsPayload }) {
  const stats = useMemo(() => {
    if (!statistics) return [];
    const statsObj = statistics as Record<string, unknown>;
    type StatValue =
      | number
      | {
          effective?: number;
          value?: number;
          percent?: number;
          rating_bonus?: number;
          rating_normalized?: number;
          rating?: number;
        };

    const getEffectiveValue = (stat?: StatValue) => {
      if (typeof stat === 'number') return stat.toLocaleString();
      if (typeof stat?.effective === 'number') return Math.round(stat.effective).toLocaleString();
      if (typeof stat?.value === 'number') return Math.round(stat.value).toLocaleString();
      return '0';
    };

    const getPercentValue = (stat?: StatValue, rating?: StatValue) => {
      const statObj =
        stat && typeof stat === 'object' ? (stat as Exclude<StatValue, number>) : null;
      const ratingObj =
        rating && typeof rating === 'object' ? (rating as Exclude<StatValue, number>) : null;
      const p =
        (typeof stat === 'number' ? stat : null) ??
        (typeof statObj?.value === 'number' ? statObj.value : null) ??
        (typeof statObj?.percent === 'number' ? statObj.percent : null) ??
        (typeof statObj?.rating_bonus === 'number' ? statObj.rating_bonus : null) ??
        (typeof stat === 'number' ? stat : null);
      if (p === null) return null;

      const r =
        (typeof ratingObj?.rating_normalized === 'number' ? ratingObj.rating_normalized : null) ??
        (typeof ratingObj?.rating === 'number' ? ratingObj.rating : null) ??
        (typeof rating === 'number' ? rating : null);
      const percStr = p.toFixed(2) + '%';
      return r !== null ? `${Math.round(r)} (${percStr})` : percStr;
    };

    // Find the relevant primary stat (Int/Agi/Str)
    const mainStat =
      (statsObj.intellect as StatValue | undefined) ||
      (statsObj.agility as StatValue | undefined) ||
      (statsObj.strength as StatValue | undefined);

    // Find the relevant crit/haste/mastery (they are usually mirrored in modern WoW, but we pick the best one)
    const crit =
      (statsObj.melee_crit as StatValue | undefined) ||
      (statsObj.spell_crit as StatValue | undefined) ||
      (statsObj.ranged_crit as StatValue | undefined) ||
      (statsObj.crit as StatValue | undefined);
    const haste =
      (statsObj.melee_haste as StatValue | undefined) ||
      (statsObj.spell_haste as StatValue | undefined) ||
      (statsObj.ranged_haste as StatValue | undefined) ||
      (statsObj.haste as StatValue | undefined);
    const mastery = statsObj.mastery as StatValue | undefined;
    const versatility =
      (statsObj.versatility_offensive_modifier as StatValue | undefined) ||
      (statsObj.versatility as StatValue | undefined);

    return [
      { label: 'Main Stat', value: getEffectiveValue(mainStat) },
      { label: 'Stamina', value: getEffectiveValue(statsObj.stamina as StatValue | undefined) },
      null,
      { label: 'Crit', value: getPercentValue(crit, crit) ?? '0.0%' },
      { label: 'Haste', value: getPercentValue(haste, haste) ?? '0.0%' },
      { label: 'Mastery', value: getPercentValue(mastery, mastery) ?? '0.0%' },
      {
        label: 'Versatility',
        value:
          getPercentValue(versatility, statsObj.versatility as StatValue | undefined) ?? '0.0%',
      },
    ];
  }, [statistics]);

  if (!statistics) {
    return (
      <div className="card p-5 opacity-40">
        <h1 className="mb-2 text-xs font-bold tracking-wider text-zinc-500 uppercase">
          Attributes
        </h1>
        <p className="text-[11px] text-zinc-600 italic">Loading attributes...</p>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <h3 className="mb-4 text-xs font-bold tracking-wider text-zinc-500 uppercase">Attributes</h3>
      <div className="space-y-2">
        {stats.map((s, i) =>
          s === null ? (
            <div key={`sep-${i}`} className="my-3 h-px bg-white/5" />
          ) : (
            <div key={s.label} className="flex justify-between text-[13px]">
              <span className="text-zinc-400">{s.label}</span>
              <span className="font-mono font-bold text-zinc-200">{s.value}</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function TalentsCard({
  activeSpec,
  activeLoadout,
  talentString,
  specId,
  tree,
  latestSimcInput,
}: {
  activeSpec: CharacterSpecialization | null;
  activeLoadout: CharacterTalentLoadout | null;
  talentString: string | null;
  specId: number | null;
  tree: TalentTreeData | null;
  latestSimcInput?: string | null;
}) {
  const loading = specId !== null && !tree;
  const [collapsed, setCollapsed] = useState(false);
  const simcLoadouts = useMemo(() => {
    if (!latestSimcInput) return [] as TalentLoadoutParsed[];
    const parsed = parseTalentLoadouts(latestSimcInput);
    const seen = new Set<string>();
    const out: TalentLoadoutParsed[] = [];
    for (const loadout of parsed) {
      const key = String(loadout.talentString || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(loadout);
    }
    return out;
  }, [latestSimcInput]);
  const [selectedSimcTalent, setSelectedSimcTalent] = useState('');
  useEffect(() => {
    if (simcLoadouts.length === 0) {
      setSelectedSimcTalent('');
      return;
    }
    const active =
      simcLoadouts.find((l) => l.isActive)?.talentString || simcLoadouts[0]?.talentString || '';
    setSelectedSimcTalent(active);
  }, [simcLoadouts]);
  const displayedTalentString = selectedSimcTalent || talentString;

  if (!activeSpec) {
    return (
      <div className="card p-5 opacity-40">
        <h1 className="mb-2 text-xs font-bold tracking-wider text-zinc-500 uppercase">Talents</h1>
        <p className="text-[11px] text-zinc-600 italic">
          Talent data unavailable for this character (Privacy settings or 404).
        </p>
      </div>
    );
  }

  const talentNames = [
    ...(activeLoadout?.selected_class_talents || []),
    ...(activeLoadout?.selected_spec_talents || []),
    ...(activeLoadout?.selected_hero_talents || []),
    ...(activeSpec?.talents || []),
  ]
    .map((talent: CharacterTalentSelection) => talent.tooltip_spell?.name || talent.talent?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-white/5 bg-white/[0.01] p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-xs font-bold tracking-wider text-zinc-500 uppercase">
              Specialization:{' '}
              <span className="text-gold">{activeSpec.specialization?.name || 'Unknown'}</span>
            </h1>
            {simcLoadouts.length > 1 && (
              <select
                value={selectedSimcTalent}
                onChange={(e) => setSelectedSimcTalent(e.target.value)}
                className="input-field h-8 w-full min-w-0 px-2 py-1 text-[11px] font-bold text-zinc-100 sm:w-auto sm:min-w-[180px]"
                style={{ colorScheme: 'dark' }}
              >
                {simcLoadouts.map((loadout, idx) => (
                  <option key={`${loadout.name}-${idx}`} value={loadout.talentString}>
                    {loadout.name}
                    {loadout.isActive ? ' (active)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-2">
            {loading && (
              <div className="border-gold h-3 w-3 animate-spin rounded-full border-2 border-t-transparent" />
            )}
            {displayedTalentString && (
              <Link
                href={`/talent-playground?talent=${encodeURIComponent(displayedTalentString)}&name=${encodeURIComponent('Character Build')}`}
                className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-bold text-zinc-300 hover:bg-white/10 hover:text-white"
              >
                Playground
              </Link>
            )}
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-bold text-zinc-300 hover:bg-white/10 hover:text-white"
            >
              {collapsed ? 'Expand' : 'Collapse'}
            </button>
          </div>
        </div>
      </div>

      {!collapsed ? (
        displayedTalentString ? (
          <div className="bg-black/20 p-2 lg:max-h-[620px] lg:overflow-y-auto">
            <div
              className="origin-top scale-100 transform transition-opacity duration-500"
              style={{ opacity: loading ? 0.3 : 1 }}
            >
              <TalentTree talentString={displayedTalentString} specId={specId ?? undefined} bare />
            </div>
          </div>
        ) : (
          <div className="p-5">
            <div className="flex flex-wrap gap-1.5">
              {talentNames.length > 0 ? (
                talentNames.map((name: string, i: number) => (
                  <span
                    key={`${name}-${i}`}
                    className="rounded-md bg-white/[0.03] px-2 py-1 text-[10px] font-bold text-zinc-400 ring-1 ring-white/5 ring-inset"
                  >
                    {name}
                  </span>
                ))
              ) : (
                <p className="text-[11px] text-zinc-600 italic">No talent data available</p>
              )}
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

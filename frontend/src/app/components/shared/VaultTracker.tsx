'use client';

import { useEffect, useMemo, useState } from 'react';
import { RAID_VAULT_THRESHOLDS } from '../../lib/game-rules';
import type { MythicPlusPayload, RaidEncountersPayload } from '../../lib/character-domain-types';
import {
  computeMythicVaultProgress,
  getMythicVaultRewardIlvls,
  getRaidInstanceIds,
  getRaidVaultRewardIlvls,
  getRaidVaultSlotRewardIlvl,
  getWeeklyVaultActivity,
  type RaidDifficultyKey,
  type WeeklyVaultActivity,
} from '../../lib/character-panel-utils';
import { API_URL, fetchJson } from '../../lib/api';
import ProgressSlotCard from './ProgressSlotCard';
import VaultActivityList, { VaultActivitySummary } from './VaultActivityList';

export type VaultTrackerData = {
  vaultActivity: WeeklyVaultActivity;
  mythicSlots: VaultSlot[];
  raidSlots: VaultSlot[];
  mythicRunsForVault: number;
  raidBossesThisWeek: number;
};

type VaultSlot = {
  slot: number;
  threshold: number;
  unlocked: boolean;
  remaining: number;
  progress: number;
  rewardIlvl: number | null;
};

export function useVaultTrackerData({
  mythicPlus,
  raidEncounters,
  region,
  periods,
  activeRaidInstanceIds,
}: {
  mythicPlus?: MythicPlusPayload;
  raidEncounters: RaidEncountersPayload;
  region?: string;
  periods?: Array<Record<string, unknown>>;
  activeRaidInstanceIds?: number[];
}): VaultTrackerData {
  const raidDropInstanceIds = useMemo(
    () => getRaidInstanceIds(raidEncounters, activeRaidInstanceIds),
    [activeRaidInstanceIds, raidEncounters]
  );
  const [raidRewardIlvls, setRaidRewardIlvls] = useState<Record<RaidDifficultyKey, number>>(
    {} as Record<RaidDifficultyKey, number>
  );
  const [mythicRewardIlvls, setMythicRewardIlvls] = useState<Record<number, number>>({});
  const [vaultUpgradeTracks, setVaultUpgradeTracks] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchJson<unknown>(`${API_URL}/api/season-config`),
      fetchJson<unknown>(`${API_URL}/api/upgrade-tracks`),
    ])
      .then(([seasonConfig, upgradeTracks]) => {
        if (!cancelled) {
          setVaultUpgradeTracks(upgradeTracks);
          setMythicRewardIlvls(getMythicVaultRewardIlvls(seasonConfig, upgradeTracks));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVaultUpgradeTracks(null);
          setMythicRewardIlvls({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (raidDropInstanceIds.length === 0) {
      setRaidRewardIlvls({} as Record<RaidDifficultyKey, number>);
      return () => {
        cancelled = true;
      };
    }

    fetchJson<unknown>(`${API_URL}/api/instances/drops?ids=${raidDropInstanceIds.join(',')}`)
      .then((response) => {
        if (!cancelled) setRaidRewardIlvls(getRaidVaultRewardIlvls(response, vaultUpgradeTracks));
      })
      .catch(() => {
        if (!cancelled) setRaidRewardIlvls({} as Record<RaidDifficultyKey, number>);
      });

    return () => {
      cancelled = true;
    };
  }, [raidDropInstanceIds, vaultUpgradeTracks]);

  const vaultActivity = useMemo(
    () =>
      getWeeklyVaultActivity(
        mythicPlus ?? {},
        raidEncounters,
        region,
        periods,
        activeRaidInstanceIds
      ),
    [activeRaidInstanceIds, mythicPlus, periods, raidEncounters, region]
  );
  const mythicVaultProgress = useMemo(
    () => computeMythicVaultProgress(mythicPlus ?? {}, region, periods, mythicRewardIlvls),
    [mythicPlus, mythicRewardIlvls, periods, region]
  );
  const raidBossesThisWeek = vaultActivity.raidKills;
  const raidSlots = useMemo(
    () =>
      RAID_VAULT_THRESHOLDS.map((threshold, index) => ({
        slot: index + 1,
        threshold,
        unlocked: raidBossesThisWeek >= threshold,
        remaining: Math.max(0, threshold - raidBossesThisWeek),
        progress: Math.min(1, raidBossesThisWeek / threshold),
        rewardIlvl: getRaidVaultSlotRewardIlvl(
          vaultActivity.raidBosses,
          threshold,
          raidRewardIlvls
        ),
      })),
    [raidBossesThisWeek, raidRewardIlvls, vaultActivity.raidBosses]
  );

  return {
    vaultActivity,
    mythicRunsForVault: mythicVaultProgress.runsForVault,
    raidBossesThisWeek,
    mythicSlots: mythicVaultProgress.slots,
    raidSlots,
  };
}

export default function VaultTrack({
  kind,
  data,
  className = '',
  showHeader = true,
}: {
  kind: 'mythic' | 'raid';
  data: VaultTrackerData;
  className?: string;
  showHeader?: boolean;
}) {
  const isMythic = kind === 'mythic';
  const slots = isMythic ? data.mythicSlots : data.raidSlots;
  const count = isMythic ? data.mythicRunsForVault : data.raidBossesThisWeek;

  const renderSlot = (slot: VaultSlot) => {
    const progressCard = (
      <ProgressSlotCard
        slotLabel={`Slot ${slot.slot}`}
        statusLabel={slot.unlocked ? 'Unlocked' : isMythic ? 'Locked' : `${slot.remaining} more`}
        tone={slot.unlocked ? 'success' : 'neutral'}
        description={
          isMythic
            ? slot.unlocked
              ? `Based on ${count} runs`
              : `${slot.remaining} more runs`
            : slot.unlocked
              ? `Based on ${count} boss kills`
              : `Requires ${slot.threshold} boss kills`
        }
        progress={slot.progress}
        footerRight={slot.rewardIlvl ? `iLvl ${slot.rewardIlvl}` : undefined}
        className="h-full"
      />
    );

    if (isMythic) {
      return (
        <VaultActivityList
          key={`mplus-${slot.slot}`}
          kind="mythic"
          label={`Mythic+ Slot ${slot.slot}`}
          items={data.vaultActivity.mythicRuns}
          maxItems={slot.threshold}
          className="h-full"
        >
          {progressCard}
        </VaultActivityList>
      );
    }

    return (
      <VaultActivityList
        key={`raid-${slot.slot}`}
        kind="raid"
        label={`Raid Slot ${slot.slot}`}
        items={data.vaultActivity.raidBosses}
        displayItems={data.vaultActivity.raidBossesForDisplay}
        className="h-full"
      >
        {progressCard}
      </VaultActivityList>
    );
  };

  return (
    <div className={className.trim()}>
      {showHeader ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
            Weekly Vault Tracker{isMythic ? '' : ' (Raid)'}
          </h4>
          <span className="text-[10px] text-zinc-500">
            {isMythic ? `${count} runs counted` : `${count} bosses this week`}
          </span>
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">{slots.map(renderSlot)}</div>
      <VaultActivitySummary kind={kind} count={count} />
    </div>
  );
}

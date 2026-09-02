import SectionCard from '../shared/SectionCard';
import type {
  CharacterProfilePayload,
  CharacterProfessionsPayload,
  MythicPlusPayload,
  RaidEncountersPayload,
} from '../../lib/character-domain-types';
import {
  getCharacterValueLabel,
  parseCharacterProfessions,
  summarizeCurrentRaidProgress,
  summarizeMythicPlus,
} from '../../lib/character-panel-utils';

type CharacterOverviewCardProps = {
  profile: CharacterProfilePayload;
  activeSpecName?: string | null;
  professions: CharacterProfessionsPayload;
  mythicPlus: MythicPlusPayload;
  raidEncounters: RaidEncountersPayload;
  region: string;
  periods?: Array<Record<string, unknown>>;
  activeRaidInstanceIds?: number[];
  layout?: 'grid' | 'stacked';
};

function numberOrNull(value: unknown): number | null {
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

function formatNumber(value: number | null): string {
  return value === null ? 'Unavailable' : value.toLocaleString();
}

function OverviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-[13px]">
      <span className="text-zinc-400">{label}</span>
      <span className="text-right font-mono font-bold text-zinc-200">{value}</span>
    </div>
  );
}

function professionValue(profession: ReturnType<typeof parseCharacterProfessions>[number]): string {
  if (profession.skillPoints === null) return 'Unavailable';
  if (profession.maxSkillPoints === null) return profession.skillPoints.toLocaleString();
  return `${profession.skillPoints.toLocaleString()}/${profession.maxSkillPoints.toLocaleString()}`;
}

export default function CharacterOverviewCard({
  profile,
  activeSpecName,
  professions,
  mythicPlus,
  raidEncounters,
  region,
  periods,
  activeRaidInstanceIds,
  layout = 'grid',
}: CharacterOverviewCardProps) {
  const mythicSummary = summarizeMythicPlus(mythicPlus, region, periods);
  const raidSummary = summarizeCurrentRaidProgress(
    raidEncounters,
    region,
    periods,
    activeRaidInstanceIds
  );
  const primaryProfessions = parseCharacterProfessions(professions, 'primaries');
  const secondaryProfessions = parseCharacterProfessions(professions, 'secondaries');
  const profileDetails = [
    {
      label: 'Specialization',
      value: activeSpecName || getCharacterValueLabel(profile.active_spec),
    },
    { label: 'Faction', value: getCharacterValueLabel(profile.faction) },
    { label: 'Guild', value: getCharacterValueLabel(profile.guild) },
    {
      label: 'Achievement points',
      value: numberOrNull(profile.achievement_points)?.toLocaleString() || null,
    },
  ].filter((detail): detail is { label: string; value: string } => Boolean(detail.value));

  const equippedItemLevel = numberOrNull(profile.equipped_item_level);
  const averageItemLevel = numberOrNull(profile.average_item_level);
  const vaultSlots = mythicSummary?.vaultSlots || [];
  const unlockedVaultSlots = vaultSlots.filter((slot) => slot.unlocked).length;
  const raidProgress = raidSummary
    ? `${raidSummary.clearedBosses}/${raidSummary.totalBosses} bosses cleared`
    : 'Unavailable';
  const weeklyVault = mythicSummary
    ? `${mythicSummary.vaultProgressCount} runs · ${unlockedVaultSlots}/${vaultSlots.length} slots`
    : 'Unavailable';

  return (
    <div className={`grid grid-cols-1 gap-4 ${layout === 'grid' ? 'lg:grid-cols-3' : ''}`}>
      <SectionCard title="Character overview" variant="card" className="lg:col-span-1">
        <div className="space-y-2">
          {profileDetails.length > 0 ? (
            profileDetails.map((detail) => (
              <OverviewRow key={detail.label} label={detail.label} value={detail.value} />
            ))
          ) : (
            <p className="text-[11px] text-zinc-600 italic">
              Additional profile details unavailable.
            </p>
          )}
          <div className="my-3 h-px bg-white/5" />
          <OverviewRow label="Equipped item level" value={formatNumber(equippedItemLevel)} />
          <OverviewRow label="Average item level" value={formatNumber(averageItemLevel)} />
        </div>
      </SectionCard>

      <SectionCard title="Activity" variant="card" className="lg:col-span-1">
        <div className="space-y-2">
          <OverviewRow
            label="Mythic+ score"
            value={mythicSummary?.score?.toLocaleString() || 'Unavailable'}
          />
          <OverviewRow
            label="Highest key"
            value={mythicSummary?.bestLevel ? `+${mythicSummary.bestLevel}` : 'Unavailable'}
          />
          <OverviewRow
            label="Top dungeon"
            value={mythicSummary?.bestDungeonName || 'Unavailable'}
          />
          <OverviewRow label="Weekly vault" value={weeklyVault} />
          <div className="my-3 h-px bg-white/5" />
          <OverviewRow
            label={raidSummary?.expansionLabel || 'Current-season raid'}
            value={raidProgress}
          />
          {raidSummary ? (
            <OverviewRow label="Raid kills this week" value={String(raidSummary.weeklyBossKills)} />
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title="Professions" variant="card" className="lg:col-span-1">
        <div className="space-y-2">
          {primaryProfessions.map((profession) => (
            <OverviewRow
              key={`primary-${profession.name}`}
              label={`Primary · ${profession.name}`}
              value={professionValue(profession)}
            />
          ))}
          {secondaryProfessions.map((profession) => (
            <OverviewRow
              key={`secondary-${profession.name}`}
              label={`Secondary · ${profession.name}`}
              value={professionValue(profession)}
            />
          ))}
          {primaryProfessions.length === 0 && secondaryProfessions.length === 0 ? (
            <p className="text-[11px] text-zinc-600 italic">Profession data unavailable.</p>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}

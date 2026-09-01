'use client';

interface StatWeightsTableProps {
  statWeights: Record<string, number>;
}

const STAT_DISPLAY_NAMES: Record<string, string> = {
  intellect: 'Intellect',
  strength: 'Strength',
  agility: 'Agility',
  stamina: 'Stamina',
  crit_rating: 'Critical Strike',
  haste_rating: 'Haste',
  mastery_rating: 'Mastery',
  versatility_rating: 'Versatility',
  weapon_dps: 'Weapon DPS',
};

export default function StatWeightsTable({ statWeights }: StatWeightsTableProps) {
  const entries = Object.entries(statWeights)
    .map(([key, value]) => ({
      stat: STAT_DISPLAY_NAMES[key] || key.replace(/_/g, ' '),
      weight: value,
    }))
    .sort((a, b) => b.weight - a.weight);

  const maxWeight =
    entries.length > 0 ? Math.max(...entries.map(({ weight }) => Math.abs(weight)), 1) : 1;

  return (
    <div className="card p-5">
      <div className="mb-5">
        <h3 className="text-muted text-xs font-medium tracking-widest uppercase">Stat Weights</h3>
        <p className="text-muted mt-1 text-[11px]">
          Relative value of one stat point. The strongest reported stat is 100%.
        </p>
      </div>
      {entries.length > 0 ? (
        <div className="space-y-3">
          {entries.map(({ stat, weight }, index) => {
            const relative = (Math.abs(weight) / maxWeight) * 100;
            return (
              <div key={stat}>
                <div className="mb-1.5 flex justify-between gap-3 text-[15px]">
                  <span className="text-gray-300">
                    <span className="text-muted mr-2 text-[11px]">{index + 1}</span>
                    {stat}
                  </span>
                  <span className="font-mono text-white tabular-nums">
                    {weight.toFixed(4)}
                    <span className="text-muted ml-2 text-[11px]">{relative.toFixed(0)}%</span>
                  </span>
                </div>
                <div className="bg-bg h-1 w-full overflow-hidden rounded-full">
                  <div
                    className={`h-full rounded-full transition-all ${weight >= 0 ? 'bg-gold/70' : 'bg-red-400/70'}`}
                    style={{ width: `${relative}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-muted text-sm">No stat weights were reported for this result.</p>
      )}
    </div>
  );
}

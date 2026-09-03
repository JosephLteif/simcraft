'use client';

import { useMemo } from 'react';
import type { TopGearResult } from '../lib/types';
import type { Instance } from '../drop-finder/types';
import { buildDropSourcePriorities } from '../lib/drop-source-priority';

interface DropSourcePriorityProps {
  results: TopGearResult[];
  sourceInstances?: Instance[];
  selectedSourceKey?: string | null;
  onSelectSource: (sourceKey: string | null) => void;
}

export default function DropSourcePriority({
  results,
  sourceInstances = [],
  selectedSourceKey = null,
  onSelectSource,
}: DropSourcePriorityProps) {
  const priorities = useMemo(
    () => buildDropSourcePriorities(results, sourceInstances),
    [results, sourceInstances]
  );
  const selectedPriority = priorities.find((priority) => priority.key === selectedSourceKey);

  if (priorities.length === 0) return null;

  return (
    <section
      data-tour="drop-finder-priority"
      aria-labelledby="drop-source-priority-title"
      className="border-gold/20 bg-gold/[0.035] mb-5 rounded-lg border p-4"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3
            id="drop-source-priority-title"
            className="text-gold text-xs font-bold tracking-[0.18em] uppercase"
          >
            Activity priority
          </h3>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            Click a boss or dungeon to show only its matching rankings. Priority favors more likely
            upgrades, then more unique rewards; DPS gain breaks ties.
          </p>
        </div>
        <span className="text-[11px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">
          {priorities.length} {priorities.length === 1 ? 'source' : 'sources'}
        </span>
      </div>

      {selectedPriority ? (
        <div className="border-gold/30 bg-gold/[0.08] mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs">
          <p className="text-zinc-300">
            Showing <span className="text-gold font-semibold">{selectedPriority.name}</span> only
          </p>
          <button
            type="button"
            onClick={() => onSelectSource(null)}
            className="text-gold border-gold/30 hover:border-gold/60 hover:bg-gold/10 focus-visible:ring-gold/60 rounded border px-2.5 py-1 font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            Show all sources
          </button>
        </div>
      ) : null}

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {priorities.map((priority, index) => {
          const isSelected = priority.key === selectedSourceKey;
          const kindLabel = priority.kind === 'raid' ? 'Raid boss' : 'Dungeon';
          return (
            <button
              key={priority.key}
              type="button"
              aria-label={`Show only ${priority.name} ${kindLabel.toLowerCase()} items`}
              aria-pressed={isSelected}
              title={`Show only ${priority.name} items`}
              onClick={() => onSelectSource(isSelected ? null : priority.key)}
              className={`hover:border-gold/60 focus-visible:ring-gold/60 w-full rounded-md border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none ${
                isSelected
                  ? 'border-gold/60 bg-gold/[0.12] ring-gold/30 ring-1'
                  : index === 0
                    ? 'border-gold/40 bg-gold/[0.08]'
                    : 'border-border/70 bg-surface-2/70'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    isSelected || index === 0 ? 'bg-gold text-black' : 'bg-white/10 text-zinc-300'
                  }`}
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-100" title={priority.name}>
                    {priority.name}
                  </p>
                  <p className="mt-0.5 text-[11px] tracking-[0.14em] text-zinc-500 uppercase">
                    {kindLabel}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg leading-none font-bold text-zinc-100 tabular-nums">
                    {priority.itemCount}
                  </p>
                  <p className="mt-1 text-[10px] tracking-[0.12em] text-zinc-500 uppercase">
                    {priority.itemCount === 1 ? 'item' : 'items'}
                  </p>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className={priority.upgradeCount > 0 ? 'text-emerald-300' : 'text-zinc-500'}>
                  {priority.upgradeCount} likely{' '}
                  {priority.upgradeCount === 1 ? 'upgrade' : 'upgrades'}
                </span>
                {priority.bestDelta > 0 ? (
                  <span className="text-zinc-400">
                    Best +{Math.round(priority.bestDelta).toLocaleString()} DPS
                  </span>
                ) : (
                  <span className="text-zinc-500">No positive DPS gain</span>
                )}
              </div>
              {priority.bestItemName ? (
                <p
                  className="mt-1 truncate text-[11px] text-zinc-500"
                  title={priority.bestItemName}
                >
                  {priority.bestItemName}
                </p>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

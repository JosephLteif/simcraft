import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { WeeklyVaultMythicRun, WeeklyVaultRaidBoss } from '../../lib/character-panel-utils';

type VaultActivityListProps =
  | {
      kind: 'mythic';
      items: WeeklyVaultMythicRun[];
      children: ReactNode;
      className?: string;
      label?: string;
    }
  | {
      kind: 'raid';
      items: WeeklyVaultRaidBoss[];
      children: ReactNode;
      className?: string;
      label?: string;
    };

type VaultActivitySummaryProps = {
  kind: 'mythic' | 'raid';
  count: number;
};

function formatDifficulty(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1).replace(/_/g, ' ');
}

export function VaultActivitySummary({ kind, count }: VaultActivitySummaryProps) {
  const isMythic = kind === 'mythic';

  return (
    <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-zinc-400">
      <span
        className={`border-b border-dotted ${isMythic ? 'border-gold/50' : 'border-emerald-400/50'}`}
      >
        {count} {isMythic ? 'runs' : 'boss kills'} this week
      </span>
      <Info className="h-3 w-3" aria-hidden="true" />
    </div>
  );
}

export default function VaultActivityList({
  kind,
  items,
  children,
  className = '',
  label,
}: VaultActivityListProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isMythic = kind === 'mythic';
  const visibleItems = items.slice(0, 8);
  const remainingCount = Math.max(0, items.length - visibleItems.length);

  const toggleOpen = () => setOpen((current) => !current);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      data-vault-activity={kind}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={`Show ${label ? `${label} ` : ''}${isMythic ? 'dungeon run' : 'raid boss kill'} details for this week`}
      onClick={(event) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.closest('[data-vault-activity-panel]')
        ) {
          toggleOpen();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleOpen();
        }
      }}
      className={`group relative min-w-0 ${className}`.trim()}
    >
      {children}

      <div
        data-vault-activity-panel
        role="tooltip"
        className={`${open ? 'pointer-events-auto visible opacity-100' : 'pointer-events-none invisible opacity-0 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100'} absolute bottom-[calc(100%+0.5rem)] left-0 z-30 w-80 max-w-[calc(100vw-2rem)] rounded-lg border p-3 shadow-2xl transition-all duration-150 ${isMythic ? 'border-gold/30 bg-[#17130c]' : 'border-emerald-400/30 bg-[#0b1715]'}`}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-zinc-100">
            {label ? `${label} · ` : ''}
            {isMythic ? 'Dungeon runs this week' : 'Raid boss kills this week'}
          </p>
          <span className={`text-[10px] font-bold ${isMythic ? 'text-gold' : 'text-emerald-300'}`}>
            {items.length}
          </span>
        </div>

        {visibleItems.length > 0 ? (
          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {isMythic
              ? visibleItems.map((item) => {
                  const run = item as WeeklyVaultMythicRun;
                  return (
                    <div
                      key={run.id}
                      data-vault-activity-item
                      className="border-gold/15 flex min-w-0 items-center justify-between gap-3 rounded border bg-black/25 px-2 py-1.5 text-[10px]"
                    >
                      <span className="min-w-0 truncate text-zinc-200">{run.dungeon}</span>
                      <span className="text-gold shrink-0 font-semibold">+{run.level}</span>
                    </div>
                  );
                })
              : visibleItems.map((item) => {
                  const boss = item as WeeklyVaultRaidBoss;
                  const difficulty = boss.difficulties
                    .map(formatDifficulty)
                    .filter(Boolean)
                    .join(' / ');
                  return (
                    <div
                      key={boss.key}
                      data-vault-activity-item
                      className="min-w-0 rounded border border-emerald-400/15 bg-black/25 px-2 py-1.5 text-[10px]"
                    >
                      <p className="truncate text-zinc-200">{boss.boss}</p>
                      <p className="truncate text-zinc-500">
                        {boss.raid}
                        {difficulty ? ` · ${difficulty}` : ''}
                      </p>
                    </div>
                  );
                })}
            {remainingCount > 0 ? (
              <p className="pt-1 text-[10px] text-zinc-500">+{remainingCount} more activities</p>
            ) : null}
          </div>
        ) : (
          <p className="text-[10px] text-zinc-500 italic">
            {isMythic
              ? 'No dungeon runs recorded this week.'
              : 'No raid boss kills recorded this week.'}
          </p>
        )}
      </div>
    </div>
  );
}

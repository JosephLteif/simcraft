import { Check, Circle, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { WeeklyVaultMythicRun, WeeklyVaultRaidBoss } from '../../lib/character-panel-utils';

type VaultActivityListProps =
  | {
      kind: 'mythic';
      items: WeeklyVaultMythicRun[];
      maxItems?: number;
      children: ReactNode;
      className?: string;
      label?: string;
    }
  | {
      kind: 'raid';
      items: WeeklyVaultRaidBoss[];
      displayItems?: WeeklyVaultRaidBoss[];
      maxItems?: number;
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

export default function VaultActivityList(props: VaultActivityListProps) {
  const { kind, items, children, className = '', label } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isMythic = kind === 'mythic';
  const activityItems = kind === 'raid' ? (props.displayItems ?? items) : items;
  const maxItems = isMythic && props.maxItems ? Math.max(1, props.maxItems) : undefined;
  const visibleItems = activityItems.slice(0, maxItems ?? 12);
  const placeholderCount = maxItems ? Math.max(0, maxItems - visibleItems.length) : 0;
  const remainingCount = maxItems ? 0 : Math.max(0, activityItems.length - visibleItems.length);
  const raidGroups = new Map<string, WeeklyVaultRaidBoss[]>();
  if (!isMythic) {
    for (const item of visibleItems) {
      const boss = item as WeeklyVaultRaidBoss;
      const group = raidGroups.get(boss.raid) ?? [];
      group.push(boss);
      raidGroups.set(boss.raid, group);
    }
  }

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
        className={`${open ? 'pointer-events-auto visible opacity-100' : 'pointer-events-none invisible opacity-0 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100'} absolute bottom-[calc(100%+0.5rem)] left-1/2 z-30 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border p-3 shadow-2xl transition-all duration-150 ${isMythic ? 'border-gold/30 bg-[#17130c]' : 'border-emerald-400/30 bg-[#0b1715]'}`}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-zinc-100">
            {isMythic
              ? `Top ${maxItems ?? activityItems.length} runs this week:`
              : 'Bosses killed this week:'}
          </p>
        </div>

        {visibleItems.length > 0 || placeholderCount > 0 ? (
          <>
            {isMythic ? (
              <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {visibleItems.map((item) => {
                  const run = item as WeeklyVaultMythicRun;
                  return (
                    <div
                      key={run.id}
                      data-vault-activity-item
                      className="border-gold/15 flex min-w-0 items-center gap-1.5 rounded border bg-black/25 px-2 py-1.5 text-[10px] text-emerald-300"
                    >
                      <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 truncate">
                        {run.dungeon} ({run.level})
                      </span>
                    </div>
                  );
                })}
                {Array.from({ length: placeholderCount }, (_, index) => (
                  <div
                    key={`placeholder-${index}`}
                    data-vault-activity-item
                    className="flex min-w-0 items-center gap-1.5 rounded border border-white/5 bg-black/15 px-2 py-1.5 text-[10px] text-zinc-600"
                  >
                    <Circle className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>Not yet completed</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid max-h-56 grid-cols-1 gap-x-4 gap-y-3 overflow-y-auto pr-1 sm:grid-cols-2">
                {Array.from(raidGroups.entries()).map(([raid, bosses]) => (
                  <div key={raid} className="min-w-0">
                    <p className="mb-1 truncate text-[10px] font-semibold text-zinc-100">{raid}</p>
                    <div className="space-y-1">
                      {bosses.map((boss) => {
                        const difficulty = boss.difficulties
                          .map(formatDifficulty)
                          .filter(Boolean)
                          .join(' / ');
                        const killedThisWeek = boss.killedThisWeek;
                        return (
                          <div
                            key={boss.key}
                            data-vault-activity-item
                            className={`flex min-w-0 items-start gap-1.5 text-[10px] ${killedThisWeek ? 'text-emerald-300' : 'text-zinc-500'}`}
                          >
                            {killedThisWeek ? (
                              <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                            ) : (
                              <Circle
                                className="mt-0.5 h-3 w-3 shrink-0 text-zinc-600"
                                aria-hidden="true"
                              />
                            )}
                            <span className="min-w-0 truncate">
                              {boss.boss}
                              {difficulty ? ` (${difficulty})` : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {remainingCount > 0 ? (
              <p className="pt-1 text-[10px] text-zinc-500">+{remainingCount} more activities</p>
            ) : null}
          </>
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

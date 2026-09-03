'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Map, X } from 'lucide-react';
import { useSimContext } from './SimContext';
import { SavedRoute } from '../lib/types';
import { parseCharacterInfo } from '@/lib/simc-parser';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { useDismissOnOutside } from '../lib/useDismissOnOutside';
import { useNotifications } from './shared/NotificationSystem';

interface RouteDetailsModalProps {
  route: SavedRoute;
  dungeonDetailsId?: number | null;
  onClose: () => void;
  formatHealth?: (hp: number) => string;
  formatTime?: (s: number) => string;
}

export default function RouteDetailsModal({
  route,
  dungeonDetailsId,
  onClose,
  formatHealth: propFormatHealth,
  formatTime: propFormatTime,
}: RouteDetailsModalProps) {
  useWowheadTooltips();
  const { setSimcFooter } = useSimContext();
  const { notify } = useNotifications();
  const router = useRouter();
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const info = useMemo(() => parseCharacterInfo(route.route_data), [route.route_data]);
  useDismissOnOutside(modalRef, true, onClose);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    modalRef.current?.focus();
    return () => previouslyFocusedRef.current?.focus();
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(route.route_data);
      notify({
        title: 'Route copied',
        description: 'The SimC route data is ready to paste.',
        variant: 'success',
      });
    } catch (error) {
      notify({
        title: 'Could not copy route',
        description: error instanceof Error ? error.message : 'Please copy the route manually.',
        variant: 'error',
      });
    }
  }, [notify, route.route_data]);

  const formatHealth =
    propFormatHealth ||
    ((hp: number) => {
      if (hp >= 1_000_000) return `${(hp / 1_000_000).toFixed(1)}M`;
      if (hp >= 1_000) return `${(hp / 1_000).toFixed(0)}K`;
      return hp.toString();
    });

  const formatTime =
    propFormatTime ||
    ((seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    });

  if (info?.kind !== 'dungeon') {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-label="Route details error"
          tabIndex={-1}
          className="w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-8 text-center shadow-2xl"
        >
          <p className="text-zinc-400">Failed to parse route data.</p>
          <button
            onClick={onClose}
            className="bg-gold mt-4 rounded-xl px-6 py-2 font-bold text-black"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const totalDungeonHealth = info.pulls.reduce((sum, p) => sum + (p.totalHealth || 0), 0);
  const timerSeconds = route.timer_seconds || (info.maxTime ? Number(info.maxTime) : 0);

  const minGroupDps = timerSeconds > 0 ? totalDungeonHealth / timerSeconds : 0;
  // Assume Tank + Healer do 10% of total damage collectively.
  // Then 90% is done by the 3 DPS.
  const minPerDps = minGroupDps > 0 ? (minGroupDps * 0.9) / 3 : 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-0 backdrop-blur-md sm:p-4">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="route-details-title"
        tabIndex={-1}
        className="mobile-modal-shell flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl sm:h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-white/5 bg-white/[0.02] p-4 sm:p-6">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div className="bg-gold/10 text-gold flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl shadow-inner sm:h-12 sm:w-12">
              <Map className="h-6 w-6" strokeWidth={2} />
            </div>
            <div>
              <h2
                id="route-details-title"
                className="max-w-[65vw] truncate text-xl font-black tracking-tight text-white sm:max-w-none sm:text-2xl"
              >
                {route.name}
              </h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-zinc-500 sm:text-sm">
                <span>{route.dungeon}</span>
                <span className="h-1 w-1 rounded-full bg-zinc-800" />
                <span className="text-sky-400">+{route.level} Level</span>
                {dungeonDetailsId ? (
                  <>
                    <span className="h-1 w-1 rounded-full bg-zinc-800" />
                    <button
                      onClick={() => router.push('/dungeons')}
                      className="text-gold hover:text-gold/80 text-xs font-semibold transition-colors hover:underline"
                    >
                      Open Dungeon
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-zinc-400 transition-all hover:bg-white/10 hover:text-white sm:h-9 sm:w-9"
            aria-label="Close route details"
          >
            <X className="h-6 w-6" strokeWidth={2} />
          </button>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-px bg-white/5 sm:grid-cols-3 xl:grid-cols-6">
          <div className="bg-zinc-950 p-4 text-center">
            <p className="text-[10px] font-black tracking-widest text-zinc-600 uppercase">
              Dungeon Timer
            </p>
            <p className="mt-1 text-xl font-bold text-amber-400">
              {timerSeconds > 0 ? formatTime(timerSeconds) : '-'}
            </p>
          </div>
          <div className="bg-zinc-950 p-4 text-center">
            <p className="text-[10px] font-black tracking-widest text-zinc-600 uppercase">
              Total Route HP
            </p>
            <p className="mt-1 text-xl font-bold text-emerald-400">
              {formatHealth(totalDungeonHealth)}
            </p>
          </div>
          <div className="bg-zinc-950 p-4 text-center">
            <p className="text-[10px] font-black tracking-widest text-zinc-600 uppercase">
              Total Pulls
            </p>
            <p className="mt-1 text-xl font-bold text-white">{info.pullCount}</p>
          </div>
          <div className="bg-zinc-950 p-4 text-center">
            <p className="text-[10px] font-black tracking-widest text-zinc-600 uppercase">
              Bloodlust Usage
            </p>
            <p className="mt-1 text-xl font-bold text-red-400">
              {info.pulls.filter((p) => p.bloodlust).length}x
            </p>
          </div>
          <div className="group relative cursor-help bg-zinc-950 p-4 text-center">
            <p className="text-[10px] font-black tracking-widest text-zinc-600 uppercase">
              Min. Group DPS
            </p>
            <p className="mt-1 text-xl font-bold text-sky-400">
              {minGroupDps > 0 ? Math.round(minGroupDps).toLocaleString() : '-'}
            </p>
            <div className="pointer-events-none absolute bottom-full left-1/2 z-[110] mb-2 w-48 -translate-x-1/2 rounded-lg bg-zinc-800 p-2 text-left text-[11px] font-medium text-zinc-200 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
              Calculated as:
              <br />
              <span className="text-emerald-400">
                Total HP ({formatHealth(totalDungeonHealth)})
              </span>{' '}
              / <span className="text-amber-400">Timer ({timerSeconds}s)</span>
            </div>
          </div>
          <div className="group relative cursor-help bg-zinc-950 p-4 text-center">
            <p className="text-[10px] font-black tracking-widest text-zinc-600 uppercase">
              Min. Per DPS (3)
            </p>
            <p className="mt-1 text-xl font-bold text-amber-400">
              {minPerDps > 0 ? Math.round(minPerDps).toLocaleString() : '-'}
            </p>
            <div className="pointer-events-none absolute bottom-full left-1/2 z-[110] mb-2 w-56 -translate-x-1/2 rounded-lg bg-zinc-800 p-2 text-left text-[11px] font-medium text-zinc-200 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
              Assumes 3 DPS players contribute <span className="text-gold">90%</span> of the
              required group damage ({Math.round(minGroupDps * 0.9).toLocaleString()} DPS total),
              while Tank/Healer provide the remaining 10%.
            </div>
          </div>
        </div>

        {/* Pull List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="space-y-4">
            {info.pulls.map((pull, idx) => {
              const hasBoss = pull.enemies.some((e) => e.name.toLowerCase().includes('boss'));
              return (
                <div
                  key={idx}
                  className={`group relative flex overflow-hidden rounded-2xl border transition-all hover:shadow-xl ${hasBoss ? 'border-amber-500/30 bg-amber-500/[0.02]' : 'border-white/5 bg-white/[0.01]'}`}
                >
                  {/* Left Rail (PNum + Lust) */}
                  <div
                    className={`flex w-16 shrink-0 flex-col items-center justify-center border-r p-2 ${hasBoss ? 'border-amber-500/20 bg-amber-500/5' : 'border-white/5 bg-black/20'}`}
                  >
                    <span className="text-xl font-black text-zinc-600">
                      {pull.pull || String(idx + 1).padStart(2, '0')}
                    </span>
                    {pull.bloodlust && (
                      <div className="mt-2 rounded bg-red-500 px-1.5 py-0.5 text-[9px] font-black text-white shadow-lg shadow-red-500/20">
                        LUST
                      </div>
                    )}
                  </div>

                  {/* Body */}
                  <div className="flex flex-1 flex-col p-4 sm:flex-row sm:items-center">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4
                          className={`text-[15px] font-bold ${hasBoss ? 'text-amber-400' : 'text-white'}`}
                        >
                          {pull.name || `Pull ${pull.pull || idx + 1}`}
                        </h4>
                        {hasBoss && (
                          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] font-black text-amber-500">
                            BOSS
                          </span>
                        )}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                        {pull.enemies.map((e, eIdx) => (
                          <div key={eIdx} className="flex items-center gap-1.5 text-[13px]">
                            <span className="font-black text-sky-400">{e.count}x</span>
                            <span className="font-medium text-zinc-300">{e.name}</span>
                            {e.health && (
                              <span className="text-[11px] text-zinc-600">
                                ({formatHealth(e.health)})
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Stats Right */}
                    <div className="mt-4 flex shrink-0 items-center gap-6 border-t border-white/5 pt-4 sm:mt-0 sm:border-0 sm:pt-0">
                      {pull.delay !== null && (
                        <div className="text-right">
                          <p className="text-[9px] font-black tracking-widest text-zinc-600 uppercase">
                            Wait/Travel
                          </p>
                          <p className="font-mono text-sm font-bold text-zinc-400">{pull.delay}s</p>
                        </div>
                      )}
                      <div className="text-right">
                        <p className="text-[9px] font-black tracking-widest text-zinc-600 uppercase">
                          Pull HP
                        </p>
                        <p className="font-mono text-[15px] font-black text-emerald-400">
                          {formatHealth(pull.totalHealth || 0)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-black tracking-widest text-zinc-600 uppercase">
                          Progress
                        </p>
                        <p className="font-mono text-[15px] font-black text-sky-400">
                          {pull.progress ? `${pull.progress}%` : '-'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-white/5 bg-black/40 p-6">
          <div className="flex items-center gap-4 text-xs font-medium text-zinc-500">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full border border-amber-500/40 bg-amber-500/20" />
              <span>Boss Encounter</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded bg-red-500 shadow-sm" />
              <span>Bloodlust Target</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="rounded-xl border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-bold text-zinc-300 transition-all hover:bg-white/10 hover:text-white"
            >
              Copy SimC Data
            </button>
            <button
              onClick={() => {
                setSimcFooter(route.route_data);
                router.push('/quick-sim');
              }}
              className="bg-gold hover:bg-gold/90 hover:shadow-gold/20 rounded-xl px-8 py-2.5 text-sm font-bold text-black transition-all hover:shadow-lg"
            >
              Load into Simulator
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

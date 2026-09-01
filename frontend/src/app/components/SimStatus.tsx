'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Check, Clock3, ListOrdered, Pause, Play, ScrollText } from 'lucide-react';
import { API_URL, pauseSim, resumeSim } from '../lib/api';
import { formatElapsedCompact, formatEta, formatMegabytes } from '../lib/format';

interface StageTiming {
  name: string;
  elapsed: number;
}

interface SimStatusProps {
  status: string;
  progress: number;
  queuePosition?: number | null;
  progressStage?: string;
  progressDetail?: string;
  createdAt?: string;
  stagesCompleted?: string[];
  stageTimings?: StageTiming[];
  activeStageElapsed?: number;
  jobId?: string;
  onCancelled?: () => void;
  onStatusChange?: (status: 'pending' | 'running' | 'paused') => void;
  resumeAvailable?: boolean;
  onRerun?: () => void;
  rerunning?: boolean;
  logLines?: string[];
  showLogs?: boolean;
  onToggleLogs?: () => void;
  profilesetsCompleted?: number;
  profilesetsTotal?: number;
  cpuPct?: number;
  memBytes?: number;
  cpuCores?: number;
  iterations?: number;
  iterationsCompleted?: number;
  fightStyle?: string;
}

export interface PhaseLogInfo {
  phase: 'Profileset' | 'Baseline';
  name: string;
  profilesetCompleted?: number;
  profilesetTotal?: number;
  simulationCompleted?: number;
  simulationTotal?: number;
  simulationPercent?: number;
  mean?: number;
  errorPercent?: number;
  remainingSeconds: number | null;
}

function useSmoothedProgress(serverProgress: number): number {
  const [display, setDisplay] = useState(serverProgress);

  useEffect(() => {
    setDisplay((prev) => Math.max(prev, serverProgress));
  }, [serverProgress]);

  return Math.round(display);
}

function classifyLine(line: string): string {
  if (line.startsWith('SimulationCraft ')) return 'text-gold/70';
  if (line.startsWith('Simulating...')) return 'text-zinc-300';
  if (line.startsWith('Generating Baseline:') || line.startsWith('Generating Profileset:'))
    return 'text-zinc-300';
  if (line.startsWith('Implementation Not Yet Verified')) return 'text-amber-500/60 italic';
  if (
    line.startsWith('Generating reports') ||
    line.startsWith('DPS Ranking:') ||
    line.startsWith('Profilesets (') ||
    line.startsWith('HPS Ranking:') ||
    line.startsWith('Baseline Performance:')
  )
    return 'text-gray-300';
  if (/^\s+\d+\.\d+\s*:\s*Combo\s/.test(line)) return 'text-zinc-300';
  return 'text-zinc-300';
}

export function parseLatestPhaseLog(lines: string[] = []): PhaseLogInfo | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    const header = line.match(/^Generating (Profileset|Baseline):\s*(.*?)(?:\s+\|\s+|$)/);
    if (!header) continue;

    const remainingMatch = line.match(/\((?:(\d+)m\s*,?\s*)?(\d+(?:\.\d+)?)s\)\s*$/i);
    const progressMatch = line.match(
      /\|\s+([^[]+?)\s+\[[^\]]*\]\s+(\d+)\/(\d+)\s+([\d.]+)\s+Mean=([-+\d.]+)\s+Error=([-+\d.]+)%\s+(\S+)/
    );
    const profilesetCount = progressMatch?.[1].match(/(\d+)\/(\d+)/);

    const remainingSeconds = remainingMatch
      ? Number(remainingMatch[1] || 0) * 60 + Number(remainingMatch[2])
      : null;

    return {
      phase: header[1] as PhaseLogInfo['phase'],
      name: header[2].trim(),
      ...(progressMatch
        ? {
            ...(profilesetCount
              ? {
                  profilesetCompleted: Number(profilesetCount[1]),
                  profilesetTotal: Number(profilesetCount[2]),
                }
              : {}),
            simulationCompleted: Number(progressMatch[2]),
            simulationTotal: Number(progressMatch[3]),
            simulationPercent: Number(progressMatch[4]),
            mean: Number(progressMatch[5]),
            errorPercent: Number(progressMatch[6]),
          }
        : {}),
      remainingSeconds: Number.isFinite(remainingSeconds) ? remainingSeconds : null,
    };
  }

  return null;
}

export function extractLatestPhaseRemainingSeconds(lines: string[] = []): number | null {
  return parseLatestPhaseLog(lines)?.remainingSeconds ?? null;
}

function LogConsole({ lines }: { lines: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAutoScroll = useRef(true);

  useEffect(() => {
    if (isAutoScroll.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  function handleScroll() {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    isAutoScroll.current = scrollHeight - scrollTop - clientHeight < 30;
  }

  return (
    <div className="w-full">
      <div className="border-border bg-surface flex items-center justify-between rounded-t-lg border border-b-0 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div className="bg-gold/60 h-1.5 w-1.5 animate-pulse rounded-full" />
          <span className="text-sm font-medium tracking-wider text-zinc-200 uppercase">
            SimC Output
          </span>
        </div>
        <span className="font-mono text-sm text-zinc-300 tabular-nums">{lines.length} lines</span>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="border-border max-h-[320px] overflow-y-auto rounded-b-lg border bg-[#0c0c0e] p-3 font-mono text-sm leading-[1.7]"
      >
        {lines.map((line, i) => (
          <div key={i} className={`break-all whitespace-pre-wrap ${classifyLine(line)}`}>
            {line || '\u00A0'}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SimStatus({
  status,
  progress,
  queuePosition,
  progressStage,
  progressDetail,
  createdAt,
  stagesCompleted,
  stageTimings = [],
  activeStageElapsed,
  jobId,
  onCancelled,
  onStatusChange,
  resumeAvailable = true,
  onRerun,
  rerunning = false,
  logLines,
  showLogs,
  onToggleLogs,
  profilesetsCompleted,
  profilesetsTotal,
  cpuPct,
  memBytes,
  cpuCores,
  iterations,
  iterationsCompleted,
  fightStyle,
}: SimStatusProps) {
  const isRunning = status === 'running';
  const isPending = status === 'pending';
  const isPaused = status === 'paused';
  const [cancelling, setCancelling] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [actionError, setActionError] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [displayedStageElapsed, setDisplayedStageElapsed] = useState(activeStageElapsed ?? 0);
  const previousStageRef = useRef(progressStage);
  const displayProgress = useSmoothedProgress(progress);
  const title = isPaused
    ? 'Paused'
    : progressStage || (isPending ? 'Queued for simulation' : 'Simulating');
  const hasStages = stagesCompleted && stagesCompleted.length > 0;
  const phaseLogInfo = parseLatestPhaseLog(logLines);
  const remainingSeconds = phaseLogInfo?.remainingSeconds ?? null;
  const hasServerProfilesetProgress = (profilesetsTotal ?? 0) > 0;
  const displayedProfilesetsCompleted = hasServerProfilesetProgress
    ? profilesetsCompleted
    : phaseLogInfo?.profilesetCompleted;
  const displayedProfilesetsTotal = hasServerProfilesetProgress
    ? profilesetsTotal
    : phaseLogInfo?.profilesetTotal;
  const displayedIterationsCompleted = phaseLogInfo?.simulationCompleted ?? iterationsCompleted;
  const displayedIterationsTotal = phaseLogInfo?.simulationTotal ?? iterations;
  const parsedProfilesetProgress =
    phaseLogInfo?.profilesetCompleted !== undefined && phaseLogInfo.profilesetTotal !== undefined
      ? `${phaseLogInfo.profilesetCompleted}/${phaseLogInfo.profilesetTotal} profilesets`
      : null;
  const displayedProgressDetail = parsedProfilesetProgress
    ? progressDetail?.split('·').slice(1).join('·').trim() || undefined
    : progressDetail;

  useEffect(() => {
    if (!createdAt || !isRunning) {
      setElapsedSeconds(0);
      return;
    }

    const started = new Date(createdAt).getTime();
    if (!Number.isFinite(started)) {
      setElapsedSeconds(0);
      return;
    }

    const update = () => setElapsedSeconds((Date.now() - started) / 1000);
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [createdAt, isRunning]);

  useEffect(() => {
    const serverElapsed = activeStageElapsed ?? 0;
    const stageChanged = previousStageRef.current !== progressStage;
    previousStageRef.current = progressStage;
    setDisplayedStageElapsed((previous) =>
      stageChanged ? Math.max(0, serverElapsed) : Math.max(previous, serverElapsed)
    );

    if (!isRunning || activeStageElapsed == null) return;
    const timer = window.setInterval(() => {
      setDisplayedStageElapsed((previous) => previous + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeStageElapsed, isRunning, progressStage]);

  async function handleCancel() {
    if (!jobId || cancelling) return;
    setCancelling(true);
    try {
      await fetch(`${API_URL}/api/sim/${jobId}/cancel`, { method: 'POST', credentials: 'include' });
      onCancelled?.();
    } catch {
      // ignore
    } finally {
      setCancelling(false);
    }
  }

  async function handlePause() {
    if (!jobId || transitioning || !resumeAvailable) return;
    setActionError('');
    setTransitioning(true);
    try {
      await pauseSim(jobId);
      onStatusChange?.('paused');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to pause simulation');
    } finally {
      setTransitioning(false);
    }
  }

  async function handleResume() {
    if (!jobId || transitioning || !resumeAvailable) return;
    setActionError('');
    setTransitioning(true);
    try {
      const response = await resumeSim(jobId);
      onStatusChange?.(response.status);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to resume simulation');
    } finally {
      setTransitioning(false);
    }
  }

  const runningStageElapsed = activeStageElapsed != null ? displayedStageElapsed : elapsedSeconds;

  return (
    <div className="flex w-full flex-col items-center space-y-6 py-16">
      <div className="relative">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-full border-2 ${
            isPending ? 'border-gold/30 bg-gold/[0.06]' : 'border-t-gold border-zinc-800'
          } ${isPaused ? '' : isPending ? '' : 'animate-spin'}`}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          {isPaused ? (
            <Pause className="text-gold h-4 w-4" />
          ) : isPending ? (
            <Clock3 className="text-gold h-4 w-4" strokeWidth={2} />
          ) : (
            <div className="bg-gold/60 h-2 w-2 animate-pulse rounded-full" />
          )}
        </div>
      </div>

      <div className="text-center">
        <p className="text-sm font-semibold text-zinc-100">{title}</p>
        {!isPending && displayedProgressDetail && (
          <p className="mt-1 text-sm text-zinc-300">{displayedProgressDetail}</p>
        )}
      </div>

      {isPending ? (
        <div
          className="border-gold/25 bg-gold/[0.06] w-full max-w-2xl rounded-2xl border px-4 py-4 sm:px-5"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <span className="border-gold/25 bg-gold/10 text-gold mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border">
              <ListOrdered className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-100">
                Waiting for an available SimC slot
              </p>
              <p className="mt-1 text-xs leading-5 text-zinc-400">
                The simulation has not started yet and will begin automatically when its turn
                arrives.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                <span className="text-gold font-mono font-semibold">
                  {queuePosition ? `Queue position #${queuePosition}` : 'Queue position pending'}
                </span>
                <span className="text-zinc-600">·</span>
                <Link href="/queue" className="text-gold font-semibold hover:underline">
                  Manage queue
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-2xl px-4 sm:px-6">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="from-gold-dark to-gold h-full rounded-full bg-gradient-to-r transition-all duration-700"
              style={{ width: `${Math.max(displayProgress, 5)}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-gold font-mono text-[13px] font-medium">{displayProgress}%</p>
            {displayedProfilesetsTotal ? (
              <p className="text-[12px] text-zinc-400">
                <span className="font-medium text-zinc-200">
                  {displayedProfilesetsCompleted || 0}
                </span>{' '}
                / {displayedProfilesetsTotal} profilesets
              </p>
            ) : displayedIterationsTotal && displayedIterationsCompleted !== undefined ? (
              <p className="text-[12px] text-zinc-400">
                <span className="font-medium text-zinc-200">{displayedIterationsCompleted}</span> /{' '}
                {displayedIterationsTotal} iterations
              </p>
            ) : null}
          </div>
        </div>
      )}

      <div className="grid w-full max-w-4xl gap-4 px-4 sm:px-6 md:grid-cols-2">
        {phaseLogInfo && (
          <div className="border-border bg-surface min-w-0 rounded-xl border p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
                Current {phaseLogInfo.phase}
              </span>
              <span
                className="truncate text-right text-[13px] text-zinc-200"
                title={phaseLogInfo.name}
              >
                {phaseLogInfo.name}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              {phaseLogInfo.simulationCompleted !== undefined &&
                phaseLogInfo.simulationTotal !== undefined &&
                phaseLogInfo.simulationPercent !== undefined && (
                  <div className="col-span-2 flex flex-col items-center">
                    <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
                      SimC Progress
                    </span>
                    <span className="mt-1 font-mono text-[12px] whitespace-nowrap text-zinc-200">
                      {`${phaseLogInfo.simulationCompleted}/${phaseLogInfo.simulationTotal} (${phaseLogInfo.simulationPercent.toFixed(3)}%)`}
                    </span>
                  </div>
                )}
              {phaseLogInfo.mean !== undefined && (
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
                    Mean
                  </span>
                  <span className="mt-1 font-mono text-[13px] text-zinc-200">
                    {Math.round(phaseLogInfo.mean).toLocaleString()}
                  </span>
                </div>
              )}
              {phaseLogInfo.errorPercent !== undefined && (
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
                    Error
                  </span>
                  <span className="mt-1 font-mono text-[13px] text-zinc-200">
                    {phaseLogInfo.errorPercent.toFixed(3)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {isRunning && (
          <div
            className={`border-border bg-surface flex w-full min-w-0 flex-wrap justify-center gap-x-6 gap-y-3 rounded-xl border p-4 shadow-sm ${phaseLogInfo ? '' : 'md:col-span-2'}`}
          >
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
                Elapsed
              </span>
              <span className="mt-1 font-mono text-[13px] text-zinc-200">
                {formatElapsedCompact(elapsedSeconds)}
              </span>
            </div>
            {remainingSeconds !== null && (
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
                  Remaining
                </span>
                <span className="mt-1 font-mono text-[13px] text-zinc-200">
                  {formatEta(remainingSeconds)}
                </span>
              </div>
            )}
            {cpuPct !== undefined && cpuPct > 0 && (
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
                  CPU Usage
                </span>
                <span className="mt-1 font-mono text-[13px] text-zinc-200">
                  {cpuPct.toFixed(1)}%
                </span>
              </div>
            )}
            {cpuCores !== undefined && cpuCores > 0 && (
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
                  Cores
                </span>
                <span className="mt-1 font-mono text-[13px] text-zinc-200">{cpuCores}</span>
              </div>
            )}
            {memBytes !== undefined && memBytes > 0 && (
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
                  Memory
                </span>
                <span className="mt-1 font-mono text-[13px] text-zinc-200">
                  {formatMegabytes(memBytes)}
                </span>
              </div>
            )}
            {displayedIterationsTotal && (
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
                  Iterations
                </span>
                <span className="mt-1 font-mono text-[13px] text-zinc-200">
                  {phaseLogInfo?.simulationTotal !== undefined
                    ? displayedIterationsTotal.toLocaleString()
                    : `${(displayedIterationsTotal / 1000).toFixed(0)}k`}
                </span>
              </div>
            )}
            {fightStyle && (
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
                  Style
                </span>
                <span className="mt-1 text-[13px] text-zinc-200">{fightStyle}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {jobId && (isRunning || isPending || isPaused) && (
        <div className="flex items-center gap-3">
          {isPaused ? (
            <button
              onClick={handleResume}
              disabled={transitioning || !resumeAvailable}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-500/[0.08] px-2.5 py-1 text-[12px] font-semibold text-emerald-200 transition-all hover:border-emerald-300/50 hover:bg-emerald-500/[0.14] disabled:cursor-not-allowed disabled:opacity-60"
              title={
                resumeAvailable
                  ? 'Resume this simulation'
                  : 'Resume unavailable after backend restart'
              }
            >
              <Play className="h-3.5 w-3.5" />
              {transitioning
                ? 'Resuming...'
                : resumeAvailable
                  ? 'Resume Sim'
                  : 'Resume Unavailable'}
            </button>
          ) : (
            <button
              onClick={handlePause}
              disabled={transitioning || !resumeAvailable}
              className="inline-flex items-center gap-1.5 rounded-md border border-sky-400/30 bg-sky-500/[0.08] px-2.5 py-1 text-[12px] font-semibold text-sky-200 transition-all hover:border-sky-300/50 hover:bg-sky-500/[0.14] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Pause className="h-3.5 w-3.5" />
              {transitioning ? 'Pausing...' : 'Pause Sim'}
            </button>
          )}
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="rounded-md border border-red-500/30 bg-red-500/[0.08] px-2.5 py-1 text-[12px] font-semibold text-red-200 transition-all hover:border-red-400/40 hover:bg-red-500/[0.14] hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelling ? 'Cancelling...' : 'Cancel Sim'}
          </button>
          {isPaused && !resumeAvailable && onRerun && (
            <button
              onClick={onRerun}
              disabled={rerunning}
              className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[12px] font-semibold text-zinc-300 transition-all hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {rerunning ? 'Rerunning...' : 'Rerun Input'}
            </button>
          )}
          {onToggleLogs && (
            <button
              onClick={onToggleLogs}
              className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[12px] font-semibold text-zinc-300 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
            >
              <ScrollText className="h-3.5 w-3.5" strokeWidth={1.5} />
              {showLogs ? 'Hide Logs' : 'Show Logs'}
            </button>
          )}
        </div>
      )}

      {actionError && (
        <p className="text-xs text-red-300" role="alert">
          {actionError}
        </p>
      )}

      {hasStages && (
        <div className="w-full max-w-4xl space-y-1 px-4 pt-2 sm:px-6">
          {stagesCompleted!.map((stage, i) => (
            <div key={i} className="flex items-center gap-2">
              <Check className="h-3 w-3 shrink-0 text-emerald-500" strokeWidth={2.5} />
              <span className="text-sm text-zinc-300">
                {stage}
                {stageTimings[i] && (
                  <span className="text-gray-500">
                    {' '}
                    took {formatElapsedCompact(stageTimings[i].elapsed)}
                  </span>
                )}
              </span>
            </div>
          ))}
          {progressStage && (
            <div className="flex items-center gap-2">
              <div className="flex h-3 w-3 shrink-0 items-center justify-center">
                <div
                  className={`bg-gold h-1.5 w-1.5 rounded-full ${isPaused ? '' : 'animate-pulse'}`}
                />
              </div>
              <span className="text-sm text-zinc-300">
                {progressStage}
                {!isPaused && (
                  <span className="text-gray-500">
                    {' '}
                    - {formatElapsedCompact(runningStageElapsed)}
                  </span>
                )}
                {displayedProgressDetail && (
                  <span className="text-zinc-300"> - {displayedProgressDetail}</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {showLogs && logLines && logLines.length > 0 && (
        <div className="w-full max-w-6xl px-4 sm:px-6">
          <LogConsole lines={logLines} />
        </div>
      )}
    </div>
  );
}

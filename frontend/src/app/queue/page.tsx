'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Clock3,
  ExternalLink,
  GripVertical,
  Layers3,
  ListOrdered,
  Play,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth } from '../components/AuthContext';
import { useNotifications } from '../components/shared/NotificationSystem';
import {
  API_URL,
  fetchJson,
  getQueue,
  reorderQueue,
  runNextSimulation,
  type QueueJob,
  type QueueResponse,
  type QueueScope,
} from '../lib/api';
import { simResultHref } from '../lib/routes';

const SIM_TYPE_LABELS: Record<string, string> = {
  quick: 'Quick Sim',
  top_gear: 'Top Gear',
  top_gear_exact_stats: 'Stats Sim',
  droptimizer: 'Drop Finder',
  upgrade_compare: 'Crest Upgrades',
  stat_weights: 'Stat Weights',
  stat_plot: 'Stat Plot',
  external_buff_matrix: 'External Buff Matrix',
  consumable_matrix: 'Consumable Matrix',
  trinket_tier_heatmap: 'Trinket / Tier Heatmaps',
};

function simTypeLabel(simType: string): string {
  return SIM_TYPE_LABELS[simType] || simType.replaceAll('_', ' ');
}

function formatAge(createdAt: string): string {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return 'Unknown age';
  const minutes = Math.max(0, Math.floor((Date.now() - created) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function movePendingJob(jobs: QueueJob[], id: string, offset: number): QueueJob[] {
  const pending = jobs.filter((job) => job.status === 'pending');
  const index = pending.findIndex((job) => job.id === id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= pending.length) return jobs;
  const nextPending = [...pending];
  const [moved] = nextPending.splice(index, 1);
  nextPending.splice(target, 0, moved);
  let pendingIndex = 0;
  return jobs.map((job) => (job.status === 'pending' ? nextPending[pendingIndex++] : job));
}

function movePendingJobToFront(jobs: QueueJob[], id: string): QueueJob[] {
  const pending = jobs.filter((job) => job.status === 'pending');
  const index = pending.findIndex((job) => job.id === id);
  if (index <= 0) return jobs;
  const nextPending = [...pending];
  const [moved] = nextPending.splice(index, 1);
  nextPending.unshift(moved);
  let pendingIndex = 0;
  return jobs.map((job) => (job.status === 'pending' ? nextPending[pendingIndex++] : job));
}

function queuedIds(jobs: QueueJob[]): string[] {
  return jobs.filter((job) => job.status === 'pending').map((job) => job.id);
}

function batchCount(jobs: QueueJob[], batchId: string | null | undefined): number {
  if (!batchId) return 0;
  return jobs.filter((job) => job.batch_id === batchId).length;
}

function QueueRow({
  job,
  allJobs,
  canManage,
  onMove,
  onRunNext,
  onCancel,
  onDragStart,
  onDrop,
}: {
  job: QueueJob;
  allJobs: QueueJob[];
  canManage: boolean;
  onMove: (id: string, offset: number) => void;
  onRunNext: (id: string) => void;
  onCancel: (id: string) => void;
  onDragStart: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  const pending = job.status === 'pending';
  const canCancel = canManage && (pending || job.status === 'running' || job.status === 'paused');
  const batchJobs = batchCount(allJobs, job.batch_id);
  const progress = Math.min(100, Math.max(0, job.progress));
  const title = job.player_name || 'Simulation';
  const detail = job.progress_detail?.trim() || job.progress_stage?.trim() || '';
  const statusLabel =
    job.status === 'pending' ? 'Queued' : job.status[0].toUpperCase() + job.status.slice(1);

  return (
    <div
      draggable={canManage && pending}
      onDragStart={() => onDragStart(job.id)}
      onDragOver={(event) => {
        if (canManage && pending) event.preventDefault();
      }}
      onDrop={() => {
        if (canManage && pending) onDrop(job.id);
      }}
      className={`rounded-xl border bg-black/20 p-3 transition-colors ${
        pending ? 'hover:border-gold/40 border-white/10' : 'border-white/[0.06]'
      }`}
    >
      <div className="flex items-start gap-3">
        {pending && canManage ? (
          <span className="mt-1 cursor-grab text-zinc-600" title="Drag to reorder">
            <GripVertical className="h-5 w-5" strokeWidth={2} />
          </span>
        ) : (
          <span className="mt-1 w-5 text-center text-xs font-semibold text-zinc-600">
            {job.queue_position || '—'}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {pending && (
              <span className="text-gold text-xs font-semibold">#{job.queue_position}</span>
            )}
            <span className="truncate font-semibold text-zinc-100">{title}</span>
            {job.realm && <span className="text-xs text-zinc-500">· {job.realm}</span>}
            {job.owner && (
              <span className="rounded border border-sky-400/20 bg-sky-400/10 px-1.5 py-0.5 text-[10px] text-sky-200">
                {job.owner}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
            <span>{simTypeLabel(job.sim_type)}</span>
            <span>·</span>
            <span>{statusLabel}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3 w-3" strokeWidth={2} />
              {formatAge(job.created_at)}
            </span>
            {batchJobs > 1 && (
              <span className="inline-flex items-center gap-1 rounded border border-violet-400/20 bg-violet-400/10 px-1.5 py-0.5 text-[10px] text-violet-200">
                <Layers3 className="h-3 w-3" strokeWidth={2} />
                Batch · {batchJobs} jobs
              </span>
            )}
          </div>
          {!pending && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="from-gold-dark to-gold h-full rounded-full bg-gradient-to-r transition-[width] duration-500"
                style={{ width: `${Math.max(progress, job.status === 'running' ? 3 : 0)}%` }}
              />
            </div>
          )}
          {detail && <p className="mt-1 truncate text-[11px] text-zinc-500">{detail}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {pending && canManage && (
            <>
              <button
                type="button"
                onClick={() => onMove(job.id, -1)}
                className="rounded-md p-1.5 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
                aria-label={`Move ${title} up`}
                title="Move up"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => onMove(job.id, 1)}
                className="rounded-md p-1.5 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
                aria-label={`Move ${title} down`}
                title="Move down"
              >
                <ArrowDown className="h-4 w-4" strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => onRunNext(job.id)}
                className="text-gold hover:bg-gold/10 rounded-md p-1.5"
                aria-label={`Run ${title} next`}
                title="Run next"
              >
                <Play className="h-4 w-4" fill="currentColor" strokeWidth={2} />
              </button>
            </>
          )}
          <Link
            href={simResultHref(job.id)}
            className="rounded-md p-1.5 text-zinc-600 hover:bg-white/10 hover:text-zinc-200"
            aria-label={`Open ${title} simulation`}
            title="Open simulation"
          >
            <ExternalLink className="h-4 w-4" strokeWidth={2} />
          </Link>
          {canCancel && (
            <button
              type="button"
              onClick={() => onCancel(job.id)}
              className="rounded-md p-1.5 text-zinc-600 hover:bg-red-400/10 hover:text-red-300"
              aria-label={`Cancel ${title}`}
              title="Cancel simulation"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function QueuePage() {
  const { user, loading: authLoading } = useAuth();
  const { notify } = useNotifications();
  const [scope, setScope] = useState<QueueScope>('mine');
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (user?.role === 'admin') setScope('all');
  }, [user?.role]);

  const refresh = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        setData(await getQueue(scope));
        setError(null);
      } catch (requestError: any) {
        setError(requestError?.message || 'Could not load the simulation queue.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [scope]
  );

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const pending = useMemo(() => data?.jobs.filter((job) => job.status === 'pending') || [], [data]);
  const running = useMemo(() => data?.jobs.filter((job) => job.status === 'running') || [], [data]);
  const paused = useMemo(() => data?.jobs.filter((job) => job.status === 'paused') || [], [data]);
  const canManage = Boolean(data);

  const applyPendingOrder = useCallback(
    async (nextJobs: QueueJob[]) => {
      if (!data) return;
      const nextIds = queuedIds(nextJobs);
      setData((current) => (current ? { ...current, jobs: nextJobs } : current));
      try {
        await reorderQueue(nextIds, scope);
        await refresh(true);
      } catch (requestError: any) {
        await refresh(true);
        notify({
          title: 'Queue changed elsewhere',
          description: requestError?.message || 'Refresh completed with the current server order.',
          variant: 'error',
          durationMs: 5000,
          dedupeKey: 'queue-reorder-conflict',
        });
      }
    },
    [data, notify, refresh, scope]
  );

  const move = useCallback(
    (id: string, offset: number) => {
      if (!data) return;
      void applyPendingOrder(movePendingJob(data.jobs, id, offset));
    },
    [applyPendingOrder, data]
  );

  const runNext = useCallback(
    async (id: string) => {
      if (!data || busyIds.has(id)) return;
      setBusyIds((current) => new Set(current).add(id));
      setData((current) =>
        current ? { ...current, jobs: movePendingJobToFront(current.jobs, id) } : current
      );
      try {
        await runNextSimulation(id, scope);
        await refresh(true);
      } catch (requestError: any) {
        await refresh(true);
        notify({
          title: 'Could not move simulation',
          description: requestError?.message || 'The queue may have changed. Try again.',
          variant: 'error',
          durationMs: 5000,
          dedupeKey: `queue-run-next:${id}`,
        });
      } finally {
        setBusyIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [busyIds, data, notify, refresh, scope]
  );

  const cancel = useCallback(
    async (id: string) => {
      if (busyIds.has(id)) return;
      setBusyIds((current) => new Set(current).add(id));
      try {
        await fetchJson(`${API_URL}/api/sim/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
        await refresh(true);
      } catch (requestError: any) {
        notify({
          title: 'Could not cancel simulation',
          description: requestError?.message || 'The simulation may have already changed state.',
          variant: 'error',
          durationMs: 5000,
          dedupeKey: `queue-cancel:${id}`,
        });
      } finally {
        setBusyIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [busyIds, notify, refresh]
  );

  const cancelAll = useCallback(async () => {
    if (pending.length === 0) return;
    if (!window.confirm(`Cancel all ${pending.length} queued simulations?`)) return;
    await Promise.all(pending.map((job) => cancel(job.id)));
    await refresh(true);
  }, [cancel, pending, refresh]);

  if (authLoading || loading) {
    return <main className="mx-auto max-w-5xl p-6 text-sm text-zinc-400">Loading queue…</main>;
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 text-zinc-100 sm:p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ListOrdered className="text-gold h-6 w-6" strokeWidth={2} />
            <h1 className="text-2xl font-semibold">Simulation Queue</h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            Arrange pending simulations before they claim an available SimC slot. Running jobs keep
            their current state and cannot be reordered.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.can_manage_all && (
            <div className="flex rounded-lg border border-white/10 bg-black/20 p-1 text-xs">
              {(['mine', 'all'] as QueueScope[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setScope(option)}
                  className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                    scope === option ? 'bg-gold/15 text-gold' : 'text-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  {option === 'mine' ? 'My jobs' : 'All jobs'}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
              strokeWidth={2}
            />
            Refresh
          </button>
        </div>
      </header>

      {data?.scope === 'mine' && (
        <div className="flex items-start gap-3 rounded-xl border border-sky-400/20 bg-sky-400/5 p-4 text-sm text-sky-100">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" strokeWidth={2} />
          <p>
            Your order applies to your own queued jobs.{' '}
            <span className="font-semibold">Run next</span> moves a job ahead of your other jobs
            without changing another user&apos;s place in the shared queue.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="font-semibold hover:text-white"
          >
            Try again
          </button>
        </div>
      )}

      <section className="rounded-2xl border border-white/10 bg-zinc-950/40 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Queued</h2>
            <p className="text-xs text-zinc-500">
              {pending.length} waiting · up to {data?.max_parallel_jobs || 1} running at once
            </p>
          </div>
          {scope === 'mine' && pending.length > 1 && (
            <button
              type="button"
              onClick={() => void cancelAll()}
              className="rounded-md border border-red-400/20 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-400/10"
            >
              Cancel all queued
            </button>
          )}
        </div>
        {pending.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-zinc-500">
            Nothing is waiting. New simulations will appear here while all configured SimC slots are
            busy.
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((job) => (
              <QueueRow
                key={job.id}
                job={job}
                allJobs={pending}
                canManage={canManage}
                onMove={move}
                onRunNext={runNext}
                onCancel={cancel}
                onDragStart={setDraggedId}
                onDrop={(targetId) => {
                  if (!draggedId || draggedId === targetId || !data) return;
                  const sourceIndex = pending.findIndex((item) => item.id === draggedId);
                  const targetIndex = pending.findIndex((item) => item.id === targetId);
                  if (sourceIndex < 0 || targetIndex < 0) return;
                  const next = [...pending];
                  const [moved] = next.splice(sourceIndex, 1);
                  next.splice(targetIndex, 0, moved);
                  let index = 0;
                  const nextJobs = data.jobs.map((item) =>
                    item.status === 'pending' ? next[index++] : item
                  );
                  setDraggedId(null);
                  void applyPendingOrder(nextJobs);
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-zinc-950/40 p-4 sm:p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Running</h2>
          <p className="text-xs text-zinc-500">{running.length} currently using a SimC slot</p>
        </div>
        {running.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-zinc-500">
            No simulations are running right now.
          </p>
        ) : (
          <div className="space-y-2">
            {running.map((job) => (
              <QueueRow
                key={job.id}
                job={job}
                allJobs={data?.jobs || []}
                canManage={canManage}
                onMove={move}
                onRunNext={runNext}
                onCancel={cancel}
                onDragStart={setDraggedId}
                onDrop={() => {}}
              />
            ))}
          </div>
        )}
      </section>

      {paused.length > 0 && (
        <section className="rounded-2xl border border-white/10 bg-zinc-950/40 p-4 sm:p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Paused</h2>
            <p className="text-xs text-zinc-500">
              Paused jobs retain their queue position when resumed.
            </p>
          </div>
          <div className="space-y-2">
            {paused.map((job) => (
              <QueueRow
                key={job.id}
                job={job}
                allJobs={data?.jobs || []}
                canManage={canManage}
                onMove={move}
                onRunNext={runNext}
                onCancel={cancel}
                onDragStart={setDraggedId}
                onDrop={() => {}}
              />
            ))}
          </div>
        </section>
      )}

      <p className="text-center text-xs text-zinc-600">
        Need to submit another simulation?{' '}
        <Link href="/quick-sim" className="text-gold hover:underline">
          Start a Quick Sim
        </Link>
      </p>
    </main>
  );
}

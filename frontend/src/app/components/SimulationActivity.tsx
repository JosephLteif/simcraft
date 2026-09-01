'use client';

import { Activity, ExternalLink, LoaderCircle, Maximize2, Minimize2, Pause, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCharacterInfo } from '@/lib/simc-parser';
import { API_URL, fetchJson } from '../lib/api';
import { simResultHref } from '../lib/routes';
import {
  loadTrackedSimulations,
  saveTrackedSimulationState,
  SIMULATION_TRACKED_EVENT,
  type TrackedSimulation,
} from '../lib/sim-tracking';
import { useNotifications } from './shared/NotificationSystem';

type SimulationStatus = 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

interface SimulationSnapshot extends TrackedSimulation {
  status: SimulationStatus;
  progress: number;
  progressStage?: string;
  progressDetail?: string;
  createdAt?: string;
  linkedName?: string;
}

interface SimulationResponse {
  id: string;
  status: SimulationStatus;
  sim_type?: string;
  simc_input?: string;
  progress: number;
  progress_stage?: string;
  progress_detail?: string;
  created_at?: string;
  linked_name?: string;
}

const ACTIVE_STATUSES = new Set<SimulationStatus>(['pending', 'running', 'paused']);
const TERMINAL_STATUSES = new Set<SimulationStatus>(['done', 'failed', 'cancelled']);
const SIMULATION_ACTIVITY_MINIMIZED_KEY = 'whylowdps_simulation_activity_minimized';

function simTypeLabel(simType?: string): string {
  return (
    (
      {
        quick: 'Quick Sim',
        top_gear: 'Top Gear',
        droptimizer: 'Drop Finder',
        upgrade_compare: 'Upgrade Planner',
        stat_weights: 'Stat Weights',
        stat_plot: 'Stat Plot',
      } as Record<string, string>
    )[simType || ''] ||
    simType ||
    'Simulation'
  );
}

function playerNameFromResponse(data: SimulationResponse): string | undefined {
  if (data.linked_name?.trim()) return data.linked_name.trim();
  if (!data.simc_input) return undefined;

  const parsed = parseCharacterInfo(data.simc_input);
  if (parsed?.kind === 'character') return parsed.name;
  if (parsed?.kind === 'dungeon') return parsed.title;
  return undefined;
}

function mergeTracked(
  current: SimulationSnapshot[],
  incoming: TrackedSimulation[]
): SimulationSnapshot[] {
  const byId = new Map(current.map((sim) => [sim.id, sim]));
  incoming.forEach((sim) => {
    const previous = byId.get(sim.id);
    byId.set(sim.id, {
      status: previous?.status || 'pending',
      progress: previous?.progress || 0,
      ...previous,
      ...sim,
      id: sim.id,
    });
  });
  return [...byId.values()];
}

function CompactSimulationRow({
  simulation,
  onOpen,
  onCancel,
  cancelling,
}: {
  simulation: SimulationSnapshot;
  onOpen: (id: string) => void;
  onCancel: (id: string) => void;
  cancelling: boolean;
}) {
  const isPaused = simulation.status === 'paused';
  const isQueued = simulation.status === 'pending';
  const progress = Math.min(100, Math.max(0, simulation.progress));
  const title = simulation.playerName || 'Simulation';
  const detail =
    simulation.progressDetail?.trim() ||
    simulation.progressStage ||
    (isPaused ? 'Paused' : isQueued ? 'Queued' : 'Simulating');

  return (
    <div className="hover:border-gold/30 flex items-stretch gap-1 rounded-lg border border-white/[0.06] bg-black/20 p-1 transition-colors hover:bg-white/[0.04]">
      <button
        type="button"
        onClick={() => onOpen(simulation.id)}
        className="focus-visible:ring-gold/60 group min-w-0 flex-1 rounded-md p-2 text-left focus-visible:ring-2 focus-visible:outline-none"
        aria-label={`Open ${title} ${simTypeLabel(simulation.simType)} result`}
      >
        <div className="flex items-start gap-2.5">
          <span className="bg-gold/10 text-gold mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md">
            {isPaused ? (
              <Pause className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-semibold text-zinc-100">{title}</span>
              <span className="text-gold shrink-0 font-mono text-[11px] tabular-nums">
                {Math.round(progress)}%
              </span>
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
              {simTypeLabel(simulation.simType)} · {detail}
            </span>
            <span className="mt-2 block h-1 overflow-hidden rounded-full bg-zinc-800">
              <span
                className="from-gold-dark to-gold block h-full rounded-full bg-gradient-to-r transition-[width] duration-700"
                style={{ width: `${Math.max(progress, 3)}%` }}
              />
            </span>
          </span>
          <ExternalLink
            className="group-hover:text-gold mt-1 h-3.5 w-3.5 shrink-0 text-zinc-600 transition-colors"
            strokeWidth={2}
          />
        </div>
      </button>
      <button
        type="button"
        onClick={() => onCancel(simulation.id)}
        disabled={cancelling}
        className="focus-visible:ring-gold/60 self-start rounded-md p-2 text-zinc-600 transition-colors hover:bg-red-400/10 hover:text-red-300 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
        aria-label={`Cancel ${title} ${simTypeLabel(simulation.simType)}`}
        title="Cancel simulation"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}

export default function SimulationActivity() {
  const router = useRouter();
  const { notify } = useNotifications();
  const [simulations, setSimulations] = useState<SimulationSnapshot[]>([]);
  const [minimized, setMinimized] = useState(false);
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(() => new Set());
  const simulationsRef = useRef(simulations);
  const previousStatusesRef = useRef(new Map<string, SimulationStatus>());

  simulationsRef.current = simulations;
  const openSimulation = useCallback(
    (id: string) => {
      setMinimized(false);
      router.push(simResultHref(id));
    },
    [router]
  );

  const cancelSimulation = useCallback(
    async (id: string) => {
      setCancellingIds((current) => new Set(current).add(id));
      try {
        await fetchJson(`${API_URL}/api/sim/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
        previousStatusesRef.current.delete(id);
        const next = simulationsRef.current.filter((simulation) => simulation.id !== id);
        setSimulations(next);
        saveTrackedSimulationState(next);
      } catch {
        notify({
          title: 'Could not cancel simulation',
          description:
            'The simulation may have already finished. Refresh its status and try again.',
          variant: 'error',
          durationMs: 5000,
          dedupeKey: `simulation-cancel:${id}`,
        });
      } finally {
        setCancellingIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [notify]
  );

  useEffect(() => {
    const tracked = loadTrackedSimulations();
    tracked.forEach((sim) => previousStatusesRef.current.set(sim.id, 'pending'));
    setSimulations(tracked.map((sim) => ({ ...sim, status: 'pending', progress: 0 })));
    try {
      setMinimized(window.sessionStorage.getItem(SIMULATION_ACTIVITY_MINIMIZED_KEY) === 'true');
    } catch {
      // Use the expanded card when storage is unavailable.
    }

    const handleTracked = (event: Event) => {
      const detail = (event as CustomEvent<TrackedSimulation[]>).detail;
      if (!Array.isArray(detail)) return;
      detail.forEach((sim) => {
        if (sim.id && !previousStatusesRef.current.has(sim.id)) {
          previousStatusesRef.current.set(sim.id, 'pending');
        }
      });
      setSimulations((current) => mergeTracked(current, detail));
    };
    window.addEventListener(SIMULATION_TRACKED_EVENT, handleTracked);
    return () => window.removeEventListener(SIMULATION_TRACKED_EVENT, handleTracked);
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(SIMULATION_ACTIVITY_MINIMIZED_KEY, String(minimized));
    } catch {
      // Ignore storage failures.
    }
  }, [minimized]);

  useEffect(() => {
    if (simulations.length === 0) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      const current = simulationsRef.current;
      if (current.length === 0) return;

      const responses = await Promise.all(
        current.map(async (simulation) => {
          try {
            const data = await fetchJson<SimulationResponse>(
              `${API_URL}/api/sim/${encodeURIComponent(simulation.id)}`
            );
            return { simulation, data };
          } catch {
            return { simulation, data: null };
          }
        })
      );
      if (!active) return;

      const next = new Map<string, SimulationSnapshot>();
      responses.forEach((result) => {
        if (!result.data) {
          next.set(result.simulation.id, result.simulation);
          return;
        }

        const { simulation, data } = result;
        const previousStatus = previousStatusesRef.current.get(simulation.id);
        const playerName = playerNameFromResponse(data) || simulation.playerName;
        const nextSimulation: SimulationSnapshot = {
          ...simulation,
          id: data.id,
          status: data.status,
          progress: data.progress,
          simType: data.sim_type || simulation.simType,
          playerName,
          progressStage: data.progress_stage,
          progressDetail: data.progress_detail,
          createdAt: data.created_at,
          linkedName: data.linked_name,
        };
        previousStatusesRef.current.set(simulation.id, data.status);

        if (
          previousStatus &&
          ACTIVE_STATUSES.has(previousStatus) &&
          TERMINAL_STATUSES.has(data.status)
        ) {
          const description = `${playerName || 'Simulation'} · ${simTypeLabel(data.sim_type || simulation.simType)}`;
          notify({
            title: data.status === 'done' ? 'Simulation finished' : 'Simulation update',
            description,
            variant: data.status === 'done' ? 'success' : 'info',
            durationMs: 6000,
            href: simResultHref(simulation.id),
            dedupeKey: `simulation:${simulation.id}`,
            action: {
              label: 'Open result',
              onClick: () => router.push(simResultHref(simulation.id)),
            },
          });
        }

        if (ACTIVE_STATUSES.has(data.status)) next.set(simulation.id, nextSimulation);
      });

      const stillNew = simulationsRef.current.filter(
        (simulation) => !current.some((item) => item.id === simulation.id)
      );
      const nextSimulations = [...next.values(), ...stillNew].filter((simulation) => simulation.id);
      setSimulations(nextSimulations);
      saveTrackedSimulationState(nextSimulations);

      if (nextSimulations.length > 0) timer = setTimeout(poll, 2000);
    }

    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [notify, router, simulations.length]);

  if (simulations.length === 0) return null;

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="border-gold/30 bg-surface/95 text-gold hover:border-gold/60 hover:bg-surface fixed right-4 bottom-24 z-[130] inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-2xl shadow-black/40 backdrop-blur-sm transition-colors sm:right-6 sm:bottom-24"
        title="Show simulation progress"
        aria-label={`Show ${simulations.length} active simulation${simulations.length === 1 ? '' : 's'}`}
      >
        <Activity className="h-3.5 w-3.5" strokeWidth={2} />
        <span>{simulations.length} active</span>
        <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    );
  }

  const queuedCount = simulations.filter((simulation) => simulation.status === 'pending').length;
  const activeCount = simulations.length - queuedCount;

  return (
    <section
      aria-label="Simulation progress"
      className="border-gold/20 bg-surface/95 fixed right-4 bottom-24 z-[130] w-[min(92vw,360px)] overflow-hidden rounded-xl border p-3 shadow-2xl shadow-black/40 backdrop-blur-sm sm:right-6 sm:bottom-24"
    >
      <header className="mb-2 flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <Activity className="text-gold h-4 w-4 shrink-0" strokeWidth={2} />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-zinc-100">Simulation progress</p>
            <p className="text-[11px] text-zinc-500">
              {activeCount} active · {queuedCount} queued
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMinimized(true)}
          className="focus-visible:ring-gold/60 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200 focus-visible:ring-2 focus-visible:outline-none"
          title="Minimize simulation progress"
          aria-label="Minimize simulation progress"
        >
          <Minimize2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </header>
      <div className="space-y-2">
        {simulations.map((simulation) => (
          <CompactSimulationRow
            key={simulation.id}
            simulation={simulation}
            onOpen={openSimulation}
            onCancel={cancelSimulation}
            cancelling={cancellingIds.has(simulation.id)}
          />
        ))}
      </div>
    </section>
  );
}

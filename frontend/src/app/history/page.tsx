'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, GitCompareArrows, Pin, Search, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  API_URL,
  clearHistory,
  deleteSim,
  fetchJson,
  getConfig,
  getHistoryStats,
  type HistoryStats,
  setSimPinned,
  updateConfig,
} from '../lib/api';
import { simResultHref } from '../lib/routes';
import {
  clearScenarioSiblings,
  type ScenarioSibling,
  storeScenarioSiblings,
} from '../lib/scenario-siblings';
import { useAuth } from '../components/AuthContext';
import { useSimContext } from '../components/SimContext';
import { useNotifications } from '../components/shared/NotificationSystem';

interface JobSummary {
  id: string;
  status: 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
  sim_type: string;
  created_at: string;
  fight_style: string;
  iterations: number;
  error_message: string | null;
  player_name: string | null;
  player_class: string | null;
  realm: string | null;
  dps: number | null;
  batch_id: string | null;
  size_bytes: number;
  upgrades?: number | null;
  downgrades?: number | null;
  pinned?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  done: 'bg-emerald-500',
  running: 'bg-amber-500',
  paused: 'bg-sky-500',
  failed: 'bg-red-500',
  pending: 'bg-zinc-500',
  cancelled: 'bg-zinc-600',
};

const FIGHT_STYLE_SHORT: Record<string, string> = {
  Patchwerk: 'Patch',
  HecticAddCleave: 'Cleave',
  LightMovement: 'Move',
};

const SIM_TYPE_LABELS: Record<string, string> = {
  quick: 'Quick Sim',
  top_gear: 'Top Gear',
  top_gear_exact_stats: 'Stats Sim',
  droptimizer: 'Drop Finder',
  stat_weights: 'Stat Weights',
  stat_plot: 'Stat Plot',
  external_buff_matrix: 'External Buff Matrix',
  consumable_matrix: 'Consumable Matrix',
  trinket_tier_heatmap: 'Trinket / Tier Heatmaps',
};

function TrashIcon() {
  return <Trash2 className="h-4 w-4" strokeWidth={2} />;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <ChevronDown
      className={`h-4 w-4 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
      strokeWidth={2}
    />
  );
}

function SearchIcon() {
  return <Search className="h-4 w-4 text-zinc-500" strokeWidth={2} />;
}

function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <Pin
      className={`h-4 w-4 ${pinned ? 'fill-gold text-gold' : 'text-zinc-500'}`}
      strokeWidth={2}
    />
  );
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (target.getTime() === today.getTime()) return 'Today';
  if (target.getTime() === yesterday.getTime()) return 'Yesterday';

  return d.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function simTypeRoute(simType: string): string {
  const normalized = String(simType || '').toLowerCase();
  if (normalized.includes('top_gear') || normalized.includes('top-gear')) return '/top-gear';
  if (normalized.includes('droptimizer') || normalized.includes('drop_finder'))
    return '/drop-finder';
  if (normalized.includes('upgrade')) return '/upgrade';
  return '/quick-sim';
}

function SimulationComparison({ sims, onClose }: { sims: JobSummary[]; onClose: () => void }) {
  if (sims.length !== 2) return null;
  const [left, right] = sims;
  const dpsDelta = (left.dps ?? 0) - (right.dps ?? 0);
  const renderValue = (value: string | number | null | undefined) =>
    value == null || value === '' ? '—' : String(value);

  return (
    <section className="card border-gold/20 bg-gold/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-gold text-xs font-bold tracking-[0.16em] uppercase">Comparison</p>
          <h2 className="mt-1 text-base font-semibold text-zinc-100">
            Selected simulation results
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
          aria-label="Close comparison"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[left, right].map((sim, index) => (
          <Link
            key={sim.id}
            href={simResultHref(sim.id)}
            className="border-border bg-surface-2/70 hover:border-gold/30 rounded-lg border p-3"
          >
            <p className="text-xs font-semibold text-zinc-400">
              {index === 0 ? 'Simulation A' : 'Simulation B'}
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-zinc-100">
              {sim.player_name || 'Unnamed character'}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-zinc-500">DPS</dt>
              <dd className="text-right font-mono text-zinc-200">
                {sim.dps == null ? '—' : Math.round(sim.dps).toLocaleString()}
              </dd>
              <dt className="text-zinc-500">Type</dt>
              <dd className="text-right text-zinc-300">
                {SIM_TYPE_LABELS[sim.sim_type] || sim.sim_type}
              </dd>
              <dt className="text-zinc-500">Fight</dt>
              <dd className="text-right text-zinc-300">{renderValue(sim.fight_style)}</dd>
              <dt className="text-zinc-500">Iterations</dt>
              <dd className="text-right text-zinc-300">{renderValue(sim.iterations)}</dd>
              <dt className="text-zinc-500">Status</dt>
              <dd className="text-right text-zinc-300">{renderValue(sim.status)}</dd>
            </dl>
          </Link>
        ))}
      </div>
      <p className="mt-3 text-xs text-zinc-400">
        DPS difference:{' '}
        <span className={dpsDelta >= 0 ? 'text-emerald-300' : 'text-red-300'}>
          {dpsDelta >= 0 ? '+' : ''}
          {Math.round(dpsDelta).toLocaleString()}
        </span>
      </p>
    </section>
  );
}

function SimRow({
  sim,
  compact,
  onDelete,
  siblingGroup,
  selectable,
  selected,
  onSelectToggle,
  onTogglePinned,
  onRerun,
}: {
  sim: JobSummary;
  compact?: boolean;
  onDelete?: (id: string) => void;
  siblingGroup?: JobSummary[];
  selectable?: boolean;
  selected?: boolean;
  onSelectToggle?: (id: string, checked: boolean) => void;
  onTogglePinned?: (id: string, pinned: boolean) => void;
  onRerun?: (sim: JobSummary) => void;
}) {
  return (
    <div className="group relative flex items-center">
      {selectable && (
        <div className={`shrink-0 ${compact ? 'pl-3' : 'pl-4'}`}>
          <input
            type="checkbox"
            checked={!!selected}
            onChange={(e) => onSelectToggle?.(sim.id, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            className="border-border bg-surface-2 text-gold focus:ring-gold h-4 w-4 rounded"
            aria-label={`Select simulation ${sim.id}`}
          />
        </div>
      )}
      <Link
        href={simResultHref(sim.id)}
        onClick={() => {
          if (!siblingGroup || siblingGroup.length <= 1) {
            clearScenarioSiblings();
            return;
          }
          const siblings: ScenarioSibling[] = siblingGroup.map((s, idx) => ({
            id: s.id,
            fightStyle: s.fight_style || 'Patchwerk',
            targetCount: 0,
            fightLength: 0,
            simType: SIM_TYPE_LABELS[s.sim_type] || s.sim_type || `Scenario ${idx + 1}`,
          }));
          storeScenarioSiblings(siblings);
        }}
        className={`flex min-w-0 flex-1 items-center gap-2 transition-colors hover:bg-white/[0.03] ${compact ? 'px-3 py-2 sm:px-4' : 'px-3 py-3 sm:px-5'}`}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_COLORS[sim.status] || STATUS_COLORS.pending}`}
        />
        {!compact && (
          <span className="bg-gold/[0.08] text-gold hidden w-[80px] shrink-0 rounded-md px-2 py-0.5 text-center text-[12px] font-medium lg:inline-block">
            {SIM_TYPE_LABELS[sim.sim_type] || sim.sim_type}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {sim.player_name ? (
            <span className={`block truncate text-zinc-200 ${compact ? 'text-xs' : 'text-sm'}`}>
              {sim.player_name}
              {sim.pinned && (
                <span className="border-gold/30 bg-gold/10 text-gold ml-2 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium">
                  <PinIcon pinned />
                  Pinned
                </span>
              )}
              {sim.player_class && <span className="ml-1.5 text-zinc-500">{sim.player_class}</span>}
              {sim.sim_type === 'top_gear_exact_stats' && (
                <span className="ml-2 inline-flex items-center rounded border border-sky-400/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                  Stats Sim
                </span>
              )}
              {sim.status === 'done' && sim.upgrades != null && sim.downgrades != null && (
                <span className="ml-2 text-xs text-zinc-400">
                  &middot;{' '}
                  {sim.sim_type === 'droptimizer'
                    ? `${sim.upgrades} items upgrade vs ${sim.downgrades} downgrade`
                    : `${sim.upgrades} upgrade combinations vs ${sim.downgrades} downgrade combinations`}
                </span>
              )}
            </span>
          ) : sim.status === 'failed' ? (
            <span className={`block truncate text-red-400/80 ${compact ? 'text-xs' : 'text-sm'}`}>
              {sim.error_message || 'Failed'}
            </span>
          ) : (
            <span className={`block truncate text-zinc-500 ${compact ? 'text-xs' : 'text-sm'}`}>
              {sim.status === 'running'
                ? 'Simulating...'
                : sim.status === 'paused'
                  ? 'Paused'
                  : 'Pending...'}
            </span>
          )}
        </div>
        <span className="w-16 shrink-0 text-right font-mono text-sm text-zinc-200 tabular-nums sm:w-20">
          {sim.dps ? Math.round(sim.dps).toLocaleString() : '—'}
        </span>
        <span className="hidden w-20 shrink-0 text-right text-[13px] text-zinc-500 sm:block">
          {FIGHT_STYLE_SHORT[sim.fight_style] || sim.fight_style}
        </span>
        <div className="hidden w-20 shrink-0 text-right group-hover:opacity-0 sm:block">
          <div className="text-[12px] text-zinc-500">{timeAgo(sim.created_at)}</div>
          {sim.size_bytes > 0 && (
            <div className="text-[10px] text-zinc-600 tabular-nums">
              {formatSize(sim.size_bytes)}
            </div>
          )}
        </div>
      </Link>
      <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {onTogglePinned && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onTogglePinned(sim.id, !(sim.pinned ?? false));
            }}
            className={`hover:bg-gold/10 rounded p-1 ${sim.pinned ? 'text-gold' : 'hover:text-gold text-zinc-500'}`}
            title={sim.pinned ? 'Unpin' : 'Pin'}
          >
            <PinIcon pinned={!!sim.pinned} />
          </button>
        )}
        {onRerun && sim.status !== 'running' && sim.status !== 'pending' && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRerun(sim);
            }}
            className="rounded px-2 py-1 text-[11px] font-semibold text-zinc-300 hover:bg-white/10 hover:text-white"
            title="Rerun this simulation input"
          >
            Rerun
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(sim.id);
            }}
            className="rounded p-1 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
            title="Delete Record"
          >
            <TrashIcon />
          </button>
        )}
      </div>
    </div>
  );
}

type HistoryEntry =
  { type: 'single'; sim: JobSummary } | { type: 'batch'; batchId: string; sims: JobSummary[] };

function groupByBatch(sims: JobSummary[]): HistoryEntry[] {
  const topGearExactType = 'top_gear_exact_stats';
  const byId = new Map<string, JobSummary>();
  sims.forEach((sim) => byId.set(sim.id, sim));

  // Build parent-linked groups for exact stats sims so they render under the parent sim row.
  const parentLinkedChildren = new Map<string, JobSummary[]>();
  const consumedIds = new Set<string>();
  sims.forEach((sim) => {
    if (sim.sim_type !== topGearExactType) return;
    if (!sim.batch_id) return;
    const parent = byId.get(sim.batch_id);
    if (!parent) return;
    // Allow linking under any real parent sim type (Top Gear, Drop Finder, etc),
    // but avoid nesting under another exact-stats child.
    if (parent.sim_type === topGearExactType) return;
    const arr = parentLinkedChildren.get(parent.id) || [];
    arr.push(sim);
    parentLinkedChildren.set(parent.id, arr);
    consumedIds.add(sim.id);
  });

  const entries: HistoryEntry[] = [];
  const batchMap = new Map<string, JobSummary[]>();
  const singles: { index: number; sim: JobSummary }[] = [];

  sims.forEach((sim, index) => {
    if (consumedIds.has(sim.id)) return;
    if (sim.batch_id) {
      let group = batchMap.get(sim.batch_id);
      if (!group) {
        group = [];
        batchMap.set(sim.batch_id, group);
        singles.push({ index, sim });
      }
      group.push(sim);
    } else {
      singles.push({ index, sim });
    }
  });

  const seen = new Set<string>();
  for (const { sim } of singles) {
    const linkedChildren = parentLinkedChildren.get(sim.id);
    if (linkedChildren && linkedChildren.length > 0) {
      entries.push({
        type: 'batch',
        batchId: `parent-${sim.id}`,
        sims: [sim, ...linkedChildren],
      });
      continue;
    }
    if (sim.batch_id) {
      if (seen.has(sim.batch_id)) continue;
      seen.add(sim.batch_id);
      entries.push({ type: 'batch', batchId: sim.batch_id, sims: batchMap.get(sim.batch_id)! });
    } else {
      entries.push({ type: 'single', sim });
    }
  }
  return entries;
}

function BatchGroup({
  entry,
  onDelete,
  selectedIds,
  onBatchSelectToggle,
  onRowSelectToggle,
  onTogglePinned,
  onRerun,
}: {
  entry: Extract<HistoryEntry, { type: 'batch' }>;
  onDelete?: (id: string) => void;
  selectedIds?: Set<string>;
  onBatchSelectToggle?: (ids: string[], checked: boolean) => void;
  onRowSelectToggle?: (id: string, checked: boolean) => void;
  onTogglePinned?: (id: string, pinned: boolean) => void;
  onRerun?: (sim: JobSummary) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const first = entry.sims[0];
  const simType = SIM_TYPE_LABELS[first?.sim_type] || first?.sim_type || 'Sim';
  const bestDps = Math.max(...entry.sims.map((s) => s.dps ?? 0));
  const batchSize = entry.sims.reduce((acc, s) => acc + s.size_bytes, 0);
  const batchIds = entry.sims.map((s) => s.id);
  const selectedCount = batchIds.filter((id) => selectedIds?.has(id)).length;
  const isBatchChecked = selectedCount > 0 && selectedCount === batchIds.length;
  const isBatchIndeterminate = selectedCount > 0 && selectedCount < batchIds.length;

  return (
    <div className="border-border border-b last:border-b-0">
      <div
        className="group relative flex cursor-pointer items-center gap-2 px-3 py-3 transition-colors hover:bg-white/[0.03] sm:gap-3 sm:px-5"
        onClick={() => setIsOpen(!isOpen)}
      >
        <input
          type="checkbox"
          checked={isBatchChecked}
          ref={(el) => {
            if (!el) return;
            el.indeterminate = isBatchIndeterminate;
          }}
          onChange={(e) => onBatchSelectToggle?.(batchIds, e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          className="border-border bg-surface-2 text-gold focus:ring-gold h-4 w-4 shrink-0 rounded"
          aria-label={`Select batch ${entry.batchId}`}
        />
        <ChevronIcon open={isOpen} />

        <span className="bg-gold/[0.08] text-gold hidden w-[80px] shrink-0 rounded-md px-2 py-0.5 text-center text-[12px] font-medium lg:inline-block">
          {simType}
        </span>

        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-zinc-200">
            {first?.player_name || 'Character'} &middot; {entry.sims.length} Scenarios
          </span>
        </div>

        <span className="w-16 shrink-0 text-right font-mono text-sm text-zinc-200 tabular-nums sm:w-20">
          {bestDps > 0 ? Math.round(bestDps).toLocaleString() : '—'}
        </span>

        <span className="hidden w-20 shrink-0 sm:block" />

        <div className="hidden w-20 shrink-0 text-right group-hover:opacity-0 sm:block">
          <div className="text-[12px] text-zinc-600">{timeAgo(first?.created_at)}</div>
          {batchSize > 0 && (
            <div className="text-[10px] text-zinc-700 tabular-nums">{formatSize(batchSize)}</div>
          )}
        </div>

        <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete all ${entry.sims.length} scenarios in this batch?`)) {
                  entry.sims.forEach((s) => onDelete(s.id));
                }
              }}
              className="rounded p-1 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
              title="Delete Entire Batch"
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="border-border/50 bg-surface-2/50 border-t pl-4">
          <div className="divide-border/30 divide-y">
            {entry.sims.map((sim) => (
              <SimRow
                key={sim.id}
                sim={sim}
                compact
                onDelete={onDelete}
                siblingGroup={entry.sims}
                selectable
                selected={selectedIds?.has(sim.id)}
                onSelectToggle={onRowSelectToggle}
                onTogglePinned={onTogglePinned}
                onRerun={onRerun}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
  const { lightMode } = useAuth();
  const { notify } = useNotifications();
  const router = useRouter();
  const { setSimcInput } = useSimContext();
  const [sims, setSims] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [pinFilter, setPinFilter] = useState<'all' | 'pinned' | 'unpinned'>('all');
  const [character, setCharacter] = useState<{
    name: string;
    realm: string;
    region?: string;
  } | null>(null);
  const [bnetCharacters, setBnetCharacters] = useState<
    { name: string; realm: string; region: string; source?: 'bnet' | 'history' }[]
  >([]);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [maxJobs, setMaxJobs] = useState<number>(50);
  const [search, setSearch] = useState('');
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkPinning, setBulkPinning] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Fetch account characters and historical characters
    Promise.all([
      lightMode
        ? Promise.resolve({ characters: [] })
        : fetchJson<{ characters: any[] }>(`${API_URL}/api/bnet/user/characters`).catch(() => ({
            characters: [],
          })),
      fetchJson<any[]>(`${API_URL}/api/history/characters`).catch(() => []),
    ])

      .then(([bnetResponse, historyData]) => {
        const bnetList = Array.isArray(bnetResponse)
          ? bnetResponse
          : bnetResponse?.characters || [];
        const merged: any[] = bnetList.map((c: any) => ({ ...c, source: 'bnet' }));
        const historyList = Array.isArray(historyData) ? historyData : [];

        for (const h of historyList) {
          if (
            !merged.find(
              (m) =>
                m.name.toLowerCase() === h.name.toLowerCase() &&
                m.realm.toLowerCase() === h.realm.toLowerCase()
            )
          ) {
            merged.push({ ...h, source: 'history' });
          }
        }
        setBnetCharacters(merged);
      })
      .catch(() => {});
  }, [lightMode]);

  const refreshHistory = useCallback(async () => {
    try {
      let url = `${API_URL}/api/sims`;
      if (showPinnedOnly) {
        url += '?pinned_only=true';
      } else if (character && character.name && character.realm) {
        url += `?player=${encodeURIComponent(character.name)}&realm=${encodeURIComponent(character.realm)}&linked_only=true`;
      }

      const [simsData, statsData] = await Promise.all([
        fetchJson<JobSummary[]>(url),
        getHistoryStats(),
      ]);
      setSims(simsData);
      setStats(statsData);
      setSelectedIds(new Set());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load simulation history.');
    }
  }, [character, showPinnedOnly]);

  useEffect(() => {
    setLoading(true);
    // Initial fetch for history and configuration
    Promise.all([refreshHistory(), getConfig().then((cfg) => setMaxJobs(cfg.max_jobs))]).finally(
      () => setLoading(false)
    );
  }, [refreshHistory]);

  const handleDelete = async (id: string) => {
    try {
      await deleteSim(id);
      await refreshHistory();
    } catch (err) {
      notify({
        title: 'Could not delete simulation',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'error',
      });
    }
  };

  const handleRerun = useCallback(
    async (sim: JobSummary) => {
      setRerunError(null);
      try {
        const response = await fetch(`${API_URL}/api/sim/${encodeURIComponent(sim.id)}/input`, {
          credentials: 'include',
        });
        if (!response.ok) throw new Error(`Unable to load simulation input (${response.status})`);
        const input = await response.text();
        if (!input.trim()) throw new Error('Simulation input was empty');
        setSimcInput(input);
        try {
          sessionStorage.setItem('whylowdps_simc_input', input);
        } catch {
          // Shared context still carries the input when session storage is unavailable.
        }
        router.push(simTypeRoute(sim.sim_type));
      } catch {
        setRerunError(
          'This simulation input could not be loaded. The original result is still available.'
        );
      }
    },
    [router, setSimcInput]
  );

  const handleTogglePinned = async (id: string, pinned: boolean) => {
    setSims((prev) => prev.map((sim) => (sim.id === id ? { ...sim, pinned } : sim)));
    try {
      await setSimPinned(id, pinned);
    } catch {
      setSims((prev) => prev.map((sim) => (sim.id === id ? { ...sim, pinned: !pinned } : sim)));
    }
  };

  const handleToggleSelection = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleToggleBatchSelection = useCallback((ids: string[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => {
        if (checked) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  }, []);

  const handleClear = async () => {
    if (!confirm('Are you sure you want to clear ALL history?')) return;
    try {
      await clearHistory();
      await refreshHistory();
    } catch (err) {
      notify({
        title: 'Could not clear history',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'error',
      });
    }
  };

  const handleMaxJobsChange = async (val: string) => {
    const num = parseInt(val);
    if (isNaN(num) || num < 1) return;
    setMaxJobs(num);
    try {
      await updateConfig({ max_jobs: num });
      await refreshHistory();
    } catch (err) {
      notify({
        title: 'Could not update history limit',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'error',
      });
    }
  };

  const filteredEntries = useMemo(() => {
    const query = search.toLowerCase().trim();
    const filtered = query
      ? sims.filter(
          (s) =>
            s.player_name?.toLowerCase().includes(query) ||
            s.sim_type.toLowerCase().includes(query) ||
            SIM_TYPE_LABELS[s.sim_type]?.toLowerCase().includes(query) ||
            s.player_class?.toLowerCase().includes(query)
        )
      : sims;
    const pinFiltered =
      pinFilter === 'all'
        ? filtered
        : pinFilter === 'pinned'
          ? filtered.filter((s) => !!s.pinned)
          : filtered.filter((s) => !s.pinned);

    const grouped = groupByBatch(pinFiltered);

    // Group by date
    const dateGroups: Record<string, HistoryEntry[]> = {};
    grouped.forEach((entry) => {
      const date = entry.type === 'single' ? entry.sim.created_at : entry.sims[0].created_at;
      const header = formatDateHeader(date);
      if (!dateGroups[header]) dateGroups[header] = [];
      dateGroups[header].push(entry);
    });

    return dateGroups;
  }, [sims, search, pinFilter]);

  const pinnedCount = useMemo(() => sims.filter((s) => !!s.pinned).length, [sims]);
  const unpinnedCount = useMemo(() => sims.filter((s) => !s.pinned).length, [sims]);

  const visibleIds = useMemo(() => {
    const ids: string[] = [];
    Object.values(filteredEntries).forEach((entries) => {
      entries.forEach((entry) => {
        if (entry.type === 'single') ids.push(entry.sim.id);
        else ids.push(...entry.sims.map((s) => s.id));
      });
    });
    return ids;
  }, [filteredEntries]);

  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));
  const comparisonSims = useMemo(
    () =>
      compareIds
        .map((id) => sims.find((sim) => sim.id === id))
        .filter((sim): sim is JobSummary => !!sim),
    [compareIds, sims]
  );

  const handleToggleSelectAllVisible = useCallback(
    (checked: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => {
          if (checked) next.add(id);
          else next.delete(id);
        });
        return next;
      });
    },
    [visibleIds]
  );

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected simulation record(s)?`)) return;
    setBulkDeleting(true);
    try {
      await Promise.all(Array.from(selectedIds).map((id) => deleteSim(id)));
      await refreshHistory();
    } catch (err) {
      notify({
        title: 'Could not delete all selected simulations',
        description: err instanceof Error ? err.message : 'Some records may not have been deleted.',
        variant: 'error',
      });
    } finally {
      setBulkDeleting(false);
    }
  }, [notify, refreshHistory, selectedIds]);

  const handleBulkPin = useCallback(
    async (pinned: boolean) => {
      if (selectedIds.size === 0) return;
      const ids = Array.from(selectedIds);
      setBulkPinning(true);
      setSims((prev) => prev.map((sim) => (selectedIds.has(sim.id) ? { ...sim, pinned } : sim)));
      try {
        await Promise.all(ids.map((id) => setSimPinned(id, pinned)));
      } catch {
        notify({
          title: 'Could not update pinned state',
          description: 'The selected records were refreshed locally, but the server update failed.',
          variant: 'error',
        });
        setSims((prev) =>
          prev.map((sim) => (selectedIds.has(sim.id) ? { ...sim, pinned: !pinned } : sim))
        );
      } finally {
        setBulkPinning(false);
      }
    },
    [notify, selectedIds]
  );

  if (loading) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted text-sm">Loading history...</p>
      </div>
    );
  }

  const groupKeys = Object.keys(filteredEntries);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 px-1 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-medium text-zinc-100">Simulation History</h2>
          {stats && (
            <span className="text-xs text-zinc-500">
              {unpinnedCount} regular + {pinnedCount} pinned &middot; {formatSize(stats.size_bytes)}
            </span>
          )}
        </div>
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200"
          >
            <div className="flex items-center justify-between gap-3">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => void refreshHistory()}
                className="font-semibold hover:text-white"
              >
                Try again
              </button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:flex xl:flex-wrap xl:items-center">
          <div className="xl:border-border flex min-w-0 items-center gap-2 xl:border-r xl:pr-2">
            <span className="text-xs text-zinc-500">Filter by Character:</span>
            <select
              className="border-border bg-surface-2 focus:border-gold min-w-0 flex-1 rounded-md border px-2 py-1.5 text-xs text-zinc-200 focus:outline-none xl:w-48 xl:flex-none"
              value={character ? `${character.name}-${character.realm}` : 'all'}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'all') {
                  setCharacter(null);
                } else {
                  const [name, realm] = val.split('-');
                  setCharacter({ name, realm });
                }
              }}
            >
              <option value="all">All Sims</option>
              {bnetCharacters.map((c, i) => (
                <option key={i} value={`${c.name}-${c.realm}`}>
                  {c.name} - {c.realm} {c.source === 'history' ? '(History)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="xl:border-border flex min-w-0 items-center gap-2 xl:border-r xl:pr-2">
            <span className="text-xs text-zinc-500">Pin Filter:</span>
            <select
              className="border-border bg-surface-2 focus:border-gold min-w-0 flex-1 rounded-md border px-2 py-1.5 text-xs text-zinc-200 focus:outline-none xl:w-28 xl:flex-none"
              value={pinFilter}
              onChange={(e) => {
                const val = e.target.value as 'all' | 'pinned' | 'unpinned';
                setPinFilter(val);
                setShowPinnedOnly(val === 'pinned');
              }}
            >
              <option value="all">All</option>
              <option value="pinned">Pinned</option>
              <option value="unpinned">Not Pinned</option>
            </select>
          </div>
          <div className="relative min-w-0">
            <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center">
              <SearchIcon />
            </div>
            <input
              type="text"
              placeholder="Search history..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-border bg-surface-2 focus:border-gold w-full rounded-md border py-1.5 pr-3 pl-8 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none xl:w-48"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500">Keep last:</label>
            <input
              type="number"
              value={maxJobs}
              onChange={(e) => setMaxJobs(parseInt(e.target.value) || 0)}
              onBlur={(e) => handleMaxJobsChange(e.target.value)}
              className="border-border bg-surface-2 focus:border-gold w-16 rounded border px-1.5 py-1 text-xs text-zinc-300 focus:outline-none"
            />
          </div>
          {sims.length > 0 && (
            <button
              onClick={handleClear}
              className="rounded bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 xl:ml-auto"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {rerunError && (
        <div
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
          role="alert"
        >
          {rerunError}
        </div>
      )}
      {comparisonSims.length === 2 && (
        <SimulationComparison sims={comparisonSims} onClose={() => setCompareIds([])} />
      )}

      {groupKeys.length === 0 ? (
        <div className="card py-12 text-center">
          <p className="text-muted text-sm">
            {search
              ? 'No records match your search.'
              : pinFilter === 'pinned'
                ? 'No pinned simulations found.'
                : pinFilter === 'unpinned'
                  ? 'No unpinned simulations found.'
                  : character
                    ? `No simulations found for ${character.name} on ${character.realm}.`
                    : 'No simulations yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="border-border bg-surface/95 sticky top-[var(--app-header-height)] z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2 backdrop-blur">
            <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={(el) => {
                  if (!el) return;
                  el.indeterminate = !allVisibleSelected && someVisibleSelected;
                }}
                onChange={(e) => handleToggleSelectAllVisible(e.target.checked)}
                className="border-border bg-surface-2 text-gold focus:ring-gold h-4 w-4 rounded"
              />
              Select all visible
            </label>
            <span className="text-xs text-zinc-500">{selectedIds.size} selected</span>
          </div>
          {groupKeys.map((group) => (
            <div key={group} className="space-y-2">
              <h3 className="px-1 text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
                {group}
              </h3>
              <div className="card overflow-hidden">
                {filteredEntries[group].map((entry, idx) => {
                  const id =
                    entry.type === 'single'
                      ? `single-${entry.sim.id}-${idx}`
                      : `batch-${entry.batchId}-${idx}`;
                  const isLast = idx === filteredEntries[group].length - 1;
                  return (
                    <div key={id} className={!isLast ? 'border-border border-b' : ''}>
                      {entry.type === 'single' ? (
                        <SimRow
                          sim={entry.sim}
                          onDelete={handleDelete}
                          selectable
                          selected={selectedIds.has(entry.sim.id)}
                          onSelectToggle={handleToggleSelection}
                          onTogglePinned={handleTogglePinned}
                          onRerun={handleRerun}
                        />
                      ) : (
                        <BatchGroup
                          entry={entry}
                          onDelete={handleDelete}
                          selectedIds={selectedIds}
                          onBatchSelectToggle={handleToggleBatchSelection}
                          onRowSelectToggle={handleToggleSelection}
                          onTogglePinned={handleTogglePinned}
                          onRerun={handleRerun}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {selectedIds.size > 0 && (
        <div className="border-border bg-surface/95 fixed bottom-4 left-1/2 z-50 flex w-[min(95vw,760px)] -translate-x-1/2 flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur">
          <div className="text-sm text-zinc-200">
            {selectedIds.size} record{selectedIds.size === 1 ? '' : 's'} selected
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size === 2 && (
              <button
                onClick={() => setCompareIds(Array.from(selectedIds))}
                disabled={bulkDeleting || bulkPinning}
                className="inline-flex items-center gap-1.5 rounded-md border border-sky-400/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-500/20 disabled:opacity-50"
              >
                <GitCompareArrows className="h-3.5 w-3.5" />
                Compare Selected
              </button>
            )}
            <button
              onClick={() => handleBulkPin(true)}
              disabled={bulkDeleting || bulkPinning}
              className="border-gold/30 text-gold hover:bg-gold/10 rounded-md border px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {bulkPinning ? 'Pinning...' : 'Pin Selected'}
            </button>
            <button
              onClick={() => handleBulkPin(false)}
              disabled={bulkDeleting || bulkPinning}
              className="border-border hover:bg-surface-2 rounded-md border px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-50"
            >
              {bulkPinning ? 'Updating...' : 'Unpin Selected'}
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              disabled={bulkDeleting || bulkPinning}
              className="border-border hover:bg-surface-2 rounded-md border px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-50"
            >
              Cancel Selection
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting || bulkPinning}
              className="inline-flex items-center gap-2 rounded-md bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/25 disabled:opacity-50"
            >
              {bulkDeleting && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-red-200/40 border-t-red-300" />
              )}
              Delete Selected
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

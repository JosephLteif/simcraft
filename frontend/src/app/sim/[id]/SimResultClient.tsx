'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, CircleAlert } from 'lucide-react';
import DpsHeroCard from '../../components/DpsHeroCard';
import type { GearItem } from '../../components/GearOverview';
import GearOverview from '../../components/GearOverview';
import ResultsChart from '../../components/ResultsChart';
import SimStatsComparisonCard from '../../components/SimStatsComparisonCard';
import SimStatus from '../../components/SimStatus';
import StatPlotChart from '../../components/StatPlotChart';
import StatWeightsTable from '../../components/StatWeightsTable';
import TopGearResults from '../../components/TopGearResults';
import TrinketTierHeatmap from '../../components/TrinketTierHeatmap';
import ExternalBuffMatrixChart from '../../components/ExternalBuffMatrixChart';
import ConsumableMatrixChart from '../../components/ConsumableMatrixChart';
import SimResultTalentsCard from '../../components/SimResultTalentsCard';
import SimTimelineAnalyzer from '../../components/SimTimelineAnalyzer';
import { calculateAverageIlevel } from '../../lib/ilevel';
import CharacterLinkButton from '../../components/CharacterLinkButton';
import { useAuth } from '../../components/AuthContext';
import type { StatSnapshot } from '../../lib/stat-snapshot';
import type { ResultItem, TopGearResult } from '../../lib/types';
import {
  AUGMENT_RUNE_OPTIONS,
  EXTERNAL_BUFF_OPTIONS,
  FLASK_OPTIONS,
  FOOD_OPTIONS,
  POTION_OPTIONS,
  RAID_BUFF_MATRIX_OPTIONS,
  TEMP_ENCHANT_OPTIONS,
} from '../../lib/sim-options-catalog';
import { parseCharacterInfo, parseSimcBuffs, SimcBuff } from '@/lib/simc-parser';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import { useNotifications } from '../../components/shared/NotificationSystem';

import { API_URL, fetchJson } from '../../lib/api';
import { formatScenarioLabel, getScenarioSiblings, type ScenarioSibling } from '../../lib/scenario-siblings';
import { simResultHref } from '../../lib/routes';
import { trackSimulations } from '../../lib/sim-tracking';
import { getSimReturnTarget, resolveSimAgainNavigation, setSimReturnNotice } from '../../lib/sim-return';

interface JobData {
  id: string;
  status: string;
  sim_type?: string;
  simc_input?: string;
  options?: Record<string, unknown> | null;
  created_at?: string;
  progress: number;
  progress_stage?: string;
  progress_detail?: string;
  stages_completed?: string[];
  stage_timings?: Array<{ name: string; elapsed: number }>;
  active_stage_elapsed?: number;
  result: Record<string, unknown> | null;
  error: string | null;
  profilesets_completed?: number;
  profilesets_total?: number;
  cpu_pct?: number;
  mem_bytes?: number;
  cpu_cores?: number;
  iterations?: number;
  iterations_completed?: number;
  fight_style?: string;
  region?: string;
  linked_region?: string;
  linked_realm?: string;
  linked_name?: string;
  batch_id?: string | null;
  pause_available?: boolean;
  resume_available?: boolean;
}

interface TimelinePoint {
  t: number;
  v: number;
}

interface TimelineEvent {
  t: number;
  spell_name: string;
  spell_id?: number;
  target?: string;
  queue_failed?: boolean;
}

function simTypeLabel(simType?: string): string {
  return (
    (
      {
        quick: 'Quick Sim',
        top_gear: 'Top Gear',
        droptimizer: 'Drop Finder',
        upgrade_compare: 'Upgrade Planner',
      } as Record<string, string>
    )[simType || ''] ||
    simType ||
    'Simulation'
  );
}

function isActiveSimStatus(status: string): boolean {
  return status === 'pending' || status === 'running' || status === 'paused';
}

function isTerminalSimStatus(status: string): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled';
}

const iconCache = new Map<string, string>();

function useIcons(entries: { type: 'spell' | 'item'; id: number }[]) {
  const [icons, setIcons] = useState<Map<string, string>>(new Map());
  const depKey = entries.map((e) => `${e.type}:${e.id}`).join(',');

  useEffect(() => {
    const missing = entries.filter((e) => e.id > 0 && !iconCache.has(`${e.type}:${e.id}`));
    if (missing.length === 0) {
      setIcons(new Map(iconCache));
      return;
    }

    let cancelled = false;
    Promise.all(
      missing.map(async (entry) => {
        try {
          const res = await fetch(
            `https://nether.wowhead.com/tooltip/${entry.type}/${entry.id}?dataEnv=1&locale=0`
          );
          if (!res.ok) return;
          const data = await res.json();
          if (data.icon) iconCache.set(`${entry.type}:${entry.id}`, data.icon);
        } catch {
          // ignore
        }
      })
    ).then(() => {
      if (!cancelled) setIcons(new Map(iconCache));
    });

    return () => {
      cancelled = true;
    };
  }, [depKey, entries]);

  return icons;
}

function parseSeriesPoints(input: unknown): TimelinePoint[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry, idx) => {
      if (typeof entry === 'number') {
        return { t: idx, v: entry };
      }
      if (!entry || typeof entry !== 'object') return null;
      const obj = entry as Record<string, unknown>;
      const tRaw = obj.x ?? obj.time;
      const vRaw = obj.v ?? obj.value ?? obj.dps;
      if (typeof vRaw !== 'number') return null;
      return {
        t: typeof tRaw === 'number' ? tRaw : idx,
        v: vRaw,
      };
    })
    .filter((v): v is TimelinePoint => v !== null);
}

function buildTimelineFromRaw(raw: any): { timeline: any | null; apl: any | null } {
  const player = raw?.sim?.players?.[0];
  const collected = player?.collected_data;
  const actionSeq = collected?.action_sequence;
  const rowFormat = Array.isArray(actionSeq) ? actionSeq : null;
  const timeCol = !rowFormat && Array.isArray(actionSeq?.time) ? actionSeq.time : null;
  const spellNameCol =
    !rowFormat && Array.isArray(actionSeq?.spell_name) ? actionSeq.spell_name : [];
  const nameCol = !rowFormat && Array.isArray(actionSeq?.name) ? actionSeq.name : [];
  const spellIdCol = !rowFormat && Array.isArray(actionSeq?.id) ? actionSeq.id : [];
  const targetCol = !rowFormat && Array.isArray(actionSeq?.target) ? actionSeq.target : [];
  const queueFailedCol =
    !rowFormat && Array.isArray(actionSeq?.queue_failed) ? actionSeq.queue_failed : [];

  const totalEvents = rowFormat ? rowFormat.length : (timeCol?.length ?? 0);
  if (totalEvents === 0) return { timeline: null, apl: null };

  const maxEvents = 2000;
  const events: TimelineEvent[] = [];
  const cooldownEvents: TimelineEvent[] = [];
  const actionCounts = new Map<string, { count: number; spellId?: number }>();
  let queueFailures = 0;
  let lastT: number | null = null;
  const deltas: number[] = [];

  const cooldownSpellIds = new Set<number>();
  if (Array.isArray(player?.buffs)) {
    for (const buff of player.buffs) {
      if (buff?.cooldown && typeof buff?.spell === 'number' && buff.spell > 0) {
        cooldownSpellIds.add(buff.spell);
      }
    }
  }

  for (let i = 0; i < Math.min(totalEvents, maxEvents); i += 1) {
    const row = rowFormat?.[i];
    const t =
      typeof row?.time === 'number' ? row.time : typeof timeCol?.[i] === 'number' ? timeCol[i] : 0;
    const sn =
      typeof row?.spell_name === 'string'
        ? row.spell_name
        : typeof spellNameCol[i] === 'string'
          ? spellNameCol[i]
          : '';
    const nn =
      typeof row?.name === 'string' ? row.name : typeof nameCol[i] === 'string' ? nameCol[i] : '';
    const evName = sn || nn || 'Unknown';
    const sid =
      typeof row?.id === 'number'
        ? row.id
        : typeof spellIdCol[i] === 'number'
          ? spellIdCol[i]
          : undefined;
    const tgt =
      typeof row?.target === 'string'
        ? row.target
        : typeof targetCol[i] === 'string'
          ? targetCol[i]
          : '';
    const qf = row?.queue_failed === true || queueFailedCol[i] === true;

    if (qf) queueFailures += 1;
    if (lastT !== null && t > lastT) deltas.push(t - lastT);
    lastT = t;

    const existing = actionCounts.get(evName);
    if (existing) {
      existing.count += 1;
      if (!existing.spellId && sid) existing.spellId = sid;
    } else {
      actionCounts.set(evName, { count: 1, spellId: sid });
    }

    const event: TimelineEvent = {
      t,
      spell_name: evName,
      target: tgt,
      queue_failed: qf,
      ...(sid ? { spell_id: sid } : {}),
    };
    events.push(event);
    if (sid && cooldownSpellIds.has(sid)) {
      cooldownEvents.push(event);
    }
  }

  const dpsSeries = parseSeriesPoints(collected?.timeline_dmg?.data);

  const resourceTimelines =
    collected?.resource_timelines && typeof collected.resource_timelines === 'object'
      ? (collected.resource_timelines as Record<string, any>)
      : {};
  const resourceOrder = [
    'mana',
    'energy',
    'rage',
    'focus',
    'runic_power',
    'insanity',
    'soul_shard',
    'holy_power',
    'combo_points',
    'maelstrom',
    'fury',
    'astral_power',
    'chi',
  ];
  const resourceType =
    resourceOrder.find((k) => resourceTimelines[k]) || Object.keys(resourceTimelines)[0] || null;
  const resourceSeriesMap = Object.fromEntries(
    Object.entries(resourceTimelines)
      .map(([key, value]) => [key, parseSeriesPoints((value as any)?.data)])
      .filter(([, series]) => Array.isArray(series) && series.length > 0)
  );
  const resourceSeries =
    resourceType && Array.isArray(resourceSeriesMap[resourceType])
      ? resourceSeriesMap[resourceType]
      : [];

  const buffUptimes = Array.isArray(player?.buffs)
    ? player.buffs
        .map((buff: any) => {
          const uptime = typeof buff?.uptime === 'number' ? buff.uptime : 0;
          if (uptime <= 0) return null;
          const normalizedName =
            (typeof buff?.spell_name === 'string' ? buff.spell_name : '') ||
            (typeof buff?.name === 'string' ? buff.name : '');
          const name = normalizedName.trim();
          if (!name) return null;
          return {
            name,
            uptime_pct: uptime,
            ...(typeof buff?.spell === 'number' && buff.spell > 0 ? { spell_id: buff.spell } : {}),
            ...(buff?.cooldown ? { is_cooldown: true } : {}),
          };
        })
        .filter((b: any) => b !== null)
        .sort((a: any, b: any) => b.uptime_pct - a.uptime_pct)
    : [];

  const totalActions = events.length;
  const topActions = [...actionCounts.entries()]
    .map(([actionName, info]) => ({
      name: actionName,
      count: info.count,
      share_pct: totalActions > 0 ? (info.count / totalActions) * 100 : 0,
      ...(info.spellId ? { spell_id: info.spellId } : {}),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const avgDelta =
    deltas.length > 0 ? deltas.reduce((sum, v) => sum + v, 0) / deltas.length : undefined;

  const timeline = {
    events,
    cooldown_events: cooldownEvents,
    dps_series: dpsSeries,
    ...(resourceSeries.length > 0 ? { resource_series: resourceSeries } : {}),
    ...(Object.keys(resourceSeriesMap).length > 0
      ? { resource_series_map: resourceSeriesMap }
      : {}),
    ...(resourceType ? { resource_type: resourceType } : {}),
    buff_uptimes: buffUptimes,
    event_count: totalEvents,
    events_truncated: totalEvents > maxEvents,
  };

  const apl = {
    total_actions: totalActions,
    unique_actions: actionCounts.size,
    queue_failures: queueFailures,
    top_actions: topActions,
    ...(avgDelta != null
      ? {
          gcd_spacing: {
            avg: avgDelta,
            min: Math.min(...deltas),
            max: Math.max(...deltas),
          },
        }
      : {}),
  };

  return { timeline, apl };
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between border-b border-border/60 bg-white/[0.01] px-5 py-3.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        <span className="text-xs font-medium uppercase tracking-widest text-muted">{title}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-zinc-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          strokeWidth={2}
        />
      </button>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}

export default function SimResultClient() {
  const router = useRouter();
  const { lightMode } = useAuth();
  const { notify } = useNotifications();
  const params = useParams();
  const searchParams = useSearchParams();
  const paramId = params.id as string;
  const queryId = (searchParams.get('id') || '').trim();

  // Robust ID resolution from params or URL
  let id = queryId || paramId;
  if ((!paramId || paramId === '_') && typeof window !== 'undefined') {
    const query = new URLSearchParams(window.location.search);
    const queryIdFromUrl = (query.get('id') || '').trim();
    if (queryIdFromUrl) {
      id = queryIdFromUrl;
    }

    const parts = window.location.pathname.split('/');
    // Sims IDs are uuid or nanoid and are generally 20+ chars
    const foundId = parts.find((p) => p.length > 20 && (p.includes('-') || /^[a-f0-9]+$/i.test(p)));
    if (foundId) {
      id = foundId;
    }
  }
  const [activeScenarioId, setActiveScenarioId] = useState(id);

  const [job, setJob] = useState<JobData | null>(null);
  const [fetchError, setFetchError] = useState('');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(true);
  const logCursorRef = useRef(0);
  const [timelineFallback, setTimelineFallback] = useState<any | null>(null);
  const [aplFallback, setAplFallback] = useState<any | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [siblings, setSiblings] = useState<ScenarioSibling[] | null>(null);
  const [liveRelatedScenarios, setLiveRelatedScenarios] = useState<ScenarioSibling[]>([]);
  const [siblingStatuses, setSiblingStatuses] = useState<Record<string, string>>({});
  const [rerunError, setRerunError] = useState('');
  const [rerunning, setRerunning] = useState(false);
  const previousStatusRef = useRef<string | null>(null);

  useEffect(() => {
    if (id && id !== '_' && id !== activeScenarioId) {
      setActiveScenarioId(id);
    }
  }, [id, activeScenarioId]);

  useEffect(() => {
    previousStatusRef.current = null;
  }, [activeScenarioId]);

  const r = job?.result as any;
  const timelineFallbackData = timelineFallback;
  const aplFallbackData = aplFallback;
  const timelineData = (r?.timeline as Record<string, unknown> | undefined) || timelineFallbackData;
  const aplData = (r?.apl_analysis as Record<string, unknown> | undefined) || aplFallbackData;

  const info = useMemo(() => {
    if (!job?.simc_input) return null;
    try {
      return parseCharacterInfo(job.simc_input);
    } catch {
      return null;
    }
  }, [job?.simc_input]);

  const activeBuffs = useMemo(() => {
    if (!job) return [];

    // 1. Get base buffs from simc_input parser (mostly for consumables/others)
    const baseBuffs = job.simc_input ? parseSimcBuffs(job.simc_input) : [];

    // 2. Overlay or override from job.options (the source of truth for checkboxes)
    const options = (job as any).options || {};
    const finalBuffs: SimcBuff[] = [];

    // If options.raid_buff_customized is false, everything is "enabled" by default in backend.
    // If true, we check specific flags.
    const customized = options.raid_buff_customized === true;

    if (!customized) {
      // Default set
      finalBuffs.push({ name: 'Bloodlust', category: 'raid_buff', spellId: 2825 });
      finalBuffs.push({ name: 'Arcane Intellect', category: 'raid_buff', spellId: 1459 });
      finalBuffs.push({ name: 'Power Word: Fortitude', category: 'raid_buff', spellId: 21562 });
      finalBuffs.push({ name: 'Mark of the Wild', category: 'raid_buff', spellId: 1126 });
      finalBuffs.push({ name: 'Battle Shout', category: 'raid_buff', spellId: 6673 });
      finalBuffs.push({ name: 'Mystic Touch', category: 'raid_buff', spellId: 8647 });
      finalBuffs.push({ name: 'Chaos Brand', category: 'raid_buff', spellId: 1490 });
    } else {
      if (options.raid_buff_bloodlust)
        finalBuffs.push({ name: 'Bloodlust', category: 'raid_buff', spellId: 2825 });
      if (options.raid_buff_arcane_intellect)
        finalBuffs.push({ name: 'Arcane Intellect', category: 'raid_buff', spellId: 1459 });
      if (options.raid_buff_power_word_fortitude)
        finalBuffs.push({ name: 'Power Word: Fortitude', category: 'raid_buff', spellId: 21562 });
      if (options.raid_buff_mark_of_the_wild)
        finalBuffs.push({ name: 'Mark of the Wild', category: 'raid_buff', spellId: 1126 });
      if (options.raid_buff_battle_shout)
        finalBuffs.push({ name: 'Battle Shout', category: 'raid_buff', spellId: 6673 });
      if (options.external_buff_mystic_touch)
        finalBuffs.push({ name: 'Mystic Touch', category: 'raid_buff', spellId: 8647 });
      if (options.external_buff_chaos_brand)
        finalBuffs.push({ name: 'Chaos Brand', category: 'raid_buff', spellId: 1490 });
      if (options.external_buff_skyfury)
        finalBuffs.push({ name: 'Skyfury', category: 'raid_buff', spellId: 462854 });
      if (options.external_buff_power_infusion)
        finalBuffs.push({ name: 'Power Infusion', category: 'raid_buff', spellId: 10060 });
      if (options.external_buff_augmentation)
        finalBuffs.push({ name: 'Ebon Might (Aug)', category: 'raid_buff', spellId: 395152 });
    }

    // Add consumables from options or base
    const allCatalog = [
      ...FLASK_OPTIONS,
      ...FOOD_OPTIONS,
      ...POTION_OPTIONS,
      ...AUGMENT_RUNE_OPTIONS,
      ...TEMP_ENCHANT_OPTIONS,
    ];

    const consumables = baseBuffs
      .filter((b) => b.category !== 'raid_buff')
      .map((b) => {
        // Normalize name: lowercase and underscore for better matching
        let normName = b.name.toLowerCase().replace(/\s+/g, '_');
        // Handle rank suffixes often used in SimC
        normName = normName.replace(/_rank([0-9])/, '_$1');

        // Try to find exact match on token or loose match on name/label
        const match = allCatalog.find(
          (c) =>
            (c.token &&
              (normName === c.token.toLowerCase() ||
                c.token.toLowerCase().endsWith(normName) ||
                c.token.toLowerCase().includes(normName) ||
                normName.endsWith(c.token.toLowerCase()) ||
                normName.includes(c.token.toLowerCase()))) ||
            b.name.toLowerCase() === c.label.toLowerCase() ||
            b.name.toLowerCase().includes(c.label.toLowerCase()) ||
            c.label.toLowerCase().includes(b.name.toLowerCase()) ||
            // Special case for flask/potion/food/etc prefixes
            (b.category === 'flask' && c.key.includes(normName)) ||
            (b.category === 'potion' && c.key.includes(normName))
        );

        if (match) {
          return {
            ...b,
            name: match.label,
            icon: match.icon,
            spellId: b.spellId || match.spellId,
            itemId: match.itemId,
          };
        }
        return b;
      });
    finalBuffs.push(...consumables);

    return finalBuffs.map((buff) => {
      // For raid buffs, also try to find icon from catalog if not present
      if (buff.category === 'raid_buff' && !buff.icon) {
        const raidCatalog = [...RAID_BUFF_MATRIX_OPTIONS, ...EXTERNAL_BUFF_OPTIONS];
        const match = raidCatalog.find(
          (c) =>
            (c.spellId && buff.spellId === c.spellId) ||
            buff.name.toLowerCase() === c.label.toLowerCase() ||
            c.label.toLowerCase().includes(buff.name.toLowerCase())
        );
        if (match) {
          return { ...buff, icon: match.icon };
        }
      }
      return buff;
    });
  }, [job]);

  const activeBuffIconsParams = useMemo(() => {
    return activeBuffs
      .map((b) => {
        if (b.spellId && b.spellId > 0) return { type: 'spell' as const, id: b.spellId };
        if (b.itemId && b.itemId > 0) return { type: 'item' as const, id: b.itemId };
        return null;
      })
      .filter((e): e is { type: 'spell' | 'item'; id: number } => !!e);
  }, [activeBuffs]);

  const iconsMap = useIcons(activeBuffIconsParams);
  useWowheadTooltips([activeBuffs, job]);

  useEffect(() => {
    setSiblings(getScenarioSiblings());
  }, []);

  useEffect(() => {
    let active = true;

    async function loadLiveRelatedScenarios() {
      const anchorIds = new Set<string>();
      const pushAnchor = (v?: string | null) => {
        const s = String(v || '').trim();
        if (s && s !== '_') anchorIds.add(s);
      };
      pushAnchor(activeScenarioId);
      pushAnchor(job?.id);
      pushAnchor(job?.batch_id || null);
      (siblings || []).forEach((s) => pushAnchor(s.id));

      if (anchorIds.size === 0) {
        if (active) setLiveRelatedScenarios([]);
        return;
      }
      try {
        const anchor = String(job?.id || activeScenarioId || '').trim();
        if (!anchor || anchor === '_') return;
        const all = await fetchJson<any[]>(
          `${API_URL}/api/sim/${encodeURIComponent(anchor)}/related`
        );
        if (!active) return;
        const sims = Array.isArray(all) ? all : [];
        const related = sims.filter(
          (s) => s && (anchorIds.has(String(s.id || '')) || anchorIds.has(String(s.batch_id || '')))
        );
        const mapped = related
          .filter((s) => s && s.id)
          .map((s, idx) => ({
            id: String(s.id),
            fightStyle: s.fight_style || 'Patchwerk',
            targetCount: 0,
            fightLength: 0,
            simType:
              s.sim_type === 'top_gear_exact_stats'
                ? `Stats Sim ${idx + 1}`
                : s.sim_type === 'top_gear'
                  ? 'Top Gear'
                  : s.sim_type || `Scenario ${idx + 1}`,
          }));
        setLiveRelatedScenarios(mapped);
      } catch {
        // ignore
      }
    }

    loadLiveRelatedScenarios();
    return () => {
      active = false;
    };
  }, [activeScenarioId, job?.id, job?.batch_id, siblings]);

  const toolbarScenarios = useMemo(() => {
    const base = siblings || [];
    const seen = new Set(base.map((s) => s.id));
    const extras = liveRelatedScenarios.filter((s) => !seen.has(s.id));
    return [...base, ...extras];
  }, [siblings, liveRelatedScenarios]);

  const getCurrentSimId = useCallback(
    () =>
      [job?.id, activeScenarioId, id]
        .map((value) => String(value || '').trim())
        .find((value) => value.length > 0 && value !== '_') || null,
    [job?.id, activeScenarioId, id]
  );

  const getSimTypeFallbackUrl = useCallback((simType?: string) => {
    const normalized = String(simType || '').toLowerCase();
    if (normalized.includes('top_gear') || normalized.includes('top-gear')) return '/top-gear';
    if (normalized.includes('droptimizer') || normalized.includes('drop_finder'))
      return '/drop-finder';
    if (normalized.includes('trinket_tier_heatmap')) return '/upgrade/trinkets';
    if (normalized.includes('external_buff_matrix')) return '/stat-weights';
    if (normalized.includes('consumable_matrix')) return '/stat-weights';
    if (
      normalized.includes('stat_weights') ||
      normalized.includes('stat-weights') ||
      normalized.includes('stat_plot')
    ) {
      return '/stat-weights';
    }
    if (normalized.includes('upgrade')) return '/upgrade';
    return '/quick-sim';
  }, []);

  useEffect(() => {
    if (toolbarScenarios.length === 0) return;
    const siblingList = toolbarScenarios;
    const maxPolledSiblings = 40;
    const limitedSiblings = siblingList.slice(0, maxPolledSiblings);
    const currentIsActive =
      job?.status === 'pending' || job?.status === 'running' || job?.status === 'paused';
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function pollSiblingStatuses() {
      const statuses: Record<string, string> = {};
      const results = await Promise.all(
        limitedSiblings.map(async (s) => {
          try {
            const data = await fetchJson<JobData>(`${API_URL}/api/sim/${s.id}`);
            return { id: s.id, status: data.status || 'pending' };
          } catch {
            // Do not keep polling forever for missing/unreachable related jobs.
            return { id: s.id, status: 'failed' };
          }
        })
      );
      for (const item of results) {
        statuses[item.id] = item.status;
      }
      if (!active) return;
      if (activeScenarioId && job?.status) statuses[activeScenarioId] = job.status;
      setSiblingStatuses(statuses);

      // Avoid idle background disk/network churn: only continuously poll while
      // the currently viewed sim is active.
      if (currentIsActive) timer = setTimeout(pollSiblingStatuses, 2000);
    }

    pollSiblingStatuses();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [toolbarScenarios, activeScenarioId, job?.status]);

  useEffect(() => {
    console.log('[SimResult] Initializing with ID:', activeScenarioId);
    if (!activeScenarioId || activeScenarioId === '_') return;
    setFetchError('');
    setTimelineFallback(null);
    setAplFallback(null);
    setTimelineLoading(false);
    setLogLines([]);
    logCursorRef.current = 0;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await fetchJson<JobData>(`${API_URL}/api/sim/${activeScenarioId}`);
        if (active) {
          const previousStatus = previousStatusRef.current;
          if (
            previousStatus &&
            isActiveSimStatus(previousStatus) &&
            isTerminalSimStatus(data.status)
          ) {
            const parsedCharacter = data.simc_input ? parseCharacterInfo(data.simc_input) : null;
            const playerName =
              data.linked_name ||
              (parsedCharacter?.kind === 'character'
                ? parsedCharacter.name
                : parsedCharacter?.kind === 'dungeon'
                  ? parsedCharacter.title
                  : 'Simulation');

            notify({
              title: data.status === 'done' ? 'Simulation finished' : 'Simulation update',
              description: `${playerName} · ${simTypeLabel(data.sim_type)}`,
              variant: data.status === 'done' ? 'success' : 'info',
              durationMs: 6000,
              href: simResultHref(activeScenarioId),
              dedupeKey: `simulation:${activeScenarioId}`,
              action: {
                label: 'Open result',
                onClick: () => router.push(simResultHref(activeScenarioId)),
              },
            });
          }
          previousStatusRef.current = data.status;
          setJob(data);
        }
        if (
          active &&
          (data.status === 'pending' || data.status === 'running' || data.status === 'paused')
        ) {
          timer = setTimeout(poll, 2000);
        }
      } catch (err) {
        if (active) setFetchError(err instanceof Error ? err.message : 'Failed to fetch status');
      }
    }
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [activeScenarioId, notify, router]);

  // Keep polling while active so the stats card can show the current phase ETA
  // even when the log console is collapsed.
  useEffect(() => {
    if (!activeScenarioId || activeScenarioId === '_') return;
    if (job?.status !== 'pending' && job?.status !== 'running') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function pollLogs() {
      try {
        const data = await fetchJson<any>(
          `${API_URL}/api/sim/${activeScenarioId}/logs?after=${logCursorRef.current}`
        );
        if (!active) return;
        if (data.lines.length > 0) {
          setLogLines((prev) => {
            const merged = [...prev, ...data.lines];
            return merged.length > 1000 ? merged.slice(-1000) : merged;
          });
          logCursorRef.current = data.next;
        }
      } catch {
        /* ignore */
      }
      if (active) timer = setTimeout(pollLogs, 1000);
    }
    pollLogs();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [activeScenarioId, job?.status]);

  useEffect(() => {
    if (!activeScenarioId || activeScenarioId === '_' || !job?.result) return;
    if (job.status !== 'done') return;
    if (job.result.timeline || job.result.apl_analysis) return;
    if (
      job.sim_type === 'stat_weights' ||
      job.sim_type === 'stat-weights' ||
      job.sim_type === 'stat_plot'
    ) {
      return;
    }
    if (job.result.type === 'top_gear') return;

    let active = true;
    (async () => {
      setTimelineLoading(true);
      try {
        const raw = await fetchJson<any>(`${API_URL}/api/sim/${activeScenarioId}/raw`);
        if (!active) return;
        const { timeline, apl } = buildTimelineFromRaw(raw);
        if (timeline) setTimelineFallback(timeline);
        if (apl) setAplFallback(apl);
      } catch {
        // ignore fallback failures
      } finally {
        if (active) setTimelineLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [activeScenarioId, job]);

  const handleToggleLogs = useCallback(() => setShowLogs((v) => !v), []);
  const scenarioStatusTone = useCallback((status: string, isCurrent: boolean): string => {
    if (isCurrent) return 'text-gold';
    if (status === 'running') return 'text-blue-300';
    if (status === 'pending') return 'text-zinc-300';
    if (status === 'paused') return 'text-sky-300';
    if (status === 'done') return 'text-emerald-300';
    if (status === 'failed' || status === 'cancelled') return 'text-red-300';
    return 'text-zinc-300';
  }, []);

  const handleSimAgain = useCallback(() => {
    const currentSimId = getCurrentSimId();
    if (currentSimId) {
      const exactTarget = getSimReturnTarget(currentSimId);
      if (exactTarget?.returnUrl) {
        const returnUrl = resolveSimAgainNavigation(currentSimId);
        if (returnUrl) {
          router.push(returnUrl);
          return;
        }
      }
    }
    router.push(getSimTypeFallbackUrl(job?.sim_type));
  }, [getCurrentSimId, getSimTypeFallbackUrl, job?.sim_type, router]);

  const handleRerunInput = useCallback(async () => {
    const sourceJobId = job?.id || activeScenarioId;
    if (!sourceJobId || sourceJobId === '_' || !job?.simc_input || rerunning) return;

    setRerunError('');
    setRerunning(true);
    try {
      const response = await fetchJson<{ id?: string }>(
        `${API_URL}/api/sim/${encodeURIComponent(sourceJobId)}/rerun`,
        {
          method: 'POST',
        }
      );
      if (!response?.id) throw new Error('The simulation could not be started.');
      trackSimulations([{ id: response.id, simType: job.sim_type }]);
      setJob(null);
      setActiveScenarioId(response.id);
      router.push(simResultHref(response.id));
    } catch (error: unknown) {
      setRerunError(
        error instanceof Error ? error.message : 'The simulation could not be started.'
      );
    } finally {
      setRerunning(false);
    }
  }, [activeScenarioId, job, rerunning, router]);

  const handleCancelled = useCallback(() => {
    const currentSimId = getCurrentSimId();
    if (currentSimId) {
      const target = getSimReturnTarget(currentSimId);
      if (target?.returnUrl) {
        if (target.pageKey) {
          setSimReturnNotice(target.pageKey, {
            title: 'Simulation cancelled',
            message: 'The simulation was cancelled and you were returned to your previous page.',
          });
        }
        const returnUrl = resolveSimAgainNavigation(currentSimId);
        if (returnUrl) {
          router.push(returnUrl);
          return;
        }
      }
    }
    setJob((prev) => (prev ? { ...prev, status: 'cancelled' } : prev));
  }, [getCurrentSimId, router]);

  const navigateToScenario = useCallback(
    (scenarioId: string) => {
      if (!scenarioId || scenarioId === activeScenarioId) return;
      setActiveScenarioId(scenarioId);
      if (typeof window !== 'undefined') {
        const target = simResultHref(scenarioId);
        window.history.pushState(window.history.state, '', target);
      }
    },
    [activeScenarioId]
  );

  if (fetchError) {
    return (
      <div className="card border-red-500/20 bg-red-500/[0.03] p-6">
        <p className="mb-1 text-sm font-semibold text-red-400">Error</p>
        <p className="text-sm text-red-400/60">{fetchError}</p>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-800 border-t-gold" />
      </div>
    );
  }

  if (job.status === 'cancelled') {
    return (
      <div className="card border-amber-500/20 bg-amber-500/[0.03] p-6 text-center">
        <p className="text-sm font-semibold text-amber-400">Simulation Cancelled</p>
      </div>
    );
  }

  if (job.status === 'failed') {
    return (
      <div className="card border-red-500/20 bg-red-500/[0.03] p-6">
        <p className="mb-2 text-sm font-semibold text-red-400">Simulation Failed</p>
        <p className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-red-400/60">
          {job.error || 'Unknown error'}
        </p>
      </div>
    );
  }

  const scenarioToolbar = (
    <div className="sticky top-[var(--app-header-height)] z-40 flex flex-col items-stretch gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      {toolbarScenarios.length > 1 ? (
        <div className="w-full overflow-x-auto rounded-xl border border-border/70 bg-surface/90 p-3 shadow-lg backdrop-blur sm:w-auto">
          <div className="flex min-w-max items-center gap-2">
            <span className="shrink-0 text-[13px] uppercase tracking-wider text-muted">
              Scenarios
            </span>
            <span className="h-4 w-px shrink-0 bg-border" />
            {toolbarScenarios.map((s) => {
              const isCurrent = s.id === activeScenarioId;
              const status = siblingStatuses[s.id] || (isCurrent ? job.status : 'pending');
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => navigateToScenario(s.id)}
                  className={`rounded-lg border px-2.5 py-1 text-[14px] font-medium transition-all ${
                    isCurrent
                      ? 'border-gold/40 bg-gold/[0.08] text-gold'
                      : 'border-border bg-surface-2 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span>{formatScenarioLabel(s)}</span>
                    <span className={`text-[11px] ${scenarioStatusTone(status, isCurrent)}`}>
                      {status === 'running'
                        ? 'In Progress'
                        : status === 'pending'
                          ? 'Pending'
                          : status === 'paused'
                            ? 'Paused'
                            : status === 'done'
                              ? 'Done'
                              : status === 'failed'
                                ? 'Failed'
                                : status === 'cancelled'
                                  ? 'Cancelled'
                                  : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div />
      )}
      {job.status === 'done' ? (
        <div className="flex w-full flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface-2/90 px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-md sm:w-auto sm:gap-3">
          <button
            type="button"
            onClick={handleSimAgain}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-emerald-400/65 bg-emerald-500/30 px-4 py-2.5 text-[15px] font-semibold text-emerald-50 transition-colors hover:bg-emerald-500/45 hover:text-white sm:flex-none"
          >
            Sim Again
          </button>
          <button
            type="button"
            onClick={handleRerunInput}
            disabled={!job.simc_input || rerunning}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-white/15 bg-white/[0.05] px-3 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
          >
            {rerunning ? 'Rerunning…' : 'Rerun This Input'}
          </button>
          {!lightMode && (
            <CharacterLinkButton
              jobId={activeScenarioId}
              currentLinkedName={job.linked_name}
              currentLinkedRealm={job.linked_realm}
              currentLinkedRegion={job.linked_region}
            />
          )}
          {rerunError && (
            <span role="alert" className="text-xs text-red-300">
              {rerunError}
            </span>
          )}
        </div>
      ) : (
        <div />
      )}
    </div>
  );

  if (job.status === 'pending' || job.status === 'running' || job.status === 'paused') {
    return (
      <div className="space-y-4">
        {scenarioToolbar}
        <SimStatus
          status={job.status}
          progress={job.progress}
          progressStage={job.progress_stage}
          progressDetail={job.progress_detail}
          createdAt={job.created_at}
          stagesCompleted={job.stages_completed}
          stageTimings={job.stage_timings}
          activeStageElapsed={job.active_stage_elapsed}
          jobId={activeScenarioId}
          onCancelled={handleCancelled}
          onStatusChange={(status) =>
            setJob((previous) => (previous ? { ...previous, status } : previous))
          }
          resumeAvailable={
            job.status === 'paused' ? job.resume_available !== false : job.pause_available !== false
          }
          onRerun={handleRerunInput}
          rerunning={rerunning}
          logLines={logLines}
          showLogs={showLogs}
          onToggleLogs={handleToggleLogs}
          profilesetsCompleted={job.profilesets_completed}
          profilesetsTotal={job.profilesets_total}
          cpuPct={job.cpu_pct}
          memBytes={job.mem_bytes}
          cpuCores={job.cpu_cores}
          iterations={job.iterations}
          iterationsCompleted={job.iterations_completed}
          fightStyle={job.fight_style}
        />
      </div>
    );
  }

  if (!job.result) {
    return <p className="text-sm text-muted">No result data available.</p>;
  }

  const hasTopGearLikeResults =
    Array.isArray(r.results) &&
    (r.results as Array<any>).some(
      (entry) => entry && typeof entry === 'object' && Array.isArray(entry.items)
    );
  const isTopGear =
    r.type === 'top_gear' ||
    job.sim_type === 'top_gear' ||
    job.sim_type === 'top-gear' ||
    hasTopGearLikeResults;
  const isDropFinderResult =
    job.sim_type === 'droptimizer' ||
    job.sim_type === 'drop_finder' ||
    job.sim_type === 'drop-finder';
  const isTrinketTierHeatmap = job.sim_type === 'trinket_tier_heatmap';
  const isExternalBuffMatrix = job.sim_type === 'external_buff_matrix';
  const isConsumableMatrix = job.sim_type === 'consumable_matrix';
  const isStatWeights =
    job.sim_type === 'stat_weights' ||
    job.sim_type === 'stat-weights' ||
    job.sim_type === 'stat_plot';
  const baselineLiveStats = (r.baseline_live_stats as StatSnapshot | undefined) || null;
  const simulatedStats = (r.simulated_stats as StatSnapshot | undefined) || null;
  const rawTopGearResults = Array.isArray(r.results) ? (r.results as Array<any>) : [];
  const topGearResults = rawTopGearResults
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, idx) => {
      const dps = Number(entry.dps ?? entry.value ?? 0);
      const delta = Number(entry.delta ?? 0);
      const items = Array.isArray(entry.items) ? entry.items : [];
      const name =
        typeof entry.name === 'string' && entry.name.trim().length > 0
          ? entry.name
          : `Result ${idx + 1}`;
      return {
        ...entry,
        name,
        dps: Number.isFinite(dps) ? dps : 0,
        delta: Number.isFinite(delta) ? delta : 0,
        items,
      } as TopGearResult;
    })
    .sort((a, b) => b.dps - a.dps);
  const normalizedTopGearBaseDps = (() => {
    const candidate = Number(r.base_dps ?? r.dps ?? 0);
    if (Number.isFinite(candidate) && candidate > 0) return candidate;
    const fromBest = Number(topGearResults[0]?.dps ?? 0);
    return Number.isFinite(fromBest) ? fromBest : 0;
  })();

  const equippedGear = r.equipped_gear as any;
  const avgIlevel = equippedGear ? calculateAverageIlevel(equippedGear) : undefined;

  return (
    <div className="space-y-6">
      {scenarioToolbar}

      {isTopGear && isTrinketTierHeatmap ? (
        <TrinketTierHeatmap
          baseDps={(r.base_dps as number) || 0}
          elapsedSeconds={(r.elapsed_time_seconds as number) || 0}
          results={
            (r.results as Array<{ name: string; dps: number; delta: number; items: any[] }>) || []
          }
        />
      ) : isTopGear && isExternalBuffMatrix ? (
        <ExternalBuffMatrixChart
          baseDps={(r.base_dps as number) || 0}
          results={
            (r.results as Array<{ name: string; dps: number; delta: number; items: any[] }>) || []
          }
        />
      ) : isTopGear && isConsumableMatrix ? (
        <ConsumableMatrixChart
          baseDps={(r.base_dps as number) || 0}
          results={
            (r.results as Array<{ name: string; dps: number; delta: number; items: any[] }>) || []
          }
        />
      ) : isTopGear ? (
        <>
          <TopGearResults
            parentSimId={job.batch_id || activeScenarioId}
            playerName={r.player_name as string}
            playerClass={r.player_class as string}
            playerRealm={r.realm as string | undefined}
            playerRegion={r.region as string | undefined}
            baseDps={normalizedTopGearBaseDps}
            results={topGearResults}
            equippedGear={r.equipped_gear as Record<string, ResultItem>}
            dpsError={r.dps_error as number | undefined}
            dpsErrorPct={r.dps_error_pct as number | undefined}
            fightLength={r.fight_length as number | undefined}
            desiredTargets={r.desired_targets as number | undefined}
            iterations={r.iterations as number | undefined}
            targetError={r.target_error as number | undefined}
            elapsedTime={r.elapsed_time_seconds as number | undefined}
            stageTimings={job.stage_timings}
            talentString={r.talent_string as string | undefined}
            currencies={r.currencies as any}
            enableWishlistActions={isDropFinderResult}
            baselineLiveStats={baselineLiveStats}
            simulatedStats={simulatedStats}
            generatedInput={job?.simc_input}
            simOptions={((job as any)?.options as Record<string, unknown> | undefined) || null}
          />
        </>
      ) : isStatWeights ? (
        <>
          <div className="card border-gold/10 bg-gold/[0.02] p-6">
            <h2 className="mb-2 text-lg font-bold text-zinc-100">Stat Weights Generated</h2>
            <p className="text-sm text-zinc-400">
              Quick Weights gives immediate marginal values for the next stat point. Stat Plot shows
              the full DPS curve across a range so you can see diminishing returns directly.
            </p>
          </div>
          {r.stat_plots ? (
            <StatPlotChart
              statPlots={r.stat_plots as Record<string, Array<{ delta: number; dps: number }>>}
            />
          ) : null}
          {r.stat_weights ? (
            <StatWeightsTable statWeights={r.stat_weights as Record<string, number>} />
          ) : (
            !r.stat_plots && (
              <div className="card border-amber-500/20 bg-amber-500/[0.03] p-6 text-center">
                <p className="text-sm font-semibold text-amber-400">
                  No stat weight or plot data found in this simulation.
                </p>
              </div>
            )
          )}
          {(baselineLiveStats || simulatedStats) && (
            <CollapsibleSection title="Character Panel">
              <SimStatsComparisonCard
                current={baselineLiveStats}
                simulated={simulatedStats}
                title="Live vs Simulated Stats"
                description="The simulated values reflect the active run setup, including raid buffs, consumables, and other selected sim modifiers."
                framed={false}
              />
            </CollapsibleSection>
          )}
        </>
      ) : (
        <>
          <DpsHeroCard
            playerName={r.player_name as string}
            playerClass={r.player_class as string}
            playerRealm={r.realm as string | undefined}
            playerRegion={r.region as string | undefined}
            dps={r.dps as number}
            dpsError={r.dps_error as number}
            dpsErrorPct={r.dps_error_pct as number | undefined}
            fightLength={r.fight_length as number}
            desiredTargets={r.desired_targets as number | undefined}
            iterations={r.iterations as number | undefined}
            targetError={r.target_error as number | undefined}
            elapsedTime={r.elapsed_time_seconds as number | undefined}
            stageTimings={job.stage_timings}
            avgIlevel={avgIlevel}
          >
            {info?.kind === 'dungeon' && (
              <div className="mt-6 grid grid-cols-1 gap-3 border-t border-white/5 pt-6 sm:grid-cols-3 sm:gap-4">
                <div className="text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Route HP
                  </p>
                  <p className="mt-1 text-lg font-bold text-emerald-400">
                    {(() => {
                      const hp = info.pulls.reduce((sum, p) => sum + (p.totalHealth || 0), 0);
                      if (hp <= 0) return '-';
                      if (hp >= 1_000_000) return `${(hp / 1_000_000).toFixed(1)}M`;
                      if (hp >= 1_000) return `${(hp / 1_000).toFixed(0)}K`;
                      return hp.toString();
                    })()}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Timer
                  </p>
                  <p className="mt-1 text-lg font-bold text-amber-400">
                    {(() => {
                      const s = info.maxTime ? Number(info.maxTime) : 0;
                      if (s <= 0) return '-';
                      const mins = Math.floor(s / 60);
                      const secs = s % 60;
                      return `${mins}:${secs.toString().padStart(2, '0')}`;
                    })()}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Min. Per DPS
                  </p>
                  <p className="mt-1 text-lg font-bold text-sky-400">
                    {(() => {
                      const hp = info.pulls.reduce((sum, p) => sum + (p.totalHealth || 0), 0);
                      const s = info.maxTime ? Number(info.maxTime) : 0;
                      const minDps = s > 0 && hp > 0 ? (hp * 0.9) / 3 / s : 0;
                      return minDps > 0 ? Math.round(minDps).toLocaleString() : '-';
                    })()}
                  </p>
                </div>
              </div>
            )}
          </DpsHeroCard>
          {(baselineLiveStats ||
            simulatedStats ||
            (r.equipped_gear &&
              Object.keys(r.equipped_gear as Record<string, unknown>).length > 0)) && (
            <CollapsibleSection title="Character Panel">
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,0.95fr)] xl:items-start">
                {r.equipped_gear &&
                  Object.keys(r.equipped_gear as Record<string, unknown>).length > 0 && (
                    <GearOverview
                      gear={r.equipped_gear as Record<string, GearItem>}
                      characterRenderUrl={
                        !lightMode && r.realm && r.player_name
                          ? `${API_URL}/api/blizzard/character/${encodeURIComponent((r.realm as string).toLowerCase())}/${encodeURIComponent((r.player_name as string).toLowerCase())}/media/render${r.region ? `?region=${(r.region as string).toLowerCase()}` : ''}`
                          : null
                      }
                      currencies={r.currencies as any}
                      framed={false}
                    />
                  )}
                {(baselineLiveStats || simulatedStats) && (
                  <div className="xl:sticky xl:top-6">
                    <SimStatsComparisonCard
                      current={baselineLiveStats}
                      simulated={simulatedStats}
                      title="Live vs Simulated Stats"
                      description="The simulated values reflect the active run setup, including raid buffs, consumables, and other selected sim modifiers."
                    />
                  </div>
                )}
              </div>
            </CollapsibleSection>
          )}
          {typeof r.talent_string === 'string' && r.talent_string && (
            <CollapsibleSection title="Talents" defaultOpen={false}>
              <SimResultTalentsCard talentString={r.talent_string as string} />
            </CollapsibleSection>
          )}

          {activeBuffs.length > 0 && (
            <CollapsibleSection title="Buffs & Consumables">
              <div className="space-y-6">
                {[
                  { title: 'Raid Buffs', category: 'raid_buff' },
                  { title: 'Consumables', category: 'consumable' },
                ].map((group) => {
                  const items =
                    group.category === 'raid_buff'
                      ? activeBuffs.filter((b) => b.category === 'raid_buff')
                      : activeBuffs.filter((b) => b.category !== 'raid_buff');

                  if (items.length === 0) return null;

                  return (
                    <div key={group.title}>
                      <h3 className="mb-3 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">
                        {group.title}
                      </h3>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {items.map((buff: any, idx) => {
                          const wowheadHref =
                            buff.spellId || buff.itemId
                              ? `https://www.wowhead.com/${buff.spellId ? 'spell' : 'item'}=${buff.spellId || buff.itemId}`
                              : null;
                          const iconKey = buff.spellId
                            ? `spell:${buff.spellId}`
                            : buff.itemId
                              ? `item:${buff.itemId}`
                              : null;
                          const cachedIcon = iconKey ? iconsMap.get(iconKey) : null;
                          const iconUrl = cachedIcon
                            ? `https://wow.zamimg.com/images/wow/icons/small/${cachedIcon}.jpg`
                            : buff.icon
                              ? `https://wow.zamimg.com/images/wow/icons/small/${buff.icon}.jpg`
                              : null;

                          return (
                            <div
                              key={idx}
                              className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-2 text-zinc-200"
                            >
                              <div className="shrink-0">
                                {buff.spellId || buff.itemId ? (
                                  <a
                                    href={wowheadHref || undefined}
                                    data-wowhead={`${buff.spellId ? 'spell' : 'item'}=${buff.spellId || buff.itemId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      if (wowheadHref) window.open(wowheadHref, '_blank', 'noopener,noreferrer');
                                    }}
                                  >
                                    {iconUrl ? (
                                      <img
                                        src={iconUrl}
                                        alt=""
                                        className="h-7 w-7 rounded-[4px] border border-white/10"
                                      />
                                    ) : (
                                      <div className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-white/10">
                                        <CircleAlert className="h-4 w-4 text-zinc-600" strokeWidth={2} />
                                      </div>
                                    )}
                                  </a>
                                ) : iconUrl ? (
                                  <img
                                    src={iconUrl}
                                    alt=""
                                    className="h-7 w-7 rounded-[4px] border border-white/10"
                                  />
                                ) : (
                                  <div className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-white/10">
                                    <CircleAlert className="h-4 w-4 text-zinc-600" strokeWidth={2} />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  {buff.spellId || buff.itemId ? (
                                    <a
                                      href={wowheadHref || undefined}
                                      data-wowhead={`${buff.spellId ? 'spell' : 'item'}=${buff.spellId || buff.itemId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="truncate text-[14px] font-bold capitalize leading-tight hover:underline"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        if (wowheadHref) window.open(wowheadHref, '_blank', 'noopener,noreferrer');
                                      }}
                                    >
                                      {(() => {
                                        const rawName = buff.name.replace(/_/g, ' ');
                                        return rawName
                                          .replace(/\s*\((Gold|Silver|Bronze|Tier \d+)\)\s*$/i, '')
                                          .replace(/\s+\d+\s*$/i, '');
                                      })()}
                                    </a>
                                  ) : (
                                    <p className="truncate text-[14px] font-bold capitalize leading-tight">
                                      {(() => {
                                        const rawName = buff.name.replace(/_/g, ' ');
                                        return rawName
                                          .replace(/\s*\((Gold|Silver|Bronze|Tier \d+)\)\s*$/i, '')
                                          .replace(/\s+\d+\s*$/i, '');
                                      })()}
                                    </p>
                                  )}
                                  {(() => {
                                    const match =
                                      buff.name.match(
                                        /\s*\((Gold|Silver|Bronze|Tier \d+)\)\s*$/i
                                      ) || buff.name.match(/\s+(\d+)\s*$/i);
                                    if (!match) return null;
                                    const tierStr = match[1].toLowerCase();
                                    const isNumericTier = /^\d+$/.test(match[1]);
                                    const style = isNumericTier
                                      ? match[1] === '3' || match[1] === '2'
                                        ? 'border-amber-300/60 bg-amber-500 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
                                        : 'border-zinc-300/60 bg-zinc-400 shadow-[0_0_8px_rgba(161,161,170,0.3)]'
                                      : tierStr === 'gold' || tierStr === 'tier 3'
                                        ? 'border-amber-300/60 bg-amber-500 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
                                        : tierStr === 'silver' || tierStr === 'tier 2'
                                          ? 'border-zinc-300/60 bg-zinc-400 shadow-[0_0_8px_rgba(161,161,170,0.3)]'
                                          : 'border-orange-400/60 bg-orange-600 shadow-[0_0_8px_rgba(234,88,12,0.3)]';
                                    return (
                                      <span
                                        className={`h-3 w-3 shrink-0 rounded-[2px] border ${style}`}
                                        title={`Quality: ${isNumericTier ? (match[1] === '3' ? 'Gold' : match[1] === '2' ? 'Gold' : 'Silver') : match[1]}`}
                                        aria-label={`Quality: ${isNumericTier ? (match[1] === '3' ? 'Gold' : match[1] === '2' ? 'Gold' : 'Silver') : match[1]}`}
                                      />
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
          )}
          <CollapsibleSection title="Damage Breakdown" defaultOpen={false}>
            <ResultsChart
              dps={r.dps as number}
              abilities={
                (r.abilities as Array<{
                  name: string;
                  portion_dps: number;
                  school: string;
                }>) || []
              }
            />
          </CollapsibleSection>
          <CollapsibleSection title="Timeline & APL Analyzer" defaultOpen={false}>
            {timelineData || aplData ? (
              <SimTimelineAnalyzer
                timeline={(timelineData || {}) as any}
                aplAnalysis={aplData as any}
                equippedGear={r.equipped_gear as any}
              />
            ) : timelineLoading ? (
              <p className="text-sm text-zinc-500">Loading timeline data...</p>
            ) : (
              <p className="text-sm text-zinc-500">
                Timeline data is not available for this result. Run this sim again after updating.
              </p>
            )}
          </CollapsibleSection>
          {r.stat_weights && (
            <StatWeightsTable statWeights={r.stat_weights as Record<string, number>} />
          )}
        </>
      )}

      {/* Footer links */}
      <div className="flex items-center justify-center gap-3 pb-4 text-xs text-muted">
        <a
          href={`${API_URL}/api/sim/${id}/raw`}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-white"
        >
          Raw JSON
        </a>
        <span className="h-3 w-px bg-border" />
        <a
          href={`${API_URL}/api/sim/${id}/input`}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-white"
        >
          Raw Input
        </a>
        <span className="h-3 w-px bg-border" />
        <a
          href={`${API_URL}/api/sim/${id}/data.csv`}
          className="transition-colors hover:text-white"
        >
          CSV
        </a>
        <span className="h-3 w-px bg-border" />
        <a
          href={`${API_URL}/api/sim/${id}/html`}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-white"
        >
          HTML Report
        </a>
        <span className="h-3 w-px bg-border" />
        <a
          href={`${API_URL}/api/sim/${id}/output.txt`}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-white"
        >
          Text Output
        </a>
      </div>
    </div>
  );
}

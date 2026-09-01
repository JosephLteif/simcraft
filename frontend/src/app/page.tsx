'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  ArrowUp,
  BarChart3,
  BookOpen,
  ChartNoAxesCombined,
  Clock3,
  Cpu,
  Database,
  ExternalLink,
  FlaskConical,
  Gem,
  GripVertical,
  Grid2X2,
  Heart,
  History,
  LayoutDashboard,
  Link2,
  List,
  Map as MapIcon,
  MapPinned,
  MoveHorizontal,
  Pencil,
  Plus,
  ScrollText,
  Search,
  Settings,
  Swords,
  Trophy,
  Users,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  API_URL,
  fetchJson,
  getHistoryStats,
  getQueue,
  getSystemStats,
  type HistoryStats,
  isDesktop,
  listCharacterProfiles,
  listSims,
} from './lib/api';
import { buildActivityData, getActivityPeriodTitle, type ActivityPeriod } from './lib/activity';
import { useSimContext } from './components/SimContext';
import { useAuth } from './components/AuthContext';
import CharacterQuickLinks from './components/character/CharacterQuickLinks';
import VaultRewardsGrid, { type VaultRewardItem } from './components/VaultRewardsGrid';
import { characterHref } from './lib/routes';
import { CLASS_COLORS, type SimSummary } from './lib/types';
import { MYTHIC_VAULT_THRESHOLDS, RAID_VAULT_THRESHOLDS } from './lib/game-rules';
import { computeWeeklyRaidBossKills } from './lib/character-panel-utils';
import { useDismissOnOutside } from './lib/useDismissOnOutside';
import { useActiveCharacter } from './components/ActiveCharacterContext';
import OnboardingChecklist from './components/OnboardingChecklist';
import ReadinessPanel from './components/ReadinessPanel';
import { fetchReadiness, type ReadinessSnapshot } from './lib/readiness';
import { SIMULATION_TRACKED_EVENT } from './lib/sim-tracking';

const LOCAL_MAIN_CHARACTER_KEY = 'whylowdps_main_character';
const LOCAL_TRACKED_CHARACTERS_KEY = 'whylowdps_tracked_characters';
const LOCAL_QUICK_LINKS_KEY = 'whylowdps_quick_links';
const LOCAL_QUICK_LINKS_HEIGHT_KEY = 'whylowdps_quick_links_height';
const LOCAL_DASHBOARD_WIDGETS_KEY = 'whylowdps_dashboard_widgets';
const LOCAL_DASHBOARD_WIDGET_SIZES_KEY = 'whylowdps_dashboard_widget_sizes';
const LOCAL_DASHBOARD_STATS_WIDGET_KEY = 'whylowdps_dashboard_stats_cards';
const LOCAL_DASHBOARD_STATS_WIDGET_VERSION_KEY = 'whylowdps_dashboard_stats_cards_version';
const LAST_REFRESH_PREFIX = 'whylowdps_last_refresh_';
const DASHBOARD_STATS_CARD_VERSION = '1';

type DashboardWidgetId =
  'stats' | 'activity' | 'quick-links' | 'tracked-characters' | 'system-health';
type DashboardWidgetSize = 1 | 2 | 3;
type StatCardId = 'active' | 'queued' | 'total' | 'history' | 'system';
type QuickLinksHeight = 'compact' | 'standard' | 'tall' | 'extra-tall';

const ACTIVITY_PERIOD_OPTIONS: { value: ActivityPeriod; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Yearly' },
];

const DASHBOARD_WIDGETS: {
  id: DashboardWidgetId;
  label: string;
  defaultSize: DashboardWidgetSize;
}[] = [
  { id: 'stats', label: 'Stats', defaultSize: 3 },
  { id: 'activity', label: 'Simulation Activity', defaultSize: 2 },
  { id: 'quick-links', label: 'Quick Links', defaultSize: 1 },
  { id: 'tracked-characters', label: 'Tracked Characters', defaultSize: 3 },
  { id: 'system-health', label: 'System Health', defaultSize: 3 },
];

const DEFAULT_DASHBOARD_WIDGETS: DashboardWidgetId[] = DASHBOARD_WIDGETS.filter(
  ({ id }) => id !== 'system-health'
).map(({ id }) => id);
const DEFAULT_DASHBOARD_WIDGET_SIZES: Record<DashboardWidgetId, DashboardWidgetSize> =
  DASHBOARD_WIDGETS.reduce(
    (acc, widget) => {
      acc[widget.id] = widget.defaultSize;
      return acc;
    },
    {} as Record<DashboardWidgetId, DashboardWidgetSize>
  );

const STAT_CARD_ORDER: StatCardId[] = ['active', 'queued', 'total', 'history', 'system'];

const QUICK_LINKS_HEIGHT_OPTIONS = [
  { value: 'compact', label: 'Compact', className: 'h-64' },
  { value: 'standard', label: 'Standard', className: 'h-80' },
  { value: 'tall', label: 'Tall', className: 'h-[32rem]' },
  { value: 'extra-tall', label: 'Extra tall', className: 'h-[48rem]' },
] as const satisfies { value: QuickLinksHeight; label: string; className: string }[];

const QUICK_LINK_ICON_OPTIONS = [
  { value: 'activity', label: 'Activity', Icon: Activity },
  { value: 'arrow-up', label: 'Arrow Up', Icon: ArrowUp },
  { value: 'bar-chart', label: 'Bar Chart', Icon: BarChart3 },
  { value: 'book-open', label: 'Book', Icon: BookOpen },
  { value: 'chart', label: 'Chart', Icon: ChartNoAxesCombined },
  { value: 'flask', label: 'Flask', Icon: FlaskConical },
  { value: 'gem', label: 'Gem', Icon: Gem },
  { value: 'grid', label: 'Grid', Icon: Grid2X2 },
  { value: 'heart', label: 'Heart', Icon: Heart },
  { value: 'history', label: 'History', Icon: History },
  { value: 'layout', label: 'Dashboard', Icon: LayoutDashboard },
  { value: 'link', label: 'Link', Icon: Link2 },
  { value: 'map', label: 'Map', Icon: MapIcon },
  { value: 'map-pinned', label: 'Pinned Map', Icon: MapPinned },
  { value: 'scroll-text', label: 'Scroll', Icon: ScrollText },
  { value: 'search', label: 'Search', Icon: Search },
  { value: 'settings', label: 'Settings', Icon: Settings },
  { value: 'swords', label: 'Swords', Icon: Swords },
  { value: 'trophy', label: 'Trophy', Icon: Trophy },
  { value: 'users', label: 'Users', Icon: Users },
  { value: 'wand', label: 'Wand', Icon: WandSparkles },
  { value: 'zap', label: 'Zap', Icon: Zap },
] as const;
type QuickLinkIconName = (typeof QUICK_LINK_ICON_OPTIONS)[number]['value'];

type QuickLink = {
  label: string;
  href: string;
  icon: QuickLinkIconName;
  external?: boolean;
  custom?: boolean;
};

const POPULAR_WOW_LINKS: QuickLink[] = [
  { label: 'Wowhead', href: 'https://www.wowhead.com/', icon: 'book-open', external: true },
  { label: 'Raidbots', href: 'https://www.raidbots.com/', icon: 'activity', external: true },
  { label: 'WoWAnalyzer', href: 'https://wowanalyzer.com/', icon: 'chart', external: true },
  {
    label: 'Warcraft Logs',
    href: 'https://www.warcraftlogs.com/',
    icon: 'scroll-text',
    external: true,
  },
  { label: 'Raider.IO', href: 'https://raider.io/', icon: 'trophy', external: true },
];

const DEFAULT_QUICK_LINKS: QuickLink[] = [
  { label: 'New Quick Sim', href: '/quick-sim', icon: 'zap' },
  { label: 'Top Gear', href: '/top-gear', icon: 'swords' },
  { label: 'Drop Finder', href: '/drop-finder', icon: 'search' },
  { label: 'Simulation History', href: '/history', icon: 'history' },
  ...POPULAR_WOW_LINKS,
];

const QUICK_LINK_OPTIONS: QuickLink[] = [
  { label: 'Dashboard', href: '/', icon: 'layout' },
  { label: 'New Quick Sim', href: '/quick-sim', icon: 'zap' },
  { label: 'Top Gear', href: '/top-gear', icon: 'swords' },
  { label: 'Drop Finder', href: '/drop-finder', icon: 'search' },
  { label: 'Crest Upgrades', href: '/upgrade-compare', icon: 'arrow-up' },
  { label: 'Quick Weights', href: '/analysis/quick-weights', icon: 'bar-chart' },
  { label: 'Stat Plot', href: '/analysis/stat-plot', icon: 'chart' },
  { label: 'Consumable Matrix', href: '/analysis/consumable-matrix', icon: 'flask' },
  { label: 'Tier Slot Matrix', href: '/analysis/tier-slot-matrix', icon: 'grid' },
  { label: 'Trinkets', href: '/upgrade/trinkets', icon: 'gem' },
  { label: 'Dungeons', href: '/dungeons', icon: 'map' },
  { label: 'Raids', href: '/raids', icon: 'swords' },
  { label: 'Routes', href: '/dungeon-routes', icon: 'map-pinned' },
  { label: 'Simulation History', href: '/history', icon: 'history' },
  { label: 'My Characters', href: '/characters', icon: 'users' },
  { label: 'Wishlist', href: '/wishlist', icon: 'heart' },
  { label: 'Talent Playground', href: '/talent-playground', icon: 'wand' },
  { label: 'Settings', href: '/settings', icon: 'settings' },
  ...POPULAR_WOW_LINKS,
];

function isQuickLinkIconName(value: unknown): value is QuickLinkIconName {
  return (
    typeof value === 'string' &&
    QUICK_LINK_ICON_OPTIONS.some((option) => option.value === value)
  );
}

function QuickLinkIcon({ name, className }: { name: QuickLinkIconName; className: string }) {
  const option = QUICK_LINK_ICON_OPTIONS.find(({ value }) => value === name);
  const Icon = option?.Icon || Link2;
  return <Icon className={className} strokeWidth={1.8} aria-hidden="true" />;
}

function normalizeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function isQuickLinksHeight(value: string): value is QuickLinksHeight {
  return QUICK_LINKS_HEIGHT_OPTIONS.some((option) => option.value === value);
}

function isLightModeBlockedHref(href: string): boolean {
  return (
    href === '/settings' ||
    href === '/characters' ||
    href.startsWith('/character') ||
    href === '/wishlist' ||
    href === '/talent-playground'
  );
}

function StatIcon({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-2 text-zinc-200">
      {children}
    </div>
  );
}

function DashboardWidgetShell({
  children,
  className,
  editMode,
  index,
  label,
  size,
  widgetId,
  onRemove,
  onResizeHandleDown,
  isDragged,
  isDragTarget,
  isDraggingAny,
  onDragHandleDown,
  onDragTargetEnter,
}: {
  children: ReactNode;
  className: string;
  editMode: boolean;
  index: number;
  label: string;
  size: DashboardWidgetSize;
  widgetId: DashboardWidgetId;
  onRemove: (id: DashboardWidgetId) => void;
  onResizeHandleDown: (id: DashboardWidgetId, e: React.PointerEvent<HTMLButtonElement>) => void;
  isDragged: boolean;
  isDragTarget: boolean;
  isDraggingAny: boolean;
  onDragHandleDown: (id: DashboardWidgetId, e: React.PointerEvent<HTMLButtonElement>) => void;
  onDragTargetEnter: (id: DashboardWidgetId) => void;
}) {
  return (
    <div
      onPointerEnter={() => {
        if (editMode) onDragTargetEnter(widgetId);
      }}
      className={`${className} ${
        editMode
          ? `rounded-xl border border-dashed p-1 ${
              isDragTarget && !isDragged ? 'border-gold/65 bg-gold/5' : 'border-gold/35'
            }`
          : ''
      } ${isDragged ? 'pointer-events-none opacity-25' : ''} relative h-full`}
      style={{ order: index }}
    >
      {editMode && (
        <>
          <button
            type="button"
            onPointerDown={(e) => onDragHandleDown(widgetId, e)}
            className={`absolute left-2 top-2 z-20 inline-flex h-6 w-6 items-center justify-center rounded border border-white/10 bg-black/70 text-zinc-300 hover:bg-white/10 ${
              isDraggingAny ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            title={`Drag ${label}`}
            aria-label={`Drag ${label}`}
          >
            <GripVertical className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <div className="absolute right-2 top-2 z-20 inline-flex items-center gap-1">
            <button
              type="button"
              onPointerDown={(e) => onResizeHandleDown(widgetId, e)}
              className="inline-flex h-6 w-6 cursor-ew-resize items-center justify-center rounded border border-white/10 bg-black/70 text-zinc-300 hover:bg-white/10"
              title={`Resize ${label} (${size}/3)`}
              aria-label={`Resize ${label}`}
            >
              <MoveHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => onRemove(widgetId)}
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/25"
              title={`Remove ${label}`}
              aria-label={`Remove ${label}`}
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </>
      )}
      <div className={`h-full ${editMode ? 'pt-8' : ''}`}>{children}</div>
    </div>
  );
}

function ActiveIcon() {
  return <Activity className="h-5 w-5" strokeWidth={2} />;
}

function QueueIcon() {
  return <Clock3 className="h-5 w-5" strokeWidth={2} />;
}

function ListIcon() {
  return <List className="h-5 w-5" strokeWidth={2} />;
}

function DatabaseIcon() {
  return <Database className="h-5 w-5" strokeWidth={2} />;
}

function CpuIcon() {
  return <Cpu className="h-5 w-5" strokeWidth={2} />;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

function toTimestampMs(raw: unknown): number {
  const n = Number(raw || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1_000_000_000_000 ? n * 1000 : n;
}

function getWeeklyResetStartMs(regionRaw: string | null | undefined, now = new Date()): number {
  const region = String(regionRaw || 'us').toLowerCase();
  const resetDayUtc = region === 'eu' ? 3 : region === 'Asia' ? 4 : 2; // Sun=0, Tue=2, Wed=3, Thu=4
  // Weekly reset schedule (from provided timer reference):
  // - US: Tuesday 6:00 PM GMT+3 => 15:00 UTC
  // - EU: Wednesday 7:00 AM GMT+3 => 04:00 UTC
  // - ASIA: kept at Thursday 07:00 UTC until a specific local schedule is provided.
  const resetHourUtc = region === 'eu' ? 4 : region === 'us' ? 15 : 7;

  const current = new Date(now);
  const todayReset = new Date(
    Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth(),
      current.getUTCDate(),
      resetHourUtc,
      0,
      0,
      0
    )
  );
  const dayDiff = (current.getUTCDay() - resetDayUtc + 7) % 7;
  let reset = new Date(todayReset);
  reset.setUTCDate(reset.getUTCDate() - dayDiff);
  if (current.getUTCDay() === resetDayUtc && current.getUTCHours() < resetHourUtc) {
    reset.setUTCDate(reset.getUTCDate() - 7);
  }
  return reset.getTime();
}

function getNextWeeklyResetMs(regionRaw: string | null | undefined, now = new Date()): number {
  const start = getWeeklyResetStartMs(regionRaw, now);
  return start + 7 * 24 * 60 * 60 * 1000;
}

function formatCountdown(msRemaining: number): string {
  if (!Number.isFinite(msRemaining) || msRemaining <= 0) return 'resetting now';
  const totalMinutes = Math.floor(msRemaining / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatLocalDateTime(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return '-';
  return new Date(timestampMs).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function computeMythicVaultRuns(mythicPlus: any, region?: string): number {
  const isRunLike = (value: any) =>
    value &&
    typeof value === 'object' &&
    (typeof value.keystone_level === 'number' ||
      typeof value.keystoneLevel === 'number' ||
      value.keystone_dungeon ||
      value.dungeon ||
      value.completed_challenge_mode);

  const collectRuns = (root: any): any[] => {
    const out: any[] = [];
    const stack: any[] = [root];
    const seen = new Set<any>();
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      if (Array.isArray(current)) {
        if (current.some((item) => isRunLike(item)))
          out.push(...current.filter((item) => isRunLike(item)));
        else for (const item of current) if (item && typeof item === 'object') stack.push(item);
        continue;
      }
      if (typeof current === 'object') {
        if (isRunLike(current)) out.push(current);
        for (const value of Object.values(current))
          if (value && typeof value === 'object') stack.push(value);
      }
    }
    return out;
  };

  const getRunLevel = (run: any) => Number(run?.keystone_level ?? run?.keystoneLevel ?? 0);
  const getRunTimestamp = (run: any) =>
    toTimestampMs(
      run?.completed_timestamp ??
        run?.completedTimestamp ??
        run?.end_timestamp ??
        run?.endTimestamp ??
        run?.start_timestamp ??
        run?.startTimestamp ??
        run?.timestamp ??
        0
    );

  const allRuns = collectRuns(mythicPlus).filter((run) => getRunLevel(run) > 0);
  const recentSource = Array.isArray(mythicPlus?.recent_runs) ? mythicPlus.recent_runs : allRuns;
  const recentRuns = [...recentSource]
    .sort((a, b) => getRunTimestamp(b) - getRunTimestamp(a))
    .slice(0, 20);
  const weekStart = getWeeklyResetStartMs(region);
  const recentWeekCount = recentRuns.filter((run) => {
    const ts = getRunTimestamp(run);
    return ts > 0 && ts >= weekStart;
  }).length;
  const currentPeriodCount = collectRuns(mythicPlus?.current_period || {}).filter((run) => {
    const ts = getRunTimestamp(run);
    return ts > 0 && ts >= weekStart;
  }).length;
  return Math.max(recentWeekCount, currentPeriodCount);
}

export default function Home() {
  const router = useRouter();
  const { setSimcInput } = useSimContext();
  const { lightMode } = useAuth();
  const { setCharacter: setActiveCharacter } = useActiveCharacter();
  const [sims, setSims] = useState<SimSummary[]>([]);
  const [queuedSims, setQueuedSims] = useState(0);
  const [historyStats, setHistoryStats] = useState<HistoryStats | null>(null);
  const [cpuUsage, setCpuUsage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ReadinessSnapshot | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [trackedCharacters, setTrackedCharacters] = useState<
    { region: string; realm: string; name: string }[]
  >([]);
  const [activeTrackedIndex, setActiveTrackedIndex] = useState(0);
  const [trackedClassByCharacter, setTrackedClassByCharacter] = useState<Record<string, string>>(
    {}
  );
  const [mainVault, setMainVault] = useState<{ mplusRuns: number; raidKills: number } | null>(null);
  const [mainMeta, setMainMeta] = useState<{
    level?: number;
    className?: string;
    ilvl?: number;
  } | null>(null);
  const [mainVaultRewards, setMainVaultRewards] = useState<VaultRewardItem[]>([]);
  const [mainSimcInput, setMainSimcInput] = useState<string>('');
  const [mainCharacterOpen, setMainCharacterOpen] = useState(true);
  const [trackedRefreshToken, setTrackedRefreshToken] = useState(0);
  const [lastRefreshedByCharacter, setLastRefreshedByCharacter] = useState<Record<string, number>>(
    {}
  );
  const [trackedRefreshing, setTrackedRefreshing] = useState(false);
  const [dashboardWidgets, setDashboardWidgets] =
    useState<DashboardWidgetId[]>(DEFAULT_DASHBOARD_WIDGETS);
  const [dashboardWidgetSizes, setDashboardWidgetSizes] = useState<
    Record<DashboardWidgetId, DashboardWidgetSize>
  >(DEFAULT_DASHBOARD_WIDGET_SIZES);
  const [visibleStatCards, setVisibleStatCards] = useState<StatCardId[]>(STAT_CARD_ORDER);
  const [dashboardEditMode, setDashboardEditMode] = useState(false);
  const [activityPeriod, setActivityPeriod] = useState<ActivityPeriod>('day');
  const [showDashboardAddMenu, setShowDashboardAddMenu] = useState(false);
  const [draggingWidgetId, setDraggingWidgetId] = useState<DashboardWidgetId | null>(null);
  const [dragOverWidgetId, setDragOverWidgetId] = useState<DashboardWidgetId | null>(null);
  const [dashboardDragPointer, setDashboardDragPointer] = useState<{
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    width: number;
    label: string;
  } | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [draggedTrackedIndex, setDraggedTrackedIndex] = useState<number | null>(null);
  const [dragOverTrackedIndex, setDragOverTrackedIndex] = useState<number | null>(null);
  const [draggedQuickLinkIndex, setDraggedQuickLinkIndex] = useState<number | null>(null);
  const [dragOverQuickLinkIndex, setDragOverQuickLinkIndex] = useState<number | null>(null);
  const [dragPointer, setDragPointer] = useState<{
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    width: number;
    label: string;
    color: string;
  } | null>(null);
  const [quickLinks, setQuickLinks] = useState<QuickLink[]>(DEFAULT_QUICK_LINKS);
  const [quickLinksHeight, setQuickLinksHeight] = useState<QuickLinksHeight>('standard');
  const [quickLinksEditMode, setQuickLinksEditMode] = useState(false);
  const [showQuickLinkAddMenu, setShowQuickLinkAddMenu] = useState(false);
  const [showCustomQuickLinkForm, setShowCustomQuickLinkForm] = useState(false);
  const [customQuickLinkLabel, setCustomQuickLinkLabel] = useState('');
  const [customQuickLinkUrl, setCustomQuickLinkUrl] = useState('');
  const [customQuickLinkIcon, setCustomQuickLinkIcon] = useState<QuickLinkIconName>('link');
  const [customQuickLinkError, setCustomQuickLinkError] = useState<string | null>(null);
  const draggedTrackedIndexRef = useRef<number | null>(null);
  const draggedQuickLinkIndexRef = useRef<number | null>(null);
  const quickLinkAddMenuRef = useRef<HTMLDivElement | null>(null);
  const dashboardAddMenuRef = useRef<HTMLDivElement | null>(null);
  const draggingWidgetIdRef = useRef<DashboardWidgetId | null>(null);
  const dragOverWidgetIdRef = useRef<DashboardWidgetId | null>(null);
  const pendingWidgetDragRef = useRef<{
    id: DashboardWidgetId;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    width: number;
    label: string;
  } | null>(null);
  const pendingWidgetResizeRef = useRef<{
    id: DashboardWidgetId;
    startX: number;
    startSize: DashboardWidgetSize;
  } | null>(null);
  const pendingTrackedRefreshRef = useRef(false);
  const pendingDragRef = useRef<{
    idx: number;
    startX: number;
    startY: number;
    width: number;
    offsetX: number;
    offsetY: number;
    label: string;
    color: string;
  } | null>(null);
  const pendingQuickLinkDragRef = useRef<{
    idx: number;
    startX: number;
    startY: number;
  } | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [simData, statData, systemStats, queueData] = await Promise.all([
        listSims(),
        getHistoryStats(),
        isDesktop ? getSystemStats().catch(() => null) : Promise.resolve(null),
        getQueue('mine').catch(() => null),
      ]);
      setSims(simData || []);
      setQueuedSims(queueData?.queued_count ?? 0);
      setHistoryStats(statData);
      setCpuUsage(systemStats?.cpu_usage ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadReadiness = useCallback(async () => {
    setReadinessError(null);
    try {
      setReadiness(await fetchReadiness());
    } catch (err) {
      setReadiness(null);
      setReadinessError(err instanceof Error ? err.message : 'Failed to read system health.');
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_QUICK_LINKS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const optionsByHref = new Map(QUICK_LINK_OPTIONS.map((link) => [link.href, link]));
      const links = parsed
        .map((link) => {
          const href = String(link?.href || '').trim();
          const option = optionsByHref.get(href);
          if (option) {
            return {
              ...option,
              icon: isQuickLinkIconName(link?.icon) ? link.icon : option.icon,
            };
          }
          const label = String(link?.label || '').trim();
          const normalizedHref = normalizeExternalUrl(href);
          if (!label || !normalizedHref) return null;
          return {
            label: label.slice(0, 80),
            href: normalizedHref,
            icon: isQuickLinkIconName(link?.icon) ? link.icon : 'link',
            external: true,
            custom: true,
          } satisfies QuickLink;
        })
        .filter((link): link is QuickLink => Boolean(link));
      setQuickLinks(links.length > 0 ? links : DEFAULT_QUICK_LINKS);
    } catch {
      setQuickLinks(DEFAULT_QUICK_LINKS);
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_QUICK_LINKS_HEIGHT_KEY);
      if (raw && isQuickLinksHeight(raw)) setQuickLinksHeight(raw);
    } catch {
      setQuickLinksHeight('standard');
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_DASHBOARD_WIDGETS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const validIds = new Set(DEFAULT_DASHBOARD_WIDGETS);
      const next = parsed.filter((id): id is DashboardWidgetId => validIds.has(id));
      setDashboardWidgets(next.length > 0 ? next : DEFAULT_DASHBOARD_WIDGETS);
    } catch {
      setDashboardWidgets(DEFAULT_DASHBOARD_WIDGETS);
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_DASHBOARD_WIDGET_SIZES_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<DashboardWidgetId, number>>;
      const next = { ...DEFAULT_DASHBOARD_WIDGET_SIZES };
      for (const widget of DASHBOARD_WIDGETS) {
        const size = Number(parsed?.[widget.id] || widget.defaultSize);
        if (size === 1 || size === 2 || size === 3) {
          next[widget.id] = size as DashboardWidgetSize;
        }
      }
      setDashboardWidgetSizes(next);
    } catch {
      setDashboardWidgetSizes(DEFAULT_DASHBOARD_WIDGET_SIZES);
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_DASHBOARD_STATS_WIDGET_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const valid = new Set<StatCardId>(STAT_CARD_ORDER);
      const saved = parsed.filter((id): id is StatCardId => valid.has(id));
      const version = localStorage.getItem(LOCAL_DASHBOARD_STATS_WIDGET_VERSION_KEY);
      const next: StatCardId[] =
        version === DASHBOARD_STATS_CARD_VERSION
          ? saved
          : saved.includes('queued')
            ? saved
            : [...saved, 'queued'];
      setVisibleStatCards(next.length > 0 ? next : STAT_CARD_ORDER);
      if (version !== DASHBOARD_STATS_CARD_VERSION) {
        localStorage.setItem(LOCAL_DASHBOARD_STATS_WIDGET_KEY, JSON.stringify(next));
        localStorage.setItem(
          LOCAL_DASHBOARD_STATS_WIDGET_VERSION_KEY,
          DASHBOARD_STATS_CARD_VERSION
        );
      }
    } catch {
      setVisibleStatCards(STAT_CARD_ORDER);
    }
  }, []);

  useEffect(() => {
    if (lightMode) {
      setTrackedCharacters([]);
      setMainVault(null);
      setMainMeta(null);
      setMainVaultRewards([]);
      setMainSimcInput('');
      setTrackedRefreshing(false);
      return;
    }
    const loadMainCharacter = async () => {
      try {
        const rawTracked =
          typeof window !== 'undefined'
            ? localStorage.getItem(LOCAL_TRACKED_CHARACTERS_KEY) || '[]'
            : '[]';
        let trackedKeys: string[] = [];
        try {
          const parsed = JSON.parse(rawTracked);
          if (Array.isArray(parsed)) trackedKeys = parsed.map((v) => String(v));
        } catch {}
        if (trackedKeys.length === 0) {
          const legacyMain =
            typeof window !== 'undefined'
              ? localStorage.getItem(LOCAL_MAIN_CHARACTER_KEY) || ''
              : '';
          if (legacyMain) trackedKeys = [legacyMain];
        }

        const parsedTracked = trackedKeys
          .map((k) => {
            const [region, realm, name] = k.split('|');
            if (!region || !realm || !name) return null;
            return { region, realm, name };
          })
          .filter(Boolean) as { region: string; realm: string; name: string }[];
        setTrackedCharacters(parsedTracked);
        if (parsedTracked.length === 0) return;

        const selected = parsedTracked[Math.min(activeTrackedIndex, parsedTracked.length - 1)];
        const { region, realm, name } = selected;
        setActiveCharacter({ region, realm, name });

        const shouldRefresh = pendingTrackedRefreshRef.current;
        const query = `?region=${region}${shouldRefresh ? '&refresh=true' : ''}`;
        const base = `/api/blizzard/character/${realm}/${name}`;
        const [profileRes, mythicPlus, raidEncounters] = await Promise.all([
          fetchJson<any>(`${API_URL}${base}/profile${query}`).catch(() => ({})),
          fetchJson<any>(`${API_URL}${base}/mythic-keystone-profile${query}`).catch(() => ({})),
          fetchJson<any>(`${API_URL}${base}/encounters/raids${query}`).catch(() => ({})),
        ]);
        setMainMeta({
          level: Number(profileRes?.level || 0) || undefined,
          className: profileRes?.character_class?.name || undefined,
          ilvl: Number(profileRes?.equipped_item_level || 0) || undefined,
        });
        const charKey = `${region.toLowerCase()}|${realm.toLowerCase()}|${name.toLowerCase()}`;
        const className = String(profileRes?.character_class?.name || '');
        if (className) {
          setTrackedClassByCharacter((prev) => ({ ...prev, [charKey]: className }));
        }

        const profiles = await listCharacterProfiles({ name, realm, region }).catch(() => []);
        const latestSimc = profiles[0]?.simc_input || '';
        const lines = String(latestSimc).split(/\r?\n/);
        const rewards: VaultRewardItem[] = [];
        let inBlock = false;
        for (const raw of lines) {
          const line = raw.trim();
          const lower = line.toLowerCase();
          if (
            lower.includes('weekly reward choices') &&
            !lower.includes('end of weekly reward choices')
          ) {
            inBlock = true;
            continue;
          }
          if (lower.includes('end of weekly reward choices')) {
            inBlock = false;
            continue;
          }
          if (!inBlock) continue;
          const m = line.replace(/^#\s*/, '').match(/^([a-z0-9_]+)\s*=\s*(.+)$/i);
          if (!m) continue;
          const id = m[2].match(/id=(\d+)/i)?.[1];
          if (!id) continue;
          const ilvl = m[2].match(/ilevel=(\d+)/i)?.[1] || '-';
          const bonusMatch = m[2].match(/bonus_id=([0-9/]+)/i);
          const bonusIds = bonusMatch
            ? bonusMatch[1]
                .split('/')
                .map((v) => Number(v))
                .filter((v) => Number.isFinite(v) && v > 0)
            : [];
          rewards.push({ slot: m[1], itemId: id, ilevel: ilvl, bonusIds });
        }
        setMainVaultRewards(rewards.slice(0, 6));
        setMainSimcInput(latestSimc);

        const mplusRuns = computeMythicVaultRuns(mythicPlus, region);
        const raidKills = computeWeeklyRaidBossKills(raidEncounters, region);
        setMainVault({ mplusRuns, raidKills });
        if (shouldRefresh) {
          const ts = Date.now();
          const charKey = `${region.toLowerCase()}|${realm.toLowerCase()}|${name.toLowerCase()}`;
          setLastRefreshedByCharacter((prev) => ({ ...prev, [charKey]: ts }));
          if (typeof window !== 'undefined') {
            localStorage.setItem(`${LAST_REFRESH_PREFIX}${charKey}`, String(ts));
          }
          pendingTrackedRefreshRef.current = false;
          setTrackedRefreshing(false);
        }
      } catch {
        if (pendingTrackedRefreshRef.current) {
          pendingTrackedRefreshRef.current = false;
          setTrackedRefreshing(false);
        }
        // ignore
      }
    };
    void loadMainCharacter();
  }, [activeTrackedIndex, lightMode, setActiveCharacter, trackedRefreshToken]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const next: Record<string, number> = {};
    for (const c of trackedCharacters) {
      const key = `${c.region.toLowerCase()}|${c.realm.toLowerCase()}|${c.name.toLowerCase()}`;
      const raw = localStorage.getItem(`${LAST_REFRESH_PREFIX}${key}`);
      const ts = raw ? Number(raw) : 0;
      if (Number.isFinite(ts) && ts > 0) next[key] = ts;
    }
    setLastRefreshedByCharacter(next);
  }, [trackedCharacters]);

  useEffect(() => {
    if (lightMode || trackedCharacters.length === 0) return;
    let cancelled = false;
    const loadTrackedClasses = async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        trackedCharacters.map(async (c) => {
          const key = `${c.region.toLowerCase()}|${c.realm.toLowerCase()}|${c.name.toLowerCase()}`;
          if (trackedClassByCharacter[key]) return;
          const query = `?region=${c.region}`;
          const base = `/api/blizzard/character/${c.realm}/${c.name}`;
          const profileRes = await fetchJson<any>(`${API_URL}${base}/profile${query}`).catch(
            () => null
          );
          const className = String(profileRes?.character_class?.name || '');
          if (className) updates[key] = className;
        })
      );
      if (cancelled || Object.keys(updates).length === 0) return;
      setTrackedClassByCharacter((prev) => ({ ...prev, ...updates }));
    };
    void loadTrackedClasses();
    return () => {
      cancelled = true;
    };
  }, [lightMode, trackedCharacters, trackedClassByCharacter]);

  const openMainWorkflow = useCallback(
    (path: string) => {
      if (mainSimcInput.trim()) {
        setSimcInput(mainSimcInput);
        sessionStorage.setItem('whylowdps_simc_input', mainSimcInput);
      }
      router.push(path);
    },
    [mainSimcInput, router, setSimcInput]
  );

  const persistQuickLinks = useCallback((next: QuickLink[]) => {
    setQuickLinks(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem(LOCAL_QUICK_LINKS_KEY, JSON.stringify(next));
    }
  }, []);

  const persistQuickLinksHeight = useCallback((next: QuickLinksHeight) => {
    setQuickLinksHeight(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem(LOCAL_QUICK_LINKS_HEIGHT_KEY, next);
    }
  }, []);

  const addableQuickLinks = useMemo(() => {
    const currentHrefs = new Set(quickLinks.map((link) => link.href));
    return QUICK_LINK_OPTIONS.filter(
      (link) => !currentHrefs.has(link.href) && (!lightMode || !isLightModeBlockedHref(link.href))
    );
  }, [lightMode, quickLinks]);

  const visibleQuickLinks = useMemo(
    () => quickLinks.filter((link) => !lightMode || !isLightModeBlockedHref(link.href)),
    [lightMode, quickLinks]
  );

  const addQuickLink = useCallback(
    (link: QuickLink) => {
      if (quickLinks.some((item) => item.href === link.href)) return;
      persistQuickLinks([...quickLinks, link]);
      setShowQuickLinkAddMenu(false);
    },
    [persistQuickLinks, quickLinks]
  );

  const reorderQuickLinks = useCallback(
    (from: number, to: number) => {
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= quickLinks.length ||
        to >= quickLinks.length
      ) {
        return;
      }
      const next = [...quickLinks];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      persistQuickLinks(next);
    },
    [persistQuickLinks, quickLinks]
  );

  const resetCustomQuickLinkForm = useCallback(() => {
    setShowCustomQuickLinkForm(false);
    setCustomQuickLinkLabel('');
    setCustomQuickLinkUrl('');
    setCustomQuickLinkIcon('link');
    setCustomQuickLinkError(null);
  }, []);

  const addCustomQuickLink = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const label = customQuickLinkLabel.trim();
      const href = normalizeExternalUrl(customQuickLinkUrl);
      if (!label) {
        setCustomQuickLinkError('Enter a name for this link.');
        return;
      }
      if (!href) {
        setCustomQuickLinkError('Enter a valid http:// or https:// URL.');
        return;
      }
      if (quickLinks.some((link) => link.href === href)) {
        setCustomQuickLinkError('That URL is already in your quick links.');
        return;
      }
      persistQuickLinks([
        ...quickLinks,
        {
          label: label.slice(0, 80),
          href,
          icon: customQuickLinkIcon,
          external: true,
          custom: true,
        },
      ]);
      setShowQuickLinkAddMenu(false);
      resetCustomQuickLinkForm();
    },
    [
      customQuickLinkIcon,
      customQuickLinkLabel,
      customQuickLinkUrl,
      persistQuickLinks,
      quickLinks,
      resetCustomQuickLinkForm,
    ]
  );

  const removeQuickLink = useCallback(
    (index: number) => {
      persistQuickLinks(quickLinks.filter((_, i) => i !== index));
    },
    [persistQuickLinks, quickLinks]
  );

  const persistDashboardWidgets = useCallback((next: DashboardWidgetId[]) => {
    setDashboardWidgets(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem(LOCAL_DASHBOARD_WIDGETS_KEY, JSON.stringify(next));
    }
  }, []);

  const persistDashboardWidgetSizes = useCallback(
    (next: Record<DashboardWidgetId, DashboardWidgetSize>) => {
      setDashboardWidgetSizes(next);
      if (typeof window !== 'undefined') {
        localStorage.setItem(LOCAL_DASHBOARD_WIDGET_SIZES_KEY, JSON.stringify(next));
      }
    },
    []
  );

  const persistVisibleStatCards = useCallback((next: StatCardId[]) => {
    setVisibleStatCards(next.length > 0 ? next : STAT_CARD_ORDER);
    if (typeof window !== 'undefined') {
      localStorage.setItem(LOCAL_DASHBOARD_STATS_WIDGET_KEY, JSON.stringify(next));
      localStorage.setItem(LOCAL_DASHBOARD_STATS_WIDGET_VERSION_KEY, DASHBOARD_STATS_CARD_VERSION);
    }
  }, []);

  const hiddenDashboardWidgets = useMemo(
    () => DASHBOARD_WIDGETS.filter((widget) => !dashboardWidgets.includes(widget.id)),
    [dashboardWidgets]
  );

  const addDashboardWidget = useCallback(
    (id: DashboardWidgetId) => {
      if (dashboardWidgets.includes(id)) return;
      persistDashboardWidgets([...dashboardWidgets, id]);
      setShowDashboardAddMenu(false);
    },
    [dashboardWidgets, persistDashboardWidgets]
  );

  const removeDashboardWidget = useCallback(
    (id: DashboardWidgetId) => {
      persistDashboardWidgets(dashboardWidgets.filter((widgetId) => widgetId !== id));
    },
    [dashboardWidgets, persistDashboardWidgets]
  );

  const resizeDashboardWidget = useCallback(
    (id: DashboardWidgetId, size: DashboardWidgetSize) => {
      persistDashboardWidgetSizes({ ...dashboardWidgetSizes, [id]: size });
    },
    [dashboardWidgetSizes, persistDashboardWidgetSizes]
  );

  const handleWidgetResizeHandleDown = useCallback(
    (id: DashboardWidgetId, e: React.PointerEvent<HTMLButtonElement>) => {
      if (!dashboardEditMode || e.button !== 0) return;
      pendingWidgetResizeRef.current = {
        id,
        startX: e.clientX,
        startSize: dashboardWidgetSizes[id] || 3,
      };
      e.preventDefault();
    },
    [dashboardEditMode, dashboardWidgetSizes]
  );

  const hiddenStatCards = useMemo(
    () => STAT_CARD_ORDER.filter((id) => !visibleStatCards.includes(id)),
    [visibleStatCards]
  );

  const removeStatCard = useCallback(
    (id: StatCardId) => {
      if (visibleStatCards.length <= 1) return;
      persistVisibleStatCards(visibleStatCards.filter((cardId) => cardId !== id));
    },
    [persistVisibleStatCards, visibleStatCards]
  );

  const addStatCard = useCallback(
    (id: StatCardId) => {
      if (visibleStatCards.includes(id)) return;
      const next = [...visibleStatCards, id].sort(
        (a, b) => STAT_CARD_ORDER.indexOf(a) - STAT_CARD_ORDER.indexOf(b)
      );
      persistVisibleStatCards(next);
    },
    [persistVisibleStatCards, visibleStatCards]
  );

  const reorderDashboardWidget = useCallback(
    (source: DashboardWidgetId, target: DashboardWidgetId) => {
      if (source === target) return;
      const from = dashboardWidgets.indexOf(source);
      const to = dashboardWidgets.indexOf(target);
      if (from < 0 || to < 0) return;
      const next = [...dashboardWidgets];
      next.splice(from, 1);
      next.splice(to, 0, source);
      persistDashboardWidgets(next);
    },
    [dashboardWidgets, persistDashboardWidgets]
  );

  const handleWidgetDragHandleDown = useCallback(
    (id: DashboardWidgetId, e: React.PointerEvent<HTMLButtonElement>) => {
      if (!dashboardEditMode || e.button !== 0) return;
      const rect = (e.currentTarget as HTMLButtonElement).closest('div')?.getBoundingClientRect();
      if (!rect) return;
      const meta = DASHBOARD_WIDGETS.find((widget) => widget.id === id);
      pendingWidgetDragRef.current = {
        id,
        startX: e.clientX,
        startY: e.clientY,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        width: Math.max(160, rect.width),
        label: meta?.label || id,
      };
      e.preventDefault();
    },
    [dashboardEditMode]
  );

  const handleWidgetDragTargetEnter = useCallback(
    (id: DashboardWidgetId) => {
      if (!dashboardEditMode) return;
      const source = draggingWidgetIdRef.current;
      if (!source || source === id) return;
      if (dragOverWidgetIdRef.current === id) return;
      reorderDashboardWidget(source, id);
      setDragOverWidgetId(id);
    },
    [dashboardEditMode, reorderDashboardWidget]
  );

  useDismissOnOutside(quickLinkAddMenuRef, showQuickLinkAddMenu, () => {
    setShowQuickLinkAddMenu(false);
    resetCustomQuickLinkForm();
  });
  useDismissOnOutside(dashboardAddMenuRef, showDashboardAddMenu, () =>
    setShowDashboardAddMenu(false)
  );

  const persistTrackedCharacters = useCallback(
    (next: { region: string; realm: string; name: string }[]) => {
      setTrackedCharacters(next);
      if (typeof window !== 'undefined') {
        localStorage.setItem(
          LOCAL_TRACKED_CHARACTERS_KEY,
          JSON.stringify(next.map((x) => `${x.region}|${x.realm}|${x.name}`))
        );
      }
    },
    []
  );

  const untrackAtIndex = useCallback(
    (idx: number) => {
      const next = trackedCharacters.filter((_, i) => i !== idx);
      persistTrackedCharacters(next);
      setActiveTrackedIndex((prev) => {
        if (next.length === 0) return 0;
        if (prev > idx) return prev - 1;
        if (prev === idx) return Math.max(0, prev - 1);
        return prev;
      });
    },
    [persistTrackedCharacters, trackedCharacters]
  );

  const moveTrackedCharacter = useCallback(
    (from: number, to: number) => {
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= trackedCharacters.length ||
        to >= trackedCharacters.length
      ) {
        return;
      }
      const next = [...trackedCharacters];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      persistTrackedCharacters(next);
      setActiveTrackedIndex((prev) => {
        if (prev === from) return to;
        if (from < prev && to >= prev) return prev - 1;
        if (from > prev && to <= prev) return prev + 1;
        return prev;
      });
    },
    [persistTrackedCharacters, trackedCharacters]
  );

  useEffect(() => {
    draggedTrackedIndexRef.current = draggedTrackedIndex;
  }, [draggedTrackedIndex]);

  useEffect(() => {
    draggedQuickLinkIndexRef.current = draggedQuickLinkIndex;
  }, [draggedQuickLinkIndex]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (draggedQuickLinkIndexRef.current != null || !pendingQuickLinkDragRef.current) return;
      const pending = pendingQuickLinkDragRef.current;
      if (Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) < 6) return;
      setDraggedQuickLinkIndex(pending.idx);
      setDragOverQuickLinkIndex(pending.idx);
      pendingQuickLinkDragRef.current = null;
    };

    const onPointerUp = () => {
      pendingQuickLinkDragRef.current = null;
      setDraggedQuickLinkIndex(null);
      setDragOverQuickLinkIndex(null);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (draggedTrackedIndexRef.current == null && pendingDragRef.current) {
        const p = pendingDragRef.current;
        const dx = e.clientX - p.startX;
        const dy = e.clientY - p.startY;
        if (Math.hypot(dx, dy) >= 6) {
          setDraggedTrackedIndex(p.idx);
          setDragOverTrackedIndex(p.idx);
          setDragPointer({
            x: e.clientX,
            y: e.clientY,
            offsetX: p.offsetX,
            offsetY: p.offsetY,
            width: p.width,
            label: p.label,
            color: p.color,
          });
          pendingDragRef.current = null;
        }
        return;
      }
      if (draggedTrackedIndexRef.current != null) {
        setDragPointer((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
      }
    };

    const onPointerUp = () => {
      pendingDragRef.current = null;
      setDraggedTrackedIndex(null);
      setDragOverTrackedIndex(null);
      setDragPointer(null);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  useEffect(() => {
    if (draggedTrackedIndex == null) return;
    const onPointerMove = (e: PointerEvent) => {
      setDragPointer((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
    };
    const onPointerUp = () => {
      setDraggedTrackedIndex(null);
      setDragOverTrackedIndex(null);
      setDragPointer(null);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [draggedTrackedIndex]);

  useEffect(() => {
    draggingWidgetIdRef.current = draggingWidgetId;
  }, [draggingWidgetId]);

  useEffect(() => {
    dragOverWidgetIdRef.current = dragOverWidgetId;
  }, [dragOverWidgetId]);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (pendingWidgetResizeRef.current) {
        const pending = pendingWidgetResizeRef.current;
        const step = Math.round((e.clientX - pending.startX) / 120);
        const next = Math.max(1, Math.min(3, pending.startSize + step)) as DashboardWidgetSize;
        if ((dashboardWidgetSizes[pending.id] || 3) !== next) {
          resizeDashboardWidget(pending.id, next);
        }
        return;
      }
      if (draggingWidgetIdRef.current == null && pendingWidgetDragRef.current) {
        const pending = pendingWidgetDragRef.current;
        const moved =
          Math.abs(e.clientX - pending.startX) > 5 || Math.abs(e.clientY - pending.startY) > 5;
        if (moved) {
          setDraggingWidgetId(pending.id);
          setDragOverWidgetId(pending.id);
          setDashboardDragPointer({
            x: e.clientX,
            y: e.clientY,
            offsetX: pending.offsetX,
            offsetY: pending.offsetY,
            width: pending.width,
            label: pending.label,
          });
        }
      }
      if (draggingWidgetIdRef.current != null) {
        setDashboardDragPointer((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
      }
    };

    const onPointerUp = () => {
      pendingWidgetResizeRef.current = null;
      pendingWidgetDragRef.current = null;
      setDraggingWidgetId(null);
      setDragOverWidgetId(null);
      setDashboardDragPointer(null);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [dashboardWidgetSizes, resizeDashboardWidget]);

  useEffect(() => {
    let active = true;
    (async () => {
      await loadAll();
      await loadReadiness();
      if (!active) return;
    })();
    return () => {
      active = false;
    };
  }, [loadAll, loadReadiness]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onFocus = () => {
      void loadAll();
      void loadReadiness();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadAll();
        void loadReadiness();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [loadAll, loadReadiness]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const usResetCountdown = useMemo(
    () => formatCountdown(getNextWeeklyResetMs('us', new Date(nowMs)) - nowMs),
    [nowMs]
  );
  const euResetCountdown = useMemo(
    () => formatCountdown(getNextWeeklyResetMs('eu', new Date(nowMs)) - nowMs),
    [nowMs]
  );
  const usNextResetMs = useMemo(() => getNextWeeklyResetMs('us', new Date(nowMs)), [nowMs]);
  const euNextResetMs = useMemo(() => getNextWeeklyResetMs('eu', new Date(nowMs)), [nowMs]);

  const activeSims = useMemo(() => sims.filter((sim) => sim.status === 'running').length, [sims]);
  const hasInFlightSims = useMemo(
    () =>
      queuedSims > 0 ||
      sims.some(
        (sim) => sim.status === 'pending' || sim.status === 'running' || sim.status === 'paused'
      ),
    [queuedSims, sims]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => void loadAll();
    window.addEventListener(SIMULATION_TRACKED_EVENT, refresh);
    if (!hasInFlightSims) {
      return () => window.removeEventListener(SIMULATION_TRACKED_EVENT, refresh);
    }

    const interval = window.setInterval(refresh, 2000);
    return () => {
      window.removeEventListener(SIMULATION_TRACKED_EVENT, refresh);
      window.clearInterval(interval);
    };
  }, [hasInFlightSims, loadAll]);

  const activity = useMemo(
    () => buildActivityData(sims, activityPeriod, new Date(nowMs)),
    [activityPeriod, nowMs, sims]
  );
  const widgetMetaById = useMemo(
    () => new Map(DASHBOARD_WIDGETS.map((widget) => [widget.id, widget])),
    []
  );
  const dashboardWidgetClassBySize: Record<DashboardWidgetSize, string> = {
    1: 'xl:col-span-1',
    2: 'xl:col-span-2',
    3: 'xl:col-span-3',
  };
  const statsWidgetSize = dashboardWidgetSizes.stats || 3;
  const trackedWidgetSize = dashboardWidgetSizes['tracked-characters'] || 3;
  const quickLinksWidgetSize = dashboardWidgetSizes['quick-links'] || 1;
  const quickLinksHeightClass =
    QUICK_LINKS_HEIGHT_OPTIONS.find((option) => option.value === quickLinksHeight)?.className ||
    'h-80';
  const quickLinksGridClass =
    quickLinksWidgetSize === 1
      ? 'grid-cols-1'
      : quickLinksWidgetSize === 2
        ? 'grid-cols-1 md:grid-cols-2'
        : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3';
  const statsCompact = statsWidgetSize === 1;
  const trackedCompact = trackedWidgetSize === 1;

  const renderWidgetShell = (id: DashboardWidgetId, children: ReactNode) => {
    const index = dashboardWidgets.indexOf(id);
    if (index < 0) return null;
    const meta = widgetMetaById.get(id);
    const size = dashboardWidgetSizes[id] || meta?.defaultSize || 3;
    return (
      <DashboardWidgetShell
        widgetId={id}
        label={meta?.label || id}
        className={dashboardWidgetClassBySize[size]}
        editMode={dashboardEditMode}
        index={index}
        size={size}
        onRemove={removeDashboardWidget}
        onResizeHandleDown={handleWidgetResizeHandleDown}
        isDragged={draggingWidgetId === id}
        isDragTarget={dragOverWidgetId === id}
        isDraggingAny={draggingWidgetId != null}
        onDragHandleDown={handleWidgetDragHandleDown}
        onDragTargetEnter={handleWidgetDragTargetEnter}
      >
        {children}
      </DashboardWidgetShell>
    );
  };

  if (loading) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted">Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div data-tour="dashboard-heading">
          <h1 className="text-xl font-semibold text-zinc-100">Simulation Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Live simulation activity, system health, and recent results.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="hidden rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 text-[11px] text-zinc-300 md:block"
            title={`US reset at ${formatLocalDateTime(usNextResetMs)} (your local time)`}
          >
            <span className="font-semibold text-zinc-200">US reset:</span> {usResetCountdown}
          </div>
          <div
            className="hidden rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 text-[11px] text-zinc-300 md:block"
            title={`EU reset at ${formatLocalDateTime(euNextResetMs)} (your local time)`}
          >
            <span className="font-semibold text-zinc-200">EU reset:</span> {euResetCountdown}
          </div>
          <button
            type="button"
            onClick={() => {
              void loadAll();
            }}
            className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:border-border-light hover:bg-surface"
          >
            Refresh Dashboard
          </button>
        </div>
      </div>

      <div data-tour="onboarding-checklist">
        <OnboardingChecklist />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div
        data-tour="dashboard-controls"
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
      >
        <div>
          <p className="text-sm font-semibold text-zinc-200">Dashboard Widgets</p>
          <p className="text-xs text-zinc-500">Add, remove, and reorder dashboard sections.</p>
        </div>
        <div className="flex items-center gap-2">
          {dashboardEditMode && (
            <div ref={dashboardAddMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setShowDashboardAddMenu((value) => !value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-surface"
              >
                Add Widget
              </button>
              {showDashboardAddMenu && (
                <div className="absolute right-0 z-50 mt-1 w-52 rounded-md border border-white/10 bg-[#111218] p-1 shadow-xl">
                  {hiddenDashboardWidgets.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-zinc-500">All widgets are visible</div>
                  ) : (
                    hiddenDashboardWidgets.map((widget) => (
                      <button
                        key={`add-dashboard-widget-${widget.id}`}
                        type="button"
                        onClick={() => addDashboardWidget(widget.id)}
                        className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/10"
                      >
                        {widget.label}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setDashboardEditMode((value) => !value);
              setShowDashboardAddMenu(false);
            }}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
              dashboardEditMode
                ? 'border-gold/50 bg-gold/15 text-gold'
                : 'border-border bg-surface-2 text-zinc-200 hover:bg-surface'
            }`}
          >
            {dashboardEditMode ? 'Done' : 'Customize'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-flow-row-dense xl:grid-cols-3">
        {renderWidgetShell(
          'system-health',
          <ReadinessPanel
            snapshot={readiness}
            loading={!readiness && !readinessError}
            error={readinessError}
            authenticated={!lightMode}
            lightMode={lightMode}
            onRefresh={() => void loadReadiness()}
          />
        )}

        {renderWidgetShell(
          'stats',
          <>
            <section className="space-y-2">
              {dashboardEditMode && (
                <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-black/20 p-1.5">
                  <span className="px-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Stats Cards
                  </span>
                  {hiddenStatCards.length === 0 ? (
                    <span className="px-1.5 text-[11px] text-zinc-500">All visible</span>
                  ) : (
                    hiddenStatCards.map((id) => (
                      <button
                        key={`show-stat-${id}`}
                        type="button"
                        onClick={() => addStatCard(id)}
                        className="rounded border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-white/10"
                      >
                        Add{' '}
                        {id === 'active'
                          ? 'Active Sims'
                          : id === 'queued'
                            ? 'Queued Sims'
                            : id === 'total'
                              ? 'Total Sims'
                              : id === 'history'
                                ? 'History Size'
                                : 'System Load'}
                      </button>
                    ))
                  )}
                </div>
              )}
              <div>
                <div
                  className={`grid gap-3 ${
                    statsCompact
                      ? 'grid-cols-1'
                      : statsWidgetSize === 2
                        ? 'grid-cols-2'
                        : visibleStatCards.length >= 5
                          ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-5'
                          : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'
                  }`}
                >
                  {visibleStatCards.map((id) => {
                    const metric =
                      id === 'active'
                        ? { label: 'Active Sims', value: String(activeSims), icon: <ActiveIcon /> }
                        : id === 'queued'
                          ? { label: 'Queued Sims', value: String(queuedSims), icon: <QueueIcon /> }
                          : id === 'total'
                            ? {
                                label: 'Total Sims',
                                value: String(historyStats?.count ?? 0),
                                icon: <ListIcon />,
                              }
                            : id === 'history'
                              ? {
                                  label: 'History Size',
                                  value: formatBytes(historyStats?.size_bytes ?? 0),
                                  icon: <DatabaseIcon />,
                                }
                              : {
                                  label: 'System Load',
                                  value: isDesktop
                                    ? cpuUsage != null
                                      ? `${Math.round(cpuUsage)}%`
                                      : 'N/A'
                                    : 'N/A',
                                  icon: <CpuIcon />,
                                };
                    const card = (
                      <div
                        key={`stat-card-${id}`}
                        className={`card ${statsCompact ? 'p-3' : 'p-4'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs uppercase tracking-wide text-zinc-500">
                              {metric.label}
                            </p>
                            <p
                              className={`mt-2 font-semibold text-zinc-100 ${
                                statsCompact ? 'text-2xl' : 'text-3xl'
                              }`}
                            >
                              {metric.value}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <StatIcon>{metric.icon}</StatIcon>
                            {dashboardEditMode && (
                              <button
                                type="button"
                                onClick={() => removeStatCard(id)}
                                disabled={visibleStatCards.length <= 1}
                                className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-300 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                    return id === 'queued' && !dashboardEditMode ? (
                      <Link
                        key={`stat-card-link-${id}`}
                        href="/queue"
                        className="block rounded-xl focus-visible:ring-gold/60 focus-visible:ring-2 focus-visible:outline-none"
                        aria-label="Open simulation queue"
                      >
                        {card}
                      </Link>
                    ) : (
                      card
                    );
                  })}
                </div>
              </div>
            </section>
          </>
        )}

        {renderWidgetShell(
          'activity',
          <>
            <section className="card flex h-full min-h-0 flex-col p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-200">Simulation Activity</h2>
                  <p className="text-xs text-zinc-500">{getActivityPeriodTitle(activityPeriod)}</p>
                </div>
                <div className="flex items-center gap-1 rounded-md border border-white/10 bg-black/20 p-1">
                  {ACTIVITY_PERIOD_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setActivityPeriod(option.value)}
                      className={`rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
                        activityPeriod === option.value
                          ? 'bg-gold/15 text-gold'
                          : 'text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-64 min-h-[256px] min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <AreaChart data={activity} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#d4a843" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#d4a843" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="#71717a" tickLine={false} axisLine={false} />
                    <YAxis
                      allowDecimals={false}
                      stroke="#71717a"
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ stroke: '#3f3f46' }}
                      contentStyle={{
                        backgroundColor: '#18181b',
                        border: '1px solid #3f3f46',
                        borderRadius: '8px',
                        color: '#e4e4e7',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#d4a843"
                      strokeWidth={2}
                      fill="url(#activityGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          </>
        )}

        {renderWidgetShell(
          'quick-links',
          <>
            <section
              data-quick-links-height={quickLinksHeight}
              className={`card flex min-h-0 flex-col p-4 ${quickLinksHeightClass}`}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-zinc-200">Quick Links</h2>
                <div className="flex items-center gap-2">
                  {quickLinksEditMode && (
                    <div ref={quickLinkAddMenuRef} className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          if (showQuickLinkAddMenu) resetCustomQuickLinkForm();
                          setShowQuickLinkAddMenu((v) => !v);
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/15 bg-white/[0.04] text-zinc-200 transition-colors hover:bg-white/[0.1] hover:text-white"
                        title="Add quick link"
                        aria-label="Add quick link"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                      {showQuickLinkAddMenu && (
                        <div className="absolute right-0 z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-white/10 bg-[#111218] p-1 shadow-xl">
                          {showCustomQuickLinkForm ? (
                            <form onSubmit={addCustomQuickLink} className="space-y-3 p-2">
                              <div>
                                <p className="text-xs font-semibold text-zinc-200">Add Custom URL</p>
                                <p className="mt-1 text-[11px] text-zinc-500">
                                  Save any http:// or https:// destination to this dashboard.
                                </p>
                              </div>
                              <label className="block text-[11px] font-semibold text-zinc-400">
                                Name
                                <input
                                  value={customQuickLinkLabel}
                                  onChange={(event) => setCustomQuickLinkLabel(event.target.value)}
                                  maxLength={80}
                                  autoFocus
                                  placeholder="My guild site"
                                  className="mt-1 w-full rounded-md border border-white/10 bg-black/20 px-2.5 py-2 text-sm font-normal text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-gold/60"
                                />
                              </label>
                              <label className="block text-[11px] font-semibold text-zinc-400">
                                URL
                                <input
                                  type="url"
                                  value={customQuickLinkUrl}
                                  onChange={(event) => setCustomQuickLinkUrl(event.target.value)}
                                  maxLength={2000}
                                  placeholder="https://example.com"
                                  className="mt-1 w-full rounded-md border border-white/10 bg-black/20 px-2.5 py-2 text-sm font-normal text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-gold/60"
                                />
                              </label>
                              <fieldset>
                                <legend className="mb-1.5 text-[11px] font-semibold text-zinc-400">
                                  Icon
                                </legend>
                                <div
                                  role="radiogroup"
                                  aria-label="Link icon"
                                  className="grid grid-cols-7 gap-1"
                                >
                                  {QUICK_LINK_ICON_OPTIONS.map(({ value, label }) => (
                                    <button
                                      key={value}
                                      type="button"
                                      role="radio"
                                      aria-label={label}
                                      aria-checked={customQuickLinkIcon === value}
                                      title={label}
                                      onClick={() => setCustomQuickLinkIcon(value)}
                                      className={`inline-flex h-8 items-center justify-center rounded border transition-colors ${
                                        customQuickLinkIcon === value
                                          ? 'border-gold/60 bg-gold/15 text-gold'
                                          : 'border-white/10 bg-black/20 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                                      }`}
                                    >
                                      <QuickLinkIcon name={value} className="h-4 w-4" />
                                    </button>
                                  ))}
                                </div>
                              </fieldset>
                              {customQuickLinkError && (
                                <p role="alert" className="text-xs text-red-300">
                                  {customQuickLinkError}
                                </p>
                              )}
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={resetCustomQuickLinkForm}
                                  className="rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="submit"
                                  disabled={!customQuickLinkLabel.trim() || !customQuickLinkUrl.trim()}
                                  className="rounded-md bg-gold/90 px-2.5 py-1.5 text-xs font-semibold text-black hover:bg-gold disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Add Link
                                </button>
                              </div>
                            </form>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowCustomQuickLinkForm(true);
                                  setCustomQuickLinkError(null);
                                }}
                                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-semibold text-gold transition-colors hover:bg-gold/10"
                              >
                                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                                Add Custom URL
                              </button>
                              {addableQuickLinks.length === 0 ? (
                                <div className="px-2 py-1.5 text-xs text-zinc-500">No links to add</div>
                              ) : (
                                addableQuickLinks.map((link) => (
                                  <button
                                    key={`add-quick-link-${link.href}`}
                                    type="button"
                                    onClick={() => addQuickLink(link)}
                                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/10"
                                  >
                                    <QuickLinkIcon
                                      name={link.icon}
                                      className="h-3.5 w-3.5 shrink-0 text-zinc-500"
                                    />
                                    <span className="truncate">{link.label}</span>
                                  </button>
                                ))
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setQuickLinksEditMode((v) => !v);
                      setShowQuickLinkAddMenu(false);
                      resetCustomQuickLinkForm();
                      pendingQuickLinkDragRef.current = null;
                      setDraggedQuickLinkIndex(null);
                      setDragOverQuickLinkIndex(null);
                    }}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                      quickLinksEditMode
                        ? 'border-gold/60 bg-gold/15 text-gold'
                        : 'border-white/15 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.1] hover:text-white'
                    }`}
                    title={quickLinksEditMode ? 'Finish quick links edit mode' : 'Edit quick links'}
                    aria-label={
                      quickLinksEditMode ? 'Finish quick links edit mode' : 'Edit quick links'
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </div>
              </div>
              {quickLinksEditMode && (
                <div className="mb-3 flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-black/20 p-1.5">
                  <span className="px-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Height
                  </span>
                  {QUICK_LINKS_HEIGHT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => persistQuickLinksHeight(option.value)}
                      aria-pressed={quickLinksHeight === option.value}
                      className={`rounded border px-2 py-1 text-[11px] font-semibold transition-colors ${
                        quickLinksHeight === option.value
                          ? 'border-gold/50 bg-gold/15 text-gold'
                          : 'border-white/10 bg-black/20 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className={`grid gap-2 ${quickLinksGridClass}`}>
                  {visibleQuickLinks.map((link, index) => {
                    const className =
                      'flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-200 transition-colors hover:border-border-light hover:bg-surface';
                    return (
                      <div
                        key={link.href}
                        data-quick-link-row={link.label}
                        onPointerEnter={() => {
                          if (!quickLinksEditMode) return;
                          const currentDragged = draggedQuickLinkIndexRef.current;
                          if (currentDragged == null || currentDragged === index) return;
                          reorderQuickLinks(currentDragged, index);
                          setDraggedQuickLinkIndex(index);
                          setDragOverQuickLinkIndex(index);
                        }}
                        className={`flex min-w-0 items-center gap-2 rounded-md transition-colors ${
                          draggedQuickLinkIndex === index ? 'opacity-40' : ''
                        } ${
                          dragOverQuickLinkIndex === index && draggedQuickLinkIndex !== index
                            ? 'bg-gold/5 ring-1 ring-gold/40'
                            : ''
                        }`}
                      >
                        {quickLinksEditMode && (
                          <button
                            type="button"
                            onPointerDown={(event) => {
                              if (event.button !== 0) return;
                              pendingQuickLinkDragRef.current = {
                                idx: index,
                                startX: event.clientX,
                                startY: event.clientY,
                              };
                              event.preventDefault();
                            }}
                            className="inline-flex h-9 w-7 shrink-0 touch-none cursor-grab items-center justify-center rounded-md border border-white/10 bg-black/20 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
                            title={`Drag ${link.label} to reorder`}
                            aria-label={`Drag ${link.label} to reorder`}
                          >
                            <GripVertical className="h-4 w-4" strokeWidth={2} />
                          </button>
                        )}
                        {link.external ? (
                          <a
                            href={link.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              if (quickLinksEditMode) e.preventDefault();
                            }}
                            className={className}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <QuickLinkIcon
                                name={link.icon}
                                className="h-4 w-4 shrink-0 text-zinc-500"
                              />
                              <span className="min-w-0 truncate">{link.label}</span>
                            </span>
                            <ExternalLink
                              className="h-3.5 w-3.5 shrink-0 text-zinc-500"
                              aria-hidden="true"
                            />
                          </a>
                        ) : (
                          <Link
                            href={link.href}
                            onClick={(e) => {
                              if (quickLinksEditMode) e.preventDefault();
                            }}
                            className={className}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <QuickLinkIcon
                                name={link.icon}
                                className="h-4 w-4 shrink-0 text-zinc-500"
                              />
                              <span className="min-w-0 truncate">{link.label}</span>
                            </span>
                          </Link>
                        )}
                        {quickLinksEditMode && (
                          <button
                            type="button"
                            onClick={() =>
                              removeQuickLink(quickLinks.findIndex((item) => item === link))
                            }
                            aria-label={`Remove ${link.label}`}
                            title={`Remove ${link.label}`}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-zinc-400 transition-colors hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300"
                          >
                            -
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </>
        )}

        {!lightMode &&
          renderWidgetShell(
            'tracked-characters',
            <>
              <section
                className={`card flex h-full min-h-0 flex-col ${trackedCompact ? 'p-2.5' : 'p-3'}`}
              >
                <div
                  className={`mb-2 flex items-center justify-between ${trackedCompact ? 'gap-2' : ''}`}
                >
                  <h2 className="text-sm font-semibold text-zinc-200">Tracked Characters</h2>
                  <div
                    className={`flex items-center gap-2 ${trackedCompact ? 'flex-wrap justify-end' : ''}`}
                  >
                    {trackedCharacters.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          untrackAtIndex(Math.min(activeTrackedIndex, trackedCharacters.length - 1))
                        }
                        className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/20"
                      >
                        Untrack
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        pendingTrackedRefreshRef.current = true;
                        setTrackedRefreshing(true);
                        setTrackedRefreshToken((v) => v + 1);
                      }}
                      disabled={trackedRefreshing}
                      className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-white/10"
                    >
                      {trackedRefreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMainCharacterOpen((prev) => !prev)}
                      className="text-xs text-zinc-400 transition-colors hover:text-zinc-200"
                    >
                      {mainCharacterOpen ? 'Collapse' : 'Expand'}
                    </button>
                  </div>
                </div>
                {(() => {
                  const active =
                    trackedCharacters[Math.min(activeTrackedIndex, trackedCharacters.length - 1)];
                  if (!active) return null;
                  const key = `${active.region.toLowerCase()}|${active.realm.toLowerCase()}|${active.name.toLowerCase()}`;
                  const ts = lastRefreshedByCharacter[key];
                  if (!ts) return null;
                  return (
                    <p className="mb-2 text-[11px] text-zinc-500">
                      Last refreshed at {new Date(ts).toLocaleString()}
                    </p>
                  );
                })()}
                <div>
                  {mainCharacterOpen && trackedCharacters.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                      No tracked characters yet. Open a character and click Track Character.
                    </p>
                  ) : mainCharacterOpen && trackedCharacters.length > 0 ? (
                    (() => {
                      const active =
                        trackedCharacters[
                          Math.min(activeTrackedIndex, trackedCharacters.length - 1)
                        ];
                      if (!active) return null;
                      return (
                        <div className={`space-y-2 ${trackedCompact ? 'text-[13px]' : ''}`}>
                          <div className={`flex flex-wrap ${trackedCompact ? 'gap-1.5' : 'gap-2'}`}>
                            {trackedCharacters.map((c, idx) => (
                              <div
                                key={`${c.region}|${c.realm}|${c.name}`}
                                onPointerEnter={() => {
                                  const currentDragged = draggedTrackedIndexRef.current;
                                  if (currentDragged == null || currentDragged === idx) return;
                                  moveTrackedCharacter(currentDragged, idx);
                                  setDraggedTrackedIndex(idx);
                                  setDragOverTrackedIndex(idx);
                                }}
                                className={`inline-flex items-center rounded-md border transition-all duration-200 ${idx === activeTrackedIndex ? 'border-gold/40 bg-gold/10' : 'border-border bg-surface-2'} ${draggedTrackedIndex === idx ? 'pointer-events-none opacity-0' : ''} ${dragOverTrackedIndex === idx && draggedTrackedIndex !== idx ? 'border-gold/50' : ''}`}
                                style={{
                                  cursor: draggedTrackedIndex != null ? 'grabbing' : 'grab',
                                }}
                              >
                                {(() => {
                                  const key = `${c.region.toLowerCase()}|${c.realm.toLowerCase()}|${c.name.toLowerCase()}`;
                                  const className = trackedClassByCharacter[key];
                                  const classColor = className
                                    ? CLASS_COLORS[
                                        className.toLowerCase().replace(/[\s-]+/g, '_')
                                      ] || '#d4d4d8'
                                    : '#d4d4d8';
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => setActiveTrackedIndex(idx)}
                                      onPointerDown={(e) => {
                                        if (e.button !== 0) return;
                                        const rect = (e.currentTarget as HTMLButtonElement)
                                          .closest('div')
                                          ?.getBoundingClientRect();
                                        if (rect) {
                                          pendingDragRef.current = {
                                            idx,
                                            startX: e.clientX,
                                            startY: e.clientY,
                                            offsetX: e.clientX - rect.left,
                                            offsetY: e.clientY - rect.top,
                                            width: rect.width,
                                            label: c.name,
                                            color: classColor,
                                          };
                                        }
                                      }}
                                      className={`px-2 py-1 text-xs ${idx === activeTrackedIndex ? 'font-semibold' : 'hover:text-zinc-100'}`}
                                      style={{ color: classColor }}
                                      title="Drag to reorder"
                                    >
                                      {c.name}
                                    </button>
                                  );
                                })()}
                              </div>
                            ))}
                          </div>
                          {dragPointer && (
                            <div
                              className="pointer-events-none fixed z-[90] inline-flex items-center rounded-md border border-gold/60 bg-[#14151d]/95 px-2.5 py-1 text-xs font-semibold shadow-[0_12px_24px_rgba(0,0,0,0.45)] transition-transform duration-150"
                              style={{
                                left: dragPointer.x - dragPointer.offsetX,
                                top: dragPointer.y - dragPointer.offsetY - 8,
                                width: dragPointer.width,
                                transform: 'translateY(-4px) rotate(-2deg) scale(1.06)',
                                color: dragPointer.color,
                              }}
                            >
                              {dragPointer.label}
                            </div>
                          )}
                          <div
                            className={`flex flex-wrap items-center gap-2 text-zinc-200 ${trackedCompact ? 'text-[13px]' : 'text-sm'}`}
                          >
                            <span className="font-semibold">
                              {
                                trackedCharacters[
                                  Math.min(activeTrackedIndex, trackedCharacters.length - 1)
                                ]?.name
                              }
                            </span>
                            <span className="text-zinc-500">
                              {' '}
                              ·{' '}
                              {
                                trackedCharacters[
                                  Math.min(activeTrackedIndex, trackedCharacters.length - 1)
                                ]?.realm
                              }{' '}
                              ·{' '}
                              {trackedCharacters[
                                Math.min(activeTrackedIndex, trackedCharacters.length - 1)
                              ]?.region.toUpperCase()}
                            </span>
                          </div>
                          <CharacterQuickLinks
                            armoryUrl={`https://${active.region.toLowerCase()}.battle.net/wow/en/character/${active.realm.toLowerCase()}/${active.name.toLowerCase()}`}
                            warcraftLogsUrl={`https://www.warcraftlogs.com/character/${active.region.toLowerCase()}/${active.realm.toLowerCase()}/${active.name.toLowerCase()}`}
                            raiderIoUrl={`https://raider.io/characters/${active.region.toLowerCase()}/${active.realm.toLowerCase()}/${active.name.toLowerCase()}`}
                          />
                          <div
                            className={`grid gap-2 ${trackedCompact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3'}`}
                          >
                            <div className="rounded border border-white/10 bg-black/20 p-2 text-xs text-zinc-300">
                              Level:{' '}
                              <span className="font-semibold text-zinc-100">
                                {mainMeta?.level ?? '-'}
                              </span>
                            </div>
                            <div className="rounded border border-white/10 bg-black/20 p-2 text-xs text-zinc-300">
                              Class:{' '}
                              <span className="font-semibold text-zinc-100">
                                {mainMeta?.className ?? '-'}
                              </span>
                            </div>
                            <div className="rounded border border-white/10 bg-black/20 p-2 text-xs text-zinc-300">
                              iLvl:{' '}
                              <span className="font-semibold text-zinc-100">
                                {mainMeta?.ilvl ?? '-'}
                              </span>
                            </div>
                          </div>
                          <div
                            className={`grid grid-cols-1 gap-2 ${trackedCompact ? '' : 'md:grid-cols-2'}`}
                          >
                            <div className="rounded border border-white/10 bg-black/20 p-2">
                              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                                Mythic+ Vault
                              </p>
                              <div
                                className={`grid gap-1.5 ${trackedCompact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3'}`}
                              >
                                {MYTHIC_VAULT_THRESHOLDS.map((threshold, idx) => {
                                  const current = mainVault?.mplusRuns ?? 0;
                                  const unlocked = current >= threshold;
                                  const progress = Math.min(1, current / threshold);
                                  return (
                                    <div
                                      key={`main-mplus-${threshold}`}
                                      className="rounded border border-white/10 bg-black/25 p-1.5"
                                    >
                                      <div className="mb-1 flex items-center justify-between text-[11px]">
                                        <span className="font-semibold text-zinc-200">
                                          Slot {idx + 1}
                                        </span>
                                        <span
                                          className={
                                            unlocked
                                              ? 'font-bold text-emerald-400'
                                              : 'text-zinc-500'
                                          }
                                        >
                                          {unlocked
                                            ? 'Unlocked'
                                            : `${Math.max(0, threshold - current)} more`}
                                        </span>
                                      </div>
                                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                                        <div
                                          className={`h-full rounded-full ${unlocked ? 'bg-emerald-400' : 'bg-gold/70'}`}
                                          style={{ width: `${Math.max(6, progress * 100)}%` }}
                                        />
                                      </div>
                                      <p className="mt-1 text-[10px] text-zinc-500">
                                        Requires {threshold} runs
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                              <p className="mt-2 text-[11px] text-zinc-500">
                                {mainVault?.mplusRuns ?? 0} runs completed this week.
                              </p>
                            </div>
                            <div className="rounded border border-white/10 bg-black/20 p-2">
                              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                                Raid Vault
                              </p>
                              <div
                                className={`grid gap-1.5 ${trackedCompact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3'}`}
                              >
                                {RAID_VAULT_THRESHOLDS.map((threshold, idx) => {
                                  const current = mainVault?.raidKills ?? 0;
                                  const unlocked = current >= threshold;
                                  const progress = Math.min(1, current / threshold);
                                  return (
                                    <div
                                      key={`main-raid-${threshold}`}
                                      className="rounded border border-white/10 bg-black/25 p-1.5"
                                    >
                                      <div className="mb-1 flex items-center justify-between text-[11px]">
                                        <span className="font-semibold text-zinc-200">
                                          Slot {idx + 1}
                                        </span>
                                        <span
                                          className={
                                            unlocked
                                              ? 'font-bold text-emerald-400'
                                              : 'text-zinc-500'
                                          }
                                        >
                                          {unlocked
                                            ? 'Unlocked'
                                            : `${Math.max(0, threshold - current)} more`}
                                        </span>
                                      </div>
                                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                                        <div
                                          className={`h-full rounded-full ${unlocked ? 'bg-emerald-400' : 'bg-gold/70'}`}
                                          style={{ width: `${Math.max(6, progress * 100)}%` }}
                                        />
                                      </div>
                                      <p className="mt-1 text-[10px] text-zinc-500">
                                        Requires {threshold} boss kills
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                              <p className="mt-2 text-[11px] text-zinc-500">
                                {mainVault?.raidKills ?? 0} boss kills completed this week.
                              </p>
                            </div>
                          </div>
                          {mainVaultRewards.length > 0 && (
                            <div className="rounded border border-white/10 bg-black/20 p-2">
                              <div className="mb-2 text-xs font-semibold text-zinc-200">
                                Vault Rewards
                              </div>
                              <VaultRewardsGrid items={mainVaultRewards} />
                            </div>
                          )}
                          <div className={`flex flex-wrap gap-2 ${trackedCompact ? 'pt-1' : ''}`}>
                            <Link
                              href={characterHref(active.region, active.realm, active.name)}
                              className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-zinc-200 hover:bg-surface"
                            >
                              Open Character
                            </Link>
                            <button
                              onClick={() => openMainWorkflow('/quick-sim')}
                              className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-zinc-200 hover:bg-surface"
                            >
                              Run Sim
                            </button>
                            <button
                              onClick={() => openMainWorkflow('/top-gear')}
                              className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-zinc-200 hover:bg-surface"
                            >
                              Top Gear
                            </button>
                            <Link
                              href={characterHref(
                                active.region,
                                active.realm,
                                active.name,
                                'vault'
                              )}
                              className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-zinc-200 hover:bg-surface"
                            >
                              Open Vault
                            </Link>
                          </div>
                        </div>
                      );
                    })()
                  ) : null}
                </div>
              </section>
            </>
          )}
      </div>
      {draggingWidgetId && dashboardDragPointer && (
        <div
          className="pointer-events-none fixed z-[95] inline-flex items-center rounded-md border border-gold/60 bg-[#14151d]/95 px-2.5 py-1 text-xs font-semibold text-zinc-100 shadow-[0_12px_24px_rgba(0,0,0,0.45)] transition-transform duration-150"
          style={{
            left: dashboardDragPointer.x - dashboardDragPointer.offsetX,
            top: dashboardDragPointer.y - dashboardDragPointer.offsetY - 8,
            width: dashboardDragPointer.width,
            transform: 'translateY(-4px) rotate(-1.5deg) scale(1.03)',
          }}
        >
          {dashboardDragPointer.label}
        </div>
      )}
    </div>
  );
}

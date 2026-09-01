'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowUp,
  BarChart3,
  Globe,
  GripVertical,
  LineChart,
  ListOrdered,
  Map as MapIcon,
  MessageCircle,
  Pencil,
  Play,
  ScrollText,
  Settings as SettingsIcon,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from './AuthContext';
import { APP_VERSION_WITH_PREFIX } from '../lib/version';
import { useDismissOnOutside } from '../lib/useDismissOnOutside';
import { API_URL, fetchJson, isHostedPrivate } from '../lib/api';
import { SIMC_RUNTIME_UPDATED_EVENT } from '../lib/simc-runtime-release';

const DISCORD_INVITE_URL = 'https://discord.gg/ZjxQv5kFxe';
const APP_WEBSITE_URL = 'https://josephlteif.github.io/WhyLowDPS/';

type SimcRuntimeSidebarStatus = {
  channel?: string | null;
  version?: string | null;
};

function formatSimcSidebarVersion(version: string | null | undefined): string {
  if (!version) return 'Unavailable';
  const match = version.match(/^(?:[^-]+-)?(\d{8})(\d{4})?$/);
  if (!match) return version;

  const [, datePart, timePart] = match;
  const date = `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`;
  return timePart ? `${date} ${timePart.slice(0, 2)}:${timePart.slice(2, 4)}` : date;
}

interface NavItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  matchPaths: string[];
  children?: { href: string; label: string; description: string }[];
}

const baseNavItems: NavItem[] = [
  {
    href: '/',
    label: 'Dashboard',
    description: 'Overview of sims, activity, and results.',
    icon: BarChart3,
    matchPaths: ['/'],
  },
  {
    href: '/top-gear',
    label: 'Sim',
    description: 'Run sims and optimize setups.',
    icon: Play,
    matchPaths: ['/quick-sim', '/top-gear'],
    children: [
      { href: '/top-gear', label: 'Top Gear', description: 'Best gear from your bags' },
      { href: '/quick-sim', label: 'Quick Sim', description: 'DPS and ability breakdown' },
    ],
  },
  {
    href: '/drop-finder',
    label: 'Upgrades',
    description: 'Find and sim gear upgrades.',
    icon: ArrowUp,
    matchPaths: ['/drop-finder', '/upgrade-compare', '/upgrade', '/wishlist'],
    children: [
      { href: '/drop-finder', label: 'Drop Finder', description: 'Find gear to acquire' },
      { href: '/upgrade-compare', label: 'Upgrade Planner', description: 'Plan owned upgrades' },
      { href: '/wishlist', label: 'Wishlist', description: 'Track items to obtain' },
    ],
  },
  {
    href: '/analysis/quick-weights',
    label: 'Analysis',
    description: 'Weights and matrix analysis.',
    icon: LineChart,
    matchPaths: [
      '/stat-weights',
      '/analysis/quick-weights',
      '/analysis/stat-plot',
      '/analysis/consumable-matrix',
      '/analysis/tier-slot-matrix',
    ],
    children: [
      {
        href: '/analysis/quick-weights',
        label: 'Quick Weights',
        description: 'Fast stat weight summary',
      },
      { href: '/analysis/stat-plot', label: 'Stat Plot', description: 'Stat scaling chart' },
      {
        href: '/analysis/consumable-matrix',
        label: 'Consumable Matrix',
        description: 'Consumable comparisons',
      },
      {
        href: '/analysis/tier-slot-matrix',
        label: 'Tier Slot Matrix',
        description: 'Tier-slot impact matrix',
      },
      { href: '/upgrade/trinkets', label: 'Trinkets', description: 'Sim trinket pools & pairs' },
    ],
  },
  {
    href: '/dungeons',
    label: 'Dungeons & Routes',
    description: 'Current dungeons and routes.',
    icon: MapIcon,
    matchPaths: ['/dungeons', '/dungeon-routes', '/raids'],
    children: [
      { href: '/dungeons', label: 'Dungeons', description: 'Rotation and affixes' },
      { href: '/raids', label: 'Raids', description: 'Raid names and encounters' },
      {
        href: '/dungeon-routes',
        label: 'Routes',
        description: 'Dungeon routes for simulation',
      },
    ],
  },
  {
    href: '/history',
    label: 'History',
    description: 'View recent simulation results.',
    icon: ScrollText,
    matchPaths: ['/history'],
  },
  {
    href: '/queue',
    label: 'Queue',
    description: 'Manage pending simulations.',
    icon: ListOrdered,
    matchPaths: ['/queue'],
  },
];

const SIDEBAR_COLLAPSED_KEY = 'whylowdps_sidebar_collapsed';
const SIDEBAR_ORDER_KEY = 'whylowdps_sidebar_order';
const SIDEBAR_VISIBLE_KEY = 'whylowdps_sidebar_visible';
const SIDEBAR_DEFAULT_VISIBLE_LABELS = new Set(['Settings']);

function navTourTarget(label: string): string {
  return `nav-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function ensureDefaultVisibleLabels(labels: string[], availableLabels: string[]): string[] {
  const next = [...labels];
  for (const label of SIDEBAR_DEFAULT_VISIBLE_LABELS) {
    if (!availableLabels.includes(label) || next.includes(label)) continue;
    next.push(label);
  }
  return next;
}

function moveLabelWithPosition(
  order: string[],
  source: string,
  target: string,
  position: 'before' | 'after'
): string[] {
  if (source === target) return order;
  const withoutSource = order.filter((label) => label !== source);
  const targetIdx = withoutSource.indexOf(target);
  if (targetIdx === -1) return withoutSource;
  const insertIdx = position === 'after' ? targetIdx + 1 : targetIdx;
  withoutSource.splice(insertIdx, 0, source);
  return withoutSource;
}

export default function Sidebar() {
  const pathname = usePathname();
  const normalizedPath =
    pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname;
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [navOrder, setNavOrder] = useState<string[] | null>(null);
  const [visibleLabels, setVisibleLabels] = useState<string[] | null>(null);
  const [draggingLabel, setDraggingLabel] = useState<string | null>(null);
  const [dragOverLabel, setDragOverLabel] = useState<string | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<'before' | 'after'>('before');
  const [dragPointer, setDragPointer] = useState<{
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    width: number;
  } | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const mobileCloseRef = useRef<HTMLButtonElement | null>(null);
  const dragSourceRef = useRef<string | null>(null);
  const dragOverRef = useRef<string | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const dragOverPosRef = useRef<'before' | 'after'>('before');
  const { user, lightMode } = useAuth();
  const [simcRuntimeStatus, setSimcRuntimeStatus] = useState<SimcRuntimeSidebarStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadSimcRuntimeStatus = () => {
      if (!isHostedPrivate || user?.role !== 'admin') {
        setSimcRuntimeStatus(null);
        return;
      }

      void fetchJson<SimcRuntimeSidebarStatus>(`${API_URL}/api/admin/simc-runtime`, {
        cache: 'no-store',
      })
        .then((status) => {
          if (!cancelled) setSimcRuntimeStatus(status);
        })
        .catch(() => {
          if (!cancelled) setSimcRuntimeStatus(null);
        });
    };

    loadSimcRuntimeStatus();
    window.addEventListener(SIMC_RUNTIME_UPDATED_EVENT, loadSimcRuntimeStatus);

    return () => {
      cancelled = true;
      window.removeEventListener(SIMC_RUNTIME_UPDATED_EVENT, loadSimcRuntimeStatus);
    };
  }, [user?.role]);

  const navItems = useMemo(() => {
    const items = [...baseNavItems];
    if (user && !lightMode) {
      items.push({
        href: '/characters',
        label: 'My Characters',
        description: 'View your Battle.net roster.',
        icon: Users,
        matchPaths: ['/characters', '/wishlist', '/talent-playground'],
        children: [
          { href: '/characters', label: 'Roster', description: 'Your Battle.net characters' },
          { href: '/wishlist', label: 'Wishlist', description: 'Saved target drops by character' },
          {
            href: '/talent-playground',
            label: 'Talent Playground',
            description: 'Build, import, and save talent trees',
          },
        ],
      });

      items.push({
        href: '/settings',
        label: 'Settings',
        description: 'API keys and account setup.',
        icon: SettingsIcon,
        matchPaths: ['/settings'],
      });
    }
    return items;
  }, [lightMode, user]);

  const orderedNavItems = useMemo(() => {
    if (!navOrder || navOrder.length === 0) return navItems;
    const byLabel = new Map(navItems.map((item) => [item.label, item]));
    const ordered: NavItem[] = [];
    for (const label of navOrder) {
      const item = byLabel.get(label);
      if (item) {
        ordered.push(item);
        byLabel.delete(label);
      }
    }
    for (const item of navItems) {
      if (byLabel.has(item.label)) ordered.push(item);
    }
    return ordered;
  }, [navItems, navOrder]);

  const visibleNavItems = useMemo(() => {
    if (!visibleLabels || visibleLabels.length === 0) return orderedNavItems;
    const visibleSet = new Set(visibleLabels);
    return orderedNavItems.filter((item) => visibleSet.has(item.label));
  }, [orderedNavItems, visibleLabels]);

  const addableNavItems = useMemo(() => {
    const currentVisible =
      visibleLabels && visibleLabels.length > 0
        ? visibleLabels
        : orderedNavItems.map((i) => i.label);
    const visibleSet = new Set(currentVisible);
    return orderedNavItems.filter((item) => !visibleSet.has(item.label));
  }, [orderedNavItems, visibleLabels]);

  useEffect(() => {
    const collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    setIsCollapsed(collapsed === '1');
    const availableLabels = navItems.map((item) => item.label);
    const savedOrder = localStorage.getItem(SIDEBAR_ORDER_KEY);
    if (savedOrder) {
      try {
        const parsed = JSON.parse(savedOrder);
        if (Array.isArray(parsed)) {
          setNavOrder(parsed.filter((v) => typeof v === 'string'));
        }
      } catch {
        // ignore malformed stored order
      }
    }
    const savedVisible = localStorage.getItem(SIDEBAR_VISIBLE_KEY);
    if (savedVisible) {
      try {
        const parsed = JSON.parse(savedVisible);
        if (Array.isArray(parsed)) {
          const savedLabels = parsed.filter((v): v is string => typeof v === 'string');
          setVisibleLabels(ensureDefaultVisibleLabels(savedLabels, availableLabels));
        }
      } catch {
        // ignore malformed stored visibility
      }
    }
  }, [navItems]);

  useEffect(() => {
    // Keep JS breakpoint aligned with Tailwind `xl` (`min-width: 1280px`).
    // Using `< 1280` avoids the 1280px dead zone where toggle and sidebar can both be hidden.
    const media = window.matchMedia('(max-width: 1279px)');
    const syncNarrow = () => setIsNarrowViewport(media.matches);
    syncNarrow();
    media.addEventListener('change', syncNarrow);
    return () => media.removeEventListener('change', syncNarrow);
  }, []);

  useEffect(() => {
    if (!isNarrowViewport) {
      setIsMobileOpen(false);
      return;
    }
    const onToggle = () => setIsMobileOpen((v) => !v);
    window.addEventListener('whylowdps:toggle-sidebar', onToggle);
    return () => window.removeEventListener('whylowdps:toggle-sidebar', onToggle);
  }, [isNarrowViewport]);

  useEffect(() => {
    if (!isNarrowViewport || !isMobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement;
    document.body.style.overflow = 'hidden';
    mobileCloseRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMobileOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [isMobileOpen, isNarrowViewport]);

  useEffect(() => {
    const width = isCollapsed ? '5rem' : '18rem';
    const effectiveWidth = isNarrowViewport ? '0rem' : width;
    document.documentElement.style.setProperty('--sidebar-width', effectiveWidth);
    document.body.style.setProperty('--sidebar-width', effectiveWidth);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, isCollapsed ? '1' : '0');
  }, [isCollapsed, isNarrowViewport]);

  useEffect(() => {
    if (!navOrder) return;
    localStorage.setItem(SIDEBAR_ORDER_KEY, JSON.stringify(navOrder));
  }, [navOrder]);

  useEffect(() => {
    if (!visibleLabels) return;
    localStorage.setItem(SIDEBAR_VISIBLE_KEY, JSON.stringify(visibleLabels));
  }, [visibleLabels]);

  useEffect(() => {
    setNavOrder((prev) => {
      const labels = navItems.map((item) => item.label);
      if (!prev || prev.length === 0) return labels;
      const deduped = prev.filter((label, idx) => prev.indexOf(label) === idx);
      const filtered = deduped.filter((label) => labels.includes(label));
      for (const label of labels) {
        if (!filtered.includes(label)) filtered.push(label);
      }
      return filtered;
    });
  }, [navItems]);

  useEffect(() => {
    setVisibleLabels((prev) => {
      const labels = navItems.map((item) => item.label);
      if (!prev || prev.length === 0) return ensureDefaultVisibleLabels(labels, labels);
      const deduped = prev.filter((label, idx) => prev.indexOf(label) === idx);
      const filtered = deduped.filter((label) => labels.includes(label));
      if (filtered.length === 0) return labels;
      return ensureDefaultVisibleLabels(filtered, labels);
    });
  }, [navItems]);

  useEffect(() => {
    dragOverRef.current = dragOverLabel;
  }, [dragOverLabel]);

  useEffect(() => {
    dragOverPosRef.current = dragOverPosition;
  }, [dragOverPosition]);

  const finishPointerDrag = useCallback(() => {
    const source = dragSourceRef.current;
    const target = dragOverRef.current;
    if (source && target && source !== target) {
      setNavOrder((prev) =>
        moveLabelWithPosition(
          prev ?? orderedNavItems.map((i) => i.label),
          source,
          target,
          dragOverPosRef.current
        )
      );
    }
    dragSourceRef.current = null;
    setDraggingLabel(null);
    setDragOverLabel(null);
    setDragOverPosition('before');
    setDragPointer(null);
  }, [orderedNavItems]);

  useEffect(() => {
    if (!draggingLabel) return;
    const onPointerMove = (e: PointerEvent) => {
      setDragPointer((prev) => {
        if (!prev) return prev;
        return { ...prev, x: e.clientX, y: e.clientY };
      });
    };
    const onPointerUp = () => finishPointerDrag();
    const onPointerCancel = () => finishPointerDrag();
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [draggingLabel, finishPointerDrag]);

  useDismissOnOutside(addMenuRef, showAddMenu, () => setShowAddMenu(false));

  return (
    <>
      {isNarrowViewport && isMobileOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={() => setIsMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px]"
          style={{ top: 'var(--app-header-height)' }}
        />
      )}
      <aside
        aria-label="App navigation"
        className={`fixed bottom-0 left-0 z-50 flex flex-col justify-between border-r border-border bg-surface/95 pb-4 pt-3 shadow-2xl transition-all duration-200 ${
          isCollapsed ? 'w-20' : 'w-[min(18rem,calc(100vw-1rem))] xl:w-72'
        } ${isNarrowViewport ? (isMobileOpen ? 'translate-x-0' : '-translate-x-full') : 'translate-x-0'}`}
        style={{ top: 'var(--app-header-height)' }}
      >
        <nav className={`flex min-h-0 flex-1 flex-col px-4 ${draggingLabel ? 'select-none' : ''}`}>
          <button
            ref={mobileCloseRef}
            type="button"
            onClick={() => setIsMobileOpen(false)}
            className="mb-2 inline-flex min-h-11 items-center justify-between rounded-lg border border-border bg-surface-2 px-3 text-sm font-semibold text-zinc-200 xl:hidden"
            aria-label="Close navigation"
          >
            Close navigation
            <X className="h-4 w-4 text-zinc-400" strokeWidth={2} />
          </button>
          {!isCollapsed && (
            <div
              className={`mb-1 flex items-center gap-2 ${isEditMode ? 'justify-between' : 'justify-end'}`}
            >
              {isEditMode && (
                <div ref={addMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setShowAddMenu((v) => !v)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/15 bg-white/[0.04] text-sm font-semibold leading-none text-zinc-200 transition-colors hover:bg-white/[0.1] hover:text-white"
                    title="Add sidebar section"
                    aria-label="Add sidebar section"
                  >
                    +
                  </button>
                  {showAddMenu && (
                    <div className="absolute left-0 z-50 mt-1 w-max min-w-44 max-w-[calc(100vw-2rem)] rounded-md border border-white/10 bg-[#111218] p-1 shadow-xl">
                      {addableNavItems.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-zinc-500">No sections to add</div>
                      ) : (
                        addableNavItems.map((addItem) => (
                          <button
                            key={`add-${addItem.label}`}
                            type="button"
                            onClick={() => {
                              setVisibleLabels((prev) => {
                                const current =
                                  prev && prev.length > 0
                                    ? prev
                                    : orderedNavItems.map((i) => i.label);
                                if (current.includes(addItem.label)) return current;
                                return [...current, addItem.label];
                              });
                              setShowAddMenu(false);
                            }}
                            className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/10"
                          >
                            {addItem.label}
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
                  setIsEditMode((v) => !v);
                  setShowAddMenu(false);
                }}
                className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
                  isEditMode
                    ? 'border-gold/60 bg-gold/15 text-gold'
                    : 'border-white/15 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.1] hover:text-white'
                }`}
                title={isEditMode ? 'Finish sidebar edit mode' : 'Edit sidebar'}
                aria-label={isEditMode ? 'Finish sidebar edit mode' : 'Edit sidebar'}
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          )}
          <div className="flex-1 space-y-2 overflow-y-auto pb-2">
            {visibleNavItems.map((item) => {
              const isActive = item.matchPaths.some(
                (p) => pathname === p || pathname.startsWith(p + '/')
              );
              const hasChildren = item.children && item.children.length > 0;
              const isOpen = openMenu === item.label || isActive;

              return (
                <div
                  key={item.label}
                  data-nav-label={item.label}
                  data-tour={navTourTarget(item.label)}
                  className={`flex flex-col gap-1 rounded-lg transition-all duration-150 ${
                    dragOverLabel === item.label && draggingLabel !== item.label
                      ? 'bg-gold/[0.04]'
                      : ''
                  }`}
                  onPointerEnter={() => {
                    if (draggingLabel && draggingLabel !== item.label) {
                      setDragOverLabel(item.label);
                      setDragOverPosition('before');
                    }
                  }}
                  onPointerMove={(e) => {
                    if (draggingLabel && draggingLabel !== item.label) {
                      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                      const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                      setDragOverLabel(item.label);
                      setDragOverPosition(position);
                    }
                  }}
                >
                  {dragOverLabel === item.label &&
                    draggingLabel !== item.label &&
                    dragOverPosition === 'before' && (
                      <div className="mx-2 h-[2px] rounded-full bg-gold shadow-[0_0_8px_rgba(212,175,55,0.6)]" />
                    )}
                  <div className="flex items-stretch gap-1">
                    {isEditMode && !isCollapsed && (
                      <button
                        type="button"
                        onPointerDown={(e) => {
                          if (!isEditMode) return;
                          if (e.pointerType === 'mouse' && e.button !== 0) return;
                          e.preventDefault();
                          const rect = (e.currentTarget as HTMLButtonElement)
                            .closest('[data-nav-label]')
                            ?.getBoundingClientRect();
                          dragSourceRef.current = item.label;
                          setDraggingLabel(item.label);
                          setDragOverLabel(item.label);
                          if (rect) {
                            setDragPointer({
                              x: e.clientX,
                              y: e.clientY,
                              offsetX: e.clientX - rect.left,
                              offsetY: e.clientY - rect.top,
                              width: rect.width,
                            });
                          }
                        }}
                        className={`shrink-0 cursor-grab rounded-md px-2 text-zinc-600 transition-all hover:bg-white/5 hover:text-zinc-300 active:cursor-grabbing ${
                          draggingLabel === item.label ? 'bg-gold/10 text-gold' : ''
                        }`}
                        title={`Drag to reorder ${item.label}`}
                        aria-label={`Drag to reorder ${item.label}`}
                      >
                        <GripVertical className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    )}
                    <Link
                      href={item.href}
                      onClick={(e) => {
                        if (isEditMode) {
                          e.preventDefault();
                          return;
                        }
                        if (hasChildren) {
                          if (isCollapsed) {
                            e.preventDefault();
                            setIsCollapsed(false);
                            setOpenMenu(item.label);
                            return;
                          }
                          e.preventDefault();
                          setOpenMenu(isOpen ? null : item.label);
                          return;
                        }
                        const normalizedHref =
                          item.href.endsWith('/') && item.href !== '/'
                            ? item.href.slice(0, -1)
                            : item.href;
                        if (normalizedPath === normalizedHref) {
                          e.preventDefault();
                          window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
                          if (isNarrowViewport) setIsMobileOpen(false);
                          return;
                        }
                        if (isNarrowViewport) setIsMobileOpen(false);
                      }}
                      draggable={false}
                      className={`group flex min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-3 transition-all duration-150 ${
                        draggingLabel === item.label ? 'scale-[0.98] opacity-25' : ''
                      } ${
                        isActive
                          ? 'bg-gold/15 text-gold'
                          : 'text-zinc-200 hover:bg-surface-2 hover:text-white'
                      }`}
                      title={item.label}
                    >
                      <item.icon
                        className={`h-6 w-6 shrink-0 ${isActive ? 'text-gold' : 'text-zinc-500 group-hover:text-zinc-300'}`}
                        strokeWidth={2}
                      />
                      {!isCollapsed && (
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="text-[15px] font-medium">{item.label}</span>
                          <span
                            className={`text-[13px] leading-snug ${isActive ? 'text-gold/80' : 'text-zinc-300'}`}
                          >
                            {item.description}
                          </span>
                        </div>
                      )}
                    </Link>
                    {isEditMode && !isCollapsed && (
                      <button
                        type="button"
                        onClick={() =>
                          setVisibleLabels((prev) => {
                            const current =
                              prev && prev.length > 0 ? prev : orderedNavItems.map((i) => i.label);
                            if (current.length <= 1) return current;
                            return current.filter((label) => label !== item.label);
                          })
                        }
                        className="shrink-0 rounded-md px-2 text-zinc-500 transition-colors hover:bg-red-500/15 hover:text-red-300"
                        title={`Remove ${item.label} from sidebar`}
                        aria-label={`Remove ${item.label} from sidebar`}
                      >
                        -
                      </button>
                    )}
                  </div>
                  {dragOverLabel === item.label &&
                    draggingLabel !== item.label &&
                    dragOverPosition === 'after' && (
                      <div className="mx-2 h-[2px] rounded-full bg-gold shadow-[0_0_8px_rgba(212,175,55,0.6)]" />
                    )}
                  {hasChildren && isOpen && !isCollapsed && (
                    <div className="ml-10 flex flex-col border-l-2 border-border/50 pl-2">
                      {item.children!.map((child) => {
                        const childActive =
                          pathname === child.href || pathname.startsWith(child.href + '/');
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={(e) => {
                              const normalizedHref =
                                child.href.endsWith('/') && child.href !== '/'
                                  ? child.href.slice(0, -1)
                                  : child.href;
                              if (normalizedPath === normalizedHref) {
                                e.preventDefault();
                                window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
                              }
                              if (isNarrowViewport) setIsMobileOpen(false);
                            }}
                            className={`flex min-h-11 flex-col justify-center rounded-md px-3 py-2 transition-colors ${
                              childActive
                                ? 'text-gold'
                                : 'text-zinc-200 hover:bg-surface-2 hover:text-white'
                            }`}
                          >
                            <span className="text-[15px] font-medium">{child.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {draggingLabel && dragPointer && (
            <div
              className="pointer-events-none fixed z-[70] rounded-lg border border-gold/40 bg-[#14151d]/95 px-4 py-3 shadow-[0_16px_30px_rgba(0,0,0,0.45)] ring-1 ring-gold/20"
              style={{
                left: dragPointer.x - dragPointer.offsetX,
                top: dragPointer.y - dragPointer.offsetY,
                width: dragPointer.width,
                transform: 'rotate(-1deg)',
              }}
            >
              <div className="text-[15px] font-medium text-zinc-100">{draggingLabel}</div>
            </div>
          )}
          {!isNarrowViewport && (
            <div className="mb-2 mt-3 flex items-end justify-end">
              <button
                type="button"
                onClick={() => setIsCollapsed((v) => !v)}
                className="rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-[11px] font-semibold text-zinc-200 transition-colors hover:bg-white/[0.1] hover:text-white"
                title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {isCollapsed ? '>>' : '<<'}
              </button>
            </div>
          )}
        </nav>

        <div className="mt-auto flex flex-col gap-2 border-t border-border/50 px-4 pt-4">
          <div className="mt-2 px-2 text-center text-xs text-zinc-400">
            {!isCollapsed ? APP_VERSION_WITH_PREFIX : 'v'}
          </div>
          {!isCollapsed && simcRuntimeStatus && (
            <div
              aria-label="SimC runtime status"
              className="px-2 text-center text-[11px] leading-tight text-zinc-500"
            >
              <div className="font-medium text-zinc-300">
                SimC {simcRuntimeStatus.channel === 'nightly' ? 'Nightly' : 'Weekly'}
              </div>
              <div>{formatSimcSidebarVersion(simcRuntimeStatus.version)}</div>
            </div>
          )}
          <div className="mx-auto flex items-center gap-2">
            <a
              href={DISCORD_INVITE_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Join Discord"
              title="Join Discord"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-[#5865F2]/20 hover:text-[#cfd4ff]"
            >
              <MessageCircle className="h-4 w-4" />
            </a>
            <a
              href={APP_WEBSITE_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Open WhyLowDPS website"
              title="Open WhyLowDPS website"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/[0.1] hover:text-white"
            >
              <Globe className="h-4 w-4" />
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}

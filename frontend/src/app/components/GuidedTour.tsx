'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ArrowRight, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { BROWSER_USER_SCOPE_CHANGED_EVENT } from '../lib/api';

export type GuidedTourStepAction = {
  type: 'click-target' | 'input-target';
  target?: string;
  nextTarget?: string;
  waitForTargetGone?: string;
  auto?: boolean;
  prompt?: string;
  clickSelector?: string;
};

export type GuidedTourStep = {
  id: string;
  target?: string;
  title: string;
  description: string;
  placement?: 'top' | 'right' | 'bottom' | 'left' | 'center';
  action?: GuidedTourStepAction;
};

export type GuidedTourDefinition = {
  id: string;
  label: string;
  paths: string[];
  steps: GuidedTourStep[];
};

const GUIDED_TOURS_STORAGE_KEY = 'whylowdps_guided_tours_v1';

const SHARED_SIM_SETUP_STEPS: GuidedTourStep[] = [
  {
    id: 'fight-setup',
    target: 'fight-setup',
    title: 'Set up the fight',
    description:
      'Choose a fight style, then adjust fight length, target count, or a dungeon scenario when those options apply to the selected profile.',
    placement: 'top',
  },
  {
    id: 'consumables-raid-buffs',
    target: 'consumables-raid-buffs',
    title: 'Choose consumables and raid buffs',
    description:
      'Set the flask, potion, food, rune, temporary enchant, and raid buff assumptions used by the simulation. Expand this section when it is collapsed.',
    placement: 'top',
  },
  {
    id: 'advanced-options',
    target: 'advanced-options',
    title: 'Review advanced options',
    description:
      'Use Advanced Options for custom APL or SimC overrides, timeline data, and expert actor sections when the defaults are not enough.',
    placement: 'top',
  },
];

export const GUIDED_TOURS: GuidedTourDefinition[] = [
  {
    id: 'app-overview',
    label: 'App overview',
    paths: ['/'],
    steps: [
      {
        id: 'welcome',
        target: 'dashboard-heading',
        title: 'Welcome to WhyLowDPS',
        description:
          'This quick tour points out the main areas of the app. You can replay this tour, or a page-specific tour, from the help button in the header.',
        placement: 'bottom',
      },
      {
        id: 'navigation',
        target: 'nav-sim',
        title: 'Move around from the sidebar',
        description:
          'Use the sidebar to switch between simulations, upgrades, analysis, dungeons, and your saved history. Sections can be expanded and customized.',
        placement: 'right',
      },
      {
        id: 'character-search',
        target: 'character-search',
        title: 'Search for a player',
        description:
          'Enter a character name, choose the region and realm, then press Go to open that player’s character page. This is separate from App search, which finds pages and actions.',
        placement: 'bottom',
      },
      {
        id: 'getting-started',
        target: 'onboarding-checklist',
        title: 'Start with the setup checklist',
        description:
          'New users can follow these steps to prepare game data, connect character data, import a SimC profile, and run a first simulation.',
        placement: 'top',
      },
      {
        id: 'dashboard',
        target: 'dashboard-controls',
        title: 'Make the dashboard yours',
        description:
          'Dashboard widgets can be shown, hidden, resized, and reordered. Use Customize whenever you want to change this overview.',
        placement: 'top',
      },
      {
        id: 'app-search',
        target: 'app-search',
        title: 'Find commands quickly',
        description:
          'App search helps you jump to pages and actions without hunting through the navigation. On smaller screens, it lives under More actions.',
        placement: 'bottom',
      },
      {
        id: 'whats-new',
        target: 'whats-new',
        title: 'Keep up with changes',
        description:
          'Open What’s new to read release notes and see the latest improvements without leaving the app.',
        placement: 'bottom',
      },
      {
        id: 'replay',
        target: 'guided-tour-trigger',
        title: 'Replay tours any time',
        description:
          'Use this help button whenever you want a refresher. More page-specific tours can be added here as each workflow grows.',
        placement: 'bottom',
      },
    ],
  },
  {
    id: 'quick-sim',
    label: 'Quick Sim',
    paths: ['/quick-sim'],
    steps: [
      {
        id: 'simc-input',
        target: 'simc-input',
        title: 'Paste your SimC export',
        description:
          'Paste the full SimulationCraft addon export here. WhyLowDPS reads the profile and keeps it available for your next simulation.',
        placement: 'bottom',
      },
      ...SHARED_SIM_SETUP_STEPS,
      {
        id: 'run-simulation',
        target: 'run-simulation',
        title: 'Run the simulation',
        description:
          'Once the profile is loaded, start the simulation. The result page will show your DPS, ability breakdown, and comparison details.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'top-gear',
    label: 'Top Gear',
    paths: ['/top-gear'],
    steps: [
      {
        id: 'simc-input',
        target: 'simc-input',
        title: 'Start with your character profile',
        description:
          'Paste a full SimC addon export above. Top Gear uses it to understand your equipped gear, bags, talents, and current character.',
        placement: 'bottom',
        action: {
          type: 'input-target',
          target: 'simc-input-field',
          nextTarget: 'fight-setup',
          prompt: 'Paste a SimC export to continue',
        },
      },
      ...SHARED_SIM_SETUP_STEPS,
      {
        id: 'top-gear-options',
        target: 'top-gear-options',
        title: 'Choose optimization rules',
        description:
          'These options control how enchants, gems, upgrade levels, and catalyst choices are handled while comparing gear.',
        placement: 'top',
      },
      {
        id: 'top-gear-items',
        target: 'top-gear-items',
        title: 'Review the gear combinations',
        description:
          'Select or adjust the items and variants you want Top Gear to compare. The combination count shows how large the simulation will be.',
        placement: 'top',
      },
      {
        id: 'loot-browser-trigger',
        target: 'loot-browser-trigger',
        title: 'Open the Loot Browser',
        description:
          'Use the plus button beside a gear slot to search raid, dungeon, tier, crafted, and other loot pools for items to compare.',
        placement: 'top',
        action: {
          type: 'click-target',
          nextTarget: 'loot-browser',
          prompt: 'Click the highlighted plus button to open Loot Browser',
        },
      },
      {
        id: 'loot-browser',
        target: 'loot-browser',
        title: 'Search and add loot',
        description:
          'Filter by category, instance, slot, difficulty, or search text, then add an item to the selected gear slot. Close the browser when you are ready to continue.',
        placement: 'bottom',
        action: {
          type: 'click-target',
          target: 'loot-browser-close',
          nextTarget: 'top-gear-submit',
          waitForTargetGone: 'loot-browser',
          prompt: 'Close Loot Browser to continue',
        },
      },
      {
        id: 'top-gear-submit',
        target: 'top-gear-submit',
        title: 'Find your best setup',
        description:
          'Start the simulation to rank the gear combinations by DPS and open the detailed results.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'drop-finder',
    label: 'Drop Finder',
    paths: ['/drop-finder'],
    steps: [
      {
        id: 'simc-input',
        target: 'simc-input',
        title: 'Load your character profile',
        description:
          'Paste a SimC export so Drop Finder can filter loot for your class, specialization, and equipped items.',
        placement: 'bottom',
      },
      ...SHARED_SIM_SETUP_STEPS,
      {
        id: 'drop-finder-category',
        target: 'drop-finder-category-raids',
        title: 'Choose a category to search',
        description:
          'Click Raids to open the raid loot list. The tour will continue as soon as the category is selected.',
        placement: 'bottom',
        action: {
          type: 'click-target',
          nextTarget: 'drop-finder-selection',
          prompt: 'Click the highlighted Raids card to continue',
        },
      },
      {
        id: 'drop-finder-selection',
        target: 'drop-finder-selection',
        title: 'Choose an instance or loot pool',
        description:
          'Click a specific raid or dungeon, or choose the all-items option. The tour will continue after your selection opens the simulation settings.',
        placement: 'bottom',
        action: {
          type: 'click-target',
          nextTarget: 'drop-finder-settings',
          prompt: 'Click a highlighted loot pool to continue',
        },
      },
      {
        id: 'drop-finder-settings',
        target: 'drop-finder-settings',
        title: 'Tune the upgrade simulation',
        description:
          'Choose difficulty and upgrade behavior, then optionally include catalyst-converted items or copied enchants and gems.',
        placement: 'top',
      },
      {
        id: 'drop-finder-items',
        target: 'drop-finder-items',
        title: 'Choose the items to simulate',
        description:
          'Select one or more loot cards to compare, or use Select all in the list toolbar. The tour continues after you choose what to sim.',
        placement: 'top',
        action: {
          type: 'click-target',
          nextTarget: 'drop-finder-submit',
          clickSelector: '[data-tour-action="drop-finder-item-choice"]',
          prompt: 'Click an item or Select all to continue',
        },
      },
      {
        id: 'drop-finder-submit',
        target: 'drop-finder-submit',
        title: 'Find and sim the drops',
        description:
          'Select the loot items you want to compare, then start the simulation to see which drops improve your character.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'upgrade-compare',
    label: 'Crest Upgrades',
    paths: ['/upgrade-compare'],
    steps: [
      {
        id: 'simc-input',
        target: 'simc-input',
        title: 'Load your upgrade state',
        description:
          'Paste a SimC export so WhyLowDPS can read your equipped items, upgrade currencies, and available upgrade paths.',
        placement: 'bottom',
        action: {
          type: 'input-target',
          target: 'simc-input-field',
          nextTarget: 'fight-setup',
          prompt: 'Paste a SimC export to continue',
        },
      },
      ...SHARED_SIM_SETUP_STEPS,
      {
        id: 'upgrade-plan',
        target: 'upgrade-plan',
        title: 'Save owned upgrades to your roadmap',
        description:
          'Save owned upgrade targets to your shared Wishlist roadmap, then return here whenever you want to simulate crest spending.',
        placement: 'top',
      },
      {
        id: 'upgrade-mode',
        target: 'upgrade-mode',
        title: 'Choose how much to consider',
        description:
          'Select whether to test the highest affordable upgrade, every affordable level, or options regardless of your current budget.',
        placement: 'bottom',
      },
      {
        id: 'upgrade-items',
        target: 'upgrade-items',
        title: 'Choose items to upgrade',
        description:
          'Select individual equipped or bag items, use All or Equipped for a quick selection, and review the combination count before simulating.',
        placement: 'top',
        action: {
          type: 'click-target',
          nextTarget: 'upgrade-submit',
          clickSelector: '[data-tour-action="upgrade-item-choice"]',
          prompt: 'Select an item, All, or Equipped to continue',
        },
      },
      {
        id: 'upgrade-submit',
        target: 'upgrade-submit',
        title: 'Sim the upgrade paths',
        description:
          'Select the items to upgrade and start the simulation. Results compare the DPS value of each valid upgrade combination.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'upgrade-trinkets',
    label: 'Trinket Upgrades',
    paths: ['/upgrade/trinkets'],
    steps: [
      {
        id: 'simc-input',
        target: 'simc-input',
        title: 'Load your trinket profile',
        description:
          'Paste a SimC export so the trinket tool can identify your equipped trinkets and build the available comparison pool.',
        placement: 'bottom',
      },
      ...SHARED_SIM_SETUP_STEPS,
      {
        id: 'trinket-settings',
        target: 'trinket-settings',
        title: 'Define the trinket comparison',
        description:
          'Choose the tier, target item level, simulation mode, source pools, and role restrictions for the trinket matrix.',
        placement: 'top',
      },
      {
        id: 'trinket-submit',
        target: 'trinket-submit',
        title: 'Run the trinket matrix',
        description:
          'Start the simulation to compare trinket pairs and find the strongest upgrades for your character.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'stat-weights',
    label: 'Analysis',
    paths: ['/stat-weights'],
    steps: [
      {
        id: 'simc-input',
        target: 'simc-input',
        title: 'Load a profile to analyze',
        description:
          'Paste a SimC export. The analysis tools use it as the baseline for stat weights, plots, consumables, and tier-slot comparisons.',
        placement: 'bottom',
      },
      ...SHARED_SIM_SETUP_STEPS,
      {
        id: 'analysis-mode-picker',
        target: 'analysis-mode-picker',
        title: 'Choose an analysis mode',
        description:
          'Use Quick Weights for a fast summary, Stat Plot for scaling curves, Consumable Matrix for consumable choices, or Tier Slot Matrix for tier impact.',
        placement: 'bottom',
      },
      {
        id: 'analysis-submit',
        target: 'analysis-submit',
        title: 'Run the analysis',
        description:
          'Start the selected analysis and review the resulting charts, tables, or rankings on the result page.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'quick-weights',
    label: 'Quick Weights',
    paths: ['/analysis/quick-weights'],
    steps: [
      {
        id: 'simc-input',
        target: 'simc-input',
        title: 'Load a profile to analyze',
        description:
          'Paste a SimC export to calculate a fast single-point value for each stat on your character.',
        placement: 'bottom',
      },
      ...SHARED_SIM_SETUP_STEPS,
      {
        id: 'analysis-submit',
        target: 'analysis-submit',
        title: 'Run Quick Weights',
        description:
          'Start the simulation to get a compact stat-weight summary for comparing gear and upgrades.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'stat-plot',
    label: 'Stat Plot',
    paths: ['/analysis/stat-plot'],
    steps: [
      {
        id: 'simc-input',
        target: 'simc-input',
        title: 'Load a profile to analyze',
        description: 'Paste a SimC export to use as the baseline for the stat-scaling curve.',
        placement: 'bottom',
      },
      ...SHARED_SIM_SETUP_STEPS,
      {
        id: 'stat-plot-options',
        target: 'stat-plot-options',
        title: 'Set up the stat curve',
        description:
          'Choose the stats to compare and set the range, step size, and iterations before running the plot.',
        placement: 'bottom',
      },
      {
        id: 'analysis-submit',
        target: 'analysis-submit',
        title: 'Run the Stat Plot',
        description: 'Start the simulation to see how DPS changes as each selected stat increases.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'consumable-matrix',
    label: 'Consumable Matrix',
    paths: ['/analysis/consumable-matrix'],
    steps: [
      {
        id: 'simc-input',
        target: 'simc-input',
        title: 'Load a profile to analyze',
        description:
          'Paste a SimC export to compare consumables and raid buffs against your current setup.',
        placement: 'bottom',
      },
      ...SHARED_SIM_SETUP_STEPS,
      {
        id: 'consumable-matrix-options',
        target: 'consumable-matrix-options',
        title: 'Choose what to compare',
        description:
          'Select the flasks, food, potions, runes, temporary enchants, and raid buffs you want included in the matrix.',
        placement: 'top',
      },
      {
        id: 'analysis-submit',
        target: 'analysis-submit',
        title: 'Run the Consumable Matrix',
        description:
          'Start the simulation to find which selected consumable combination produces the best result.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'tier-slot-matrix',
    label: 'Tier Slot Matrix',
    paths: ['/analysis/tier-slot-matrix'],
    steps: [
      {
        id: 'simc-input',
        target: 'simc-input',
        title: 'Load a profile to analyze',
        description:
          'Paste a SimC export to measure the impact of tier pieces across their possible slots.',
        placement: 'bottom',
      },
      ...SHARED_SIM_SETUP_STEPS,
      {
        id: 'analysis-submit',
        target: 'analysis-submit',
        title: 'Run the Tier Slot Matrix',
        description:
          'Start the simulation to compare tier-slot combinations and see which setup gives the best result.',
        placement: 'top',
      },
    ],
  },
];

type GuidedTourContextValue = {
  activeTour: GuidedTourDefinition | null;
  currentTour: GuidedTourDefinition | null;
  currentStep: number;
  startTour: (tourId: string) => void;
  startCurrentTour: () => void;
  nextStep: () => void;
  previousStep: () => void;
  closeTour: () => void;
};

const GuidedTourContext = createContext<GuidedTourContextValue | null>(null);

function pathMatches(pathname: string, path: string): boolean {
  return pathname === path || (path !== '/' && pathname.startsWith(`${path}/`));
}

function readCompletedTours(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(GUIDED_TOURS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === 'string')
        : []
    );
  } catch {
    return new Set();
  }
}

function findTarget(target?: string): HTMLElement | null {
  if (!target || typeof document === 'undefined') return null;
  const elements = document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`);
  return (
    Array.from(elements).find((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      );
    }) || null
  );
}

function findVisibleTarget(target?: string): HTMLElement | null {
  const element = findTarget(target);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.top < window.innerHeight
    ? element
    : null;
}

function hasBlockingDialog(): boolean {
  return typeof document !== 'undefined' && Boolean(document.querySelector('[role="dialog"]'));
}

function persistCompletedTours(completed: Set<string>): void {
  try {
    window.localStorage.setItem(GUIDED_TOURS_STORAGE_KEY, JSON.stringify(Array.from(completed)));
  } catch {
    // Storage can be unavailable in privacy-restricted webviews.
  }
}

export function useGuidedTour(): GuidedTourContextValue {
  const value = useContext(GuidedTourContext);
  if (!value) throw new Error('useGuidedTour must be used inside GuidedTourProvider');
  return value;
}

export function GuidedTourProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/';
  const [completedTours, setCompletedTours] = useState<Set<string>>(() => readCompletedTours());
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const refreshCompletedTours = () => setCompletedTours(readCompletedTours());
    window.addEventListener(BROWSER_USER_SCOPE_CHANGED_EVENT, refreshCompletedTours);
    return () =>
      window.removeEventListener(BROWSER_USER_SCOPE_CHANGED_EVENT, refreshCompletedTours);
  }, []);

  const currentTour = useMemo(
    () =>
      GUIDED_TOURS.find((tour) => tour.paths.some((path) => pathMatches(pathname, path))) || null,
    [pathname]
  );
  const activeTour = useMemo(
    () => GUIDED_TOURS.find((tour) => tour.id === activeTourId) || null,
    [activeTourId]
  );

  const startTour = useCallback((tourId: string) => {
    if (!GUIDED_TOURS.some((tour) => tour.id === tourId) || hasBlockingDialog()) return;
    setCurrentStep(0);
    setActiveTourId(tourId);
  }, []);

  const finishTour = useCallback((tourId: string) => {
    setCompletedTours((previous) => {
      const next = new Set(previous);
      next.add(tourId);
      persistCompletedTours(next);
      return next;
    });
    setActiveTourId(null);
    setCurrentStep(0);
  }, []);

  const closeTour = useCallback(() => {
    if (activeTourId) finishTour(activeTourId);
  }, [activeTourId, finishTour]);

  const startCurrentTour = useCallback(() => {
    if (currentTour) startTour(currentTour.id);
  }, [currentTour, startTour]);

  const nextStep = useCallback(() => {
    if (!activeTour) return;
    if (currentStep >= activeTour.steps.length - 1) {
      finishTour(activeTour.id);
      return;
    }
    setCurrentStep((step) => step + 1);
  }, [activeTour, currentStep, finishTour]);

  const previousStep = useCallback(() => {
    setCurrentStep((step) => Math.max(0, step - 1));
  }, []);

  useEffect(() => {
    if (!activeTourId) return;
    const tour = GUIDED_TOURS.find((candidate) => candidate.id === activeTourId);
    if (!tour?.paths.some((path) => pathMatches(pathname, path))) {
      setActiveTourId(null);
      setCurrentStep(0);
    }
  }, [activeTourId, pathname]);

  useEffect(() => {
    if (!currentTour || activeTourId || completedTours.has(currentTour.id)) return;
    const firstStep = currentTour.steps[0];
    let attempts = 0;
    let timer = 0;
    const tryStart = () => {
      if (!hasBlockingDialog() && findVisibleTarget(firstStep.target)) {
        startTour(currentTour.id);
        return;
      }
      attempts += 1;
      if (attempts < 120) timer = window.setTimeout(tryStart, 250);
    };
    timer = window.setTimeout(tryStart, 900);
    return () => window.clearTimeout(timer);
  }, [activeTourId, completedTours, currentTour, startTour]);

  const contextValue = useMemo(
    () => ({
      activeTour,
      currentTour,
      currentStep,
      startTour,
      startCurrentTour,
      nextStep,
      previousStep,
      closeTour,
    }),
    [
      activeTour,
      closeTour,
      currentStep,
      currentTour,
      nextStep,
      previousStep,
      startCurrentTour,
      startTour,
    ]
  );

  return (
    <GuidedTourContext.Provider value={contextValue}>
      {children}
      <GuidedTourOverlay />
    </GuidedTourContext.Provider>
  );
}

type ViewportRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

function getViewportRect(element: HTMLElement | null): ViewportRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const padding = 8;
  return {
    top: Math.max(0, rect.top - padding),
    left: Math.max(0, rect.left - padding),
    right: Math.min(window.innerWidth, rect.right + padding),
    bottom: Math.min(window.innerHeight, rect.bottom + padding),
    width: Math.min(window.innerWidth, rect.width + padding * 2),
    height: Math.min(window.innerHeight, rect.height + padding * 2),
  };
}

function getHeaderBottom(): number {
  if (typeof document === 'undefined') return 0;
  const header = document.querySelector<HTMLElement>('.app-header-safe-area');
  if (!header) return 0;
  return clamp(header.getBoundingClientRect().bottom, 0, window.innerHeight);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function getCardPosition(
  rect: ViewportRect | null,
  placement: GuidedTourStep['placement']
): CSSProperties {
  const margin = 16;
  const cardWidth = Math.min(360, Math.max(240, window.innerWidth - margin * 2));
  const estimatedHeight = 220;
  if (!rect || placement === 'center') {
    return {
      left: '50%',
      top: '50%',
      width: `min(${cardWidth}px, calc(100vw - ${margin * 2}px))`,
      transform: 'translate(-50%, -50%)',
    };
  }

  const preferred = placement || 'bottom';
  let left = rect.left;
  let top = rect.bottom + margin;
  if (preferred === 'top') top = rect.top - estimatedHeight - margin;
  if (preferred === 'right') {
    left = rect.right + margin;
    top = rect.top;
  }
  if (preferred === 'left') {
    left = rect.left - cardWidth - margin;
    top = rect.top;
  }

  if (preferred === 'bottom' && top + estimatedHeight > window.innerHeight - margin) {
    top = rect.top - estimatedHeight - margin;
  }
  if (preferred === 'top' && top < margin) top = rect.bottom + margin;
  if (preferred === 'right' && left + cardWidth > window.innerWidth - margin) {
    left = rect.left - cardWidth - margin;
  }
  if (preferred === 'left' && left < margin) left = rect.right + margin;

  return {
    left: clamp(left, margin, window.innerWidth - cardWidth - margin),
    top: clamp(top, margin, window.innerHeight - estimatedHeight - margin),
    width: `min(${cardWidth}px, calc(100vw - ${margin * 2}px))`,
  };
}

function GuidedTourOverlay() {
  const { activeTour, currentStep, closeTour, nextStep, previousStep } = useGuidedTour();
  const [targetRect, setTargetRect] = useState<ViewportRect | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const step = activeTour?.steps[currentStep] || null;

  useEffect(() => {
    if (!activeTour || !step) return;
    let frame = 0;
    let actionTimer = 0;
    setTargetRect(null);
    const target = findTarget(step.target);
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center', behavior: 'auto' });
    }

    const sync = () => {
      frame = 0;
      setTargetRect(getViewportRect(findTarget(step.target)));
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(sync);
    };

    schedule();
    const delayedSync = window.setTimeout(schedule, 250);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    const observer =
      typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : null;
    observer?.observe(document.body, { childList: true, subtree: true });

    const action = step.action;
    const actionTarget = findTarget(action?.target || step.target);
    let actionTriggered = false;
    let attempts = 0;
    const advanceAfterAction = () => {
      if (action?.waitForTargetGone && findTarget(action.waitForTargetGone) && attempts < 40) {
        attempts += 1;
        actionTimer = window.setTimeout(advanceAfterAction, 50);
        return;
      }
      if (!action?.nextTarget || findTarget(action.nextTarget) || attempts >= 40) {
        nextStep();
        return;
      }
      attempts += 1;
      actionTimer = window.setTimeout(advanceAfterAction, 50);
    };
    const onActionClick = (event: Event) => {
      if (action?.type !== 'click-target') return;
      if (
        action?.clickSelector &&
        (!(event.target instanceof Element) || !event.target.closest(action.clickSelector))
      ) {
        return;
      }
      if (actionTriggered) return;
      actionTriggered = true;
      actionTimer = window.setTimeout(advanceAfterAction, 0);
    };
    const onActionInput = () => {
      if (action?.type !== 'input-target' || actionTriggered || !actionTarget) return;
      const inputValue =
        actionTarget instanceof HTMLInputElement || actionTarget instanceof HTMLTextAreaElement
          ? actionTarget.value
          : actionTarget.textContent || '';
      if (inputValue.trim().length < 10) return;
      actionTriggered = true;
      actionTimer = window.setTimeout(advanceAfterAction, 0);
    };
    if (action?.type === 'click-target' && actionTarget) {
      actionTarget.addEventListener('click', onActionClick);
      if (action.auto) {
        actionTimer = window.setTimeout(() => actionTarget.click(), 0);
      }
    }
    if (action?.type === 'input-target' && actionTarget) {
      actionTarget.addEventListener('input', onActionInput);
      onActionInput();
    }

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(delayedSync);
      if (actionTimer) window.clearTimeout(actionTimer);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      actionTarget?.removeEventListener('click', onActionClick);
      actionTarget?.removeEventListener('input', onActionInput);
      observer?.disconnect();
    };
  }, [activeTour, nextStep, step]);

  useEffect(() => {
    if (!activeTour) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeTour();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTour, closeTour]);

  useEffect(() => {
    if (activeTour) cardRef.current?.focus();
  }, [activeTour, currentStep]);

  if (!activeTour || !step) return null;

  const isLastStep = currentStep === activeTour.steps.length - 1;
  const spotlightStyle = targetRect
    ? {
        top: targetRect.top,
        left: targetRect.left,
        width: targetRect.width,
        height: targetRect.height,
      }
    : undefined;
  const cardPosition = getCardPosition(targetRect, step.placement);
  const segmentStyle = targetRect
    ? {
        top: targetRect.top,
        left: targetRect.left,
        right: targetRect.right,
        bottom: targetRect.bottom,
      }
    : null;

  const headerBottom = getHeaderBottom();
  const dimTop = headerBottom;
  const dimTargetTop = targetRect ? Math.max(targetRect.top, dimTop) : dimTop;
  const dimTargetBottom = targetRect ? Math.max(targetRect.bottom, dimTop) : dimTop;
  const requiresAction = Boolean(step.action);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[300]"
      aria-label={`${activeTour.label} tour`}
    >
      {segmentStyle ? (
        <>
          <div
            className="pointer-events-auto absolute inset-x-0 bg-black/70"
            style={{ top: dimTop, height: Math.max(0, dimTargetTop - dimTop) }}
          />
          <div
            className="pointer-events-auto absolute left-0 bg-black/70"
            style={{
              top: dimTargetTop,
              width: segmentStyle.left,
              height: dimTargetBottom - dimTargetTop,
            }}
          />
          <div
            className="pointer-events-auto absolute right-0 bg-black/70"
            style={{
              top: dimTargetTop,
              width: window.innerWidth - segmentStyle.right,
              height: dimTargetBottom - dimTargetTop,
            }}
          />
          <div
            className="pointer-events-auto absolute inset-x-0 bottom-0 bg-black/70"
            style={{ top: dimTargetBottom }}
          />
        </>
      ) : (
        <div
          className="pointer-events-auto absolute inset-x-0 bottom-0 bg-black/70"
          style={{ top: dimTop }}
        />
      )}

      {spotlightStyle ? (
        <div
          aria-hidden="true"
          className="border-gold pointer-events-none absolute rounded-xl border-2 shadow-[0_0_0_2px_rgba(212,175,55,0.25),0_0_24px_rgba(212,175,55,0.35)]"
          style={spotlightStyle}
        />
      ) : null}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guided-tour-title"
        tabIndex={-1}
        className="border-gold/30 pointer-events-auto absolute rounded-2xl border bg-[#14151d] p-5 text-left shadow-2xl shadow-black/60 outline-none"
        style={cardPosition}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-gold text-[10px] font-bold tracking-[0.2em] uppercase">
              {activeTour.label} · {currentStep + 1} of {activeTour.steps.length}
            </p>
            <h2 id="guided-tour-title" className="mt-2 text-lg font-semibold text-zinc-100">
              {step.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={closeTour}
            className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close tour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-3 text-sm leading-6 text-zinc-300">{step.description}</p>
        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={closeTour}
            className="text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-200"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {currentStep > 0 ? (
              <button
                type="button"
                onClick={previousStep}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                Back
              </button>
            ) : null}
            {requiresAction ? (
              <span className="text-gold max-w-[190px] text-right text-xs font-semibold">
                {step.action?.prompt || 'Click the highlighted control to continue'}
              </span>
            ) : (
              <button
                type="button"
                onClick={nextStep}
                className="bg-gold hover:bg-gold-light inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold text-black transition-colors"
              >
                {isLastStep ? 'Finish' : 'Next'}
                <ArrowRight className="h-3.5 w-3.5 opacity-60" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Command, Search, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { CHANGELOG_OPEN_EVENT } from './ChangelogPopup';

type PaletteCommand = {
  id: string;
  label: string;
  description: string;
  href?: string;
};

const commands: PaletteCommand[] = [
  { id: 'whats-new', label: "Open What's New", description: 'Review the latest release notes.' },
  {
    id: 'dashboard',
    label: 'Open Dashboard',
    description: 'Overview of sims and activity.',
    href: '/',
  },
  {
    id: 'quick-sim',
    label: 'Start Quick Sim',
    description: 'Run a DPS simulation.',
    href: '/quick-sim',
  },
  {
    id: 'top-gear',
    label: 'Open Top Gear',
    description: 'Optimize gear combinations.',
    href: '/top-gear',
  },
  {
    id: 'drop-finder',
    label: 'Open Drop Finder',
    description: 'Sim possible loot upgrades.',
    href: '/drop-finder',
  },
  {
    id: 'upgrade-compare',
    label: 'Open Crest Upgrades',
    description: 'Sim owned gear upgrades.',
    href: '/upgrade-compare',
  },
  {
    id: 'wishlist',
    label: 'Open Wishlist',
    description: 'Plan drops and owned upgrades.',
    href: '/wishlist',
  },
  {
    id: 'history',
    label: 'Open Simulation History',
    description: 'Review, rerun, pin, or compare results.',
    href: '/history',
  },
  {
    id: 'queue',
    label: 'Open Simulation Queue',
    description: 'Manage pending simulations.',
    href: '/queue',
  },
  {
    id: 'dungeons',
    label: 'Open Dungeons',
    description: 'View the current Mythic+ rotation.',
    href: '/dungeons',
  },
  { id: 'raids', label: 'Open Raids', description: 'Browse raid encounters.', href: '/raids' },
  {
    id: 'routes',
    label: 'Open Saved Routes',
    description: 'Manage dungeon routes.',
    href: '/dungeon-routes',
  },
  {
    id: 'quick-weights',
    label: 'Open Quick Weights',
    description: 'Calculate stat weights.',
    href: '/analysis/quick-weights',
  },
  {
    id: 'stat-plot',
    label: 'Open Stat Plot',
    description: 'View stat scaling.',
    href: '/analysis/stat-plot',
  },
  {
    id: 'consumable-matrix',
    label: 'Open Consumable Matrix',
    description: 'Compare consumables.',
    href: '/analysis/consumable-matrix',
  },
  {
    id: 'tier-slot-matrix',
    label: 'Open Tier Slot Matrix',
    description: 'Compare tier-slot impact.',
    href: '/analysis/tier-slot-matrix',
  },
  {
    id: 'trinkets',
    label: 'Open Trinket Heatmaps',
    description: 'Compare trinket and tier pools.',
    href: '/upgrade/trinkets',
  },
  {
    id: 'characters',
    label: 'Open Characters',
    description: 'Review saved and tracked characters.',
    href: '/characters',
  },
  {
    id: 'settings-simulation',
    label: 'Settings: Simulation',
    description: 'Repair simulation defaults and clipboard options.',
    href: '/settings?tab=simulation',
  },
  {
    id: 'settings-integrations',
    label: 'Settings: Integrations',
    description: 'Repair Blizzard credentials and integrations.',
    href: '/settings?tab=integrations',
  },
  {
    id: 'settings-data',
    label: 'Settings: Data',
    description: 'Refresh game data or manage backups.',
    href: '/settings?tab=data',
  },
  {
    id: 'settings-updates',
    label: 'Settings: Updates',
    description: 'Check app and SimC runtime updates.',
    href: '/settings?tab=updates',
  },
];

export const COMMAND_PALETTE_OPEN_EVENT = 'whylowdps:open-command-palette';

export default function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = commands.filter((item) =>
    `${item.label} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, handleOpen);
  }, []);

  const runCommand = useCallback(
    (item: PaletteCommand) => {
      if (item.id === 'whats-new') {
        window.dispatchEvent(new Event(CHANGELOG_OPEN_EVENT));
      } else if (item.href) {
        router.push(item.href);
      }
      setOpen(false);
    },
    [router]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (!open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % Math.max(filtered.length, 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex(
          (index) => (index - 1 + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1)
        );
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const item = filtered[selectedIndex];
        if (item) {
          runCommand(item);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filtered, open, runCommand, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIndex(0);

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        ) || []
      );
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleTab);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleTab);
      previouslyFocusedRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-start justify-center bg-black/65 px-4 pt-[min(18vh,9rem)] backdrop-blur-sm"
      onMouseDown={() => setOpen(false)}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        tabIndex={-1}
        className="border-border bg-surface w-full max-w-xl overflow-hidden rounded-xl border shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-border flex items-center gap-3 border-b px-4">
          <Search className="h-4 w-4 shrink-0 text-zinc-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search commands..."
            aria-label="Search commands"
            className="min-w-0 flex-1 bg-transparent py-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          />
          <kbd className="border-border hidden rounded border px-1.5 py-0.5 text-[10px] text-zinc-500 sm:inline">
            Esc
          </kbd>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-white"
            aria-label="Close command palette"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2 id="command-palette-title" className="sr-only">
          Command palette
        </h2>
        <div
          role="listbox"
          aria-label="Available commands"
          className="max-h-[min(60vh,420px)] overflow-y-auto p-2"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-zinc-500">
              No commands match that search.
            </p>
          ) : (
            filtered.map((item, index) => (
              <button
                type="button"
                key={item.id}
                role="option"
                aria-selected={index === selectedIndex}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => {
                  runCommand(item);
                }}
                className={`flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors ${index === selectedIndex ? 'bg-gold/15 text-white' : 'text-zinc-300 hover:bg-white/[0.06]'}`}
              >
                <Command
                  className={`mt-0.5 h-4 w-4 shrink-0 ${index === selectedIndex ? 'text-gold' : 'text-zinc-500'}`}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-zinc-500">
                    {item.description}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
        <div className="border-border flex items-center gap-3 border-t px-4 py-2 text-[11px] text-zinc-500">
          <span>
            <kbd className="border-border rounded border px-1">↑</kbd>
            <kbd className="border-border ml-1 rounded border px-1">↓</kbd> navigate
          </span>
          <span>
            <kbd className="border-border rounded border px-1">Enter</kbd> open
          </span>
          <span className="ml-auto">
            <kbd className="border-border rounded border px-1">Ctrl K</kbd> toggle
          </span>
        </div>
      </section>
    </div>
  );
}

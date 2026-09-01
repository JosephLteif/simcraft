'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRightLeft,
  ChevronDown,
  HelpCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  Search,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react';
import { useAuth } from './AuthContext';
import LoginModal from './LoginModal';
import { API_URL, fetchJsonCached } from '../lib/api';
import { characterHref } from '../lib/routes';
import { useDismissOnOutside } from '../lib/useDismissOnOutside';
import DesktopWindowTitleBar from './DesktopWindowTitleBar';
import { CHANGELOG_OPEN_EVENT } from './ChangelogPopup';
import { COMMAND_PALETTE_OPEN_EVENT } from './CommandPalette';
import NotificationCenter from './shared/NotificationCenter';
import { useGuidedTour } from './GuidedTour';
import SharedResultImport from './SharedResultImport';

type SearchCharacter = {
  realm: string;
  region: string;
};

type RealmOption = {
  slug: string;
  name: string;
};

type RecentCharacterSearch = {
  name: string;
  realm: string;
  region: string;
  realmName?: string;
};

const CHARACTER_SEARCH_HISTORY_STORAGE_KEY = 'whylowdps_character_search_history_v1';
const MAX_CHARACTER_SEARCH_HISTORY = 8;

function recentCharacterSearchKey(search: RecentCharacterSearch): string {
  return `${search.region}|${search.realm}|${search.name}`.toLowerCase();
}

function parseRecentCharacterSearch(value: unknown): RecentCharacterSearch | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = String(raw.name ?? '').trim();
  const realm = String(raw.realm ?? '')
    .trim()
    .toLowerCase();
  const region = String(raw.region ?? '')
    .trim()
    .toLowerCase();
  const realmName = String(raw.realmName ?? '').trim();
  if (!name || !realm || !region) return null;
  return { name, realm, region, ...(realmName ? { realmName } : {}) };
}

function readRecentCharacterSearches(): RecentCharacterSearch[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CHARACTER_SEARCH_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    return parsed
      .map(parseRecentCharacterSearch)
      .filter((search): search is RecentCharacterSearch => {
        if (!search) return false;
        const key = recentCharacterSearchKey(search);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_CHARACTER_SEARCH_HISTORY);
  } catch {
    return [];
  }
}

function writeRecentCharacterSearches(searches: RecentCharacterSearch[]): void {
  try {
    window.localStorage.setItem(
      CHARACTER_SEARCH_HISTORY_STORAGE_KEY,
      JSON.stringify(searches.slice(0, MAX_CHARACTER_SEARCH_HISTORY))
    );
  } catch {
    // Storage can be unavailable in privacy-restricted webviews.
  }
}

function RecentCharacterSearchDropdown({
  searches,
  query,
  onSelect,
}: {
  searches: RecentCharacterSearch[];
  query: string;
  onSelect: (search: RecentCharacterSearch) => void;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSearches = searches.filter((search) => {
    if (!normalizedQuery) return true;
    return `${search.name} ${search.realm} ${search.realmName || ''}`
      .toLowerCase()
      .includes(normalizedQuery);
  });

  if (visibleSearches.length === 0) return null;

  return (
    <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-border bg-surface-2 shadow-2xl">
      <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        Recent characters
      </div>
      <div className="p-1">
        {visibleSearches.map((search) => (
          <button
            key={recentCharacterSearchKey(search)}
            type="button"
            onClick={() => onSelect(search)}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left transition-colors hover:bg-white/10"
            aria-label={`Go to ${search.name} on ${search.realmName || search.realm} (${search.region.toUpperCase()})`}
          >
            <span className="min-w-0 truncate text-[13px] font-medium text-zinc-200">
              {search.name}
            </span>
            <span className="ml-3 shrink-0 text-[11px] text-zinc-500">
              {search.realmName || search.realm} · {search.region.toUpperCase()}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function TopHeader() {
  const router = useRouter();
  const { user, loading, lightMode, disableLightMode, login, logout, checkCredentialsStatus } =
    useAuth();
  const { currentTour, startCurrentTour, closeTour } = useGuidedTour();
  const headerRef = useRef<HTMLElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [characterName, setCharacterName] = useState('');
  const [characterRegion, setCharacterRegion] = useState('us');
  const [characterRealm, setCharacterRealm] = useState('');
  const [realmOptions, setRealmOptions] = useState<RealmOption[]>([]);
  const [recentCharacterSearches, setRecentCharacterSearches] = useState<RecentCharacterSearch[]>(
    []
  );
  const [isRecentSearchOpen, setIsRecentSearchOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isMobileActionsOpen, setIsMobileActionsOpen] = useState(false);

  useDismissOnOutside(headerRef, isRecentSearchOpen, () => setIsRecentSearchOpen(false));
  useDismissOnOutside(accountMenuRef, isAccountMenuOpen, () => setIsAccountMenuOpen(false));
  useDismissOnOutside(headerRef, isMobileActionsOpen, () => setIsMobileActionsOpen(false));

  useEffect(() => {
    setRecentCharacterSearches(readRecentCharacterSearches());
  }, []);

  const handleLoginClick = async () => {
    const status = await checkCredentialsStatus();
    if (status.globally_configured) login();
    else setIsModalOpen(true);
  };

  const handleModalConfirm = (clientId: string, clientSecret: string, credentialId?: string) => {
    setIsModalOpen(false);
    login(clientId, clientSecret, credentialId);
  };

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/');
  };

  const handleSidebarToggle = () => {
    window.dispatchEvent(new Event('whylowdps:toggle-sidebar'));
  };

  const handleWhatsNew = () => {
    closeTour();
    window.dispatchEvent(new Event(CHANGELOG_OPEN_EVENT));
  };

  const handleCommandPaletteOpen = () => {
    closeTour();
    window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT));
  };

  const handlePageTourOpen = () => {
    startCurrentTour();
  };

  useEffect(() => {
    let cancelled = false;
    const loadDefaultRegion = async () => {
      if (lightMode) return;
      try {
        const res = await fetchJsonCached<{ characters?: SearchCharacter[] }>(
          `${API_URL}/api/bnet/user/characters`,
          { ttl: 600000 }
        );
        if (cancelled) return;
        const chars = Array.isArray(res?.characters) ? res.characters : [];
        const preferred = chars.find((c) => c?.region)?.region?.toLowerCase();
        if (preferred) setCharacterRegion(preferred);
      } catch {}
    };
    void loadDefaultRegion();
    return () => {
      cancelled = true;
    };
  }, [lightMode]);

  useEffect(() => {
    let cancelled = false;
    const loadRealmOptions = async () => {
      if (lightMode) {
        setRealmOptions([]);
        return;
      }
      try {
        const res = await fetchJsonCached<{ realms?: RealmOption[] }>(
          `${API_URL}/api/blizzard/realms?region=${encodeURIComponent(characterRegion)}`,
          { ttl: 86400000 }
        );
        if (cancelled) return;
        setRealmOptions(Array.isArray(res?.realms) ? res.realms : []);
      } catch {
        if (!cancelled) setRealmOptions([]);
      }
    };
    void loadRealmOptions();
    return () => {
      cancelled = true;
    };
  }, [characterRegion, lightMode]);

  useEffect(() => {
    if (!characterRealm && realmOptions.length > 0) setCharacterRealm(realmOptions[0].slug);
  }, [realmOptions, characterRealm]);

  useLayoutEffect(() => {
    const applyHeaderHeight = () => {
      const headerHeight = headerRef.current?.offsetHeight;
      if (!headerHeight) return;
      document.body.style.setProperty('--app-header-height', `${headerHeight}px`);
      window.dispatchEvent(new Event('whylowdps:layout-updated'));
    };

    applyHeaderHeight();

    const header = headerRef.current;
    const observer =
      header && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            applyHeaderHeight();
          })
        : null;

    if (header && observer) {
      observer.observe(header);
    }

    window.addEventListener('resize', applyHeaderHeight);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', applyHeaderHeight);
      document.body.style.setProperty('--app-header-height', '3rem');
    };
  }, []);

  const handleCharacterSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedName = characterName.trim();
    const trimmedRealm = characterRealm.trim();
    if (!trimmedName || !trimmedRealm) return;

    const search = {
      name: trimmedName,
      realm: trimmedRealm,
      region: characterRegion,
      realmName:
        realmOptions.find((realm) => realm.slug.toLowerCase() === trimmedRealm.toLowerCase())
          ?.name || trimmedRealm,
    };
    const nextSearches = [
      search,
      ...recentCharacterSearches.filter(
        (recentSearch) =>
          recentCharacterSearchKey(recentSearch) !== recentCharacterSearchKey(search)
      ),
    ].slice(0, MAX_CHARACTER_SEARCH_HISTORY);
    setRecentCharacterSearches(nextSearches);
    writeRecentCharacterSearches(nextSearches);
    setIsRecentSearchOpen(false);
    router.push(characterHref(characterRegion, trimmedRealm, trimmedName));
  };

  const handleRecentCharacterSearch = (search: RecentCharacterSearch) => {
    setCharacterName(search.name);
    setCharacterRegion(search.region);
    setCharacterRealm(search.realm);
    setIsRecentSearchOpen(false);
    router.push(characterHref(search.region, search.realm, search.name));
  };

  return (
    <>
      <header
        ref={headerRef}
        className="app-header-safe-area fixed top-0 z-50 w-full border-b border-white/5 bg-bg/90 backdrop-blur-xl"
      >
        <DesktopWindowTitleBar />

        <div className="grid h-12 grid-cols-[auto_1fr_auto] items-center gap-2 px-2 sm:gap-3 sm:px-3 md:px-5">
          <div className="flex items-center gap-2">
            <button
              data-tauri-drag-region="false"
              type="button"
              onClick={handleSidebarToggle}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-2 text-zinc-300 transition hover:border-zinc-500 hover:bg-white/5 hover:text-white sm:h-8 sm:w-8 xl:hidden"
              title="Toggle sidebar"
              aria-label="Toggle sidebar"
            >
              <Menu className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              data-tauri-drag-region="false"
              type="button"
              onClick={handleBack}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] font-medium text-zinc-300 transition hover:border-zinc-500 hover:bg-white/5 hover:text-white sm:h-8"
              title="Go back"
              aria-label="Go back"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
              <span className="hidden sm:inline">Back</span>
            </button>
          </div>

          <Link
            href="/"
            className="inline-flex min-w-0 items-center justify-center gap-1.5 text-center text-[13px] font-semibold tracking-tight text-zinc-200 sm:text-sm xl:hidden"
          >
            <img src="/icon.png" alt="WhyLowDps" className="h-6 w-6 shrink-0 object-contain" />
            <span className="hidden min-[400px]:inline">WhyLowDps</span>
          </Link>

          {!lightMode && (
            <form
              data-tauri-drag-region="false"
              data-tour="character-search"
              onSubmit={handleCharacterSearch}
              className="relative mx-auto hidden w-full max-w-[560px] items-center gap-1.5 xl:flex"
            >
              <input
                type="text"
                value={characterName}
                onChange={(e) => setCharacterName(e.target.value)}
                onFocus={() => setIsRecentSearchOpen(true)}
                placeholder="Character"
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
                aria-label="Character name"
              />
              <select
                value={characterRegion}
                onChange={(e) => setCharacterRegion(e.target.value)}
                className="h-8 w-16 rounded-md border border-border bg-surface-2 px-2 text-[13px] text-zinc-200 focus:border-zinc-500 focus:outline-none"
                aria-label="Character region"
              >
                <option value="us">US</option>
                <option value="eu">EU</option>
                <option value="kr">KR</option>
                <option value="tw">TW</option>
              </select>
              <select
                value={characterRealm}
                onChange={(e) => setCharacterRealm(e.target.value)}
                className="h-8 w-40 rounded-md border border-border bg-surface-2 px-2 text-[13px] text-zinc-200 focus:border-zinc-500 focus:outline-none"
                aria-label="Character realm"
              >
                {realmOptions.length === 0 ? (
                  <option value="">Realm</option>
                ) : (
                  realmOptions.map((realm) => (
                    <option key={realm.slug} value={realm.slug}>
                      {realm.name}
                    </option>
                  ))
                )}
              </select>
              <button
                type="submit"
                className="h-8 rounded-md border border-gold/25 bg-gold/15 px-3 text-[13px] font-semibold text-gold transition-colors hover:bg-gold/25"
              >
                Go
              </button>
              {isRecentSearchOpen && (
                <RecentCharacterSearchDropdown
                  searches={recentCharacterSearches}
                  query={characterName}
                  onSelect={handleRecentCharacterSearch}
                />
              )}
            </form>
          )}

          <div data-tauri-drag-region="false" className="flex items-center gap-1.5 justify-self-end sm:gap-3">
            <div className="hidden items-center gap-3 md:flex">
              <button
                type="button"
                onClick={handleCommandPaletteOpen}
                data-tour="app-search"
                className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-[13px] font-semibold text-zinc-200 transition-colors hover:bg-white/[0.1] hover:text-white"
                title="Search app commands (Ctrl K)"
                aria-label="Search app commands (Ctrl K)"
                aria-keyshortcuts="Control+K Meta+K"
              >
                <Search className="h-3.5 w-3.5" strokeWidth={2} />
                <span className="hidden md:inline">App search</span>
                <kbd className="hidden rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 xl:inline">
                  Ctrl K
                </kbd>
              </button>
              <button
                type="button"
                onClick={handleWhatsNew}
                data-tour="whats-new"
                className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-[13px] font-semibold text-zinc-200 transition-colors hover:bg-white/[0.1] hover:text-white"
                title="What's new"
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
                <span className="hidden md:inline">What&apos;s new</span>
              </button>
              <SharedResultImport />
              {currentTour ? (
                <button
                  type="button"
                  onClick={handlePageTourOpen}
                  data-tour="guided-tour-trigger"
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-gold/25 bg-gold/10 px-2.5 text-[13px] font-semibold text-gold transition-colors hover:bg-gold/20"
                  title={`Start the ${currentTour.label} tour`}
                  aria-label={`Start the ${currentTour.label} tour`}
                >
                  <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />
                  <span className="hidden md:inline">Tour</span>
                </button>
              ) : null}
            </div>
            <div className="relative md:hidden">
              <button
                type="button"
                onClick={() => setIsMobileActionsOpen((open) => !open)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/[0.1] hover:text-white sm:h-8 sm:w-8"
                title="More actions"
                aria-label="More actions"
                aria-expanded={isMobileActionsOpen}
                aria-haspopup="menu"
              >
                <MoreHorizontal className="h-4 w-4" strokeWidth={2} />
              </button>
              {isMobileActionsOpen ? (
                <div
                  role="menu"
                  aria-label="More actions"
                  className="absolute right-0 top-full z-[150] mt-2 w-48 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-2xl shadow-black/50"
                >
                  <button
                    type="button"
                    role="menuitem"
                    data-tour="app-search"
                    onClick={() => {
                      setIsMobileActionsOpen(false);
                      handleCommandPaletteOpen();
                    }}
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-white/[0.07] hover:text-white"
                  >
                    <Search className="h-4 w-4 text-zinc-400" strokeWidth={2} />
                    App search
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-tour="whats-new"
                    onClick={() => {
                      setIsMobileActionsOpen(false);
                      handleWhatsNew();
                    }}
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-white/[0.07] hover:text-white"
                  >
                    <Sparkles className="h-4 w-4 text-zinc-400" strokeWidth={2} />
                    What&apos;s new
                  </button>
                  <SharedResultImport variant="menu" />
                  {currentTour ? (
                    <button
                      type="button"
                      role="menuitem"
                      data-tour="guided-tour-trigger"
                      onClick={() => {
                        setIsMobileActionsOpen(false);
                        handlePageTourOpen();
                      }}
                      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-white/[0.07] hover:text-white"
                    >
                      <HelpCircle className="h-4 w-4 text-zinc-400" strokeWidth={2} />
                      Page tour
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <NotificationCenter />
            {!loading &&
              (lightMode ? (
                <div className="flex items-center gap-2">
                  <span className="hidden text-[13px] font-medium text-zinc-300 sm:inline">
                    Light mode
                  </span>
                  <button
                    onClick={disableLightMode}
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[13px] font-semibold text-zinc-100 transition-colors hover:bg-white/10"
                  >
                    Full mode
                  </button>
                </div>
              ) : user ? (
                <div ref={accountMenuRef} className="relative flex items-center gap-3">
                  <div className="hidden h-6 w-px bg-border sm:block" />
                  <button
                    type="button"
                    onClick={() => setIsAccountMenuOpen((open) => !open)}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2 transition-colors hover:bg-white/[0.1] sm:h-9"
                    aria-label={`Account menu for ${user.battletag}`}
                    aria-expanded={isAccountMenuOpen}
                    aria-haspopup="menu"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold/20 text-xs font-bold text-gold ring-1 ring-gold/30 sm:h-7 sm:w-7">
                      {user.battletag.trim().charAt(0).toUpperCase() || '?'}
                    </span>
                    <span className="hidden max-w-32 truncate text-[13px] font-medium text-zinc-200 sm:inline">
                      {user.battletag}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 text-zinc-400 transition-transform ${isAccountMenuOpen ? 'rotate-180' : ''}`}
                      strokeWidth={2}
                    />
                  </button>

                  {isAccountMenuOpen ? (
                    <div
                      role="menu"
                      aria-label="Account menu"
                      className="absolute right-0 top-full z-[150] mt-2 w-[min(18rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/50"
                    >
                      <div className="border-b border-border px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/20 text-sm font-bold text-gold ring-1 ring-gold/30">
                            {user.battletag.trim().charAt(0).toUpperCase() || '?'}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                              BattleTag
                            </p>
                            <p className="truncate text-sm font-semibold text-zinc-100">
                              {user.battletag}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="p-1">
                        <Link
                          href="/characters"
                          role="menuitem"
                          onClick={() => setIsAccountMenuOpen(false)}
                          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-200 transition-colors hover:bg-white/[0.07] hover:text-white"
                        >
                          <UserRound className="h-4 w-4 text-zinc-400" strokeWidth={2} />
                          My Characters
                        </Link>
                        {user.role === 'admin' ? (
                          <Link
                            href="/admin/users"
                            role="menuitem"
                            onClick={() => setIsAccountMenuOpen(false)}
                            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-200 transition-colors hover:bg-white/[0.07] hover:text-white"
                          >
                            <Users className="h-4 w-4 text-zinc-400" strokeWidth={2} />
                            Manage Users
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setIsAccountMenuOpen(false);
                            logout(true);
                          }}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-zinc-200 transition-colors hover:bg-white/[0.07] hover:text-white"
                        >
                          <ArrowRightLeft className="h-4 w-4 text-zinc-400" strokeWidth={2} />
                          Switch account
                        </button>
                        <div className="my-1 border-t border-border" />
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setIsAccountMenuOpen(false);
                            logout(false);
                          }}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
                        >
                          <LogOut className="h-4 w-4" strokeWidth={2} />
                          Log out
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <button
                  onClick={handleLoginClick}
                  className="rounded-md bg-[#0074e0] px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-[#005fb8]"
                >
                  Login with Battle.net
                </button>
              ))}
          </div>
        </div>
        {!lightMode && (
          <form
            data-tauri-drag-region="false"
            data-tour="character-search"
            onSubmit={handleCharacterSearch}
            className="relative flex items-center gap-1.5 border-t border-white/5 px-2 py-2 md:px-5 xl:hidden"
          >
            <input
              type="text"
              value={characterName}
              onChange={(e) => setCharacterName(e.target.value)}
              onFocus={() => setIsRecentSearchOpen(true)}
              placeholder="Character"
              className="h-10 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none sm:h-8"
              aria-label="Character name"
            />
            <select
              value={characterRegion}
              onChange={(e) => setCharacterRegion(e.target.value)}
              className="h-10 w-14 rounded-md border border-border bg-surface-2 px-1.5 text-[13px] text-zinc-200 focus:border-zinc-500 focus:outline-none sm:h-8 sm:w-16 sm:px-2"
              aria-label="Character region"
            >
              <option value="us">US</option>
              <option value="eu">EU</option>
              <option value="kr">KR</option>
              <option value="tw">TW</option>
            </select>
            <select
              value={characterRealm}
              onChange={(e) => setCharacterRealm(e.target.value)}
              className="h-10 w-24 rounded-md border border-border bg-surface-2 px-1.5 text-[13px] text-zinc-200 focus:border-zinc-500 focus:outline-none sm:h-8 sm:w-28 sm:px-2"
              aria-label="Character realm"
            >
              {realmOptions.length === 0 ? (
                <option value="">Realm</option>
              ) : (
                realmOptions.map((realm) => (
                  <option key={realm.slug} value={realm.slug}>
                    {realm.name}
                  </option>
                ))
              )}
            </select>
            <button
              type="submit"
              className="h-10 rounded-md border border-gold/25 bg-gold/15 px-3 text-[13px] font-semibold text-gold transition-colors hover:bg-gold/25 sm:h-8"
            >
              Go
            </button>
            {isRecentSearchOpen && (
              <RecentCharacterSearchDropdown
                searches={recentCharacterSearches}
                query={characterName}
                onSelect={handleRecentCharacterSearch}
              />
            )}
          </form>
        )}
      </header>

      <LoginModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={handleModalConfirm}
      />
    </>
  );
}

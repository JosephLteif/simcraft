'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { API_URL, fetchJson, fetchJsonCached } from '../lib/api';
import { characterHref } from '../lib/routes';
import { CLASS_COLORS } from '../lib/types';
import { buildWishlistHref } from '../lib/wishlist';

interface Character {
  name: string;
  realm: string;
  region: string;
  class: string;
  race: string;
  faction: string;
  level: number;
  mode: string;
}

const FAVORITES_STORAGE_KEY = 'whylowdps.characters.favorites';
const HIDDEN_STORAGE_KEY = 'whylowdps.characters.hidden';
const LOCAL_TRACKED_CHARACTERS_KEY = 'whylowdps_tracked_characters';

function normalizeClassKey(value: string): string {
  return (value || '').toLowerCase().replace(/\s+/g, '_');
}

function normalizeFaction(value: string): 'alliance' | 'horde' | 'other' {
  const v = (value || '').toLowerCase();
  if (v.includes('alliance')) return 'alliance';
  if (v.includes('horde')) return 'horde';
  return 'other';
}

function normalizeRegion(value: string): string {
  return (value || 'us').toLowerCase();
}

function characterId(char: Character): string {
  return `${normalizeRegion(char.region)}|${char.realm.toLowerCase()}|${char.name.toLowerCase()}`;
}
function wishlistHrefForCharacter(char: Character): string {
  return buildWishlistHref({
    name: char.name,
    realm: char.realm,
    region: char.region,
    className: char.class,
  });
}

function CharacterCard({
  char,
  faction,
  isFavorite,
  isHidden,
  onToggleFavorite,
  onToggleHidden,
  onToggleTracked,
  isTrackedCharacter,
}: {
  char: Character;
  faction: 'alliance' | 'horde';
  isFavorite: boolean;
  isHidden: boolean;
  onToggleFavorite: (char: Character) => void;
  onToggleHidden: (char: Character) => void;
  onToggleTracked: (char: Character) => void;
  isTrackedCharacter: boolean;
}) {
  const classKey = normalizeClassKey(char.class);
  const color = CLASS_COLORS[classKey] || '#d4d4d8';
  const isAlliance = faction === 'alliance';
  const href = characterHref(
    char.region,
    char.realm.toLowerCase().replace(/'/g, '').replace(/\s+/g, '-'),
    char.name
  );
  const cardLabel = `${char.name} - ${char.realm} (${normalizeRegion(char.region).toUpperCase()})`;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      onMouseLeave={() => setMenuOpen(false)}
      className={`group relative flex min-h-[18rem] overflow-hidden rounded-xl border bg-[#0c0c0f] transition-all ${
        isHidden
          ? 'border-white/10 opacity-70'
          : 'border-white/10 hover:border-gold/40 hover:shadow-[0_0_0_1px_rgba(212,175,55,0.15)]'
      }`}
    >
      <Link href={href} aria-label={cardLabel} className="absolute inset-0 z-10" />
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {classKey ? (
          <img
            src={`https://render.worldofwarcraft.com/profile-backgrounds/v2/armory_bg_class_${classKey}.jpg`}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover opacity-[0.78] transition-transform duration-500 group-hover:scale-[1.03]"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : null}
        <img
          src={`${API_URL}/api/blizzard/character/${char.realm}/${char.name}/media/main?region=${char.region}`}
          alt=""
          className="absolute inset-x-0 -bottom-[6%] z-[2] mx-auto h-[112%] w-auto max-w-none object-contain opacity-100 transition-transform duration-300 group-hover:scale-[1.08]"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
        <div
          className={`absolute inset-0 z-[1] bg-gradient-to-t ${
            isAlliance
              ? 'from-[#080a10]/97 via-[#080a10]/45 to-transparent'
              : 'from-[#100808]/97 via-[#100808]/45 to-transparent'
          }`}
        />
        <div className="absolute inset-x-0 bottom-0 z-[1] h-16 bg-gradient-to-t from-black/70 to-transparent" />
      </div>

      <div className="pointer-events-none relative z-20 flex w-full flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xl font-black tracking-tight" style={{ color }}>
              {char.name}
              {isFavorite ? <span className="ml-2 align-middle text-gold">&#9733;</span> : null}
              {isTrackedCharacter ? (
                <span className="ml-2 inline-flex items-center rounded border border-emerald-400/40 bg-emerald-500/15 px-1.5 py-0.5 align-middle text-[10px] font-black uppercase tracking-wider text-emerald-300">
                  Tracked
                </span>
              ) : null}
            </p>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
              {char.race} {char.class}
            </p>
          </div>
          <div className="pointer-events-auto relative z-30 flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-black/35 text-zinc-300 transition hover:border-white/30 hover:text-white"
                title="Character actions"
                aria-label="Character actions"
              >
                ⋯
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-9 z-40 min-w-[170px] rounded-md border border-white/15 bg-[#111317] p-1 shadow-xl">
                  <Link
                    href={`/talent-playground?char=${encodeURIComponent(characterId(char))}`}
                    className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/10"
                  >
                    Open Talents
                  </Link>
                  <Link
                    href={wishlistHrefForCharacter(char)}
                    className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/10"
                  >
                    Open Wishlist
                  </Link>
                  <div className="my-1 h-px bg-white/10" />
                  <button
                    type="button"
                    onClick={() => {
                      onToggleTracked(char);
                      setMenuOpen(false);
                    }}
                    className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/10"
                  >
                    {isTrackedCharacter ? 'Untrack Character' : 'Track Character'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onToggleFavorite(char);
                      setMenuOpen(false);
                    }}
                    className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/10"
                  >
                    {isFavorite ? 'Remove Favorite' : 'Add to Favorite'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onToggleHidden(char);
                      setMenuOpen(false);
                    }}
                    className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/10"
                  >
                    {isHidden ? 'Show' : 'Hide'}
                  </button>
                </div>
              ) : null}
            </div>
            <span
              className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white ${
                isAlliance ? 'bg-blue-700' : 'bg-red-700'
              }`}
            >
              {isAlliance ? 'Alliance' : 'Horde'}
            </span>
          </div>
        </div>

        <div className="mt-auto flex items-end justify-between">
          <p className="text-[13px] font-semibold text-zinc-100">{char.realm}</p>
          <p className="text-[11px] font-semibold text-zinc-300">
            {normalizeRegion(char.region).toUpperCase()} - L{char.level}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function CharactersPage() {
  const { user, loading } = useAuth();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState<'all' | string>('all');
  const [classFilter, setClassFilter] = useState<'all' | string>('all');
  const [realmFilter, setRealmFilter] = useState<'all' | string>('all');
  const [viewFilter, setViewFilter] = useState<'visible' | 'all' | 'favorites' | 'hidden'>(
    'visible'
  );
  const [favorites, setFavorites] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [trackedCharacterKeys, setTrackedCharacterKeys] = useState<string[]>([]);

  const fetchCharacters = useCallback(
    (refresh = false) => {
      if (!loading && user) {
        setFetching(true);
        const url = `${API_URL}/api/bnet/user/characters`;
        const promise = refresh
          ? fetchJson<{ characters: Character[] }>(`${url}?refresh=true`)
          : fetchJsonCached<{ characters: Character[] }>(url, { ttl: 600000 });

        promise
          .then((data) => setCharacters(data.characters || []))
          .catch((err) => setError(err.message))
          .finally(() => setFetching(false));
      }
    },
    [loading, user]
  );

  useEffect(() => {
    fetchCharacters();
  }, [fetchCharacters]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const rawFavorites = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
      const rawHidden = window.localStorage.getItem(HIDDEN_STORAGE_KEY);
      if (rawFavorites) {
        const parsed = JSON.parse(rawFavorites);
        if (Array.isArray(parsed)) setFavorites(parsed.filter((v) => typeof v === 'string'));
      }
      if (rawHidden) {
        const parsed = JSON.parse(rawHidden);
        if (Array.isArray(parsed)) setHidden(parsed.filter((v) => typeof v === 'string'));
      }
      const rawTracked = window.localStorage.getItem(LOCAL_TRACKED_CHARACTERS_KEY);
      if (rawTracked) {
        const parsed = JSON.parse(rawTracked);
        if (Array.isArray(parsed))
          setTrackedCharacterKeys(parsed.filter((v) => typeof v === 'string'));
      }
    } catch {
      setFavorites([]);
      setHidden([]);
    } finally {
      setStorageHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !storageHydrated) return;
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  }, [favorites, storageHydrated]);

  useEffect(() => {
    if (typeof window === 'undefined' || !storageHydrated) return;
    window.localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(hidden));
  }, [hidden, storageHydrated]);

  const toggleFavorite = useCallback((char: Character) => {
    const id = characterId(char);
    setFavorites((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }, []);

  const toggleHidden = useCallback((char: Character) => {
    const id = characterId(char);
    setHidden((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }, []);

  const toggleTrackedCharacter = useCallback((char: Character) => {
    const key = characterId(char);
    setTrackedCharacterKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((v) => v !== key) : [...prev, key];
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LOCAL_TRACKED_CHARACTERS_KEY, JSON.stringify(next));
      }
      return next;
    });
  }, []);

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);

  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const c of characters) set.add(normalizeRegion(c.region));
    return Array.from(set).sort();
  }, [characters]);

  const classes = useMemo(() => {
    const set = new Set<string>();
    for (const c of characters) set.add(c.class);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [characters]);

  const realms = useMemo(() => {
    const set = new Set<string>();
    for (const c of characters) set.add(c.realm);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [characters]);

  const filteredCharacters = useMemo(() => {
    const query = search.toLowerCase().trim();
    return characters.filter((char) => {
      const id = characterId(char);
      const isFavorite = favoriteSet.has(id);
      const isHidden = hiddenSet.has(id);

      if (viewFilter === 'visible' && isHidden) return false;
      if (viewFilter === 'favorites' && !isFavorite) return false;
      if (viewFilter === 'hidden' && !isHidden) return false;
      if (regionFilter !== 'all' && normalizeRegion(char.region) !== regionFilter) return false;
      if (classFilter !== 'all' && char.class !== classFilter) return false;
      if (realmFilter !== 'all' && char.realm !== realmFilter) return false;
      if (!query) return true;
      const haystack =
        `${char.name} ${char.realm} ${char.class} ${char.race} ${char.region}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [
    characters,
    search,
    regionFilter,
    classFilter,
    realmFilter,
    viewFilter,
    favoriteSet,
    hiddenSet,
  ]);

  const allianceCharacters = useMemo(
    () => filteredCharacters.filter((c) => normalizeFaction(c.faction) === 'alliance'),
    [filteredCharacters]
  );
  const hordeCharacters = useMemo(
    () => filteredCharacters.filter((c) => normalizeFaction(c.faction) === 'horde'),
    [filteredCharacters]
  );

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-800 border-t-gold" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center text-center">
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-gray-100">Access Denied</h1>
        <p className="text-base text-zinc-400">
          Please log in with Battle.net to view your characters.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="lg:max-w-[330px]">
          <h1 className="text-2xl font-bold tracking-tight text-gray-100">My Characters</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Favorite the ones you use most and hide inactive alts from your default view.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 lg:flex-nowrap">
          <Link
            href="/talent-playground"
            className="rounded border border-gold/40 bg-gold/[0.12] px-3 py-1 text-xs font-bold text-gold hover:bg-gold/[0.2]"
          >
            Talent Playground
          </Link>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search character, realm, class..."
            className="h-9 w-64 max-w-full rounded-md border border-white/10 bg-black/20 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-gold/70 focus:outline-none"
          />
          <select
            value={viewFilter}
            onChange={(e) =>
              setViewFilter(e.target.value as 'visible' | 'all' | 'favorites' | 'hidden')
            }
            className="h-9 rounded-md border border-white/10 bg-[#121218] px-2.5 text-sm text-zinc-100 focus:border-gold/70 focus:outline-none"
            style={{ colorScheme: 'dark' }}
          >
            <option value="visible">Visible</option>
            <option value="favorites">Favorites</option>
            <option value="all">All Characters</option>
            <option value="hidden">Hidden</option>
          </select>
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="h-9 rounded-md border border-white/10 bg-[#121218] px-2.5 text-sm text-zinc-100 focus:border-gold/70 focus:outline-none"
            style={{ colorScheme: 'dark' }}
          >
            <option value="all">All Regions</option>
            {regions.map((region) => (
              <option key={region} value={region}>
                {region.toUpperCase()}
              </option>
            ))}
          </select>
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="h-9 rounded-md border border-white/10 bg-[#121218] px-2.5 text-sm text-zinc-100 focus:border-gold/70 focus:outline-none"
            style={{ colorScheme: 'dark' }}
          >
            <option value="all">All Classes</option>
            {classes.map((klass) => (
              <option key={klass} value={klass}>
                {klass}
              </option>
            ))}
          </select>
          <select
            value={realmFilter}
            onChange={(e) => setRealmFilter(e.target.value)}
            className="h-9 rounded-md border border-white/10 bg-[#121218] px-2.5 text-sm text-zinc-100 focus:border-gold/70 focus:outline-none"
            style={{ colorScheme: 'dark' }}
          >
            <option value="all">All Realms</option>
            {realms.map((realm) => (
              <option key={realm} value={realm}>
                {realm}
              </option>
            ))}
          </select>
          <button
            onClick={() => fetchCharacters(true)}
            disabled={fetching}
            className="rounded border border-white/10 bg-black/20 px-3 py-1 text-xs font-bold text-zinc-200 backdrop-blur-sm hover:bg-white/10 active:scale-95 disabled:opacity-50"
          >
            {fetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {fetching ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-800 border-t-gold" />
        </div>
      ) : error ? (
        <div className="card border-red-500/20 bg-red-500/[0.03] p-6 text-center">
          <p className="text-sm font-semibold text-red-400">{error}</p>
        </div>
      ) : characters.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-zinc-400">No characters found on this account.</p>
        </div>
      ) : filteredCharacters.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-zinc-400">
            {viewFilter === 'favorites'
              ? 'No favorite characters match these filters.'
              : viewFilter === 'hidden'
                ? 'No hidden characters match these filters.'
                : 'No characters match these filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-blue-300">Alliance</h2>
              <span className="text-xs text-zinc-500">{allianceCharacters.length} characters</span>
            </div>
            {allianceCharacters.length === 0 ? (
              <div className="border-white/8 rounded-lg border bg-white/[0.02] px-4 py-6 text-sm text-zinc-500">
                No Alliance characters in current filters.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {allianceCharacters.map((char, idx) => (
                  <CharacterCard
                    key={`alliance-${char.name}-${char.realm}-${idx}`}
                    char={char}
                    faction="alliance"
                    isFavorite={favoriteSet.has(characterId(char))}
                    isHidden={hiddenSet.has(characterId(char))}
                    onToggleFavorite={toggleFavorite}
                    onToggleHidden={toggleHidden}
                    onToggleTracked={toggleTrackedCharacter}
                    isTrackedCharacter={trackedCharacterKeys.includes(characterId(char))}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-red-300">Horde</h2>
              <span className="text-xs text-zinc-500">{hordeCharacters.length} characters</span>
            </div>
            {hordeCharacters.length === 0 ? (
              <div className="border-white/8 rounded-lg border bg-white/[0.02] px-4 py-6 text-sm text-zinc-500">
                No Horde characters in current filters.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {hordeCharacters.map((char, idx) => (
                  <CharacterCard
                    key={`horde-${char.name}-${char.realm}-${idx}`}
                    char={char}
                    faction="horde"
                    isFavorite={favoriteSet.has(characterId(char))}
                    isHidden={hiddenSet.has(characterId(char))}
                    onToggleFavorite={toggleFavorite}
                    onToggleHidden={toggleHidden}
                    onToggleTracked={toggleTrackedCharacter}
                    isTrackedCharacter={trackedCharacterKeys.includes(characterId(char))}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

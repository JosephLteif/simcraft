'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { API_URL, getGameContext, listInstances } from '../lib/api';
import {
  getRuntimeWowSeasonContent,
  wowExpansions,
  wowInstances,
  type WowExpansion,
  type WowInstance,
} from '../lib/wow-season-content';
import type { Instance } from '../drop-finder/types';

type RaidEncounter = {
  id: number;
  name: string;
};

const FALLBACK_RAID_IMAGES: Record<string, string> = {
  'the tidebound grotto':
    'https://bnetcmsus-a.akamaihd.net/cms/blog_header/7t/7TRTKV368HRY1785353626933.jpg',
  'the venomous abyss':
    'https://bnetcmsus-a.akamaihd.net/cms/content_entry_media/SSA6NR4LD1VX1785170429186.png',
};

const DEFAULT_RAID_IMAGE = FALLBACK_RAID_IMAGES['the tidebound grotto'];

function normalizeRaidName(value: string): string {
  return value.trim().toLowerCase();
}

function resolveAssetUrl(url?: string): string | undefined {
  if (!url) return undefined;
  return url.startsWith('/') ? `${API_URL}${url}` : url;
}

function normalizeEncounter(raw: unknown): RaidEncounter | null {
  if (raw && typeof raw === 'object') {
    const value = raw as Record<string, unknown>;
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    const id = Number(value.id);
    if (value.trash === true || id < 0) return null;
    if (name && Number.isFinite(id)) return { id, name };
  }

  if (typeof raw === 'string') {
    const id = Number(raw.match(/\bid=([^;}\s]+)/)?.[1]);
    const name = raw.match(/\bname=(.*?)(?:; [A-Za-z_][A-Za-z0-9_]*=|}$)/)?.[1]?.trim();
    if (name && Number.isFinite(id)) return { id, name };
  }

  return null;
}

function fallbackRaidImages(raid: Instance): string[] {
  return [
    FALLBACK_RAID_IMAGES[normalizeRaidName(raid.name)],
    wowInstances.find((instance) => instance.id === raid.id)?.imageUrl,
    DEFAULT_RAID_IMAGE,
  ].filter((url): url is string => Boolean(url));
}

function toApiRaid(instance: WowInstance): Instance {
  return {
    id: instance.id,
    name: instance.name,
    type: 'raid',
    expansion: instance.expansionId,
    image_url: instance.imageUrl,
    encounters: (instance.encounters ?? []).map((encounter) => ({
      id: encounter.id,
      name: encounter.name,
    })),
  };
}

function RaidArtwork({ raid }: { raid: Instance }) {
  const apiImageUrl = resolveAssetUrl(raid.image_url);
  const fallbackImageUrls = fallbackRaidImages(raid);
  const [imageUrl, setImageUrl] = useState(
    apiImageUrl && !apiImageUrl.includes('/api/data/images/')
      ? apiImageUrl
      : (fallbackImageUrls[0] ?? apiImageUrl)
  );

  return imageUrl ? (
    <img
      src={imageUrl}
      alt=""
      className="h-40 w-full object-cover"
      loading="lazy"
      onError={() => {
        setImageUrl((current) => {
          const nextFallbackIndex = fallbackImageUrls.indexOf(current) + 1;
          return fallbackImageUrls[nextFallbackIndex] ?? undefined;
        });
      }}
    />
  ) : (
    <div className="h-40 bg-zinc-800" aria-hidden="true" />
  );
}

function RaidCard({ raid }: { raid: Instance }) {
  const encounters = (Array.isArray(raid.encounters) ? raid.encounters : [])
    .map(normalizeEncounter)
    .filter((encounter): encounter is RaidEncounter => Boolean(encounter));

  return (
    <article className="overflow-hidden rounded-xl border border-white/15 bg-zinc-900/80">
      <RaidArtwork raid={raid} />
      <div className="p-4">
        <h2 className="text-xl font-bold text-zinc-100">{raid.name}</h2>
        <p className="mt-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          {encounters.length} encounters
        </p>
        {encounters.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {encounters.map((encounter) => (
              <li
                key={`${raid.id}-${encounter.id}`}
                className="flex items-center gap-2 text-sm text-zinc-200"
              >
                <span>{encounter.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">No encounter details are available.</p>
        )}
      </div>
    </article>
  );
}

export default function RaidsPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [runtimeRaids, setRuntimeRaids] = useState<Instance[]>([]);
  const [expansions, setExpansions] = useState<WowExpansion[]>(wowExpansions);
  const [currentExpansionId, setCurrentExpansionId] = useState<number | null>(null);
  const [selectedExpansionId, setSelectedExpansionId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listInstances().catch(() => []),
      getGameContext().catch(() => null),
      getRuntimeWowSeasonContent(),
    ])
      .then(([data, context, runtimeWow]) => {
        if (cancelled) return;
        setInstances(data);
        if (runtimeWow.expansions.length > 0) setExpansions(runtimeWow.expansions);
        const seasonName = context?.active_season?.name?.toLocaleLowerCase() ?? '';
        const currentContent = runtimeWow.result.content.find(
          (content) =>
            content.season.source?.gameContext === true ||
            seasonName.includes(content.season.name.toLocaleLowerCase())
        );
        if (currentContent) setRuntimeRaids(currentContent.raids.map(toApiRaid));
        const expansionName = currentContent?.season.expansion?.name?.toLocaleLowerCase();
        setCurrentExpansionId(
          runtimeWow.expansions.find((expansion) =>
            expansionName?.includes(expansion.name.toLocaleLowerCase())
          )?.id ??
            currentContent?.season.expansionId ??
            null
        );
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load raids.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const raids = useMemo(() => {
    const apiRaids = instances.filter((instance) => instance.type === 'raid' && instance.id > 0);
    if (runtimeRaids.length > 0) return runtimeRaids;
    return apiRaids.map((raid) =>
      raid.expansion == null && currentExpansionId != null
        ? { ...raid, expansion: currentExpansionId }
        : raid
    );
  }, [currentExpansionId, instances, runtimeRaids]);
  const expansionIds = useMemo(
    () =>
      [
        ...new Set(raids.map((raid) => raid.expansion).filter((id): id is number => id != null)),
      ].sort((left, right) => right - left),
    [raids]
  );
  const effectiveExpansionId = selectedExpansionId ?? currentExpansionId ?? expansionIds[0] ?? null;
  const visibleRaids = raids.filter(
    (raid) => effectiveExpansionId == null || raid.expansion === effectiveExpansionId
  );
  const expansionNames = new Map(expansions.map((expansion) => [expansion.id, expansion.name]));

  if (loading) {
    return <div className="h-64 animate-pulse rounded-xl border border-white/10 bg-white/5" />;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-red-400" />
        <h1 className="text-xl font-bold text-zinc-100">Failed to load raids</h1>
        <p className="mt-2 text-zinc-500">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-gold mt-6 rounded-lg px-4 py-2 text-sm font-semibold text-black"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white lg:text-4xl">Raids</h1>
          <p className="mt-2 text-base font-semibold text-zinc-300">
            Blizzard raid names, artwork, and encounters
          </p>
        </div>
        <label className="flex flex-col gap-1 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
          Expansion
          <select
            value={effectiveExpansionId ?? ''}
            onChange={(event) => setSelectedExpansionId(Number(event.currentTarget.value) || null)}
            className="w-full rounded-lg border border-white/15 bg-zinc-900 px-3 py-2 text-sm font-medium tracking-normal text-zinc-100 normal-case sm:w-auto sm:min-w-56"
          >
            {expansionIds.length === 0 ? <option value="">No expansions available</option> : null}
            {expansionIds.map((id) => (
              <option key={id} value={id}>
                {expansionNames.get(id) ?? `Expansion ${id}`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4 text-sm text-zinc-400">
        {visibleRaids.length} raid{visibleRaids.length === 1 ? '' : 's'} available from Blizzard
        data.
      </div>

      {visibleRaids.length > 0 ? (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleRaids.map((raid) => (
            <RaidCard key={raid.id} raid={raid} />
          ))}
        </section>
      ) : (
        <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-10 text-center text-zinc-500">
          No raids are available for this expansion.
        </div>
      )}
    </div>
  );
}

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import ErrorAlert from '../components/ErrorAlert';
import { useSimContext } from '../components/SimContext';
import { API_URL, fetchJson, listCharacterProfiles } from '../lib/api';
import {
  buildGearItemUid,
  slotCandidatesFromWishlistSlot,
  slotFromInventoryType,
} from '../lib/gear-utils';
import { getRoadmapStatus, type RoadmapStatus, type RoadmapStatusResult } from '../lib/roadmap';
import { getWowheadData, QUALITY_COLORS, useItemInfo, type ItemInfo } from '../lib/useItemInfo';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import type { ResolveGearResponse, ResolvedItem } from '../lib/types';
import { setSimAgainState } from '../lib/sim-return';
import { parseCharacterInfo } from '../../lib/simc-parser';
import type { Instance } from '../drop-finder/types';
import {
  WISHLIST_STORAGE_KEY,
  buildWishlistOwnerKey,
  clearDropWishlist,
  getWishlistItemLevel,
  listWishlistOwners,
  loadWishlist,
  parseWishlistOwnerKey,
  removeFromWishlist,
  removeRoadmapEntry,
  setRoadmapCompleted,
  type WishlistItem,
  type WishlistOwnerSummary,
} from '../lib/wishlist';

type SelectedItemsMap = Record<string, string[]>;
type BnetCharacter = {
  name?: string;
  realm?: string;
  region?: string;
  class?: string;
  className?: string;
  character_class?: { name?: string };
};

function makeUid(
  itemId: number,
  bonusIds: number[],
  origin: string,
  slot: string,
  enchantId = 0,
  gemId = 0
): string {
  return buildGearItemUid({
    item_id: itemId,
    bonus_ids: bonusIds,
    origin,
    slot,
    includeIlevel: false,
    enchant_id: enchantId,
    gem_id: gemId,
  });
}

function slotCandidates(item: WishlistItem): string[] {
  if (item.inventory_type === 11) return ['finger1', 'finger2'];
  if (item.inventory_type === 12) return ['trinket1', 'trinket2'];
  const mapped = slotFromInventoryType(item.inventory_type);
  if (mapped) return [mapped];
  return slotCandidatesFromWishlistSlot(item.wishlist_slot || '');
}

function groupLabel(item: WishlistItem): string {
  if (item.roadmap_source === 'owned-upgrade') return 'Crest upgrades';
  const instance = item.instance_name || 'Unknown Instance';
  const source = item.source_type || 'Unknown Source';
  return `${instance} - ${source}`;
}

function slotGroupLabel(item: WishlistItem): string {
  const slot = (item.wishlist_slot || '').trim();
  if (slot) {
    return slot
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const first = slotCandidates(item)[0];
  if (!first) return 'Unknown Slot';
  return first
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function iconCandidates(icon: string): string[] {
  const clean = (icon || '').trim().replace(/\.(jpg|jpeg|png|webp)$/i, '');
  if (!clean) return [];
  if (/^https?:\/\//i.test(clean)) return [clean];
  return [
    `https://render.worldofwarcraft.com/icons/56/${clean}.jpg`,
    `https://wow.zamimg.com/images/wow/icons/large/${clean}.jpg`,
    `https://wow.zamimg.com/images/wow/icons/small/${clean}.jpg`,
  ];
}

function WishlistItemIcon({ icon, name }: { icon: string; name: string }) {
  const sources = useMemo(() => iconCandidates(icon), [icon]);
  const [index, setIndex] = useState(0);

  useEffect(() => setIndex(0), [icon]);

  if (sources.length === 0) {
    return (
      <div className="border-border bg-surface flex h-9 w-9 items-center justify-center rounded border text-[10px] text-zinc-500">
        ?
      </div>
    );
  }

  return (
    <img
      src={sources[index]}
      alt={name}
      className="border-border h-9 w-9 rounded border object-cover"
      onError={() => setIndex((previous) => Math.min(previous + 1, sources.length - 1))}
    />
  );
}

async function resolveSimcInputForOwner(opts: {
  selectedOwnerKey: string;
  activeOwnerKey: string;
  activeSimcInput: string;
}): Promise<string> {
  if (opts.selectedOwnerKey === opts.activeOwnerKey && opts.activeSimcInput.trim()) {
    return opts.activeSimcInput.trim();
  }
  const parsed = parseWishlistOwnerKey(opts.selectedOwnerKey);
  if (!parsed.name || !parsed.realm || !parsed.region) return opts.activeSimcInput.trim();
  const profiles = await listCharacterProfiles({
    name: parsed.name,
    realm: parsed.realm,
    region: parsed.region,
  });
  const latest = [...profiles].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return latest?.simc_input?.trim() || opts.activeSimcInput.trim();
}

function useResolvedGear(simcInput: string): {
  resolved: ResolveGearResponse | null;
  loading: boolean;
} {
  const [resolved, setResolved] = useState<ResolveGearResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (simcInput.trim().length < 10) {
      setResolved(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setResolved(null);
    setLoading(true);
    fetchJson<ResolveGearResponse>(`${API_URL}/api/gear/resolve`, {
      method: 'POST',
      body: JSON.stringify({ simc_input: simcInput, max_upgrade: false, catalyst: false }),
    })
      .then((result) => {
        if (!cancelled) setResolved(result);
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [simcInput]);

  return { resolved, loading };
}

const STATUS_LABELS: Record<RoadmapStatus, string> = {
  to_obtain: 'To obtain',
  ready_to_upgrade: 'Ready to upgrade',
  complete: 'Complete',
};

function RoadmapItemRow({
  entry,
  status,
  itemInfo,
  instances,
  onComplete,
  onReopen,
  onRemove,
}: {
  entry: WishlistItem;
  status: RoadmapStatusResult;
  itemInfo?: ItemInfo;
  instances: Instance[];
  onComplete: () => void;
  onReopen: () => void;
  onRemove: () => void;
}) {
  const router = useRouter();
  const itemName = itemInfo?.name || entry.name;
  const itemIcon = itemInfo?.icon || entry.icon;
  const itemIlvl = getWishlistItemLevel(entry);
  const itemBonusIds =
    entry.bonus_ids || (entry.wishlist_bonus_id ? [entry.wishlist_bonus_id] : undefined);
  const wowheadExtra = getWowheadData(itemBonusIds, itemIlvl);
  const sourceTags =
    entry.roadmap_source === 'owned-upgrade'
      ? []
      : buildSourceTagLinks(
          { ...entry, encounter: entry.encounter || 'Unknown Encounter' },
          instances
        );
  const qualityColor = itemInfo ? QUALITY_COLORS[itemInfo.quality] || '#fff' : '#fff';

  return (
    <div className="border-border bg-surface-2 flex items-start gap-3 rounded border px-3 py-2.5">
      {status.status === 'complete' ? (
        <button
          type="button"
          onClick={entry.roadmap_completed ? onReopen : undefined}
          aria-label={entry.roadmap_completed ? `Reopen ${itemName}` : `${itemName} is complete`}
          className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
            entry.roadmap_completed
              ? 'border-emerald-400/60 bg-emerald-400/80 text-black'
              : 'border-emerald-400/40 text-emerald-300'
          }`}
        >
          {entry.roadmap_completed ? (
            <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
          ) : (
            <span className="text-[10px]">✓</span>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={onComplete}
          aria-label={`Mark ${itemName} complete`}
          className="mt-1 h-5 w-5 shrink-0 rounded border border-zinc-600 text-transparent transition-colors hover:border-emerald-400/60 hover:text-emerald-300"
        >
          <Check className="mx-auto h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}

      <WishlistItemIcon icon={itemIcon} name={itemName} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`https://www.wowhead.com/item=${entry.item_id}`}
            data-wowhead={`item=${entry.item_id}${wowheadExtra ? `&${wowheadExtra}` : ''}`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-gold truncate text-sm font-medium"
            style={{ color: qualityColor }}
          >
            {itemName}
          </a>
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
              status.status === 'complete'
                ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                : status.status === 'ready_to_upgrade'
                  ? 'border-gold/40 bg-gold/10 text-gold'
                  : 'border-amber-400/40 bg-amber-500/10 text-amber-200'
            }`}
          >
            {STATUS_LABELS[status.status]}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-zinc-500">
          {itemIlvl ? (
            <span>
              {entry.roadmap_source === 'owned-upgrade' && status.ownedItem
                ? `${status.ownedItem.ilevel} → ${itemIlvl} ilvl`
                : `${itemIlvl} ilvl`}
            </span>
          ) : null}
          {entry.roadmap_source === 'owned-upgrade' ? (
            <Link
              href="/upgrade-compare"
              className="border-gold/35 bg-gold/10 text-gold hover:bg-gold/20 rounded border px-1.5 py-0.5 font-semibold"
            >
              Crest upgrade
            </Link>
          ) : (
            sourceTags.map((tag, index) => (
              <button
                type="button"
                key={`${entry.roadmap_id}:src:${index}`}
                onClick={() => router.push(tag.path)}
                className="rounded border border-amber-400/45 bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-200 hover:bg-amber-500/20"
              >
                {tag.text}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {entry.roadmap_completed ? (
          <button
            type="button"
            onClick={onReopen}
            className="border-border inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Reopen
          </button>
        ) : null}
        <button
          type="button"
          onClick={onRemove}
          className="rounded border border-red-500/20 px-2 py-1 text-xs text-red-300 hover:bg-red-500/15"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function buildSourceTagLinks(
  item: WishlistItem,
  instances: Instance[]
): { text: string; path: string }[] {
  const tags: { text: string; path: string }[] = [];
  const instance = instances.find(
    (value) => value.name.toLowerCase() === (item.instance_name || '').toLowerCase()
  );
  if (instance) tags.push({ text: instance.name, path: `/drop-finder?instance=${instance.id}` });
  if (item.encounter) {
    tags.push({
      text: item.encounter,
      path: `/drop-finder?encounter=${encodeURIComponent(item.encounter)}`,
    });
  }
  return tags;
}

export default function WishlistPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { simcInput, setSimcInput } = useSimContext();
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [owners, setOwners] = useState<WishlistOwnerSummary[]>([]);
  const [bnetCharacters, setBnetCharacters] = useState<BnetCharacter[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [groupBy, setGroupBy] = useState<'instance' | 'slot'>('instance');
  const [preparingTopGear, setPreparingTopGear] = useState(false);
  const [error, setError] = useState('');

  const characterInfo = useMemo(() => parseCharacterInfo(simcInput), [simcInput]);
  const activeCharacterOwnerKey = useMemo(() => {
    if (characterInfo?.kind === 'character') {
      return buildWishlistOwnerKey({
        name: characterInfo.name,
        realm: characterInfo.server,
        region: characterInfo.region,
        className: characterInfo.className,
      });
    }
    return buildWishlistOwnerKey({});
  }, [characterInfo]);

  const requestedOwnerKey = (searchParams.get('owner') || '').trim().toLowerCase();
  const [selectedOwnerKey, setSelectedOwnerKey] = useState(activeCharacterOwnerKey);
  useEffect(() => {
    setSelectedOwnerKey(requestedOwnerKey || activeCharacterOwnerKey);
  }, [activeCharacterOwnerKey, requestedOwnerKey]);

  const selectedOwnerSummary = useMemo(
    () => owners.find((owner) => owner.key === selectedOwnerKey) || null,
    [owners, selectedOwnerKey]
  );
  const canGenerateForSelectedOwner =
    selectedOwnerKey === activeCharacterOwnerKey || !!selectedOwnerSummary?.name;
  const hasSimSource = !!simcInput.trim() || !!selectedOwnerSummary?.name;
  const activeSimcInput = selectedOwnerKey === activeCharacterOwnerKey ? simcInput : '';
  const { resolved, loading: resolvedLoading } = useResolvedGear(activeSimcInput);

  const itemQueries = useMemo(
    () =>
      wishlist.map((item) => ({
        item_id: item.item_id,
        bonus_ids: item.bonus_ids || (item.wishlist_bonus_id ? [item.wishlist_bonus_id] : []),
      })),
    [wishlist]
  );
  const itemInfoMap = useItemInfo(itemQueries);
  useWowheadTooltips([itemInfoMap]);

  const refreshWishlist = useCallback(() => {
    setOwners(listWishlistOwners());
    setWishlist(loadWishlist(selectedOwnerKey));
  }, [selectedOwnerKey]);

  useEffect(() => {
    refreshWishlist();
    const onStorage = (event: StorageEvent) => {
      if (event.key === WISHLIST_STORAGE_KEY) refreshWishlist();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refreshWishlist]);

  useEffect(() => setWishlist(loadWishlist(selectedOwnerKey)), [selectedOwnerKey]);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ characters?: BnetCharacter[] } | BnetCharacter[]>(
      `${API_URL}/api/bnet/user/characters`
    )
      .then((response) => {
        if (cancelled) return;
        const list = Array.isArray(response) ? response : response?.characters || [];
        setBnetCharacters(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setBnetCharacters([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchJson<Instance[]>(`${API_URL}/api/instances`)
      .then((response) => {
        if (!cancelled) setInstances(Array.isArray(response) ? response : []);
      })
      .catch(() => {
        if (!cancelled) setInstances([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectorOwners = useMemo(() => {
    const byKey = new Map<string, WishlistOwnerSummary>();
    for (const owner of owners) byKey.set(owner.key, owner);
    for (const char of bnetCharacters) {
      const name = (char.name || '').trim();
      const realm = (char.realm || '').trim();
      const region = (char.region || '').trim();
      if (!name || !realm || !region) continue;
      const className =
        (char.className || '').trim() ||
        (char.class || '').trim() ||
        (char.character_class?.name || '').trim();
      const key = buildWishlistOwnerKey({ name, realm, region, className });
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          count: loadWishlist(key).length,
          name,
          realm,
          region,
          className: className || undefined,
          label: name,
        });
      }
    }
    if (!byKey.has(activeCharacterOwnerKey)) {
      byKey.set(activeCharacterOwnerKey, {
        key: activeCharacterOwnerKey,
        label: characterInfo?.kind === 'character' ? characterInfo.name : 'Active character',
        count: loadWishlist(activeCharacterOwnerKey).length,
      });
    }
    if (selectedOwnerKey && !byKey.has(selectedOwnerKey)) {
      const parsed = parseWishlistOwnerKey(selectedOwnerKey);
      byKey.set(selectedOwnerKey, {
        key: selectedOwnerKey,
        label: parsed.name || 'Selected character',
        count: loadWishlist(selectedOwnerKey).length,
        name: parsed.name || undefined,
        realm: parsed.realm || undefined,
        region: parsed.region || undefined,
      });
    }
    return [...byKey.values()].sort((a, b) => {
      const aIsGlobal = a.key === 'global';
      const bIsGlobal = b.key === 'global';
      if (aIsGlobal && !bIsGlobal) return -1;
      if (!aIsGlobal && bIsGlobal) return 1;
      if (a.count !== b.count) return b.count - a.count;
      return a.label.localeCompare(b.label);
    });
  }, [activeCharacterOwnerKey, bnetCharacters, characterInfo, owners, selectedOwnerKey]);

  const statusById = useMemo(() => {
    const map = new Map<string, RoadmapStatusResult>();
    for (const entry of wishlist) {
      if (entry.roadmap_id) {
        map.set(entry.roadmap_id, getRoadmapStatus(entry, resolved, []));
      }
    }
    return map;
  }, [resolved, wishlist]);

  const statusEntries = useMemo(
    () =>
      wishlist.map((entry) => ({
        entry,
        status: statusById.get(entry.roadmap_id || '') || { status: 'to_obtain' as const },
      })),
    [statusById, wishlist]
  );
  const toObtainEntries = statusEntries.filter(({ status }) => status.status === 'to_obtain');
  const readyEntries = statusEntries.filter(({ status }) => status.status === 'ready_to_upgrade');
  const completeEntries = statusEntries.filter(({ status }) => status.status === 'complete');
  const dropEntries = wishlist.filter((entry) => entry.roadmap_source !== 'owned-upgrade');
  const toObtainDropEntries = toObtainEntries.filter(
    ({ entry }) => entry.roadmap_source !== 'owned-upgrade'
  );

  const buildTopGearRestoreState = useCallback(
    async (entries: WishlistItem[]) => {
      const effectiveSimcInput = await resolveSimcInputForOwner({
        selectedOwnerKey,
        activeOwnerKey: activeCharacterOwnerKey,
        activeSimcInput: simcInput,
      });
      if (!effectiveSimcInput || entries.length === 0) return null;

      const resolvedGear = await fetchJson<ResolveGearResponse>(`${API_URL}/api/gear/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          simc_input: effectiveSimcInput,
          max_upgrade: false,
          catalyst: false,
        }),
      });
      const selectedItems: SelectedItemsMap = {};
      const nextResolved: ResolveGearResponse = {
        ...resolvedGear,
        slots: Object.fromEntries(
          Object.entries(resolvedGear.slots).map(([slot, slotResult]) => [
            slot,
            {
              ...slotResult,
              equipped: slotResult.equipped ? { ...slotResult.equipped } : null,
              alternatives: [...slotResult.alternatives],
            },
          ])
        ),
      };

      for (const wish of entries) {
        const slots = slotCandidates(wish).filter((slot) => !!nextResolved.slots[slot]);
        if (slots.length === 0) continue;
        const bonusIds = Array.isArray(wish.bonus_ids) ? wish.bonus_ids : [];
        const finalBonusIds =
          bonusIds.length > 0 ? bonusIds : wish.wishlist_bonus_id ? [wish.wishlist_bonus_id] : [];
        const itemLevel = getWishlistItemLevel(wish);
        const simcString =
          finalBonusIds.length > 0
            ? `,id=${wish.item_id},bonus_id=${finalBonusIds.join('/')},ilevel=${itemLevel}`
            : `,id=${wish.item_id},ilevel=${itemLevel}`;

        for (const slot of slots) {
          const uid = makeUid(wish.item_id, finalBonusIds, 'bags', slot);
          const slotResult = nextResolved.slots[slot];
          const exists =
            slotResult?.equipped?.uid === uid ||
            slotResult?.alternatives?.some((item) => item.uid === uid);
          if (!exists) {
            const itemInfo = itemInfoMap[wish.item_id];
            const quality = typeof itemInfo?.quality === 'number' ? itemInfo.quality : wish.quality;
            const qualityColor =
              QUALITY_COLORS[quality] ||
              (quality >= 5
                ? '#ff8000'
                : quality === 4
                  ? '#a335ee'
                  : quality === 3
                    ? '#0070dd'
                    : '#1eff00');
            const newItem: ResolvedItem = {
              uid,
              slot,
              item_id: wish.item_id,
              ilevel: itemLevel,
              simc_string: simcString,
              origin: 'bags',
              bonus_ids: finalBonusIds,
              enchant_id: 0,
              gem_id: 0,
              name: wish.name,
              icon: itemInfo?.icon || wish.icon || '',
              quality,
              quality_color: qualityColor,
              tag: 'Wishlist',
              upgrade: wish.wishlist_upgrade_label || itemInfo?.upgrade || '',
              sockets: 0,
              enchant_name: '',
              gem_name: '',
              gem_icon: '',
              encounter: wish.encounter,
              instance_name: wish.instance_name,
              source_type: wish.source_type,
              inventory_type: wish.inventory_type,
            };
            slotResult.alternatives.push(newItem);
          }
          if (!selectedItems[slot]) selectedItems[slot] = [];
          if (!selectedItems[slot].includes(uid)) selectedItems[slot].push(uid);
        }
      }

      return {
        simcInput: effectiveSimcInput,
        selectedUids: selectedItems,
        localItems: [],
        maxUpgrade: false,
        copyEnchants: true,
        catalyst: false,
        catalystCharges: null,
        resolved: nextResolved,
      };
    },
    [activeCharacterOwnerKey, itemInfoMap, selectedOwnerKey, simcInput]
  );

  const handleSimulateDrops = useCallback(async () => {
    if (!hasSimSource) {
      setError('Load a SimC export or select a character with a saved profile.');
      return;
    }
    if (!canGenerateForSelectedOwner) {
      setError('Select a character with a saved profile first.');
      return;
    }
    if (toObtainDropEntries.length === 0) {
      setError('There are no items waiting to be obtained.');
      return;
    }

    setPreparingTopGear(true);
    setError('');
    try {
      const state = await buildTopGearRestoreState(toObtainDropEntries.map(({ entry }) => entry));
      if (!state) {
        setError('Could not prepare the drop simulation.');
        return;
      }
      if (state.simcInput) setSimcInput(state.simcInput);
      setSimAgainState('top-gear', state);
      router.push('/top-gear');
    } catch {
      setError('Failed to prepare the drop simulation.');
    } finally {
      setPreparingTopGear(false);
    }
  }, [
    buildTopGearRestoreState,
    canGenerateForSelectedOwner,
    hasSimSource,
    router,
    setSimcInput,
    toObtainDropEntries,
  ]);

  const groupedEntries = useCallback(
    (entries: { entry: WishlistItem; status: RoadmapStatusResult }[]) => {
      const map = new Map<string, { entry: WishlistItem; status: RoadmapStatusResult }[]>();
      for (const item of entries) {
        const key = groupBy === 'slot' ? slotGroupLabel(item.entry) : groupLabel(item.entry);
        const list = map.get(key) || [];
        list.push(item);
        map.set(key, list);
      }
      return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    },
    [groupBy]
  );

  const renderStatusSection = (
    status: RoadmapStatus,
    entries: { entry: WishlistItem; status: RoadmapStatusResult }[]
  ) => {
    if (entries.length === 0) return null;
    return (
      <section key={status} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">{STATUS_LABELS[status]}</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              {status === 'to_obtain'
                ? 'Targets not found in the current export.'
                : status === 'ready_to_upgrade'
                  ? 'Owned upgrade targets to follow; open Crest Upgrades to simulate crests.'
                  : 'Targets already reached or manually completed.'}
            </p>
          </div>
        </div>
        {groupedEntries(entries).map(([group, groupItems]) => (
          <div key={group} className="card space-y-2 p-3">
            {groupBy === 'instance' ? (
              <h4 className="text-xs font-semibold text-zinc-400">{group}</h4>
            ) : null}
            {groupItems.map(({ entry, status: itemStatus }) => (
              <RoadmapItemRow
                key={entry.roadmap_id || `${entry.item_id}:${getWishlistItemLevel(entry)}`}
                entry={entry}
                status={itemStatus}
                itemInfo={itemInfoMap[entry.item_id]}
                instances={instances}
                onComplete={() => {
                  if (entry.roadmap_id) {
                    setRoadmapCompleted(entry.roadmap_id, true, selectedOwnerKey);
                    refreshWishlist();
                  }
                }}
                onReopen={() => {
                  if (entry.roadmap_id) {
                    setRoadmapCompleted(entry.roadmap_id, false, selectedOwnerKey);
                    refreshWishlist();
                  }
                }}
                onRemove={() => {
                  if (entry.roadmap_id) {
                    removeRoadmapEntry(entry.roadmap_id, selectedOwnerKey);
                  } else {
                    removeFromWishlist(
                      entry.item_id,
                      selectedOwnerKey,
                      getWishlistItemLevel(entry)
                    );
                  }
                  refreshWishlist();
                }}
              />
            ))}
          </div>
        ))}
      </section>
    );
  };

  const statusDataReady = activeSimcInput.trim().length >= 10 && !resolvedLoading;
  const counts = statusDataReady
    ? `${toObtainEntries.length} to obtain · ${readyEntries.length} ready to upgrade · ${completeEntries.length} complete`
    : `${wishlist.length} saved roadmap item${wishlist.length === 1 ? '' : 's'}`;

  return (
    <div className="mobile-page-bottom space-y-6 pb-28">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Gear Roadmap</h2>
          <p className="text-sm text-zinc-400">{counts}</p>
          <p className="mt-1 text-xs text-zinc-500">
            Follow saved drops and owned upgrades here; use{' '}
            <Link href="/upgrade-compare" className="hover:text-gold text-zinc-300 underline">
              Crest Upgrades
            </Link>{' '}
            when you are ready to sim crest spending.
          </p>
          {selectedOwnerKey !== activeCharacterOwnerKey ? (
            <p className="mt-1 text-xs text-amber-200/80">
              Load this character&apos;s SimC export to refresh automatic status.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label
            className="text-xs tracking-wider text-zinc-500 uppercase"
            htmlFor="roadmap-character"
          >
            Character
          </label>
          <select
            id="roadmap-character"
            value={selectedOwnerKey}
            onChange={(event) => setSelectedOwnerKey(event.target.value)}
            className="border-border bg-surface-2 rounded border px-2 py-1.5 text-xs text-zinc-100"
          >
            {selectorOwners.map((owner) => (
              <option key={owner.key} value={owner.key}>
                {owner.label} ({owner.count})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              clearDropWishlist(selectedOwnerKey);
              refreshWishlist();
            }}
            className="rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20"
            disabled={dropEntries.length === 0}
          >
            Clear drops
          </button>
          <button
            type="button"
            onClick={() => void handleSimulateDrops()}
            disabled={
              preparingTopGear ||
              toObtainDropEntries.length === 0 ||
              !hasSimSource ||
              !canGenerateForSelectedOwner
            }
            className="bg-gold/20 text-gold hover:bg-gold/30 rounded px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {preparingTopGear ? 'Preparing Top Gear...' : 'Simulate drops'}
          </button>
        </div>
      </div>

      <ErrorAlert message={error} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs tracking-wider text-zinc-500 uppercase">Group By</span>
          <div className="border-border bg-surface-2 inline-flex rounded border p-0.5">
            {(['instance', 'slot'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setGroupBy(mode)}
                className={`rounded px-2 py-1 text-xs transition ${
                  groupBy === mode
                    ? 'bg-gold/20 text-gold'
                    : 'hover:bg-surface-3 text-zinc-300 hover:text-zinc-100'
                }`}
              >
                {mode === 'instance' ? 'By Instance' : 'By Slot'}
              </button>
            ))}
          </div>
        </div>
        <Link href="/drop-finder" className="hover:text-gold text-xs text-zinc-400 underline">
          Find more gear in Drop Finder
        </Link>
      </div>

      {wishlist.length === 0 ? (
        <div className="card p-8 text-center text-sm text-zinc-500">
          No roadmap entries yet. Save target drops from Drop Finder or owned upgrades from Crest
          Upgrades.
        </div>
      ) : (
        <div className="space-y-6">
          {renderStatusSection('to_obtain', toObtainEntries)}
          {renderStatusSection('ready_to_upgrade', readyEntries)}
          {renderStatusSection('complete', completeEntries)}
        </div>
      )}
    </div>
  );
}

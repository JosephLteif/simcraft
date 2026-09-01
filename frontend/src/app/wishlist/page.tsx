'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import { useSimContext } from '../components/SimContext';
import { API_URL, fetchJson, listCharacterProfiles } from '../lib/api';
import {
  buildGearItemUid,
  slotCandidatesFromWishlistSlot,
  slotFromInventoryType,
} from '../lib/gear-utils';
import { getWowheadData, QUALITY_COLORS, useItemInfo } from '../lib/useItemInfo';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import type { ResolveGearResponse, ResolvedItem } from '../lib/types';
import { setSimAgainState } from '../lib/sim-return';
import { parseCharacterInfo } from '../../lib/simc-parser';
import type { Instance } from '../drop-finder/types';
import { buildSourceTagLinks } from '../lib/source-navigation';
import {
  WISHLIST_STORAGE_KEY,
  buildWishlistOwnerKey,
  clearWishlist,
  listWishlistOwners,
  loadWishlist,
  parseWishlistOwnerKey,
  removeFromWishlist,
  type WishlistOwnerSummary,
  type WishlistItem,
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

  useEffect(() => {
    setIndex(0);
  }, [icon]);

  if (sources.length === 0) {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded border border-border bg-surface text-[10px] text-zinc-500">
        ?
      </div>
    );
  }

  return (
    <img
      src={sources[index]}
      alt={name}
      className="h-8 w-8 rounded border border-border object-cover"
      onError={() => {
        setIndex((prev) => (prev + 1 < sources.length ? prev + 1 : prev));
      }}
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
  if (!parsed.name || !parsed.realm || !parsed.region) {
    return opts.activeSimcInput.trim();
  }

  const profiles = await listCharacterProfiles({
    name: parsed.name,
    realm: parsed.realm,
    region: parsed.region,
  });
  const latest = [...profiles].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return latest?.simc_input?.trim() || opts.activeSimcInput.trim();
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

  const [selectedOwnerKey, setSelectedOwnerKey] = useState(activeCharacterOwnerKey);
  const requestedOwnerKey = (searchParams.get('owner') || '').trim().toLowerCase();

  useEffect(() => {
    setSelectedOwnerKey(requestedOwnerKey || activeCharacterOwnerKey);
  }, [requestedOwnerKey, activeCharacterOwnerKey]);

  const selectedOwnerSummary = useMemo(
    () => owners.find((owner) => owner.key === selectedOwnerKey) || null,
    [owners, selectedOwnerKey]
  );

  const canGenerateForSelectedOwner =
    selectedOwnerKey === activeCharacterOwnerKey || !!selectedOwnerSummary?.name;
  const hasSimSource = !!simcInput.trim() || !!selectedOwnerSummary?.name;

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
    const latestOwners = listWishlistOwners();
    setOwners(latestOwners);
    setWishlist(loadWishlist(selectedOwnerKey));
  }, [selectedOwnerKey]);

  useEffect(() => {
    refreshWishlist();
    const onStorage = (e: StorageEvent) => {
      if (e.key === WISHLIST_STORAGE_KEY) refreshWishlist();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refreshWishlist]);

  useEffect(() => {
    setWishlist(loadWishlist(selectedOwnerKey));
  }, [selectedOwnerKey]);

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
        if (cancelled) return;
        setBnetCharacters([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchJson<Instance[]>(`${API_URL}/api/instances`)
      .then((response) => {
        if (cancelled) return;
        setInstances(Array.isArray(response) ? response : []);
      })
      .catch(() => {
        if (cancelled) return;
        setInstances([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectorOwners = useMemo(() => {
    const byKey = new Map<string, WishlistOwnerSummary>();
    for (const owner of owners) {
      byKey.set(owner.key, owner);
    }

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
      if (byKey.has(key)) continue;
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
  }, [owners, bnetCharacters, activeCharacterOwnerKey, characterInfo, selectedOwnerKey]);

  const grouped = useMemo(() => {
    const map = new Map<string, WishlistItem[]>();
    for (const item of wishlist) {
      const key = groupBy === 'slot' ? slotGroupLabel(item) : groupLabel(item);
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [wishlist, groupBy]);

  const buildTopGearRestoreState = useCallback(async () => {
    const effectiveSimcInput = await resolveSimcInputForOwner({
      selectedOwnerKey,
      activeOwnerKey: activeCharacterOwnerKey,
      activeSimcInput: simcInput,
    });
    if (!effectiveSimcInput) return null;
    if (wishlist.length === 0) return null;

    const resolved = await fetchJson<ResolveGearResponse>(`${API_URL}/api/gear/resolve`, {
      method: 'POST',
      body: JSON.stringify({ simc_input: effectiveSimcInput, max_upgrade: false, catalyst: false }),
    });

    const selectedItems: SelectedItemsMap = {};
    const nextResolved: ResolveGearResponse = {
      ...resolved,
      slots: Object.fromEntries(
        Object.entries(resolved.slots).map(([slot, slotRes]) => [
          slot,
          {
            ...slotRes,
            equipped: slotRes.equipped ? { ...slotRes.equipped } : null,
            alternatives: [...slotRes.alternatives],
          },
        ])
      ),
    };

    for (const wish of wishlist) {
      const slots = slotCandidates(wish).filter((slot) => !!nextResolved.slots[slot]);
      if (slots.length === 0) continue;
      const bonusIds = Array.isArray(wish.bonus_ids) ? wish.bonus_ids : [];
      const finalBonusIds =
        bonusIds.length > 0 ? bonusIds : wish.wishlist_bonus_id ? [wish.wishlist_bonus_id] : [];
      const simcString =
        finalBonusIds.length > 0
          ? `,id=${wish.item_id},bonus_id=${finalBonusIds.join('/')},ilevel=${wish.wishlist_ilvl || wish.ilevel}`
          : `,id=${wish.item_id},ilevel=${wish.wishlist_ilvl || wish.ilevel}`;

      for (const slot of slots) {
        const uid = makeUid(wish.item_id, finalBonusIds, 'bags', slot);
        const slotRes = nextResolved.slots[slot];
        const exists =
          slotRes?.equipped?.uid === uid || slotRes?.alternatives?.some((item) => item.uid === uid);
        if (!exists) {
          const itemInfo = itemInfoMap[wish.item_id];
          const resolvedIcon = itemInfoMap[wish.item_id]?.icon || wish.icon || '';
          const resolvedQuality =
            typeof itemInfo?.quality === 'number' ? itemInfo.quality : wish.quality;
          const resolvedQualityColor =
            QUALITY_COLORS[resolvedQuality] ||
            (resolvedQuality >= 5
              ? '#ff8000'
              : resolvedQuality === 4
                ? '#a335ee'
                : resolvedQuality === 3
                  ? '#0070dd'
                  : '#1eff00');
          const resolvedUpgrade = wish.wishlist_upgrade_label || itemInfo?.upgrade || '';
          const newItem: ResolvedItem = {
            uid,
            slot,
            item_id: wish.item_id,
            ilevel: wish.wishlist_ilvl || wish.ilevel,
            simc_string: simcString,
            origin: 'bags',
            bonus_ids: finalBonusIds,
            enchant_id: 0,
            gem_id: 0,
            name: wish.name,
            icon: resolvedIcon,
            quality: resolvedQuality,
            quality_color: resolvedQualityColor,
            tag: 'Wishlist',
            upgrade: resolvedUpgrade,
            sockets: 0,
            enchant_name: '',
            gem_name: '',
            gem_icon: '',
            encounter: wish.encounter,
            instance_name: wish.instance_name,
            source_type: wish.source_type,
            inventory_type: wish.inventory_type,
          };
          slotRes.alternatives.push(newItem);
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
  }, [selectedOwnerKey, activeCharacterOwnerKey, simcInput, wishlist, itemInfoMap]);

  const handleGenerateWishlistSim = useCallback(async () => {
    if (!simcInput.trim() && !selectedOwnerSummary?.name) {
      setError('Load a SimC export or pick a saved character wishlist.');
      return;
    }
    if (!canGenerateForSelectedOwner) {
      setError('Switch to the active character in Wishlist to prepare this in Top Gear.');
      return;
    }
    if (wishlist.length === 0) {
      setError('Your wishlist is empty.');
      return;
    }

    setPreparingTopGear(true);
    setError('');
    try {
      const state = await buildTopGearRestoreState();
      if (!state) {
        setError('Could not prepare Top Gear state from this wishlist.');
        return;
      }
      if (typeof state.simcInput === 'string' && state.simcInput.trim().length > 0) {
        setSimcInput(state.simcInput);
      }
      setSimAgainState('top-gear', state);
      router.push('/top-gear');
    } catch {
      setError('Failed to prepare Top Gear with wishlist items.');
    } finally {
      setPreparingTopGear(false);
    }
  }, [
    simcInput,
    selectedOwnerSummary,
    canGenerateForSelectedOwner,
    wishlist.length,
    buildTopGearRestoreState,
    setSimcInput,
    router,
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Wishlist</h2>
          <p className="text-sm text-zinc-400">{wishlist.length} saved item(s)</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <label className="text-xs uppercase tracking-wider text-zinc-500">Character</label>
            <select
              value={selectedOwnerKey}
              onChange={(e) => setSelectedOwnerKey(e.target.value)}
              className="rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-zinc-100"
            >
              {selectorOwners.map((owner) => (
                <option key={owner.key} value={owner.key}>
                  {owner.label} ({owner.count})
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => {
              clearWishlist(selectedOwnerKey);
              refreshWishlist();
            }}
            className="rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20"
            disabled={wishlist.length === 0}
          >
            Clear All
          </button>
          <Link
            href="/upgrade-compare"
            className="rounded border border-border px-3 py-1.5 text-xs text-zinc-300 hover:border-gold/40 hover:bg-gold/10 hover:text-gold"
          >
            Open Upgrade Planner
          </Link>
          <button
            onClick={() => void handleGenerateWishlistSim()}
            disabled={
              preparingTopGear ||
              wishlist.length === 0 ||
              !hasSimSource ||
              !canGenerateForSelectedOwner
            }
            className="rounded bg-gold/20 px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/30 disabled:opacity-50"
            title={
              !hasSimSource
                ? 'Load a SimC export or select a character wishlist with a saved profile'
                : !canGenerateForSelectedOwner
                  ? 'Select the active character wishlist to generate this sim'
                  : undefined
            }
          >
            {preparingTopGear ? 'Preparing Top Gear...' : 'Generate Wishlist Sim'}
          </button>
        </div>
      </div>

      <ErrorAlert message={error} />

      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-zinc-500">Group By</span>
        <div className="inline-flex rounded border border-border bg-surface-2 p-0.5">
          <button
            type="button"
            onClick={() => setGroupBy('instance')}
            className={`rounded px-2 py-1 text-xs transition ${
              groupBy === 'instance'
                ? 'bg-gold/20 text-gold'
                : 'text-zinc-300 hover:bg-surface-3 hover:text-zinc-100'
            }`}
          >
            By Instance
          </button>
          <button
            type="button"
            onClick={() => setGroupBy('slot')}
            className={`rounded px-2 py-1 text-xs transition ${
              groupBy === 'slot'
                ? 'bg-gold/20 text-gold'
                : 'text-zinc-300 hover:bg-surface-3 hover:text-zinc-100'
            }`}
          >
            By Slot
          </button>
        </div>
      </div>

      {wishlist.length === 0 ? (
        <div className="card p-8 text-center text-sm text-zinc-500">
          No wishlist items yet. Add items from Drop Finder.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([group, items]) => (
            <div key={group} className="card p-4">
              <h3 className="mb-3 text-sm font-semibold text-zinc-200">{group}</h3>
              <div className="space-y-2">
                {items.map((item) => {
                  const itemName = itemInfoMap[item.item_id]?.name || item.name;
                  const itemIcon = itemInfoMap[item.item_id]?.icon || item.icon;
                  const itemIlvl = item.wishlist_ilvl || item.ilevel;
                  const itemBonusIds =
                    item.bonus_ids ||
                    (item.wishlist_bonus_id ? [item.wishlist_bonus_id] : undefined);
                  const wowheadExtra = getWowheadData(itemBonusIds, itemIlvl);
                  const sourceTags = buildSourceTagLinks(
                    { ...item, encounter: item.encounter || 'Unknown Encounter' },
                    instances
                  );

                  return (
                    <div
                      key={`${item.item_id}:${itemIlvl || 0}`}
                      className="flex items-center justify-between rounded border border-border bg-surface-2 px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <WishlistItemIcon icon={itemIcon} name={itemName} />
                        <div className="min-w-0">
                          <a
                            href={`https://www.wowhead.com/item=${item.item_id}`}
                            data-wowhead={`item=${item.item_id}${wowheadExtra ? `&${wowheadExtra}` : ''}`}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate text-sm font-medium text-zinc-100 hover:text-gold"
                          >
                            {itemName}
                          </a>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {itemIlvl ? (
                              <span className="inline-flex shrink-0 items-center rounded border border-emerald-400/45 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold leading-none text-emerald-200">
                                {itemIlvl} ilvl
                              </span>
                            ) : null}
                            {sourceTags.map((tag, index) => (
                              <button
                                type="button"
                                key={`${item.item_id}:${itemIlvl || 0}:src:${index}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  router.push(tag.path);
                                }}
                                className="inline-flex shrink-0 items-center rounded border border-amber-400/45 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold leading-none text-amber-200 transition-colors hover:bg-amber-500/20"
                              >
                                {tag.text}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          removeFromWishlist(item.item_id, selectedOwnerKey, itemIlvl);
                          refreshWishlist();
                        }}
                        className="rounded border border-red-500/20 px-2 py-1 text-xs text-red-300 hover:bg-red-500/15"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

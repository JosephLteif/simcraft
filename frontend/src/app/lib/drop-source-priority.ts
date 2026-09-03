import type { Instance } from '../drop-finder/types';
import type { ResultItem, TopGearResult } from './types';

export type DropSourceKind = 'raid' | 'dungeon';

export interface DropSourcePriority {
  key: string;
  kind: DropSourceKind;
  name: string;
  itemCount: number;
  upgradeCount: number;
  bestDelta: number;
  bestItemName: string;
}

function normalize(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function sourceInstanceFor(item: ResultItem, sourceInstances: Instance[]): Instance | undefined {
  const instanceId = Number(item.instance_id || 0);
  if (instanceId > 0) {
    const byId = sourceInstances.find((instance) => instance.id === instanceId);
    if (byId) return byId;
  }

  const instanceName = normalize(item.instance_name);
  return instanceName
    ? sourceInstances.find((instance) => normalize(instance.name) === instanceName)
    : undefined;
}

function sourceKindFor(item: ResultItem, sourceInstances: Instance[]): DropSourceKind | null {
  const sourceType = normalize(item.source_type);
  if (sourceType.includes('raid')) return 'raid';
  if (sourceType.includes('dungeon') || sourceType.includes('mythic')) return 'dungeon';

  const instanceType = normalize(sourceInstanceFor(item, sourceInstances)?.type);
  if (instanceType.includes('raid')) return 'raid';
  if (instanceType.includes('dungeon') || instanceType.includes('mythic')) return 'dungeon';
  return null;
}

function sourceNameFor(item: ResultItem, kind: DropSourceKind): string {
  const name = kind === 'raid' ? item.encounter : item.instance_name;
  return String(name || (kind === 'raid' ? item.instance_name : item.encounter) || '').trim();
}

function sourceKeyFor(item: ResultItem, kind: DropSourceKind, name: string): string {
  const encounterId = Number(item.encounter_id || 0);
  const instanceId = Number(item.instance_id || 0);
  const stableId =
    kind === 'raid'
      ? encounterId > 0
        ? `${encounterId}:${instanceId > 0 ? instanceId : normalize(item.instance_name)}`
        : normalize(name)
      : instanceId > 0
        ? String(instanceId)
        : normalize(name);
  return `${kind}:${stableId}`;
}

function itemKeyFor(item: ResultItem): string {
  return `${Number(item.item_id)}:${normalize(item.slot)}`;
}

export function getDropSourceKey(
  item: ResultItem,
  sourceInstances: Instance[] = []
): string | null {
  const itemId = Number(item.item_id);
  if (item.is_kept || !Number.isFinite(itemId) || itemId <= 0) return null;

  const kind = sourceKindFor(item, sourceInstances);
  if (!kind) return null;
  const name = sourceNameFor(item, kind);
  return name ? sourceKeyFor(item, kind, name) : null;
}

export function filterResultsByDropSource(
  results: TopGearResult[],
  sourceKey: string,
  sourceInstances: Instance[] = []
): TopGearResult[] {
  return results.filter((result) =>
    result.items.some((item) => getDropSourceKey(item, sourceInstances) === sourceKey)
  );
}

export function buildDropSourcePriorities(
  results: TopGearResult[],
  sourceInstances: Instance[] = []
): DropSourcePriority[] {
  const groups = new Map<
    string,
    {
      kind: DropSourceKind;
      name: string;
      itemKeys: Set<string>;
      upgradeItemKeys: Set<string>;
      bestDelta: number;
      bestItemName: string;
    }
  >();

  for (const result of results) {
    const delta = Number(result.delta);
    const resultDelta = Number.isFinite(delta) ? delta : 0;

    for (const item of result.items) {
      const key = getDropSourceKey(item, sourceInstances);
      if (!key) continue;
      const kind = sourceKindFor(item, sourceInstances);
      if (!kind) continue;
      const name = sourceNameFor(item, kind);
      let group = groups.get(key);
      if (!group) {
        group = {
          kind,
          name,
          itemKeys: new Set<string>(),
          upgradeItemKeys: new Set<string>(),
          bestDelta: Number.NEGATIVE_INFINITY,
          bestItemName: '',
        };
        groups.set(key, group);
      }

      const itemKey = itemKeyFor(item);
      group.itemKeys.add(itemKey);
      if (resultDelta > 0) group.upgradeItemKeys.add(itemKey);
      if (resultDelta > group.bestDelta) {
        group.bestDelta = resultDelta;
        group.bestItemName = String(item.name || '').trim();
      }
    }
  }

  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      kind: group.kind,
      name: group.name,
      itemCount: group.itemKeys.size,
      upgradeCount: group.upgradeItemKeys.size,
      bestDelta: Number.isFinite(group.bestDelta) ? group.bestDelta : 0,
      bestItemName: group.bestItemName,
    }))
    .sort((a, b) => {
      if (b.upgradeCount !== a.upgradeCount) return b.upgradeCount - a.upgradeCount;
      if (b.itemCount !== a.itemCount) return b.itemCount - a.itemCount;
      if (b.bestDelta !== a.bestDelta) return b.bestDelta - a.bestDelta;
      return a.name.localeCompare(b.name);
    });
}

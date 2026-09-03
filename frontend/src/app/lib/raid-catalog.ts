import type { GameContext } from './api';
import type { Instance } from '../drop-finder/types';

function isWorldBosses(instance: Instance): boolean {
  return instance.name.toLocaleLowerCase().includes('world boss');
}

export function getCurrentRaidInstances(
  instances: Instance[],
  context: GameContext | null
): Instance[] {
  const raids = instances.filter((instance) => instance.type === 'raid' && instance.id > 0);
  const poolInstanceId = context?.pools?.raids;
  const pool =
    poolInstanceId == null
      ? undefined
      : instances.find((instance) => instance.id === poolInstanceId);
  const activeEncounterIds = new Set(
    context?.pool_members?.raids ?? pool?.encounters.map((encounter) => encounter.id) ?? []
  );

  if (activeEncounterIds.size > 0) {
    const current = raids.filter(
      (raid) =>
        activeEncounterIds.has(raid.id) ||
        raid.encounters.some((encounter) => activeEncounterIds.has(encounter.id)) ||
        (raid.current_season === true && isWorldBosses(raid))
    );
    if (current.length > 0) return current;
  }

  return raids.filter((raid) => raid.current_season === true);
}

export function getRaidCatalog(
  instances: Instance[],
  context: GameContext | null,
  activeExpansionId: number | null
): Instance[] {
  const currentRaidIds = new Set(
    getCurrentRaidInstances(instances, context).map((raid) => raid.id)
  );

  return instances
    .filter((instance) => instance.type === 'raid' && instance.id > 0)
    .map((raid) =>
      currentRaidIds.has(raid.id) && raid.expansion == null && activeExpansionId != null
        ? { ...raid, expansion: activeExpansionId }
        : raid
    );
}

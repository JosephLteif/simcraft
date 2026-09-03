const SIMULATION_TYPE_ROUTES: Array<{ tokens: string[]; route: string }> = [
  { tokens: ['top_gear'], route: '/top-gear' },
  { tokens: ['droptimizer', 'drop_finder'], route: '/drop-finder' },
  { tokens: ['trinket_tier_heatmap'], route: '/upgrade/trinkets' },
  { tokens: ['consumable_matrix'], route: '/analysis/consumable-matrix' },
  { tokens: ['stat_plot'], route: '/analysis/stat-plot' },
  { tokens: ['stat_weights'], route: '/analysis/quick-weights' },
  { tokens: ['upgrade_compare'], route: '/upgrade-compare' },
  { tokens: ['upgrade'], route: '/upgrade-compare' },
];

export function simulationTypeRoute(simType?: string | null): string {
  const normalized = String(simType || '')
    .toLowerCase()
    .replace(/-/g, '_');
  const match = SIMULATION_TYPE_ROUTES.find(({ tokens }) =>
    tokens.some((token) => normalized.includes(token))
  );

  // External-buff matrix has no standalone launch page; retain the existing
  // analysis landing route so the result remains actionable.
  if (normalized.includes('external_buff_matrix')) return '/stat-weights';
  return match?.route ?? '/quick-sim';
}

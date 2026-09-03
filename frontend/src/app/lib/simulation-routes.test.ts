import { describe, expect, it } from 'vitest';
import { simulationTypeRoute } from './simulation-routes';

describe('simulationTypeRoute', () => {
  it('maps each simulation family to an existing launch surface', () => {
    expect(simulationTypeRoute('upgrade_compare')).toBe('/upgrade-compare');
    expect(simulationTypeRoute('trinket_tier_heatmap')).toBe('/upgrade/trinkets');
    expect(simulationTypeRoute('consumable_matrix')).toBe('/analysis/consumable-matrix');
    expect(simulationTypeRoute('stat_plot')).toBe('/analysis/stat-plot');
    expect(simulationTypeRoute('stat_weights')).toBe('/analysis/quick-weights');
    expect(simulationTypeRoute('top_gear_exact_stats')).toBe('/top-gear');
  });

  it('keeps unknown and external-buff results recoverable', () => {
    expect(simulationTypeRoute('external_buff_matrix')).toBe('/stat-weights');
    expect(simulationTypeRoute('future_simulation')).toBe('/quick-sim');
  });
});

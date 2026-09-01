import { describe, expect, it } from 'vitest';
import {
  buildDpsDistributionSummary,
  calculateMeaningfulDifferenceThreshold,
  classifyDpsDifference,
} from './result-insights';

describe('result insights calculations', () => {
  it('builds estimated percentiles and a confidence interval from sim metadata', () => {
    const summary = buildDpsDistributionSummary(1000, 100, 10_000);

    expect(summary).not.toBeNull();
    expect(summary?.iterations).toBe(10_000);
    expect(summary?.standardError).toBe(1);
    expect(summary?.confidenceInterval?.low).toBeCloseTo(998.04, 2);
    expect(summary?.confidenceInterval?.high).toBeCloseTo(1001.96, 2);
    expect(summary?.percentiles.p50).toBe(1000);
    expect(summary?.percentiles.p95).toBeCloseTo(1164.485, 2);
    expect(summary?.points).toHaveLength(41);
  });

  it('does not invent a confidence interval without enough iterations', () => {
    const summary = buildDpsDistributionSummary(1000, 100, 1);

    expect(summary?.confidenceInterval).toBeNull();
    expect(summary?.iterations).toBeNull();
  });

  it('uses a conservative threshold for comparing two simulated means', () => {
    const threshold = calculateMeaningfulDifferenceThreshold(100, 10_000);

    expect(threshold).toBeCloseTo(2.7719, 3);
    expect(classifyDpsDifference(3, threshold)).toBe('meaningful');
    expect(classifyDpsDifference(-2, threshold)).toBe('within-noise');
    expect(classifyDpsDifference(100, null)).toBe('unknown');
  });
});

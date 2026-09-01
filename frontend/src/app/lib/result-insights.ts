export interface DpsPercentiles {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface DpsDistributionPoint {
  dps: number;
  density: number;
}

export interface DpsDistributionSummary {
  mean: number;
  standardDeviation: number;
  iterations: number | null;
  standardError: number | null;
  confidenceHalfWidth: number | null;
  confidenceInterval: { low: number; high: number } | null;
  percentiles: DpsPercentiles;
  points: DpsDistributionPoint[];
}

export type DpsDifferenceStatus = 'meaningful' | 'within-noise' | 'unknown';

const Z_95 = 1.96;
const NORMAL_QUANTILES: DpsPercentiles = {
  p5: -1.6448536269514722,
  p25: -0.6744897501960817,
  p50: 0,
  p75: 0.6744897501960817,
  p95: 1.6448536269514722,
};

function finiteNumber(value: number | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

export function buildDpsDistributionSummary(
  meanInput: number | undefined,
  standardDeviationInput: number | undefined,
  iterationsInput?: number
): DpsDistributionSummary | null {
  const mean = finiteNumber(meanInput);
  if (mean == null || mean < 0) return null;

  const standardDeviation = Math.max(0, finiteNumber(standardDeviationInput) || 0);
  const rawIterations = finiteNumber(iterationsInput);
  const iterations = rawIterations != null && rawIterations > 1 ? Math.floor(rawIterations) : null;
  const standardError = iterations != null ? standardDeviation / Math.sqrt(iterations) : null;
  const confidenceHalfWidth = standardError != null ? Z_95 * standardError : null;

  const percentiles = {
    p5: mean + NORMAL_QUANTILES.p5 * standardDeviation,
    p25: mean + NORMAL_QUANTILES.p25 * standardDeviation,
    p50: mean,
    p75: mean + NORMAL_QUANTILES.p75 * standardDeviation,
    p95: mean + NORMAL_QUANTILES.p95 * standardDeviation,
  };

  const points: DpsDistributionPoint[] = [];
  if (standardDeviation > 0) {
    for (let index = 0; index <= 40; index += 1) {
      const z = -3 + (index / 40) * 6;
      points.push({
        dps: mean + z * standardDeviation,
        density: Math.exp(-0.5 * z * z),
      });
    }
  }

  return {
    mean,
    standardDeviation,
    iterations,
    standardError,
    confidenceHalfWidth,
    confidenceInterval:
      confidenceHalfWidth != null
        ? { low: mean - confidenceHalfWidth, high: mean + confidenceHalfWidth }
        : null,
    percentiles,
    points,
  };
}

/**
 * Returns the 95% threshold for separating two independent means when both
 * values use the same reported run-to-run standard deviation and iteration count.
 */
export function calculateMeaningfulDifferenceThreshold(
  standardDeviationInput: number | undefined,
  iterationsInput?: number
): number | null {
  const standardDeviation = finiteNumber(standardDeviationInput);
  const iterations = finiteNumber(iterationsInput);
  const iterationCount = iterations != null ? Math.floor(iterations) : 0;
  if (standardDeviation == null || standardDeviation <= 0 || iterationCount < 2) {
    return null;
  }

  return (Z_95 * Math.sqrt(2) * standardDeviation) / Math.sqrt(iterationCount);
}

export function classifyDpsDifference(
  deltaInput: number | undefined,
  threshold: number | null
): DpsDifferenceStatus {
  const delta = finiteNumber(deltaInput);
  if (delta == null || threshold == null) return 'unknown';
  return Math.abs(delta) >= threshold ? 'meaningful' : 'within-noise';
}

'use client';

import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  buildDpsDistributionSummary,
  calculateMeaningfulDifferenceThreshold,
  classifyDpsDifference,
  type DpsDifferenceStatus,
} from '../lib/result-insights';

interface ResultInsightsProps {
  dps: number;
  dpsError?: number;
  iterations?: number;
}

interface MeaningfulDifferenceIndicatorProps {
  delta: number;
  standardDeviation?: number;
  iterations?: number;
  compact?: boolean;
}

function formatDps(value: number, digits = 0): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function statusLabel(status: DpsDifferenceStatus): string {
  if (status === 'meaningful') return 'Meaningful';
  if (status === 'within-noise') return 'Within noise';
  return 'Needs more data';
}

function statusClassName(status: DpsDifferenceStatus): string {
  if (status === 'meaningful') return 'text-emerald-400';
  if (status === 'within-noise') return 'text-amber-300';
  return 'text-muted';
}

export function MeaningfulDifferenceIndicator({
  delta,
  standardDeviation,
  iterations,
  compact = false,
}: MeaningfulDifferenceIndicatorProps) {
  const threshold = calculateMeaningfulDifferenceThreshold(standardDeviation, iterations);
  const status = classifyDpsDifference(delta, threshold);
  const explanation =
    status === 'meaningful'
      ? `The ${Math.abs(delta).toLocaleString(undefined, { maximumFractionDigits: 0 })} DPS difference clears the estimated ${threshold?.toLocaleString(undefined, { maximumFractionDigits: 0 })} DPS noise threshold.`
      : status === 'within-noise'
        ? `The ${Math.abs(delta).toLocaleString(undefined, { maximumFractionDigits: 0 })} DPS difference is smaller than the estimated ${threshold?.toLocaleString(undefined, { maximumFractionDigits: 0 })} DPS noise threshold.`
        : 'Iteration data is not available to judge whether this difference is meaningful.';

  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium ${statusClassName(status)}`}
      data-tooltip={explanation}
      aria-label={`${statusLabel(status)} DPS difference. ${explanation}`}
    >
      <span aria-hidden="true">
        {status === 'meaningful' ? '●' : status === 'within-noise' ? '≈' : '?'}
      </span>
      {compact ? statusLabel(status) : `${statusLabel(status)} difference`}
    </span>
  );
}

function DistributionChart({
  mean,
  standardDeviation,
  p5,
  p95,
  points,
}: {
  mean: number;
  standardDeviation: number;
  p5: number;
  p95: number;
  points: Array<{ dps: number; density: number }>;
}) {
  const chart = useMemo(() => {
    const height = 220;
    const left = 22;
    const right = 618;
    const baseline = 166;
    const top = 34;
    const minDps = mean - 3 * standardDeviation;
    const maxDps = mean + 3 * standardDeviation;
    const scaleX = (value: number) =>
      left + ((value - minDps) / (maxDps - minDps)) * (right - left);
    const scaleY = (density: number) => baseline - density * (baseline - top);
    const path = points
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'} ${scaleX(point.dps).toFixed(2)} ${scaleY(point.density).toFixed(2)}`
      )
      .join(' ');
    const areaPath = `${path} L ${right} ${baseline} L ${left} ${baseline} Z`;

    return {
      height,
      left,
      right,
      baseline,
      meanX: scaleX(mean),
      p5X: scaleX(p5),
      p95X: scaleX(p95),
      path,
      areaPath,
      tickValues: [p5, mean, p95],
      scaleX,
    };
  }, [mean, p5, p95, points, standardDeviation]);

  return (
    <svg
      viewBox={`0 0 640 ${chart.height}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Estimated DPS distribution centered at ${formatDps(mean)} DPS`}
    >
      <title>Estimated DPS distribution</title>
      <desc>
        A normal approximation centered on the reported DPS mean. The shaded band covers the
        estimated 5th to 95th percentiles.
      </desc>
      <rect
        x={chart.p5X}
        y={24}
        width={Math.max(0, chart.p95X - chart.p5X)}
        height={chart.baseline - 24}
        fill="currentColor"
        className="text-sky-400/10"
      />
      <line
        x1={chart.left}
        x2={chart.right}
        y1={chart.baseline}
        y2={chart.baseline}
        stroke="currentColor"
        className="text-border"
      />
      <path d={chart.areaPath} fill="currentColor" className="text-gold/15" />
      <path
        d={chart.path}
        fill="none"
        stroke="currentColor"
        className="text-gold"
        strokeWidth="2.5"
      />
      <line
        x1={chart.meanX}
        x2={chart.meanX}
        y1={26}
        y2={chart.baseline}
        stroke="currentColor"
        className="text-gold"
        strokeDasharray="4 4"
      />
      {chart.tickValues.map((value, index) => {
        const x = chart.scaleX(value);
        const label = index === 1 ? 'Mean' : index === 0 ? 'P5' : 'P95';
        return (
          <g key={label}>
            <line
              x1={x}
              x2={x}
              y1={chart.baseline}
              y2={chart.baseline + 6}
              stroke="currentColor"
              className="text-muted"
            />
            <text
              x={x}
              y={chart.baseline + 22}
              textAnchor="middle"
              fill="currentColor"
              className="text-muted text-[11px]"
            >
              {label} {formatDps(value)}
            </text>
          </g>
        );
      })}
      <text x={chart.left} y={18} fill="currentColor" className="text-muted text-[11px]">
        DPS density
      </text>
    </svg>
  );
}

export default function ResultInsights({ dps, dpsError, iterations }: ResultInsightsProps) {
  const summary = useMemo(
    () => buildDpsDistributionSummary(dps, dpsError, iterations),
    [dps, dpsError, iterations]
  );
  const [open, setOpen] = useState(false);

  if (!summary) return null;

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.03]"
      >
        <div>
          <h3 className="text-muted text-xs font-medium tracking-widest uppercase">
            Result Insights
          </h3>
          <p className="text-muted mt-1 text-sm">
            See the expected run-to-run spread before deciding whether a gain is worth acting on.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-[11px] tracking-wider text-sky-300 uppercase">
            Normal approximation
          </span>
          <ChevronDown
            className={`h-4 w-4 text-zinc-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            strokeWidth={2}
          />
        </div>
      </button>

      {open && (
        <div className="border-border/60 border-t p-5">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(260px,0.8fr)] xl:items-start">
            <div className="min-w-0">
              {summary.points.length > 0 ? (
                <DistributionChart
                  mean={summary.mean}
                  standardDeviation={summary.standardDeviation}
                  p5={summary.percentiles.p5}
                  p95={summary.percentiles.p95}
                  points={summary.points}
                />
              ) : (
                <p className="text-muted py-10 text-center text-sm">
                  This result reported no measurable run-to-run spread.
                </p>
              )}
              <p className="text-muted mt-1 text-[11px]">
                Shaded range: estimated P5-P95. The distribution is reconstructed from the reported
                standard deviation; it is not a raw sample histogram.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-muted mb-2 text-[11px] font-medium tracking-wider uppercase">
                  Estimated percentiles
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 xl:grid-cols-2">
                  {(
                    [
                      ['P5', summary.percentiles.p5],
                      ['P25', summary.percentiles.p25],
                      ['P50', summary.percentiles.p50],
                      ['P75', summary.percentiles.p75],
                      ['P95', summary.percentiles.p95],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-2">
                      <span className="text-muted">{label}</span>
                      <span className="font-mono text-zinc-200 tabular-nums">
                        {formatDps(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-border/60 border-t pt-4">
                <p className="text-muted mb-2 text-[11px] font-medium tracking-wider uppercase">
                  95% confidence interval for the mean
                </p>
                {summary.confidenceInterval ? (
                  <p className="font-mono text-lg text-zinc-100 tabular-nums">
                    {formatDps(summary.confidenceInterval.low)} -{' '}
                    {formatDps(summary.confidenceInterval.high)} DPS
                  </p>
                ) : (
                  <p className="text-muted text-sm">Iteration count is needed to calculate this.</p>
                )}
                <p className="text-muted mt-1 text-[11px]">
                  {summary.iterations != null
                    ? `Based on ${summary.iterations.toLocaleString()} iterations and +/-${formatDps(summary.standardDeviation)} DPS standard deviation.`
                    : `Run-to-run spread: +/-${formatDps(summary.standardDeviation)} DPS.`}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

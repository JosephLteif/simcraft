import { useEffect, useState } from 'react';
import type { ResultItem, TopGearResult } from '../../lib/types';
import type { EnchantInfo, GemInfo, ItemInfo } from '../../lib/useItemInfo';
import type { Instance } from '../../drop-finder/types';

import RankingsHeader from './RankingsHeader';
import ResultRow from './ResultRow';

const PAGE_SIZE = 10;

export interface ResultListProps {
  results: TopGearResult[];
  maxDps: number;
  baseDps: number;
  dpsError?: number;
  iterations?: number;
  equippedGear?: Record<string, ResultItem>;
  baseAvgIlevel: number;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  selectedResultName: string | null;
  onSelectResult: (name: string) => void;
  currencies?: Record<string, { id: number; name: string; icon: string }>;
  dropBaselineIlevelByKey?: Record<string, number>;
  getExactStatsStatus?: (result: TopGearResult) => {
    status: 'idle' | 'loading' | 'ready' | 'error' | 'same_base';
    label?: string;
  };
  onLoadExactStats?: (result: TopGearResult) => void;
  onAddResultToWishlist?: (result: TopGearResult) => void;
  isResultWishlisted?: (result: TopGearResult) => boolean;
  sourceInstances?: Instance[];
  baselineTierBySlot?: Record<string, string>;
  showHeader?: boolean;
  showRanks?: boolean;
  isBestResult?: (result: TopGearResult, index: number) => boolean;
}

export function ResultList({
  results,
  maxDps,
  baseDps,
  dpsError,
  iterations,
  equippedGear,
  baseAvgIlevel,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  selectedResultName,
  onSelectResult,
  currencies,
  dropBaselineIlevelByKey = {},
  getExactStatsStatus,
  onLoadExactStats,
  onAddResultToWishlist,
  isResultWishlisted,
  sourceInstances = [],
  baselineTierBySlot = {},
  showHeader = true,
  showRanks = true,
  isBestResult,
}: ResultListProps) {
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [results]);

  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const visible = results.slice(pageStart, pageStart + PAGE_SIZE);
  const hasPagination = pageCount > 1;
  const formatCount = (count: number) => count.toLocaleString();
  const firstVisible = results.length === 0 ? 0 : pageStart + 1;
  const lastVisible = pageStart + visible.length;

  return (
    <div className="space-y-1">
      {showHeader && <RankingsHeader />}
      {visible.map((result, idx) =>
        (() => {
          const exact = getExactStatsStatus?.(result) || { status: 'idle' as const };
          return (
            <ResultRow
              key={result.name}
              result={result}
              rank={showRanks ? pageStart + idx + 1 : undefined}
              maxDps={maxDps}
              baseDps={baseDps}
              dpsError={dpsError}
              iterations={iterations}
              equippedGear={equippedGear}
              baseAvgIlevel={baseAvgIlevel}
              isBest={
                isBestResult
                  ? isBestResult(result, pageStart + idx)
                  : pageStart + idx === 0 && result.delta > 0
              }
              isSelected={result.name === (selectedResultName || results[0]?.name)}
              onSelect={() => onSelectResult(result.name)}
              itemInfoMap={itemInfoMap}
              enchantInfoMap={enchantInfoMap}
              gemInfoMap={gemInfoMap}
              currencies={currencies}
              dropBaselineIlevelByKey={dropBaselineIlevelByKey}
              exactStatsStatus={exact.status}
              exactStatsLabel={exact.label}
              onLoadExactStats={onLoadExactStats ? () => onLoadExactStats(result) : undefined}
              exactStatsButtonLabel={
                exact.status === 'loading'
                  ? 'Starting...'
                  : exact.status === 'ready' || exact.status === 'error'
                    ? 'Go to Sim'
                    : 'Start Sim'
              }
              exactStatsButtonVariant={
                exact.status === 'ready' || exact.status === 'error' ? 'goto' : 'start'
              }
              exactStatsButtonDisabled={exact.status === 'loading'}
              onAddToWishlist={
                onAddResultToWishlist ? () => onAddResultToWishlist(result) : undefined
              }
              isWishlisted={isResultWishlisted ? isResultWishlisted(result) : false}
              sourceInstances={sourceInstances}
              baselineTierBySlot={baselineTierBySlot}
            />
          );
        })()
      )}
      {hasPagination && (
        <div className="border-border bg-surface-2 mt-2 rounded-lg border p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="px-1 text-xs text-zinc-400">
              Showing {formatCount(firstVisible)}-{formatCount(lastVisible)} of{' '}
              {formatCount(results.length)} results
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                disabled={currentPage === 0}
                className="border-border rounded border px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                disabled={currentPage === pageCount - 1}
                className="border-border rounded border px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
              >
                Next
              </button>
              <span className="flex items-center px-1 text-xs text-zinc-500">
                Page {formatCount(currentPage + 1)} of {formatCount(pageCount)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RankedResults(props: ResultListProps) {
  return <ResultList {...props} />;
}

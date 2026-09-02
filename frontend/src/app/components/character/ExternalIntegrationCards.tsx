import { ExternalLink, RefreshCw } from 'lucide-react';
import type { IntegrationEnvelope, RaiderIoData, WarcraftLogsData } from '../../lib/api';
import { normalizeEncounterName } from '../../lib/warcraft-logs-guides';

export type CharacterIntegrationState<T> = {
  enabled: boolean;
  loading: boolean;
  refreshing: boolean;
  snapshot: IntegrationEnvelope<T> | null;
  error: string | null;
};

type ProviderCardProps<T> = {
  title: string;
  description: string;
  state: CharacterIntegrationState<T> | null;
  onRefresh?: () => void;
  children?: (data: T) => React.ReactNode;
  profileUrl?: (data: T) => string;
};

function ProviderCard<T>({
  title,
  description,
  state,
  onRefresh,
  children,
  profileUrl,
}: ProviderCardProps<T>) {
  if (!state?.enabled) return null;
  const snapshot = state.snapshot;
  const data = snapshot?.status === 'ok' ? snapshot.data : null;
  const isLoading = state.loading && !snapshot;
  const statusText =
    snapshot?.status === 'not_found' ? 'Character not found.' : 'Data unavailable.';

  return (
    <section
      className="card p-5"
      data-testid={`${title.toLowerCase().replace(/[^a-z]+/g, '-')}-card`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold tracking-wider text-zinc-500 uppercase">{title}</h3>
          <p className="mt-1 text-[11px] text-zinc-500">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {state.refreshing && <span className="text-[11px] text-zinc-500">Updating…</span>}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={state.loading || state.refreshing}
              className="rounded border border-white/10 bg-black/20 p-1.5 text-zinc-400 transition-colors hover:text-white disabled:opacity-50"
              aria-label={`Refresh ${title}`}
              title={`Refresh ${title}`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${state.refreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="text-[11px] text-zinc-500" role="status">
          Loading {title}…
        </p>
      ) : data ? (
        <>
          {children?.(data)}
          {profileUrl && (
            <a
              href={profileUrl(data)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold mt-4 inline-flex items-center gap-1 text-[11px] font-semibold hover:underline"
            >
              Open {title} profile <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {state.error && (
            <p className="mt-3 text-[11px] text-amber-300" role="status">
              Refresh failed; showing the last successful snapshot.
            </p>
          )}
        </>
      ) : (
        <p className="text-[11px] text-zinc-500" role="status">
          {state.error || statusText}
        </p>
      )}
    </section>
  );
}

export function RaiderIoMythicPlusDetails({ data }: { data: RaiderIoData }) {
  const ranks = (
    [
      ['World', data.ranks?.world],
      ['Region', data.ranks?.region],
      ['Realm', data.ranks?.realm],
    ] as Array<[string, number | null | undefined]>
  ).filter((entry): entry is [string, number] => entry[1] !== null && entry[1] !== undefined);

  return (
    <div className="space-y-3">
      {ranks.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold text-zinc-400">Overall season rank</p>
          <div className="flex flex-wrap gap-1.5">
            {ranks.map(([label, value]) => (
              <span
                key={label}
                className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-300"
              >
                {label}{' '}
                <span className="font-mono font-semibold text-zinc-100">#{formatRank(value)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {data.best_runs.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-zinc-400">Raider.IO best runs</p>
          {data.best_runs.map((run, index) => (
            <div
              key={`${run.dungeon}-${index}`}
              className="flex items-center justify-between gap-3 rounded border border-white/5 bg-black/20 px-2.5 py-2 text-[11px]"
            >
              <div className="min-w-0">
                {run.url ? (
                  <a
                    href={run.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-gold truncate font-medium text-zinc-200 hover:underline"
                  >
                    {run.dungeon}
                  </a>
                ) : (
                  <p className="truncate font-medium text-zinc-200">{run.dungeon}</p>
                )}
                {formatRaiderIoRunDate(run.completed_at) && (
                  <p className="mt-0.5 text-[10px] text-zinc-500">
                    Completed {formatRaiderIoRunDate(run.completed_at)}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5 font-mono text-[10px]">
                {run.level !== null && (
                  <span className="rounded border border-white/10 px-1.5 py-0.5 text-zinc-300">
                    +{run.level}
                  </span>
                )}
                {run.score !== null && (
                  <span className="border-gold/30 bg-gold/5 text-gold rounded border px-1.5 py-0.5">
                    {Math.round(run.score)} score
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-zinc-500">No current-season best runs found.</p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-600">
        <span>
          Data by{' '}
          <a
            href="https://raider.io"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gold text-zinc-400 hover:underline"
          >
            Raider.IO
          </a>
          .
        </span>
        <a
          href={data.profile_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gold inline-flex items-center gap-1 font-semibold hover:underline"
        >
          Open Raider.IO profile <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

export function RaiderIoRaidAttribution({
  state,
  currentRaidNames,
  onRefresh,
}: {
  state: CharacterIntegrationState<RaiderIoData> | null;
  currentRaidNames?: string[];
  onRefresh?: () => void;
}) {
  if (!state?.enabled) return null;

  const snapshot = state.snapshot;
  const data = snapshot?.status === 'ok' ? snapshot.data : null;
  const isLoading = state.loading && !snapshot;
  const lastScanned = data ? formatRaiderIoRunDate(data.last_crawled_at) : null;
  const currentRaidNameSet = currentRaidNames
    ? new Set(currentRaidNames.map(normalizeEncounterName))
    : null;
  const visibleAchievements = data
    ? currentRaidNameSet
      ? data.raid_achievements.filter((achievement) =>
          currentRaidNameSet.has(normalizeEncounterName(achievement.raid))
        )
      : data.raid_achievements
    : [];
  const status = state.refreshing
    ? 'Updating Raider.IO…'
    : data
      ? state.error
        ? 'Refresh failed; showing the last successful Raider.IO snapshot.'
        : 'Public source and profile link'
      : isLoading
        ? 'Loading Raider.IO source…'
        : snapshot?.status === 'not_found'
          ? 'Character not found on Raider.IO; Blizzard progression remains visible.'
          : 'Raider.IO data unavailable; Blizzard progression remains visible.';

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-zinc-300">Supplemental source: Raider.IO</p>
        <p
          className={`mt-0.5 text-[10px] ${state.error && !state.refreshing ? 'text-amber-300' : 'text-zinc-500'}`}
        >
          {status}
          {lastScanned ? ` · Last scanned ${lastScanned}` : ''}
        </p>
        {data && visibleAchievements.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold text-zinc-500">Achievements</span>
            {visibleAchievements.flatMap((achievement) => {
              const labels = [];
              const raidName = formatRaiderIoRaidName(achievement.raid);
              const aheadOfTheCurveDate = achievement.ahead_of_the_curve_at
                ? formatRaiderIoRunDate(achievement.ahead_of_the_curve_at)
                : null;
              const cuttingEdgeDate = achievement.cutting_edge_at
                ? formatRaiderIoRunDate(achievement.cutting_edge_at)
                : null;
              if (aheadOfTheCurveDate) {
                labels.push(
                  <span
                    key={`${achievement.raid}-aotc`}
                    className="rounded border border-emerald-400/20 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-200"
                  >
                    {raidName} · AOTC · {aheadOfTheCurveDate}
                  </span>
                );
              }
              if (cuttingEdgeDate) {
                labels.push(
                  <span
                    key={`${achievement.raid}-cutting-edge`}
                    className="rounded border border-violet-400/20 bg-violet-400/10 px-1.5 py-0.5 text-[10px] text-violet-200"
                  >
                    {raidName} · Cutting Edge · {cuttingEdgeDate}
                  </span>
                );
              }
              return labels;
            })}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {data && (
          <a
            href={data.profile_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gold inline-flex items-center gap-1 text-[11px] font-semibold hover:underline"
          >
            Open Raider.IO profile <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={state.loading || state.refreshing}
            className="rounded border border-white/10 bg-black/20 p-1.5 text-zinc-400 transition-colors hover:text-white disabled:opacity-50"
            aria-label="Refresh Raider.IO raid source"
            title="Refresh Raider.IO raid source"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${state.refreshing ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>
    </div>
  );
}

export function WarcraftLogsRaidCard({
  warcraftLogs,
  onRefresh,
}: {
  warcraftLogs: CharacterIntegrationState<WarcraftLogsData> | null;
  onRefresh?: () => void;
}) {
  if (!warcraftLogs?.enabled) return null;

  return (
    <div className="grid grid-cols-1 gap-4">
      <ProviderCard
        title="Warcraft Logs"
        description="Recent public reports and latest-zone rankings"
        state={warcraftLogs}
        onRefresh={onRefresh}
        profileUrl={(data) => data.profile_url}
      >
        {(data) => (
          <div className="space-y-3">
            {data.ranking && (
              <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                <RankingStat
                  label="Best parse"
                  value={formatPercentMetric(data.ranking.best_performance_average)}
                />
                <RankingStat
                  label="Median parse"
                  value={formatPercentMetric(data.ranking.median_performance_average)}
                />
                <RankingStat label="All Stars" value={formatMetric(data.ranking.all_stars)} />
                <RankingStat
                  label="Avg ILVL"
                  value={formatMetric(data.ranking.average_item_level)}
                />
              </div>
            )}
            {data.ranking && (
              <p className="text-[11px] text-zinc-400">
                Public Warcraft Logs percentiles for the latest available zone.
              </p>
            )}
            {data.ranking?.zone_name && (
              <p className="text-[11px] font-medium text-zinc-300">
                Latest zone: {data.ranking.zone_name}
              </p>
            )}
            {data.reports.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-zinc-400">Recent public reports</p>
                {data.reports.map((report) => (
                  <a
                    key={report.code}
                    href={report.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:border-gold/30 flex items-center justify-between gap-3 rounded border border-white/5 bg-black/20 px-2.5 py-2 text-[11px] transition-colors"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-zinc-200">
                        {report.title || report.code}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-zinc-400">
                        {report.zone_name || 'Public report'}
                      </span>
                      {formatReportTimes(report) ? (
                        <span className="mt-0.5 block text-[11px] text-zinc-300">
                          {formatReportTimes(report)}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-mono text-zinc-300">{report.code}</span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-zinc-500">No public reports found.</p>
            )}
          </div>
        )}
      </ProviderCard>
    </div>
  );
}

function RankingStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-16 rounded border border-white/15 bg-black/30 px-2.5 py-2">
      <p className="text-[11px] font-semibold tracking-wide text-zinc-300 uppercase">{label}</p>
      <p className="mt-1 font-mono text-base font-bold text-white">{value}</p>
    </div>
  );
}

function formatMetric(value: number | null): string {
  return value === null ? '—' : Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

function formatRank(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatRaiderIoRaidName(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function formatRaiderIoRunDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatPercentMetric(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function formatReportTimes(report: WarcraftLogsData['reports'][number]): string | null {
  const start = formatReportTimestamp(report.start_time);
  const end = formatReportTimestamp(report.end_time);
  if (start && end) return `${start} – ${end}`;
  return start || (end ? `Ended ${end}` : null);
}

function formatReportTimestamp(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  const milliseconds = value < 100_000_000_000 ? value * 1_000 : value;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

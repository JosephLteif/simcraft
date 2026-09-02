import { ExternalLink, RefreshCw } from 'lucide-react';
import type { IntegrationEnvelope, RaiderIoData, WarcraftLogsData } from '../../lib/api';

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

export function RaiderIoMythicPlusCard({
  state,
  onRefresh,
}: {
  state: CharacterIntegrationState<RaiderIoData> | null;
  onRefresh?: () => void;
}) {
  return (
    <ProviderCard
      title="Raider.IO"
      description="Current-season Mythic+ score and best runs"
      state={state}
      onRefresh={onRefresh}
      profileUrl={(data) => data.profile_url}
    >
      {(data) => (
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] text-zinc-500">Current score</p>
              <p className="text-2xl font-black text-white">
                {data.score === null ? '—' : Math.round(data.score).toLocaleString()}
              </p>
            </div>
            <p className="text-right text-[11px] text-zinc-500">
              {data.name} · {data.realm}
            </p>
          </div>
          {data.best_runs.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-zinc-400">Best runs</p>
              {data.best_runs.map((run, index) => (
                <div
                  key={`${run.dungeon}-${index}`}
                  className="flex items-center justify-between gap-3 rounded border border-white/5 bg-black/20 px-2.5 py-2 text-[11px]"
                >
                  <span className="truncate text-zinc-200">{run.dungeon}</span>
                  <span className="shrink-0 font-mono text-zinc-400">
                    {run.level === null ? '—' : `+${run.level}`}
                    {run.score !== null ? ` · ${Math.round(run.score)}` : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500">No current-season best runs found.</p>
          )}
          <p className="text-[10px] text-zinc-600">
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
          </p>
        </div>
      )}
    </ProviderCard>
  );
}

export function RaidIntegrationCards({
  raiderIo,
  warcraftLogs,
  onRefresh,
}: {
  raiderIo: CharacterIntegrationState<RaiderIoData> | null;
  warcraftLogs: CharacterIntegrationState<WarcraftLogsData> | null;
  onRefresh?: () => void;
}) {
  if (!raiderIo?.enabled && !warcraftLogs?.enabled) return null;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ProviderCard
        title="Raider.IO raid progression"
        description="Public progression from the current character profile"
        state={raiderIo}
        onRefresh={onRefresh}
        profileUrl={(data) => data.profile_url}
      >
        {(data) =>
          data.raid_progression.length > 0 ? (
            <div className="space-y-1.5">
              {data.raid_progression.slice(0, 4).map((raid) => (
                <div
                  key={raid.raid}
                  className="flex items-center justify-between gap-3 rounded border border-white/5 bg-black/20 px-2.5 py-2 text-[11px]"
                >
                  <span className="truncate text-zinc-200">{raid.raid}</span>
                  <span className="shrink-0 font-mono text-zinc-400">
                    {raid.summary ||
                      (raid.killed !== null && raid.total !== null
                        ? `${raid.killed}/${raid.total}`
                        : '—')}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500">No raid progression found.</p>
          )
        }
      </ProviderCard>

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
                  value={formatMetric(data.ranking.best_performance_average)}
                />
                <RankingStat
                  label="Median parse"
                  value={formatMetric(data.ranking.median_performance_average)}
                />
                <RankingStat label="All Stars" value={formatMetric(data.ranking.all_stars)} />
                <RankingStat
                  label="Avg ILVL"
                  value={formatMetric(data.ranking.average_item_level)}
                />
              </div>
            )}
            {data.ranking?.zone_name && (
              <p className="text-[10px] text-zinc-500">Latest zone: {data.ranking.zone_name}</p>
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
                      <span className="mt-0.5 block truncate text-[10px] text-zinc-500">
                        {report.zone_name || 'Public report'}
                      </span>
                      {formatReportTimes(report) ? (
                        <span className="mt-0.5 block text-[10px] text-zinc-600">
                          {formatReportTimes(report)}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-zinc-500">{report.code}</span>
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
    <div className="rounded border border-white/5 bg-black/20 px-2 py-1.5">
      <p className="text-zinc-500">{label}</p>
      <p className="mt-0.5 font-mono text-zinc-200">{value}</p>
    </div>
  );
}

function formatMetric(value: number | null): string {
  return value === null ? '—' : Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
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

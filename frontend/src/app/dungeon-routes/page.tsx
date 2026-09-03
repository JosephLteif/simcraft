'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { deleteSavedRoute, listInstances, listSavedRoutes, saveRoute } from '../lib/api';
import { SavedRoute } from '../lib/types';
import { parseCharacterInfo } from '@/lib/simc-parser';
import { convertMdtToSimc, isMdtString, parseMdtString } from '@/lib/mdt-parser';
import { Instance } from '../drop-finder/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSimContext } from '../components/SimContext';
import RouteDetailsModal from '../components/RouteDetailsModal';
import { useDismissOnOutside } from '../lib/useDismissOnOutside';
import { normalizeSourceName } from '../lib/source-navigation';
import { useNotifications } from '../components/shared/NotificationSystem';

export default function DungeonRoutesPage() {
  const router = useRouter();
  const { setSimcFooter } = useSimContext();
  const { notify } = useNotifications();
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [availableInstances, setAvailableInstances] = useState<Instance[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [dungeonFilter, setDungeonFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date' | 'level'>('date');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const addRouteModalRef = useRef<HTMLDivElement | null>(null);
  const [newRoute, setNewRoute] = useState({
    name: '',
    dungeon: '',
    level: '',
    pull_count: '',
    timer_seconds: '',
    affixes: '',
    route_data: '',
  });
  const [parsedMdt, setParsedMdt] = useState<any>(null);
  const [selectedDungeonId, setSelectedDungeonId] = useState<string>('');
  const [customDungeonName, setCustomDungeonName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [viewingRoute, setViewingRoute] = useState<SavedRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingRouteId, setDeletingRouteId] = useState<string | null>(null);
  useDismissOnOutside(addRouteModalRef, isModalOpen, () => setIsModalOpen(false));

  const formatHealth = (hp: number) => {
    if (hp >= 1_000_000) return `${(hp / 1_000_000).toFixed(1)}M`;
    if (hp >= 1_000) return `${(hp / 1_000).toFixed(0)}K`;
    return hp.toString();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [data, instances] = await Promise.all([listSavedRoutes(), listInstances()]);
      setRoutes(data);
      setAvailableInstances(instances);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load saved routes.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-extract data from SimC string
  useEffect(() => {
    let input = newRoute.route_data;
    if (!input || input.length < 10) {
      setParsedMdt(null);
      return;
    }

    if (isMdtString(input)) {
      const mdtInfo = parseMdtString(input);
      if (mdtInfo) {
        setParsedMdt(mdtInfo);
        input = convertMdtToSimc(mdtInfo);
      } else {
        setParsedMdt(null);
      }
    } else {
      setParsedMdt(null);
    }

    const levelMatch = input.match(
      /^(?:keystone_level|level|mythic_plus_level)\s*=\s*"?([^"\n,]+)"?/im
    );
    const dungeonMatch = input.match(
      /^(?:dungeon|instance|mythic_plus_dungeon|keystone_dungeon)\s*=\s*"?([^"\n,]+)"?/im
    );
    const nameMatch = input.match(/^(?:route_name|name)\s*=\s*"?([^"\n,]+)"?/im);
    const enemyMatch = input.match(/^enemy\s*=\s*"([^"]+)"/im);
    const timerMatch = input.match(/^max_time\s*=\s*"?([^"\n,]+)"?/im);
    const affixMatch = input.match(/^(?:affix|affixes)\s*=\s*"?([^"\n,]+)"?/im);
    const pullCount = (input.match(/^raid_events\+=\/pull,/gim) || []).length;

    setNewRoute((prev) => {
      const updates: any = {};

      if (!prev.level && levelMatch?.[1]) {
        updates.level = levelMatch[1];
      }

      if (!prev.timer_seconds && timerMatch?.[1]) {
        updates.timer_seconds = timerMatch[1];
      }

      if (!prev.affixes && affixMatch?.[1]) {
        updates.affixes = affixMatch[1];
      }

      if (!prev.pull_count && pullCount > 0) {
        updates.pull_count = pullCount.toString();
      }

      if (!prev.dungeon) {
        if (dungeonMatch?.[1]) {
          updates.dungeon = dungeonMatch[1];
        } else if (enemyMatch?.[1]) {
          updates.dungeon = enemyMatch[1]
            .replace(/^(Expert|Advanced|Standard):\s*/i, '')
            .replace(/'s Weekly Route/i, '');
        }

        if (updates.dungeon) {
          const matched = availableInstances.find(
            (i) =>
              i.name.toLowerCase() === updates.dungeon.toLowerCase() ||
              i.name.toLowerCase().includes(updates.dungeon.toLowerCase())
          );
          if (matched) {
            setSelectedDungeonId(String(matched.id));
            setCustomDungeonName('');
          } else {
            setSelectedDungeonId('other');
            setCustomDungeonName(updates.dungeon);
          }
        }
      }

      if (!prev.name) {
        if (nameMatch?.[1]) {
          updates.name = nameMatch[1];
        } else if (updates.dungeon || prev.dungeon) {
          const d = updates.dungeon || prev.dungeon;
          const l = updates.level || prev.level;
          updates.name = `${d}${l ? ` +${l}` : ''} Route`;
        }
      }

      if (Object.keys(updates).length === 0) return prev;
      return { ...prev, ...updates };
    });
  }, [newRoute.route_data, availableInstances]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreateRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const dungeonName =
      selectedDungeonId === 'other'
        ? customDungeonName
        : availableInstances.find((i) => String(i.id) === selectedDungeonId)?.name || 'Unknown';

    try {
      await saveRoute({
        name: newRoute.name,
        dungeon: dungeonName,
        level: newRoute.level ? Number(newRoute.level) : undefined,
        pull_count: newRoute.pull_count ? Number(newRoute.pull_count) : undefined,
        timer_seconds: newRoute.timer_seconds ? Number(newRoute.timer_seconds) : undefined,
        affixes: newRoute.affixes || undefined,
        route_data: newRoute.route_data,
      });
      setNewRoute({
        name: '',
        dungeon: '',
        level: '',
        pull_count: '',
        timer_seconds: '',
        affixes: '',
        route_data: '',
      });
      setSelectedDungeonId('');
      setCustomDungeonName('');
      setIsModalOpen(false);
      await refresh();
      notify({
        title: 'Route saved',
        description: 'The route is now available in Saved Routes.',
        variant: 'success',
      });
    } catch (e: any) {
      notify({
        title: 'Could not save route',
        description: e?.message || 'Please try again.',
        variant: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this route?')) return;
    setDeletingRouteId(id);
    try {
      await deleteSavedRoute(id);
      setRoutes((prev) => prev.filter((r) => r.id !== id));
      notify({
        title: 'Route deleted',
        description: 'The saved route was removed.',
        variant: 'success',
      });
    } catch (e: any) {
      notify({
        title: 'Could not delete route',
        description: e?.message || 'Please try again.',
        variant: 'error',
      });
    } finally {
      setDeletingRouteId(null);
    }
  };

  const dungeons = useMemo(() => {
    const set = new Set(routes.map((r) => r.dungeon));
    return Array.from(set).sort();
  }, [routes]);

  const filteredAndSortedRoutes = useMemo(() => {
    let result = [...routes];

    if (dungeonFilter !== 'all') {
      result = result.filter((r) => r.dungeon === dungeonFilter);
    }

    result.sort((a, b) => {
      if (sortBy === 'level') {
        return (b.level || 0) - (a.level || 0);
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return result;
  }, [routes, dungeonFilter, sortBy]);

  const instanceIdByNormalizedName = useMemo(() => {
    const map = new Map<string, number>();
    for (const instance of availableInstances) {
      if (!instance.name) continue;
      map.set(normalizeSourceName(instance.name), instance.id);
    }
    return map;
  }, [availableInstances]);

  const findMatchedInstanceId = useCallback(
    (dungeonName: string): number | null => {
      const normalizedRouteName = normalizeSourceName(dungeonName);
      const direct = instanceIdByNormalizedName.get(normalizedRouteName);
      if (direct) return direct;
      for (const instance of availableInstances) {
        const normalizedInstanceName = normalizeSourceName(instance.name);
        if (
          normalizedInstanceName.includes(normalizedRouteName) ||
          normalizedRouteName.includes(normalizedInstanceName)
        ) {
          return instance.id;
        }
      }
      return null;
    },
    [availableInstances, instanceIdByNormalizedName]
  );

  if (isLoading && routes.length === 0) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="border-gold h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Saved Routes</h1>
          <p className="mt-2 text-zinc-400">
            Manage and browse your saved dungeon routes for simulation.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-gold hover:bg-gold/90 hover:shadow-gold/20 rounded-xl px-6 py-3 text-[15px] font-bold text-black transition-all hover:shadow-lg"
        >
          Add Route
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="font-semibold hover:text-white"
          >
            Try again
          </button>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
            Dungeon
          </label>
          <select
            value={dungeonFilter}
            onChange={(e) => setDungeonFilter(e.target.value)}
            className="border-border bg-surface-2 focus:border-gold/50 focus:ring-gold/50 rounded-lg border px-3 py-1.5 text-sm text-zinc-100 focus:ring-1 focus:outline-none"
            style={{ colorScheme: 'dark' }}
          >
            <option value="all">All Dungeons</option>
            {dungeons.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
            Sort By
          </label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="border-border bg-surface-2 focus:border-gold/50 focus:ring-gold/50 rounded-lg border px-3 py-1.5 text-sm text-zinc-100 focus:ring-1 focus:outline-none"
            style={{ colorScheme: 'dark' }}
          >
            <option value="date">Newest First</option>
            <option value="level">Highest Level</option>
          </select>
        </div>

        <div className="ml-auto self-end">
          <button
            onClick={refresh}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            Refresh
          </button>
        </div>
      </div>

      {filteredAndSortedRoutes.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.01]">
          <p className="text-zinc-500">No saved routes found matching your filters.</p>
          <Link href="/quick-sim" className="text-gold mt-4 text-sm font-medium hover:underline">
            Go to Quick Sim to save your first route
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredAndSortedRoutes.map((route) => (
            <div
              key={route.id}
              className="group flex flex-col overflow-hidden rounded-2xl border border-white/5 bg-white/[0.03] transition-all hover:border-white/10 hover:bg-white/[0.05] hover:shadow-2xl hover:shadow-black/40"
            >
              <div className="p-5">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="group-hover:text-gold truncate text-lg font-bold tracking-tight text-white transition-colors">
                      {route.name}
                    </h3>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-zinc-500">{route.dungeon}</p>
                      {(() => {
                        const matchedInstanceId = findMatchedInstanceId(route.dungeon);
                        if (!matchedInstanceId) return null;
                        return (
                          <Link
                            href="/dungeons"
                            className="text-gold/90 hover:text-gold text-xs font-semibold transition-colors hover:underline"
                          >
                            Open Dungeon
                          </Link>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => setViewingRoute(route)}
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-bold text-zinc-400 transition-all hover:border-white/20 hover:text-white"
                    >
                      View Details
                    </button>
                    {route.level && (
                      <span className="rounded-lg bg-sky-500/10 px-2.5 py-1 font-mono text-xs font-black text-sky-400">
                        +{route.level}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                    {new Date(route.created_at).toLocaleDateString()}
                  </span>
                  {route.pull_count && (
                    <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-emerald-400 uppercase">
                      {route.pull_count} Pulls
                    </span>
                  )}
                  {(() => {
                    const info = parseCharacterInfo(route.route_data);
                    if (info?.kind !== 'dungeon') return null;
                    const totalHealth = info.pulls.reduce(
                      (sum, p) => sum + (p.totalHealth || 0),
                      0
                    );
                    const timer = route.timer_seconds || (info.maxTime ? Number(info.maxTime) : 0);
                    // Assume 3 DPS do 90% of total HP.
                    const minDps =
                      timer > 0 && totalHealth > 0 ? (totalHealth * 0.9) / 3 / timer : 0;

                    return (
                      <>
                        {timer > 0 && (
                          <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-amber-400 uppercase">
                            {formatTime(timer)} Timer
                          </span>
                        )}
                        {totalHealth > 0 && (
                          <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-sky-400 uppercase">
                            {formatHealth(totalHealth)} HP
                          </span>
                        )}
                        {minDps > 0 && (
                          <span className="bg-gold/10 text-gold rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase">
                            {Math.round(minDps).toLocaleString()} DPS
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>

                {route.affixes && (
                  <div className="mt-3 line-clamp-1 text-[11px] font-medium text-zinc-500">
                    {route.affixes}
                  </div>
                )}
              </div>

              <div className="mt-auto flex items-center gap-[1px] border-t border-white/5 bg-black/20 p-[1px]">
                <button
                  onClick={() => {
                    setSimcFooter(route.route_data);
                    router.push('/quick-sim');
                  }}
                  className="bg-gold/10 text-gold hover:bg-gold/20 flex-1 py-3 text-xs font-bold tracking-widest uppercase transition-colors"
                >
                  Use in Sim
                </button>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(route.route_data).then(
                      () =>
                        notify({
                          title: 'Route copied',
                          description: 'Route data copied to the clipboard.',
                          variant: 'success',
                        }),
                      () =>
                        notify({
                          title: 'Could not copy route',
                          description: 'Clipboard access was unavailable.',
                          variant: 'error',
                        })
                    );
                  }}
                  className="flex-1 bg-white/[0.02] py-3 text-xs font-bold tracking-widest text-zinc-400 uppercase transition-colors hover:bg-white/[0.05] hover:text-white"
                >
                  Copy
                </button>
                <button
                  disabled={deletingRouteId === route.id}
                  onClick={() => handleDelete(route.id)}
                  className="bg-white/[0.02] px-4 py-3 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:cursor-wait disabled:opacity-50"
                  title="Delete Route"
                  aria-label={`Delete ${route.name}`}
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewingRoute && (
        <RouteDetailsModal
          route={viewingRoute}
          dungeonDetailsId={findMatchedInstanceId(viewingRoute.dungeon)}
          onClose={() => setViewingRoute(null)}
          formatHealth={formatHealth}
          formatTime={formatTime}
        />
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div
            ref={addRouteModalRef}
            className="animate-in fade-in zoom-in w-full max-w-2xl rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl duration-200"
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Add New Dungeon Route</h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-zinc-500 hover:text-white"
              >
                <X className="h-6 w-6" strokeWidth={2} />
              </button>
            </div>

            <form onSubmit={handleCreateRoute} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold tracking-wider text-zinc-500 uppercase">
                    Route Name
                  </label>
                  <input
                    required
                    type="text"
                    value={newRoute.name}
                    onChange={(e) => setNewRoute({ ...newRoute, name: e.target.value })}
                    placeholder="e.g. Mists +10 Push Route"
                    className="focus:border-gold/50 focus:ring-gold/50 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:ring-1 focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold tracking-wider text-zinc-500 uppercase">
                    Dungeon
                  </label>
                  <select
                    required
                    value={selectedDungeonId}
                    onChange={(e) => setSelectedDungeonId(e.target.value)}
                    className="focus:border-gold/50 focus:ring-gold/50 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:ring-1 focus:outline-none"
                  >
                    <option value="" disabled>
                      Select a Dungeon
                    </option>
                    {availableInstances
                      .filter((i) => i.type === 'dungeon' || i.type === 'mythic_plus')
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((i) => (
                        <option key={i.id} value={String(i.id)}>
                          {i.name}
                        </option>
                      ))}
                    <option value="other">Other / Custom</option>
                  </select>
                </div>
              </div>

              {selectedDungeonId === 'other' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold tracking-wider text-zinc-500 uppercase">
                    Custom Dungeon Name
                  </label>
                  <input
                    required
                    type="text"
                    value={customDungeonName}
                    onChange={(e) => setCustomDungeonName(e.target.value)}
                    placeholder="e.g. Operation: Mechagon"
                    className="focus:border-gold/50 focus:ring-gold/50 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:ring-1 focus:outline-none"
                  />
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold tracking-wider text-zinc-500 uppercase">
                  Keystone Level (Optional)
                </label>
                <input
                  type="number"
                  value={newRoute.level}
                  onChange={(e) => setNewRoute({ ...newRoute, level: e.target.value })}
                  placeholder="e.g. 10"
                  className="focus:border-gold/50 focus:ring-gold/50 w-32 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:ring-1 focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold tracking-wider text-zinc-500 uppercase">
                  SimC Route Data
                </label>
                <textarea
                  required
                  rows={8}
                  value={newRoute.route_data}
                  onChange={(e) => setNewRoute({ ...newRoute, route_data: e.target.value })}
                  placeholder="Paste your dungeon_route=... or route=... here"
                  className="focus:border-gold/50 focus:ring-gold/50 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-zinc-300 focus:ring-1 focus:outline-none"
                />
              </div>

              {parsedMdt && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold tracking-wider text-zinc-500 uppercase">
                    Pulls Preview ({parsedMdt.pullCount} pulls)
                  </label>
                  <div className="max-h-60 overflow-y-auto rounded-lg border border-white/10 bg-black/40">
                    <table className="w-full text-left text-[11px]">
                      <thead className="sticky top-0 bg-zinc-900 text-[10px] font-black tracking-wider text-zinc-500 uppercase">
                        <tr>
                          <th className="px-4 py-2">Pull</th>
                          <th className="px-2 py-2 text-center">BL</th>
                          <th className="px-2 py-2">Enemies</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {parsedMdt.pulls.map((pull: any, idx: number) => (
                          <tr key={idx} className="hover:bg-white/[0.02]">
                            <td className="px-4 py-2 font-mono font-bold text-zinc-400">
                              {pull.pull || String(idx + 1).padStart(2, '0')}
                            </td>
                            <td className="px-2 py-2 text-center">
                              {pull.bloodlust && (
                                <span className="inline-block rounded bg-red-500/20 px-1 py-0.5 text-[9px] font-black text-red-400">
                                  BL
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-2">
                              <div className="flex flex-wrap gap-x-2 gap-y-1">
                                {pull.enemies.map((e: any, eIdx: number) => (
                                  <span key={eIdx} className="text-zinc-300">
                                    {e.count > 1 ? (
                                      <span className="font-bold text-sky-400/90">{e.count}x </span>
                                    ) : (
                                      <span className="text-zinc-500">1x </span>
                                    )}
                                    {e.name}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="mt-8 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-gold hover:bg-gold/90 rounded-lg px-6 py-2 text-sm font-bold text-black transition-all disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Route'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

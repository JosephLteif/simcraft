'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  API_URL,
  fetchJson,
  isDesktop,
  isNetworkUnavailableError,
  LAN_ACCESS_REQUIRED_STORAGE_KEY,
} from '../lib/api';
import SplashScreen from './SplashScreen';
import { useAuth } from './AuthContext';
import { usePathname, useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { readinessDataMessage } from '../lib/readiness';

const AUTO_RETRY_DELAYS_MS = [2000, 5000, 10000] as const;

export default function DataGuard({ children }: { children: ReactNode }) {
  const [dataStatus, setDataStatus] = useState<any>({ status: 'syncing', progress: '' });
  const [isReady, setIsReady] = useState(false);
  const { user, loading, lanAccessRequired, lightMode, checkCredentialsStatus } = useAuth();
  const [isGloballyConfigured, setIsGloballyConfigured] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [missingRequiredFiles, setMissingRequiredFiles] = useState<string[]>([]);
  const [showMissingFilesPopup, setShowMissingFilesPopup] = useState(false);
  const [missingDataDownloadBusy, setMissingDataDownloadBusy] = useState(false);
  const [missingDataProgress, setMissingDataProgress] = useState<{
    task: string;
    current: number;
    total: number;
    details: string;
    downloadedBytes: number;
    totalBytes: number;
    speedBytesPerSec: number;
  }>({
    task: '',
    current: 0,
    total: 0,
    details: '',
    downloadedBytes: 0,
    totalBytes: 0,
    speedBytesPerSec: 0,
  });
  const [missingDataError, setMissingDataError] = useState('');
  const [autoRetryAttempt, setAutoRetryAttempt] = useState(0);
  const statusFailureCountRef = useRef(0);
  const statusFailureFirstAtRef = useRef<number | null>(null);
  const autoRetryAttemptRef = useRef(0);
  const autoRetryTimerRef = useRef<number | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const normalizedPath =
    pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname;
  const isSharedResultPage = normalizedPath === '/shared-result';
  const isLanResyncPage = normalizedPath === '/lan/resync';
  const isSettingsPage = normalizedPath === '/settings';

  const safeText = (value: unknown, fallback = ''): string => {
    if (typeof value === 'string') return value;
    if (value == null) return fallback;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (typeof obj.detail === 'string') return obj.detail;
      if (typeof obj.error === 'string') return `error: ${obj.error}`;
      try {
        return JSON.stringify(value);
      } catch {
        return fallback;
      }
    }
    return fallback;
  };
  const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(
      value >= 100 || unit === 0 || Number.isInteger(value) ? 0 : value >= 10 ? 1 : 2
    )} ${units[unit]}`;
  };
  const parseProgress = (progress: string) => {
    const parts = String(progress || '').split(':');
    if (parts.length < 4) {
      return {
        task: '',
        current: 0,
        total: 0,
        details: progress || '',
        downloadedBytes: 0,
        totalBytes: 0,
        speedBytesPerSec: 0,
      };
    }
    const downloadedBytes = Number(parts[4] || 0);
    const totalBytes = Number(parts[5] || 0);
    const speedBytesPerSec = Number(parts[7] || 0);
    return {
      task: parts[0] || '',
      current: Number(parts[1] || 0),
      total: Number(parts[2] || 0),
      details: parts[3] || '',
      downloadedBytes: Number.isFinite(downloadedBytes) ? downloadedBytes : 0,
      totalBytes: Number.isFinite(totalBytes) ? totalBytes : 0,
      speedBytesPerSec: Number.isFinite(speedBytesPerSec) ? speedBytesPerSec : 0,
    };
  };

  const toSplashStatus = (value: unknown): string => {
    const text = safeText(value, 'syncing').trim();
    if (!text) return 'syncing';
    if (text === 'ready') return 'syncing';
    if (text === 'syncing' || text === 'unauthenticated' || text === 'unauthenticated_needs_keys') {
      return text;
    }
    const lower = text.toLowerCase();
    if (lower.includes('error') || lower.includes('failed') || lower.includes('invalid')) {
      return text;
    }
    return 'syncing';
  };

  const toSplashProgress = (value: unknown): string => {
    const progress = safeText(value, '').trim();
    return (
      progress ||
      readinessDataMessage(
        dataStatus?.status,
        Boolean(dataStatus?.degraded),
        'Syncing with Blizzard...'
      )
    );
  };

  useEffect(() => {
    setIsReady(localStorage.getItem('whylowdps_data_ready') === 'true');
  }, []);

  useEffect(() => {
    if (
      lightMode ||
      isSharedResultPage ||
      lanAccessRequired ||
      localStorage.getItem(LAN_ACCESS_REQUIRED_STORAGE_KEY) === '1'
    ) {
      setIsGloballyConfigured(false);
      setIsChecking(false);
      return;
    }
    let cancelled = false;
    setIsChecking(true);
    checkCredentialsStatus()
      .then((status) => {
        if (cancelled) return;
        setIsGloballyConfigured(status.globally_configured);
      })
      .catch((err) => {
        if (cancelled) return;
        if (!isNetworkUnavailableError(err)) {
          console.error('[DataGuard] Credentials status check failed:', err);
        }
      })
      .finally(() => {
        if (cancelled) return;
        setIsChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [checkCredentialsStatus, isSharedResultPage, lanAccessRequired, lightMode]);

  const checkStatus = useCallback(async () => {
    if (
      isSharedResultPage ||
      lanAccessRequired ||
      localStorage.getItem(LAN_ACCESS_REQUIRED_STORAGE_KEY) === '1'
    ) {
      return;
    }
    try {
      const data = await fetchJson<any>(`${API_URL}/api/data/status`);
      statusFailureCountRef.current = 0;
      statusFailureFirstAtRef.current = null;

      if (missingDataDownloadBusy && String(data?.progress || '').startsWith('Repair:')) {
        setMissingDataProgress(parseProgress(String(data.progress)));
      }

      if (data.status === 'ready') {
        if (autoRetryTimerRef.current != null) {
          window.clearTimeout(autoRetryTimerRef.current);
          autoRetryTimerRef.current = null;
        }
        autoRetryAttemptRef.current = 0;
        setAutoRetryAttempt(0);
        setDataStatus(data);
        setIsReady(true);
        try {
          localStorage.setItem('whylowdps_data_ready', 'true');
        } catch {}
      } else if (data.status === 'needs_credentials') {
        if (autoRetryTimerRef.current != null) {
          window.clearTimeout(autoRetryTimerRef.current);
          autoRetryTimerRef.current = null;
        }
        autoRetryAttemptRef.current = 0;
        setAutoRetryAttempt(0);
        if (lightMode) {
          setDataStatus(data);
          setIsReady(true);
          return;
        }
        setIsReady(false);
        try {
          localStorage.removeItem('whylowdps_data_ready');
        } catch {}
        setDataStatus({ status: 'syncing', progress: 'Initializing synchronization...' });
        fetchJson(`${API_URL}/api/data/sync`, { method: 'POST' }).catch(() => {});
      } else {
        setIsReady(false);
        try {
          localStorage.removeItem('whylowdps_data_ready');
        } catch {}
        setDataStatus(data);

        const statusText = safeText(data?.status, '').toLowerCase();
        const isSyncError = statusText.includes('error') || statusText.includes('failed');
        if (isSyncError && autoRetryTimerRef.current == null) {
          const attempt = autoRetryAttemptRef.current;
          if (attempt < AUTO_RETRY_DELAYS_MS.length) {
            const delayMs = AUTO_RETRY_DELAYS_MS[attempt];
            autoRetryTimerRef.current = window.setTimeout(() => {
              autoRetryTimerRef.current = null;
              autoRetryAttemptRef.current += 1;
              setAutoRetryAttempt(autoRetryAttemptRef.current);
              fetchJson(`${API_URL}/api/data/sync`, { method: 'POST' })
                .catch(() => {})
                .finally(() => {
                  void checkStatus();
                });
            }, delayMs);
          }
        }
      }
    } catch (err) {
      if (!isNetworkUnavailableError(err)) {
        console.error('Failed to fetch data status:', err);
      }
      // Avoid random splash/reload-like UX on brief idle/network hiccups.
      statusFailureCountRef.current += 1;
      if (statusFailureFirstAtRef.current == null) {
        statusFailureFirstAtRef.current = Date.now();
      }
      const failedForMs = Date.now() - (statusFailureFirstAtRef.current || Date.now());
      const shouldDropReady = statusFailureCountRef.current >= 3 && failedForMs >= 6000;
      if (shouldDropReady) {
        setIsReady(false);
        try {
          localStorage.removeItem('whylowdps_data_ready');
        } catch {}
        setDataStatus({ status: 'syncing', progress: 'Waiting for backend to start...' });
      }
    }
  }, [isSharedResultPage, lanAccessRequired, lightMode, missingDataDownloadBusy]);

  useEffect(() => {
    if (isSharedResultPage) return;
    if (
      !isReady &&
      !lanAccessRequired &&
      localStorage.getItem(LAN_ACCESS_REQUIRED_STORAGE_KEY) !== '1'
    ) {
      setDataStatus({ status: 'syncing', progress: 'Initializing synchronization...' });
      fetchJson(`${API_URL}/api/data/sync`, { method: 'POST' })
        .catch(() => {})
        .finally(() => {
          checkStatus();
        });
    }
  }, [checkStatus, isReady, isSharedResultPage, lanAccessRequired]);

  useEffect(() => {
    if (
      isSharedResultPage ||
      lanAccessRequired ||
      localStorage.getItem(LAN_ACCESS_REQUIRED_STORAGE_KEY) === '1' ||
      (isReady && !missingDataDownloadBusy)
    ) {
      return;
    }
    const interval = setInterval(() => {
      checkStatus();
    }, 2000);
    return () => clearInterval(interval);
  }, [checkStatus, isReady, isSharedResultPage, lanAccessRequired, missingDataDownloadBusy]);

  const handleRetry = () => {
    if (autoRetryTimerRef.current != null) {
      window.clearTimeout(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
    }
    autoRetryAttemptRef.current = 0;
    setAutoRetryAttempt(0);
    fetchJson(`${API_URL}/api/data/sync`, { method: 'POST' })
      .catch(() => {})
      .finally(() => checkStatus());
  };

  const openDataFolder = useCallback(async () => {
    if (!isDesktop) return;
    try {
      await invoke('open_data_dir');
    } catch {
      try {
        const info = (await invoke('get_system_info')) as { data_dir?: string };
        const raw = String(info?.data_dir || '').trim();
        if (!raw) throw new Error('Missing data directory path');
        const normalized = raw.replace(/\\/g, '/');
        const prefixed = normalized.match(/^[A-Za-z]:\//) ? `/${normalized}` : normalized;
        await invoke('open_external_url', { url: `file://${prefixed}` });
      } catch (fallbackErr) {
        console.error('Failed to open data directory:', fallbackErr);
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      if (autoRetryTimerRef.current != null) {
        window.clearTimeout(autoRetryTimerRef.current);
      }
    };
  }, []);
  const startMissingDataDownload = useCallback(async () => {
    setMissingDataError('');
    setMissingDataDownloadBusy(true);
    setMissingDataProgress({
      task: '',
      current: 0,
      total: 0,
      details: 'Repairing missing files...',
      downloadedBytes: 0,
      totalBytes: 0,
      speedBytesPerSec: 0,
    });
    try {
      const result = await fetchJson<{
        failed?: Array<{ error?: string }>;
        sources?: Record<string, string[]>;
      }>(`${API_URL}/api/data/files/missing/download`, {
        method: 'POST',
        timeoutMs: 120_000,
      });
      if (Array.isArray(result?.failed) && result.failed.length > 0) {
        const firstError = result.failed[0]?.error || 'Some files failed to download.';
        setMissingDataError(firstError);
      }
      const repairedSources = [
        ['bundled', 'packaged files'],
        ['recovery_snapshot', 'verified recovery snapshot'],
        ['raidbots', 'Raidbots'],
      ]
        .filter(([key]) => (result?.sources?.[key] || []).length > 0)
        .map(([, label]) => label);
      const repairDetails =
        repairedSources.length > 0
          ? `Repaired from ${repairedSources.join(' and ')}.`
          : 'Missing files repaired.';

      const state = await fetchJson<any>(`${API_URL}/api/data/files`);
      const missing = Array.isArray(state?.files)
        ? state.files
            .filter((f: any) => f?.required && !f?.exists)
            .map((f: any) => String(f?.label || f?.relative_path || f?.key || 'Unknown file'))
        : [];
      setMissingRequiredFiles(missing);
      setShowMissingFilesPopup(missing.length > 0);
      setMissingDataProgress({
        task: '',
        current: 0,
        total: 0,
        details:
          missing.length > 0
            ? `${repairDetails} Some required files are still missing.`
            : repairDetails,
        downloadedBytes: 0,
        totalBytes: 0,
        speedBytesPerSec: 0,
      });
      setMissingDataDownloadBusy(false);
    } catch (err: any) {
      setMissingDataDownloadBusy(false);
      setMissingDataError(err?.message || 'Failed to start missing data download.');
    }
  }, []);

  useEffect(() => {
    if (
      isSharedResultPage ||
      lanAccessRequired ||
      localStorage.getItem(LAN_ACCESS_REQUIRED_STORAGE_KEY) === '1'
    ) {
      return;
    }
    let cancelled = false;

    const checkMissingFiles = async () => {
      try {
        const state = await fetchJson<any>(`${API_URL}/api/data/files`);
        if (cancelled || !Array.isArray(state?.files)) return;
        const missing = state.files
          .filter((f: any) => f?.required && !f?.exists)
          .map((f: any) => String(f?.label || f?.relative_path || f?.key || 'Unknown file'));
        setMissingRequiredFiles(missing);
        setShowMissingFilesPopup(missing.length > 0);
      } catch {}
    };

    void checkMissingFiles();

    const onFocus = () => void checkMissingFiles();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkMissingFiles();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    const onCacheStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ status?: string }>).detail;
      if (String(detail?.status || '').toLowerCase() === 'ready') {
        void checkMissingFiles();
      }
    };

    window.addEventListener('whylowdps-cache-refresh-status', onCacheStatus as EventListener);
    const interval = showMissingFilesPopup
      ? window.setInterval(() => {
          void checkMissingFiles();
        }, 2000)
      : null;

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener(
        'whylowdps-cache-refresh-status',
        onCacheStatus as EventListener
      );
      if (interval) window.clearInterval(interval);
    };
  }, [isSharedResultPage, lanAccessRequired, showMissingFilesPopup]);

  const lightModeBlockedRoute =
    lightMode &&
    (normalizedPath === '/settings' ||
      normalizedPath === '/characters' ||
      normalizedPath.startsWith('/character') ||
      normalizedPath === '/wishlist' ||
       normalizedPath === '/talent-playground');
  const shouldShowMissingFilesPopup = showMissingFilesPopup;

  useEffect(() => {
    if (!lanAccessRequired || isLanResyncPage || isSharedResultPage) return;
    router.replace('/lan/resync');
  }, [isLanResyncPage, isSharedResultPage, lanAccessRequired, router]);

  let content: React.ReactNode = children;
  if (isLanResyncPage) {
    content = children;
  } else if (lanAccessRequired && !isSharedResultPage) {
    content = <SplashScreen status="lan_access_required" progress="" />;
  } else if (lightModeBlockedRoute) {
    content = (
      <main className="flex min-h-[calc(100vh-var(--app-header-height))] items-center justify-center px-4 py-12">
        <section className="w-full max-w-md rounded-lg border border-border bg-surface p-5 text-center">
          <p className="text-sm font-semibold text-zinc-100">Unavailable in Light mode</p>
          <p className="mt-2 text-sm text-zinc-400">
            Battle.net character, vault, wishlist, and settings features are disabled.
          </p>
          <a
            href="/quick-sim"
            className="mt-4 inline-flex rounded-md border border-gold/30 bg-gold/15 px-3 py-2 text-sm font-semibold text-gold transition-colors hover:bg-gold/25"
          >
            Open Quick Sim
          </a>
        </section>
      </main>
    );
  } else if (
    (loading || isChecking) &&
    !isSettingsPage &&
    !isSharedResultPage &&
    !lightMode
  ) {
    content = null;
  } else if (user && !isSettingsPage && !isSharedResultPage && !isReady) {
    content = (
      <SplashScreen
        status={toSplashStatus(dataStatus?.status)}
        progress={toSplashProgress(dataStatus?.progress)}
        onRetry={handleRetry}
        retriesRemaining={Math.max(0, AUTO_RETRY_DELAYS_MS.length - autoRetryAttempt)}
        retriesDone={autoRetryAttempt}
        retriesTotal={AUTO_RETRY_DELAYS_MS.length}
      />
    );
  } else if (
    !user &&
    isGloballyConfigured === false &&
    !isSettingsPage &&
    !isSharedResultPage &&
    !lightMode
  ) {
    content = <SplashScreen status="unauthenticated_needs_keys" progress="" />;
  } else if (!user && !isSettingsPage && !isSharedResultPage && !lightMode) {
    content = <SplashScreen status="unauthenticated" progress="" />;
  } else if (!isReady && !isSettingsPage && !isSharedResultPage) {
    content = (
      <SplashScreen
        status={toSplashStatus(dataStatus?.status)}
        progress={toSplashProgress(dataStatus?.progress)}
        onRetry={handleRetry}
        retriesRemaining={Math.max(0, AUTO_RETRY_DELAYS_MS.length - autoRetryAttempt)}
        retriesDone={autoRetryAttempt}
        retriesTotal={AUTO_RETRY_DELAYS_MS.length}
      />
    );
  }

  return (
    <>
      {content}
      {dataStatus?.degraded && !isSettingsPage && !isSharedResultPage && (
        <div className="mobile-fixed-bottom fixed left-1/2 z-[180] w-[min(92vw,760px)] -translate-x-1/2 rounded-lg border border-amber-400/30 bg-amber-950/90 px-3 py-2 text-xs text-amber-100 shadow-xl backdrop-blur">
          Using the last validated game-data snapshot. New seasonal data is temporarily degraded; simulations and unrelated browsing remain available.
        </div>
      )}
      {shouldShowMissingFilesPopup && !isSharedResultPage && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-lg rounded-xl border border-amber-500/30 bg-[#1a1306] p-5 shadow-2xl">
            <p className="text-base font-semibold text-amber-200">Critical data files are missing</p>
            <p className="mt-1 text-sm text-amber-100/90">
              You need to download missing game data before continuing.
            </p>
            <p className="mt-3 max-h-24 overflow-auto text-xs text-amber-100/80">
            {missingRequiredFiles.slice(0, 4).join(', ')}
            {missingRequiredFiles.length > 4 ? ` +${missingRequiredFiles.length - 4} more` : ''}
            </p>
            <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-zinc-200">
              <p>{missingDataProgress.details || 'Click Repair Missing Files to restore app data.'}</p>
              {(missingDataDownloadBusy || missingDataProgress.totalBytes > 0) && (
                <div className="mt-2 space-y-1 text-zinc-300">
                  <p>
                    Progress: {missingDataProgress.current}/{missingDataProgress.total || '?'}
                  </p>
                  <div className="h-2 overflow-hidden rounded-full bg-black/50">
                    <div
                      className="h-full rounded-full bg-amber-400 transition-all duration-300"
                      style={{
                        width: `${
                          missingDataProgress.total > 0
                            ? Math.max(
                                0,
                                Math.min(
                                  100,
                                  Math.round(
                                    (missingDataProgress.current / missingDataProgress.total) * 100
                                  )
                                )
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  <p>
                    Downloaded: {formatBytes(missingDataProgress.downloadedBytes)} /{' '}
                    {formatBytes(missingDataProgress.totalBytes)}
                  </p>
                  <p>Speed: {formatBytes(missingDataProgress.speedBytesPerSec)}/s</p>
                </div>
              )}
            </div>
            {missingDataError && (
              <p className="mt-3 text-xs text-red-300">{missingDataError}</p>
            )}
            <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-zinc-200">
              <p>
                Repair restores packaged files first, then downloads a verified recovery snapshot. If
                that snapshot is unavailable, it tries Raidbots automatically.
              </p>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void startMissingDataDownload()}
                disabled={missingDataDownloadBusy}
                className="rounded-md border border-amber-400/40 bg-amber-400/15 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-400/25 disabled:opacity-60"
              >
                {missingDataDownloadBusy ? 'Repairing...' : 'Repair Missing Files'}
              </button>
              <button
                type="button"
                onClick={() => void openDataFolder()}
                className="rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-white/10"
              >
                Open Data Folder
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

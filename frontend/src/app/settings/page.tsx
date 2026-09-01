'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { useRouter } from 'next/navigation';
import {
  API_URL,
  type BlizzardCredentialProfile,
  deleteBlizzardCredentialProfile,
  fetchJson,
  getConfig,
  isDesktop,
  isHostedPrivate,
  listBlizzardCredentialProfiles,
  renameBlizzardCredentialProfile,
  saveBlizzardCredentialProfile,
  updateConfig,
} from '../lib/api';
import { useSimContext } from '../components/SimContext';
import DefaultOptionsSettingsCard from '../components/DefaultOptionsSettingsCard';
import DataCacheSettingsSection from './components/DataCacheSettingsSection';
import DataFilePreviewModal from './components/DataFilePreviewModal';
import DataFileStateModal from './components/DataFileStateModal';
import DiscordWebhookSettings from './components/DiscordWebhookSettings';
import LocalBackupSection from './components/LocalBackupSection';
import IntegrationsSettingsSection from './components/IntegrationsSettingsSection';
import UpdatesSettingsSection from './components/UpdatesSettingsSection';
import ReadinessPanel from '../components/ReadinessPanel';
import { APP_VERSION_WITH_PREFIX } from '../lib/version';
import { CHANGELOG_HISTORY_URL } from '../lib/changelog';
import {
  fetchSimcRuntimeInfo,
  fetchSimcRuntimeVersions,
  SIMC_RUNTIME_UPDATED_EVENT,
  type SimcRuntimeInfo,
  type SimcRuntimeVersionOption,
} from '../lib/simc-runtime-release';
import { useDataCacheRefresh } from './useDataCacheRefresh';
import { useDataFileStateManager } from './useDataFileStateManager';
import { useSettingsUpdater } from './useSettingsUpdater';
import { fetchReadiness, type ReadinessSnapshot } from '../lib/readiness';
import { SIMULATION_PERFORMANCE_PRESETS, getPresetThreads } from '../lib/sim-performance';
import {
  clampSimIdleTimeoutSeconds,
  clampSimTimeoutSeconds,
  DEFAULT_SIM_IDLE_TIMEOUT_SECONDS,
  DEFAULT_SIM_TIMEOUT_SECONDS,
  MAX_SIM_IDLE_TIMEOUT_SECONDS,
  MAX_SIM_TIMEOUT_SECONDS,
  MIN_SIM_IDLE_TIMEOUT_SECONDS,
  MIN_SIM_TIMEOUT_SECONDS,
} from '../lib/sim-timeout';

type CloseBehaviorPreferenceResponse = {
  minimize_to_tray_on_close?: boolean | null;
};
type CloseBehaviorMode = 'ask' | 'close' | 'tray';
type SimcUpdateChannel = 'weekly' | 'nightly';
type SimcUpdateChannelResponse = {
  channel?: string | null;
};
type SimcRuntimeVersionPreferenceResponse = {
  version?: string | null;
};
type SimcRuntimeStatusResponse = {
  channel?: string | null;
  version?: string | null;
  updated?: boolean | null;
};
type LanAccessInfo = {
  enabled: boolean;
  restart_required: boolean;
  addresses: string[];
};
type LanDevice = {
  id: string;
  name: string;
  paired_at: number;
  last_seen_at?: number | null;
  active: boolean;
};

type SettingsTab =
  | 'health'
  | 'simulation'
  | 'defaults'
  | 'application'
  | 'integrations'
  | 'data'
  | 'updates'
  | 'about';

function formatLanDeviceDate(timestamp?: number | null): string {
  if (!timestamp) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp * 1000));
}

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const {
    threads,
    setThreads,
    simTimeoutSeconds,
    setSimTimeoutSeconds,
    simIdleTimeoutSeconds,
    setSimIdleTimeoutSeconds,
    maxCombinations,
    setMaxCombinations,
    autoClipboardPasteSimc,
    setAutoClipboardPasteSimc,
    dataCacheRefreshMinutes,
    setDataCacheRefreshMinutes,
  } = useSimContext();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [credentialName, setCredentialName] = useState('');
  const [credentialProfiles, setCredentialProfiles] = useState<BlizzardCredentialProfile[]>([]);
  const [secretTouched, setSecretTouched] = useState(false);
  const [hasSecret, setHasSecret] = useState(false);
  const [maxThreads, setMaxThreads] = useState(0);
  const [maxParallelJobs, setMaxParallelJobs] = useState(1);
  const [parallelJobsSettingLoaded, setParallelJobsSettingLoaded] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [blizzardSaving, setBlizzardSaving] = useState(false);
  const [blizzardTesting, setBlizzardTesting] = useState(false);
  const [blizzardMessage, setBlizzardMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [performanceSaved, setPerformanceSaved] = useState(false);
  const { cacheSyncing, cacheMessage, syncProgress, syncProgressPct, refreshDataCache } =
    useDataCacheRefresh();
  const {
    dataStateLoading,
    dataStateError,
    dataStateMessage,
    dataStateOpen,
    setDataStateOpen,
    dataFileStates,
    dataActionBusyKey,
    dataFilePreview,
    dataFilePreviewOpen,
    setDataFilePreviewOpen,
    dataFilePreviewLoading,
    dataFilePreviewError,
    viewDataStates,
    refreshDataStates,
    downloadFile,
    downloadAllMissingFiles,
    openDataRootDirectory,
    showFileContent,
    groupedDataFiles,
  } = useDataFileStateManager();
  const [refreshPreset, setRefreshPreset] = useState<'disabled' | 'daily' | 'weekly'>('disabled');
  const [activeTab, setActiveTab] = useState<SettingsTab>('simulation');
  const [closeBehaviorMode, setCloseBehaviorMode] = useState<CloseBehaviorMode>('ask');
  const [closeBehaviorLoading, setCloseBehaviorLoading] = useState(false);
  const [closeBehaviorMessage, setCloseBehaviorMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [lanSharingEnabled, setLanSharingEnabled] = useState(false);
  const [lanSharingLoading, setLanSharingLoading] = useState(false);
  const [lanSharingRestartRequired, setLanSharingRestartRequired] = useState(false);
  const [lanSharingMessage, setLanSharingMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [lanPairingUrl, setLanPairingUrl] = useState('');
  const [lanQrCodeDataUrl, setLanQrCodeDataUrl] = useState('');
  const [lanDevices, setLanDevices] = useState<LanDevice[]>([]);
  const [lanDevicesLoading, setLanDevicesLoading] = useState(false);
  const [lanDeviceActionId, setLanDeviceActionId] = useState<string | null>(null);
  const [lanDeviceRemovalCandidate, setLanDeviceRemovalCandidate] = useState<LanDevice | null>(
    null
  );
  const [selectedSimcChannel, setSelectedSimcChannelState] = useState<SimcUpdateChannel>('weekly');
  const [selectedSimcRuntimeVersion, setSelectedSimcRuntimeVersionState] = useState<string | null>(
    null
  );
  const [simcChannelMessage, setSimcChannelMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [simcRuntimeInfo, setSimcRuntimeInfo] = useState<SimcRuntimeInfo | null>(null);
  const [simcRuntimeVersions, setSimcRuntimeVersions] = useState<SimcRuntimeVersionOption[]>([]);
  const [simcRuntimeVersionsLoading, setSimcRuntimeVersionsLoading] = useState(false);
  const [simcRuntimeInfoLoading, setSimcRuntimeInfoLoading] = useState(false);
  const [simcRuntimeDownloading, setSimcRuntimeDownloading] = useState(false);
  const [readiness, setReadiness] = useState<ReadinessSnapshot | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [readinessActionBusy, setReadinessActionBusy] = useState<
    'refresh' | 'retry' | 'repair' | null
  >(null);
  const {
    updateCheckState,
    updateMessage,
    appReleases,
    appReleaseMetadataStatus,
    selectedAppChannel,
    setSelectedAppChannel,
    selectedAppVersion,
    setSelectedAppVersion,
    loadAppReleases,
    downloadAndInstallLatest,
    deploymentInfo,
    dockerReleases,
    dockerReleaseMetadataStatus,
    loadDockerReleases,
    dockerUpdateStatus,
    loadDockerUpdateStatus,
    saveDockerUpdateSettings,
    triggerDockerUpdate,
  } = useSettingsUpdater({
    performanceSaved,
    hasUser: !!user,
    isAdmin: user?.role === 'admin',
  });
  const simcRuntimeControlAvailable = isDesktop || (isHostedPrivate && user?.role === 'admin');

  const refreshReadiness = useCallback(async () => {
    setReadinessLoading(true);
    setReadinessError(null);
    try {
      setReadiness(await fetchReadiness());
    } catch (err) {
      setReadiness(null);
      setReadinessError(err instanceof Error ? err.message : 'Failed to read system health.');
    } finally {
      setReadinessLoading(false);
    }
  }, []);

  const retryReadinessData = useCallback(async () => {
    setReadinessActionBusy('retry');
    try {
      await refreshDataCache();
      await refreshReadiness();
    } finally {
      setReadinessActionBusy(null);
    }
  }, [refreshDataCache, refreshReadiness]);

  const repairReadinessData = useCallback(async () => {
    setReadinessActionBusy('repair');
    try {
      await downloadAllMissingFiles();
      await refreshReadiness();
    } finally {
      setReadinessActionBusy(null);
    }
  }, [downloadAllMissingFiles, refreshReadiness]);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user) {
      router.replace('/');
      return;
    }

    fetchJson<any>(`${API_URL}/api/user/config`)
      .then((data) => {
        setClientId(data.blizzard_client_id || '');
        setHasSecret(data.has_blizzard_client_secret || false);
        const savedThreads = parseInt(data.sim_threads || '', 10);
        if (Number.isFinite(savedThreads) && savedThreads > 0) {
          setThreads(savedThreads);
        }
        const savedSimTimeout = parseInt(data.sim_timeout_seconds || '', 10);
        if (Number.isFinite(savedSimTimeout) && savedSimTimeout > 0) {
          setSimTimeoutSeconds(clampSimTimeoutSeconds(savedSimTimeout));
        }
        const savedSimIdleTimeout = parseInt(data.sim_idle_timeout_seconds || '', 10);
        if (Number.isFinite(savedSimIdleTimeout) && savedSimIdleTimeout > 0) {
          setSimIdleTimeoutSeconds(clampSimIdleTimeoutSeconds(savedSimIdleTimeout));
        }
        const savedMaxCombos = parseInt(data.max_gear_combinations || '', 10);
        if (Number.isFinite(savedMaxCombos) && savedMaxCombos > 0) {
          setMaxCombinations(savedMaxCombos);
        }
        setPerformanceSaved(true);
      })
      .catch((err) => {
        console.error('Failed to load settings:', err);
        setPerformanceSaved(true);
      })
      .finally(() => {
        setPageLoading(false);
      });
  }, [
    authLoading,
    user,
    router,
    setMaxCombinations,
    setSimIdleTimeoutSeconds,
    setSimTimeoutSeconds,
    setThreads,
  ]);

  useEffect(() => {
    if (!user || !simcRuntimeControlAvailable) {
      setParallelJobsSettingLoaded(false);
      return;
    }

    let cancelled = false;
    setParallelJobsSettingLoaded(false);
    getConfig()
      .then((config) => {
        if (cancelled) return;
        if (!Number.isFinite(config.max_parallel_jobs) || config.max_parallel_jobs < 1) return;
        setMaxParallelJobs(config.max_parallel_jobs);
        setParallelJobsSettingLoaded(true);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [simcRuntimeControlAvailable, user]);

  useEffect(() => {
    if (!authLoading && user) void refreshReadiness();
  }, [authLoading, refreshReadiness, user]);

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get(
      'tab'
    ) as SettingsTab | null;
    if (
      requestedTab &&
      [
        'health',
        'simulation',
        'defaults',
        'application',
        'integrations',
        'data',
        'updates',
        'about',
      ].includes(requestedTab)
    ) {
      setActiveTab(requestedTab);
    }
  }, []);

  useEffect(() => {
    if (!user || !isDesktop) return;
    listBlizzardCredentialProfiles()
      .then(setCredentialProfiles)
      .catch(() => setCredentialProfiles([]));
  }, [user]);

  useEffect(() => {
    fetch(`${API_URL}/health`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data.threads) {
          setMaxThreads(data.threads);
          if (threads === 0) {
            setThreads(Math.max(1, Math.round(data.threads * 0.6)));
          }
        }
      })
      .catch(() => {});
  }, [threads, setThreads]);

  useEffect(() => {
    if (!performanceSaved || !user || threads <= 0) return;
    fetchJson(`${API_URL}/api/user/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'sim_threads', value: String(threads) }),
    }).catch(() => {});
  }, [threads, performanceSaved, user]);

  useEffect(() => {
    if (!performanceSaved || !user || (maxCombinations ?? 0) <= 0) return;
    fetchJson(`${API_URL}/api/user/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'max_gear_combinations',
        value: String(maxCombinations),
      }),
    }).catch(() => {});
  }, [maxCombinations, performanceSaved, user]);

  useEffect(() => {
    if (!performanceSaved || !user || simTimeoutSeconds <= 0) return;
    fetchJson(`${API_URL}/api/user/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'sim_timeout_seconds',
        value: String(simTimeoutSeconds),
      }),
    }).catch(() => {});
  }, [performanceSaved, simTimeoutSeconds, user]);

  useEffect(() => {
    if (!performanceSaved || !user || simIdleTimeoutSeconds <= 0) return;
    fetchJson(`${API_URL}/api/user/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'sim_idle_timeout_seconds',
        value: String(simIdleTimeoutSeconds),
      }),
    }).catch(() => {});
  }, [performanceSaved, simIdleTimeoutSeconds, user]);

  useEffect(() => {
    if (!simcRuntimeControlAvailable || !parallelJobsSettingLoaded || !performanceSaved) return;
    if (!Number.isFinite(maxParallelJobs) || maxParallelJobs < 1) return;
    updateConfig({ max_parallel_jobs: Math.floor(maxParallelJobs) }).catch(() => {});
  }, [maxParallelJobs, simcRuntimeControlAvailable, parallelJobsSettingLoaded, performanceSaved]);

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    setCloseBehaviorLoading(true);
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const pref = await invoke<CloseBehaviorPreferenceResponse>('get_close_behavior_preference');
        if (cancelled) return;
        const savedValue = pref?.minimize_to_tray_on_close;
        setCloseBehaviorMode(savedValue == null ? 'ask' : savedValue ? 'tray' : 'close');
      } catch {
      } finally {
        if (!cancelled) setCloseBehaviorLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshLanDevices = useCallback(async () => {
    if (!isDesktop) return;
    setLanDevicesLoading(true);
    try {
      const devices = await fetchJson<LanDevice[]>(`${API_URL}/api/lan/devices`);
      setLanDevices(devices);
      if (devices.some((device) => device.active)) {
        setLanPairingUrl('');
        setLanQrCodeDataUrl('');
      }
    } catch {
      setLanDevices([]);
    } finally {
      setLanDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isDesktop || !lanSharingEnabled) {
      setLanDevices([]);
      return;
    }
    void refreshLanDevices();
    const interval = window.setInterval(
      () => void refreshLanDevices(),
      lanPairingUrl ? 2_000 : 10_000
    );
    return () => window.clearInterval(interval);
  }, [lanPairingUrl, lanSharingEnabled, refreshLanDevices]);

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const info = await invoke<LanAccessInfo>('get_lan_access_info');
        if (!cancelled) {
          setLanSharingEnabled(info.enabled);
          setLanSharingRestartRequired(info.restart_required);
        }
      } catch (err: any) {
        if (!cancelled) {
          setLanSharingEnabled(false);
          const detail = err?.message || err?.toString?.() || '';
          if (/command not found|not allowed/i.test(detail)) {
            setLanSharingMessage({
              type: 'error',
              text: 'LAN sharing needs the latest desktop runtime. Close and reopen the latest WhyLowDPS build.',
            });
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!simcRuntimeControlAvailable) return;
    let cancelled = false;
    (async () => {
      try {
        if (isDesktop) {
          const { invoke } = await import('@tauri-apps/api/core');
          const pref = await invoke<SimcUpdateChannelResponse>('get_simc_update_channel');
          const versionPref = await invoke<SimcRuntimeVersionPreferenceResponse>(
            'get_simc_runtime_version'
          );
          if (cancelled) return;
          setSelectedSimcChannelState(pref?.channel === 'nightly' ? 'nightly' : 'weekly');
          setSelectedSimcRuntimeVersionState(versionPref?.version || null);
          return;
        }

        const status = await fetchJson<SimcRuntimeStatusResponse>(
          `${API_URL}/api/admin/simc-runtime`
        );
        if (cancelled) return;
        setSelectedSimcChannelState(status?.channel === 'nightly' ? 'nightly' : 'weekly');
        setSelectedSimcRuntimeVersionState(null);
      } catch {
        if (!cancelled) {
          setSelectedSimcChannelState('weekly');
          setSelectedSimcRuntimeVersionState(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [simcRuntimeControlAvailable]);

  useEffect(() => {
    if (dataCacheRefreshMinutes >= 7 * 24 * 60) {
      setRefreshPreset('weekly');
      return;
    }
    if (dataCacheRefreshMinutes >= 24 * 60) {
      setRefreshPreset('daily');
      return;
    }
    setRefreshPreset('disabled');
  }, [dataCacheRefreshMinutes]);

  const testBlizzardCredentials = async () => {
    setBlizzardTesting(true);
    setBlizzardMessage(null);
    try {
      const payload: Record<string, string> = { client_id: clientId.trim() };
      payload.client_secret = clientSecret.trim();
      await fetchJson(`${API_URL}/api/user/blizzard/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      setBlizzardMessage({ type: 'success', text: 'Blizzard credentials verified successfully.' });
    } catch (err: any) {
      setBlizzardMessage({
        type: 'error',
        text: err.message || 'Failed to verify Blizzard credentials.',
      });
    }
    setBlizzardTesting(false);
  };

  const saveBlizzardSettings = async () => {
    if (!clientId.trim() && !clientSecret.trim()) return;
    setBlizzardSaving(true);
    setBlizzardMessage(null);
    try {
      await fetchJson(`${API_URL}/api/user/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'blizzard_client_id', value: clientId.trim() }),
      });

      if (clientSecret.trim()) {
        const profile = await saveBlizzardCredentialProfile({
          name: credentialName.trim() || 'Main credentials',
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
        });
        setCredentialProfiles((profiles) => {
          const next = profiles.filter((item) => item.id !== profile.id);
          return [...next, profile];
        });
        setHasSecret(true);
        setCredentialName('');
        setClientSecret('');
        setSecretTouched(false);
      }
      setBlizzardMessage({ type: 'success', text: 'Blizzard credentials saved securely.' });
    } catch (err: any) {
      setBlizzardMessage({
        type: 'error',
        text: err?.message || 'Failed to save Blizzard settings.',
      });
    } finally {
      setBlizzardSaving(false);
    }
  };

  const renameSavedCredential = async (id: string, nextName: string) => {
    const trimmedName = nextName.trim();
    if (!trimmedName) return;
    try {
      const profile = await renameBlizzardCredentialProfile(id, trimmedName);
      setCredentialProfiles((profiles) =>
        profiles.map((item) => (item.id === id ? profile : item))
      );
    } catch (err: any) {
      setBlizzardMessage({ type: 'error', text: err?.message || 'Failed to rename credentials.' });
    }
  };

  const deleteSavedCredential = async (id: string) => {
    if (!window.confirm('Remove these saved Blizzard credentials from this device?')) return;
    try {
      await deleteBlizzardCredentialProfile(id);
      setCredentialProfiles((profiles) => profiles.filter((profile) => profile.id !== id));
    } catch (err: any) {
      setBlizzardMessage({ type: 'error', text: err?.message || 'Failed to remove credentials.' });
    }
  };

  const updateCloseBehavior = async (nextMode: CloseBehaviorMode) => {
    if (!isDesktop) return;
    setCloseBehaviorMessage(null);
    const previous = closeBehaviorMode;
    setCloseBehaviorMode(nextMode);
    setCloseBehaviorLoading(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      if (nextMode === 'ask') {
        await invoke('clear_close_behavior_preference');
      } else {
        const nextValue = nextMode === 'tray';
        try {
          await invoke('set_close_behavior_preference', {
            minimizeToTrayOnClose: nextValue,
          });
        } catch {
          await invoke('set_close_behavior_preference', {
            minimize_to_tray_on_close: nextValue,
          });
        }
      }
      setCloseBehaviorMessage({
        type: 'success',
        text:
          nextMode === 'ask'
            ? 'Close action updated: ask every time.'
            : `Close action updated: ${nextMode === 'tray' ? 'minimize to tray' : 'close app'}.`,
      });
    } catch (err: any) {
      const detail =
        err?.message || err?.toString?.() || (typeof err === 'string' ? err : '') || '';
      setCloseBehaviorMode(previous);
      setCloseBehaviorMessage({
        type: 'error',
        text:
          nextMode === 'ask' && /command not found|not allowed/i.test(detail)
            ? 'Ask Every Time requires the latest desktop runtime. Restart the app and try again.'
            : detail || 'Failed to update close behavior.',
      });
    } finally {
      setCloseBehaviorLoading(false);
    }
  };

  const updateLanSharing = async (enabled: boolean) => {
    if (!isDesktop) return;
    setLanSharingLoading(true);
    setLanSharingMessage(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_lan_sharing_enabled', { enabled });
      setLanSharingEnabled(enabled);
      setLanPairingUrl('');
      setLanQrCodeDataUrl('');
      const info = await invoke<LanAccessInfo>('get_lan_access_info');
      setLanSharingRestartRequired(info.restart_required);
      setLanSharingMessage({
        type: 'success',
        text: info.restart_required
          ? 'Saved. Restart WhyLowDPS to apply this change.'
          : 'LAN sharing is already using this setting.',
      });
    } catch (err: any) {
      const detail = err?.message || err?.toString?.() || '';
      setLanSharingMessage({
        type: 'error',
        text: /command not found|not allowed/i.test(detail)
          ? 'LAN sharing needs the latest desktop runtime. Close and reopen the latest WhyLowDPS build, then try again.'
          : detail || 'Failed to update LAN sharing.',
      });
    } finally {
      setLanSharingLoading(false);
    }
  };

  const createLanPairingLink = async (deviceId?: string) => {
    if (!isDesktop || !lanSharingEnabled) return;
    setLanSharingLoading(true);
    setLanSharingMessage(null);
    try {
      const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
      const pairing = await fetchJson<{ path: string }>(`${API_URL}/api/lan/pairing${query}`, {
        method: 'POST',
      });
      const { invoke } = await import('@tauri-apps/api/core');
      const info = await invoke<LanAccessInfo>('get_lan_access_info');
      const address = info.addresses[0];
      if (!address) {
        throw new Error('No private IPv4 address was detected on this PC.');
      }

      const url = `http://${address}:17384${pairing.path}`;
      setLanPairingUrl(url);
      const { toDataURL } = await import('qrcode');
      setLanQrCodeDataUrl(
        await toDataURL(url, {
          errorCorrectionLevel: 'M',
          margin: 4,
          width: 320,
          color: { dark: '#111111', light: '#ffffff' },
        })
      );
      try {
        await navigator.clipboard.writeText(url);
        setLanSharingMessage({
          type: 'success',
          text: 'Phone link copied. It expires after five minutes and works once.',
        });
      } catch {
        setLanSharingMessage({
          type: 'success',
          text: 'Phone link created. Copy it to your phone within five minutes.',
        });
      }
    } catch (err: any) {
      setLanSharingMessage({
        type: 'error',
        text:
          err?.message ||
          err?.toString?.() ||
          'Could not create a phone link. Restart WhyLowDPS after enabling LAN sharing.',
      });
    } finally {
      setLanSharingLoading(false);
    }
  };

  const renameLanDevice = async (device: LanDevice) => {
    const name = window.prompt('Name this paired device', device.name)?.trim();
    if (!name || name === device.name) return;

    setLanDeviceActionId(device.id);
    setLanSharingMessage(null);
    try {
      await fetchJson(`${API_URL}/api/lan/devices/${encodeURIComponent(device.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      await refreshLanDevices();
      setLanSharingMessage({ type: 'success', text: 'Device name updated.' });
    } catch (err: any) {
      setLanSharingMessage({
        type: 'error',
        text: err?.message || 'Failed to rename the device.',
      });
    } finally {
      setLanDeviceActionId(null);
    }
  };

  const removeLanDevice = async (device: LanDevice) => {
    setLanDeviceActionId(device.id);
    setLanSharingMessage(null);
    try {
      await fetchJson(`${API_URL}/api/lan/devices/${encodeURIComponent(device.id)}`, {
        method: 'DELETE',
      });
      await refreshLanDevices();
      setLanSharingMessage({ type: 'success', text: `${device.name} no longer has LAN access.` });
    } catch (err: any) {
      setLanSharingMessage({
        type: 'error',
        text: err?.message || 'Failed to remove the device.',
      });
    } finally {
      setLanDeviceActionId(null);
    }
  };

  useEffect(() => {
    if (!lanDeviceRemovalCandidate) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLanDeviceRemovalCandidate(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lanDeviceRemovalCandidate]);

  const restartForLanSharing = async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('restart_app');
  };

  const loadSimcRuntimeInfo = async (
    channel: SimcUpdateChannel,
    options?: { forceRefresh?: boolean }
  ) => {
    if (!simcRuntimeControlAvailable) return;
    setSimcRuntimeInfoLoading(true);
    try {
      if (isDesktop) {
        const info = await fetchSimcRuntimeInfo(channel, options);
        setSimcRuntimeInfo(info);
      } else {
        const status = await fetchJson<SimcRuntimeStatusResponse>(
          `${API_URL}/api/admin/simc-runtime`
        );
        setSimcRuntimeInfo({
          channel: status?.channel === 'nightly' ? 'nightly' : 'weekly',
          version: status?.version || 'Unavailable',
          metadataStatus: status?.version ? 'available' : 'unavailable',
        });
      }
    } catch (err: any) {
      setSimcChannelMessage({
        type: 'error',
        text: err?.message || err?.toString?.() || 'Failed to load SimC runtime status.',
      });
    } finally {
      setSimcRuntimeInfoLoading(false);
    }
  };

  const loadSimcRuntimeVersions = async () => {
    setSimcRuntimeVersionsLoading(true);
    const versions = await fetchSimcRuntimeVersions();
    setSimcRuntimeVersions(versions);
    setSimcRuntimeVersionsLoading(false);
  };

  useEffect(() => {
    if (!simcRuntimeControlAvailable) return;
    void loadSimcRuntimeInfo(selectedSimcChannel);
  }, [selectedSimcChannel, simcRuntimeControlAvailable]);

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    setSimcRuntimeVersionsLoading(true);
    fetchSimcRuntimeVersions()
      .then((versions) => {
        if (!cancelled) setSimcRuntimeVersions(versions);
      })
      .finally(() => {
        if (!cancelled) setSimcRuntimeVersionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setSelectedSimcChannel = async (nextChannel: SimcUpdateChannel) => {
    if (!simcRuntimeControlAvailable) return;
    const previous = selectedSimcChannel;
    setSelectedSimcChannelState(nextChannel);
    setSimcChannelMessage(null);
    let savedChannel: SimcUpdateChannel;
    try {
      if (isDesktop) {
        const { invoke } = await import('@tauri-apps/api/core');
        const pref = await invoke<SimcUpdateChannelResponse>('set_simc_update_channel', {
          channel: nextChannel,
        });
        await invoke('set_simc_runtime_version', { version: null });
        savedChannel = pref?.channel === 'nightly' ? 'nightly' : 'weekly';
      } else {
        const status = await fetchJson<SimcRuntimeStatusResponse>(
          `${API_URL}/api/admin/simc-runtime`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel: nextChannel }),
          }
        );
        savedChannel = status?.channel === 'nightly' ? 'nightly' : 'weekly';
        setSimcRuntimeInfo({
          channel: savedChannel,
          version: status?.version || 'Unavailable',
          metadataStatus: status?.version ? 'available' : 'unavailable',
        });
      }
      setSelectedSimcChannelState(savedChannel);
      setSelectedSimcRuntimeVersionState(null);
      window.dispatchEvent(new Event(SIMC_RUNTIME_UPDATED_EVENT));
    } catch (err: any) {
      setSelectedSimcChannelState(previous);
      setSimcChannelMessage({
        type: 'error',
        text: err?.message || err?.toString?.() || 'Failed to update SimC channel.',
      });
      return;
    }

    setSimcChannelMessage({
      type: 'success',
      text: isDesktop
        ? `SimC channel saved as ${savedChannel}.`
        : `Docker SimC runtime switched to ${savedChannel}.`,
    });
  };

  const setSelectedSimcRuntimeVersion = async (value: string) => {
    if (!isDesktop) return;
    const previousChannel = selectedSimcChannel;
    const previousVersion = selectedSimcRuntimeVersion;
    const { invoke } = await import('@tauri-apps/api/core');
    const [mode, selected] = value.split(':', 2);
    const nextChannel =
      selected === 'nightly' || selected?.startsWith('nightly-') ? 'nightly' : 'weekly';
    const nextVersion = mode === 'version' ? selected : null;
    setSelectedSimcChannelState(nextChannel);
    setSelectedSimcRuntimeVersionState(nextVersion);
    setSimcChannelMessage(null);
    try {
      await invoke<SimcUpdateChannelResponse>('set_simc_update_channel', { channel: nextChannel });
      const pref = await invoke<SimcRuntimeVersionPreferenceResponse>('set_simc_runtime_version', {
        version: nextVersion,
      });
      setSelectedSimcRuntimeVersionState(pref?.version || null);
      setSimcChannelMessage({
        type: 'success',
        text: nextVersion
          ? `SimC pinned to ${nextVersion}.`
          : `SimC will follow latest ${nextChannel}.`,
      });
    } catch (err: any) {
      setSelectedSimcChannelState(previousChannel);
      setSelectedSimcRuntimeVersionState(previousVersion);
      setSimcChannelMessage({
        type: 'error',
        text: err?.message || err?.toString?.() || 'Failed to update SimC version.',
      });
    }
  };

  const downloadSelectedSimcRuntime = async () => {
    if (!simcRuntimeControlAvailable || simcRuntimeDownloading) return;
    const channel = selectedSimcChannel;
    setSimcRuntimeDownloading(true);
    setSimcChannelMessage({
      type: 'success',
      text: `Downloading ${channel} SimC runtime...`,
    });
    try {
      let status: SimcRuntimeStatusResponse;
      if (isDesktop) {
        const { invoke } = await import('@tauri-apps/api/core');
        status = await invoke<SimcRuntimeStatusResponse>('update_simc_runtime', {
          channel,
          version: selectedSimcRuntimeVersion,
        });
      } else {
        status = await fetchJson<SimcRuntimeStatusResponse>(`${API_URL}/api/admin/simc-runtime`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel }),
        });
        setSimcRuntimeInfo({
          channel: status?.channel === 'nightly' ? 'nightly' : 'weekly',
          version: status?.version || 'Unavailable',
          metadataStatus: status?.version ? 'available' : 'unavailable',
        });
      }
      const version = status?.version ? ` (${status.version})` : '';
      window.dispatchEvent(new Event(SIMC_RUNTIME_UPDATED_EVENT));
      setSimcChannelMessage({
        type: 'success',
        text: status?.updated
          ? `SimC ${channel} runtime downloaded${version}.`
          : `SimC ${selectedSimcRuntimeVersion || channel} runtime is already up to date${version}.`,
      });
      await loadSimcRuntimeInfo(channel);
    } catch (err: any) {
      setSimcChannelMessage({
        type: 'error',
        text: err?.message || err?.toString?.() || `SimC ${channel} runtime download failed.`,
      });
    } finally {
      setSimcRuntimeDownloading(false);
    }
  };

  const activePresetIdx = SIMULATION_PERFORMANCE_PRESETS.findIndex(
    (p) => maxThreads > 0 && getPresetThreads(maxThreads, p.pct) === threads
  );

  const selectSettingsTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    router.replace(`/settings?tab=${tab}`, { scroll: false });
  };

  if (authLoading || pageLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-gold"></div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 space-y-8 duration-500">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-white">Settings</h1>
        <p className="mt-2 text-zinc-400">Manage your account and integrations.</p>
      </header>

      <div role="tablist" aria-label="Settings sections" className="flex flex-wrap gap-2">
        {[
          { id: 'health', label: 'Health' },
          { id: 'simulation', label: 'Simulation' },
          { id: 'defaults', label: 'Defaults' },
          { id: 'application', label: 'Application' },
          { id: 'integrations', label: 'Integrations' },
          { id: 'data', label: 'Data Cache' },
          { id: 'updates', label: isHostedPrivate ? 'Docker Updates' : 'App Updates' },
          { id: 'about', label: 'About' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => selectSettingsTab(tab.id as SettingsTab)}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`settings-panel-${tab.id}`}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === tab.id
                ? 'border-gold/40 bg-gold/15 text-gold'
                : 'border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'health' && (
        <ReadinessPanel
          variant="details"
          snapshot={readiness}
          loading={readinessLoading}
          error={readinessError}
          authenticated={Boolean(user)}
          lightMode={false}
          onRefresh={() => void refreshReadiness()}
          onRetryData={() => void retryReadinessData()}
          onRepairData={() => void repairReadinessData()}
          onViewData={() => void viewDataStates()}
          actionBusy={readinessActionBusy}
        />
      )}

      {activeTab === 'defaults' && (
        <div id="settings-panel-defaults">
          <DefaultOptionsSettingsCard />
        </div>
      )}

      {activeTab === 'integrations' && (
        <div className="space-y-6">
          {isHostedPrivate ? (
            <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
              <h2 className="mb-3 text-xl font-semibold text-white">API Integrations</h2>
              <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
                Blizzard API access is configured by the hosted server administrator. Client secrets
                are not entered or stored in this browser.
              </p>
            </section>
          ) : (
            <IntegrationsSettingsSection
              clientId={clientId}
              setClientId={setClientId}
              clientSecret={clientSecret}
              setClientSecret={setClientSecret}
              credentialName={credentialName}
              setCredentialName={setCredentialName}
              credentialProfiles={credentialProfiles}
              renameSavedCredential={renameSavedCredential}
              deleteSavedCredential={deleteSavedCredential}
              secretTouched={secretTouched}
              setSecretTouched={setSecretTouched}
              hasSecret={hasSecret}
              blizzardTesting={blizzardTesting}
              blizzardSaving={blizzardSaving}
              testBlizzardCredentials={testBlizzardCredentials}
              saveBlizzardSettings={saveBlizzardSettings}
              blizzardMessage={blizzardMessage}
            />
          )}
          {isHostedPrivate && <DiscordWebhookSettings />}
        </div>
      )}

      {activeTab === 'simulation' && (
        <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
          <h2 className="mb-6 text-xl font-semibold text-white">Simulation Performance</h2>
          <div className="max-w-2xl space-y-6">
            {maxThreads > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-300">CPU Threads</span>
                  <span className="rounded border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px] tabular-nums text-white">
                    {threads}/{maxThreads}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {SIMULATION_PERFORMANCE_PRESETS.map((p, i) => {
                    const val = getPresetThreads(maxThreads, p.pct);
                    return (
                      <button
                        key={p.label}
                        onClick={() => setThreads(val)}
                        className={`rounded-lg border px-3 py-2 text-center transition-all ${
                          activePresetIdx === i
                            ? 'border-white bg-white text-black'
                            : 'border-border bg-surface-2 text-zinc-400 hover:border-gray-500 hover:text-white'
                        }`}
                      >
                        <span className="block text-[12px] font-semibold">{p.label}</span>
                        <span className="mt-0.5 block text-[10px] opacity-70">{val} threads</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-border pt-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-zinc-300">Max Gear Combos</p>
                <p className="text-[12px] text-zinc-500">Limits Top Gear simulation runtime.</p>
              </div>
              <input
                type="number"
                min={10}
                max={100000}
                step={50}
                value={maxCombinations ?? 500}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (Number.isFinite(val) && val > 0) setMaxCombinations(val);
                }}
                className="w-24 rounded border border-border bg-surface-2 px-2 py-1 text-center font-mono text-xs tabular-nums text-white [appearance:textfield] focus:border-gold/50 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>

            {simcRuntimeControlAvailable && (
              <div className="border-border flex items-center justify-between gap-4 border-t pt-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-zinc-300">Parallel simulations</p>
                  <p className="max-w-xl text-[12px] text-zinc-500">
                    Run this many simulations at once. Additional simulations stay queued until a
                    slot is available.
                  </p>
                  {isHostedPrivate && (
                    <p className="text-gold/80 text-[11px]">Only administrators can change this.</p>
                  )}
                </div>
                <input
                  aria-label="Parallel simulations"
                  type="number"
                  min={1}
                  step={1}
                  value={maxParallelJobs}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (Number.isFinite(val) && val > 0) setMaxParallelJobs(val);
                  }}
                  className="border-border bg-surface-2 focus:border-gold/50 w-24 [appearance:textfield] rounded border px-2 py-1 text-center font-mono text-xs text-white tabular-nums focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>
            )}

            <div className="space-y-3 border-t border-border pt-4">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Simulation timeouts</h3>
                <p className="mt-1 text-[12px] text-zinc-500">
                  Total runtime defaults to 2 hours. The no-output timeout stops a run that stops
                  producing progress.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-[12px] font-medium text-zinc-400">Total timeout</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={MIN_SIM_TIMEOUT_SECONDS / 3600}
                      max={MAX_SIM_TIMEOUT_SECONDS / 3600}
                      step={0.25}
                      value={simTimeoutSeconds / 3600}
                      onChange={(e) => {
                        const hours = Number(e.target.value);
                        if (Number.isFinite(hours)) {
                          setSimTimeoutSeconds(hours * 3600);
                        }
                      }}
                      className="w-24 rounded border border-border bg-surface-2 px-2 py-1 text-center font-mono text-xs tabular-nums text-white [appearance:textfield] focus:border-gold/50 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <span className="text-xs text-zinc-500">hours</span>
                  </div>
                </label>
                <label className="space-y-1.5">
                  <span className="text-[12px] font-medium text-zinc-400">No-output timeout</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={MIN_SIM_IDLE_TIMEOUT_SECONDS / 60}
                      max={MAX_SIM_IDLE_TIMEOUT_SECONDS / 60}
                      step={1}
                      value={Math.round(simIdleTimeoutSeconds / 60)}
                      onChange={(e) => {
                        const minutes = Number(e.target.value);
                        if (Number.isFinite(minutes)) {
                          setSimIdleTimeoutSeconds(minutes * 60);
                        }
                      }}
                      className="w-24 rounded border border-border bg-surface-2 px-2 py-1 text-center font-mono text-xs tabular-nums text-white [appearance:textfield] focus:border-gold/50 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <span className="text-xs text-zinc-500">minutes</span>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'application' && (
        <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
          <h2 className="mb-3 text-xl font-semibold text-white">Clipboard Import</h2>
          <p className="mb-5 text-sm text-zinc-400">
            When the app regains focus, it can check the latest clipboard text and auto-fill the
            SimC export box if it looks like a valid SimC string.
          </p>

          <div className="space-y-4">
            <div className="flex max-w-2xl items-center justify-between gap-4 rounded-lg border border-border/60 bg-surface-2/60 px-4 py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-200">
                  Auto paste latest SimC from clipboard
                </p>
                <p className="text-[13px] text-zinc-500">
                  Read the latest clipboard entry and automatically paste it into the main input if
                  it looks like a SimC profile.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAutoClipboardPasteSimc(!autoClipboardPasteSimc)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  autoClipboardPasteSimc ? 'bg-gold' : 'border border-border bg-surface'
                }`}
                aria-pressed={autoClipboardPasteSimc}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
                    autoClipboardPasteSimc ? 'left-[22px] bg-black' : 'left-0.5 bg-gray-500'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'application' && isDesktop && (
        <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
          <h2 className="mb-3 text-xl font-semibold text-white">Close Behavior</h2>
          <p className="mb-5 text-sm text-zinc-400">
            Choose what happens when you close the app window.
          </p>

          <div className="max-w-2xl space-y-4">
            <div className="inline-flex rounded-lg border border-border bg-surface-2 p-1">
              <button
                type="button"
                disabled={closeBehaviorLoading}
                onClick={() => void updateCloseBehavior('ask')}
                className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
                  closeBehaviorMode === 'ask'
                    ? 'bg-white text-black'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                Ask Every Time
              </button>
              <button
                type="button"
                disabled={closeBehaviorLoading}
                onClick={() => void updateCloseBehavior('close')}
                className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
                  closeBehaviorMode === 'close'
                    ? 'bg-white text-black'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                Close App
              </button>
              <button
                type="button"
                disabled={closeBehaviorLoading}
                onClick={() => void updateCloseBehavior('tray')}
                className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
                  closeBehaviorMode === 'tray'
                    ? 'bg-gold/20 text-gold'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                Minimize to Tray
              </button>
            </div>

            {closeBehaviorMessage ? (
              <p
                className={`text-xs ${
                  closeBehaviorMessage.type === 'success' ? 'text-emerald-300' : 'text-red-300'
                }`}
              >
                {closeBehaviorMessage.text}
              </p>
            ) : null}
          </div>
        </section>
      )}

      {activeTab === 'application' && isDesktop && (
        <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
          <h2 className="mb-3 text-xl font-semibold text-white">Share over LAN</h2>
          <p className="mb-5 max-w-2xl text-sm text-zinc-400">
            Open WhyLowDPS from your phone on the same private Wi-Fi network. Anyone with the
            pairing link can operate this local app and use the PC&apos;s current account session.
          </p>

          <div className="max-w-2xl space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-surface-2/60 px-4 py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-200">Share this app over LAN</p>
                <p className="text-[13px] text-zinc-500">
                  Keep this off unless the network is trusted. No internet or port-forwarding access
                  is supported.
                </p>
              </div>
              <button
                type="button"
                disabled={lanSharingLoading}
                onClick={() => void updateLanSharing(!lanSharingEnabled)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  lanSharingEnabled ? 'bg-gold' : 'border border-border bg-surface'
                }`}
                aria-label="Share this app over LAN"
                aria-pressed={lanSharingEnabled}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
                    lanSharingEnabled ? 'left-[22px] bg-black' : 'left-0.5 bg-gray-500'
                  }`}
                />
              </button>
            </div>

            {(lanSharingEnabled || lanSharingRestartRequired) && (
              <div className="space-y-3 rounded-lg border border-gold/20 bg-gold/5 p-4">
                {lanSharingRestartRequired && (
                  <p className="text-xs text-gold">
                    Restart required before this LAN setting takes effect.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {lanSharingRestartRequired && (
                    <button
                      type="button"
                      onClick={() => void restartForLanSharing()}
                      className="rounded-lg bg-gold px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-gold/90"
                    >
                      Restart WhyLowDPS
                    </button>
                  )}
                  {lanSharingEnabled && (
                    <button
                      type="button"
                      disabled={lanSharingLoading}
                      onClick={() => void createLanPairingLink()}
                      className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-gold/40 hover:text-white disabled:opacity-50"
                    >
                      New pairing link
                    </button>
                  )}
                </div>
                {lanPairingUrl && (
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    {lanQrCodeDataUrl && (
                      <div className="shrink-0 space-y-2">
                        <div className="w-fit rounded-xl bg-white p-3">
                          <img
                            src={lanQrCodeDataUrl}
                            alt="Scan this QR code to open WhyLowDPS on your phone"
                            width={320}
                            height={320}
                            className="h-64 w-64 sm:h-80 sm:w-80"
                          />
                        </div>
                        <p className="max-w-80 text-center text-[11px] text-zinc-500">
                          Scan with your phone camera while both devices are on the same Wi-Fi.
                        </p>
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-2">
                      <label
                        className="block text-xs font-medium text-zinc-400"
                        htmlFor="lan-pairing-url"
                      >
                        One-time phone link
                      </label>
                      <div className="flex flex-col gap-2">
                        <input
                          id="lan-pairing-url"
                          readOnly
                          value={lanPairingUrl}
                          className="min-w-0 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-zinc-200 focus:border-gold/50 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard.writeText(lanPairingUrl)}
                          className="w-fit rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-gold/40 hover:text-white"
                        >
                          Copy link
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {lanSharingEnabled && (
              <div className="space-y-3 rounded-lg border border-border/60 bg-surface-2/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-200">Paired devices</h3>
                    <p className="text-xs text-zinc-500">
                      Paired sessions survive app restarts. Phones send presence while open and are
                      marked offline when closed or unreachable.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={lanDevicesLoading}
                    onClick={() => void refreshLanDevices()}
                    className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-gold/40 hover:text-white disabled:opacity-50"
                  >
                    {lanDevicesLoading ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>

                {lanDevices.length === 0 && !lanDevicesLoading ? (
                  <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-xs text-zinc-500">
                    No phones or browsers have been paired yet. Create a new phone link above to add
                    one.
                  </p>
                ) : null}

                <div className="space-y-2">
                  {lanDevices.map((device) => (
                    <div
                      key={device.id}
                      className="flex flex-col gap-3 rounded-lg border border-border/60 bg-surface/50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium text-zinc-200">
                            {device.name}
                          </p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              device.active
                                ? 'bg-emerald-400/10 text-emerald-300'
                                : 'bg-zinc-700/40 text-zinc-500'
                            }`}
                          >
                            {device.active ? 'Connected' : 'Offline'}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-zinc-500">
                          Paired {formatLanDeviceDate(device.paired_at)} · Last seen{' '}
                          {formatLanDeviceDate(device.last_seen_at)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          disabled={lanSharingLoading || lanDeviceActionId === device.id}
                          onClick={() => void createLanPairingLink(device.id)}
                          className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-gold/40 hover:text-white disabled:opacity-50"
                        >
                          New link
                        </button>
                        <button
                          type="button"
                          disabled={lanDeviceActionId === device.id}
                          onClick={() => void renameLanDevice(device)}
                          className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-gold/40 hover:text-white disabled:opacity-50"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          disabled={lanDeviceActionId === device.id}
                          onClick={() => setLanDeviceRemovalCandidate(device)}
                          className="rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs font-semibold text-red-300 hover:border-red-300/60 hover:text-red-200 disabled:opacity-50"
                        >
                          Remove access
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {lanSharingMessage ? (
              <p
                className={`text-xs ${
                  lanSharingMessage.type === 'success' ? 'text-emerald-300' : 'text-red-300'
                }`}
              >
                {lanSharingMessage.text}
              </p>
            ) : null}
          </div>
        </section>
      )}

      {activeTab === 'data' && (
        <div className="space-y-6">
          <DataCacheSettingsSection
            refreshPreset={refreshPreset}
            setRefreshPreset={setRefreshPreset}
            setDataCacheRefreshMinutes={setDataCacheRefreshMinutes}
            cacheSyncing={cacheSyncing}
            refreshDataCache={refreshDataCache}
            viewDataStates={viewDataStates}
            syncProgress={syncProgress}
            syncProgressPct={syncProgressPct}
            cacheMessage={cacheMessage}
          />
          {isDesktop && <LocalBackupSection />}
        </div>
      )}

      {activeTab === 'updates' && (
        <UpdatesSettingsSection
          selectedSimcChannel={selectedSimcChannel}
          setSelectedSimcChannel={setSelectedSimcChannel}
          selectedSimcRuntimeVersion={selectedSimcRuntimeVersion}
          setSelectedSimcRuntimeVersion={setSelectedSimcRuntimeVersion}
          simcRuntimeVersions={simcRuntimeVersions}
          simcRuntimeVersionsLoading={simcRuntimeVersionsLoading}
          simcRuntimeInfo={simcRuntimeInfo}
          simcRuntimeInfoLoading={simcRuntimeInfoLoading}
          simcRuntimeDownloading={simcRuntimeDownloading}
          refreshSimcRuntimeInfo={() => {
            void loadSimcRuntimeInfo(selectedSimcChannel, { forceRefresh: true });
            void loadSimcRuntimeVersions();
          }}
          downloadSelectedSimcRuntime={downloadSelectedSimcRuntime}
          simcChannelMessage={simcChannelMessage}
          isDesktopRuntime={simcRuntimeControlAvailable}
          isHostedPrivateRuntime={isHostedPrivate}
          updateCheckState={updateCheckState}
          appReleases={appReleases}
          appReleaseMetadataStatus={appReleaseMetadataStatus}
          selectedAppChannel={selectedAppChannel}
          setSelectedAppChannel={setSelectedAppChannel}
          dockerReleases={dockerReleases}
          dockerReleaseMetadataStatus={dockerReleaseMetadataStatus}
          selectedAppVersion={selectedAppVersion}
          setSelectedAppVersion={setSelectedAppVersion}
          loadAppReleases={loadAppReleases}
          downloadAndInstallLatest={downloadAndInstallLatest}
          updateMessage={updateMessage}
          deploymentInfo={deploymentInfo}
          loadDockerReleases={loadDockerReleases}
          dockerUpdateStatus={dockerUpdateStatus}
          loadDockerUpdateStatus={loadDockerUpdateStatus}
          saveDockerUpdateSettings={saveDockerUpdateSettings}
          triggerDockerUpdate={triggerDockerUpdate}
          dockerUpdateControlAvailable={isHostedPrivate && user?.role === 'admin'}
        />
      )}

      {activeTab === 'about' && (
        <section className="space-y-6 rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
              About WhyLowDPS
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Simulation tools with clear setup
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
              WhyLowDPS helps you understand character performance with repeatable SimulationCraft
              runs and Blizzard character data. The app reports the local setup state so you can
              repair the next blocker without guessing.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-surface-2/50 p-4">
              <p className="text-xs text-zinc-500">Version</p>
              <p className="mt-1 font-semibold text-zinc-100">
                {readiness?.app.version || APP_VERSION_WITH_PREFIX}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Revision {readiness?.app.revision || 'unknown'}
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-surface-2/50 p-4">
              <p className="text-xs text-zinc-500">Deployment mode</p>
              <p className="mt-1 font-semibold capitalize text-zinc-100">
                {readiness?.app.mode || 'unknown'}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Runtime and data remain scoped to this installation or hosted server.
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-surface-2/50 p-4">
            <h3 className="font-semibold text-zinc-100">Privacy and security</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Blizzard credentials are stored using the app&apos;s existing protected credential
              flow and are used only for the integrations you enable. Readiness checks expose status
              and counts, never secrets or local filesystem paths. LAN access remains paired and
              scoped to the devices you approve.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <a
              className="text-gold hover:underline"
              href="https://github.com/JosephLteif/WhyLowDPS"
              target="_blank"
              rel="noreferrer"
            >
              Documentation
            </a>
            <a
              className="text-gold hover:underline"
              href={CHANGELOG_HISTORY_URL}
              target="_blank"
              rel="noreferrer"
            >
              Changelog history
            </a>
            <a
              className="text-gold hover:underline"
              href="https://github.com/JosephLteif/WhyLowDPS/blob/main/CHANGELOG.md"
              target="_blank"
              rel="noreferrer"
            >
              Repository changelog
            </a>
            <a
              className="text-gold hover:underline"
              href="https://github.com/JosephLteif/WhyLowDPS/issues"
              target="_blank"
              rel="noreferrer"
            >
              Support and issue tracker
            </a>
          </div>
        </section>
      )}

      <DataFileStateModal
        isOpen={dataStateOpen}
        onClose={() => setDataStateOpen(false)}
        disableOutsideDismiss={dataFilePreviewOpen}
        isDesktop={isDesktop}
        dataFileStates={dataFileStates}
        dataStateLoading={dataStateLoading}
        dataStateError={dataStateError}
        dataStateMessage={dataStateMessage}
        dataActionBusyKey={dataActionBusyKey}
        groupedDataFiles={groupedDataFiles}
        refreshDataStates={refreshDataStates}
        downloadAllMissingFiles={downloadAllMissingFiles}
        openDataRootDirectory={openDataRootDirectory}
        downloadFile={downloadFile}
        showFileContent={showFileContent}
        dataFilePreviewLoading={dataFilePreviewLoading}
      />
      <DataFilePreviewModal
        isOpen={dataFilePreviewOpen}
        onClose={() => setDataFilePreviewOpen(false)}
        dataFilePreview={dataFilePreview}
        dataFilePreviewLoading={dataFilePreviewLoading}
        dataFilePreviewError={dataFilePreviewError}
      />
      {lanDeviceRemovalCandidate && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLanDeviceRemovalCandidate(null);
          }}
        >
          <section
            className="w-full max-w-md rounded-2xl border border-red-400/25 bg-[#171012] p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-lan-device-title"
            aria-describedby="remove-lan-device-description"
          >
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-red-300/80">
              Revoke device access
            </p>
            <h2 id="remove-lan-device-title" className="mt-2 text-xl font-semibold text-white">
              Remove {lanDeviceRemovalCandidate.name}?
            </h2>
            <p
              id="remove-lan-device-description"
              className="mt-3 text-sm leading-relaxed text-zinc-400"
            >
              This immediately ends the device&apos;s current session. The device can only reconnect
              after you create and scan a new pairing QR code.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setLanDeviceRemovalCandidate(null)}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10"
              >
                Keep access
              </button>
              <button
                type="button"
                onClick={() => {
                  const device = lanDeviceRemovalCandidate;
                  setLanDeviceRemovalCandidate(null);
                  void removeLanDevice(device);
                }}
                className="rounded-lg bg-red-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-red-400"
              >
                Remove access
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL, fetchJson, isDesktop, isHostedPrivate } from '../lib/api';
import { APP_VERSION } from '../lib/version';
import {
  fetchDockerImageReleases,
  fetchAppReleases,
  type AppReleaseInfo,
  type DockerImageReleaseInfo,
} from '../lib/updater-release';
import { readStoredUpdateChannel, type UpdateChannel } from '../lib/update-channel';
import type {
  DeploymentInfo,
  DockerUpdateMode,
  DockerUpdateStatus,
  SettingsStatusMessage,
} from './types';

type UpdateCheckState = 'idle' | 'checking' | 'installing';

type UseSettingsUpdaterArgs = {
  performanceSaved: boolean;
  hasUser: boolean;
  isAdmin?: boolean;
};

export function useSettingsUpdater({
  performanceSaved,
  hasUser,
  isAdmin = false,
}: UseSettingsUpdaterArgs) {
  const [updateCheckState, setUpdateCheckState] = useState<UpdateCheckState>('idle');
  const [updateMessage, setUpdateMessage] = useState<SettingsStatusMessage | null>(null);
  const [appReleases, setAppReleases] = useState<AppReleaseInfo[]>([]);
  const [appReleaseMetadataStatus, setAppReleaseMetadataStatus] = useState<
    'available' | 'rate_limited' | 'unavailable'
  >('unavailable');
  const [selectedAppVersion, setSelectedAppVersion] = useState('');
  const [selectedAppChannel, setSelectedAppChannelState] = useState<UpdateChannel>('stable');
  const [appChannelLoaded, setAppChannelLoaded] = useState(!isDesktop);
  const persistedAppChannelRef = useRef<UpdateChannel>('stable');
  const skipAppChannelSaveRef = useRef(false);
  const [deploymentInfo, setDeploymentInfo] = useState<DeploymentInfo | null>(null);
  const [dockerReleases, setDockerReleases] = useState<DockerImageReleaseInfo[]>([]);
  const [dockerReleaseMetadataStatus, setDockerReleaseMetadataStatus] = useState<
    'available' | 'rate_limited' | 'unavailable'
  >('unavailable');
  const [dockerUpdateStatus, setDockerUpdateStatus] = useState<DockerUpdateStatus | null>(null);

  useEffect(() => {
    const onUpdaterStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ status?: string; message?: string }>).detail;
      const status = detail?.status || '';
      const message = detail?.message || '';

      if (status === 'checking') {
        setUpdateCheckState('checking');
        setUpdateMessage(null);
        return;
      }

      setUpdateCheckState('idle');
      if (status === 'available') {
        setUpdateMessage({
          type: 'success',
          text: message || 'Update available. Use the bottom-right updater popup to install.',
        });
      } else if (status === 'downloading') {
        setUpdateMessage({
          type: 'success',
          text: message || 'Downloading and installing update...',
        });
      } else if (status === 'downloaded') {
        setUpdateMessage({
          type: 'success',
          text: message || 'Update installed. Restart the app to apply.',
        });
      } else if (status === 'none') {
        setUpdateMessage({ type: 'success', text: message || 'You are on the latest version.' });
      } else if (status === 'error') {
        setUpdateMessage({ type: 'error', text: message || 'Failed to check for updates.' });
      }
    };

    window.addEventListener('whylowdps-updater-status', onUpdaterStatus as EventListener);
    return () => {
      window.removeEventListener('whylowdps-updater-status', onUpdaterStatus as EventListener);
    };
  }, []);

  useEffect(() => {
    if (isDesktop) {
      const storedChannel = readStoredUpdateChannel(APP_VERSION);
      persistedAppChannelRef.current = storedChannel;
      setSelectedAppChannelState(storedChannel);
    }
    setAppChannelLoaded(true);
  }, []);

  useEffect(() => {
    if (!isDesktop || !appChannelLoaded || !performanceSaved || !hasUser) return;
    if (skipAppChannelSaveRef.current) {
      skipAppChannelSaveRef.current = false;
      return;
    }
    if (selectedAppChannel === persistedAppChannelRef.current) return;
    fetchJson(`${API_URL}/api/user/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'app_update_channel',
        value: selectedAppChannel,
      }),
    })
      .then(() => {
        persistedAppChannelRef.current = selectedAppChannel;
      })
      .catch((error) => {
        const previousChannel = persistedAppChannelRef.current;
        skipAppChannelSaveRef.current = true;
        setSelectedAppChannelState(previousChannel);
        try {
          localStorage.setItem('whylowdps_update_channel', previousChannel);
        } catch {}
        setUpdateMessage({
          type: 'error',
          text: `Could not save the app update channel. ${
            error instanceof Error ? error.message : 'Retry by selecting it again.'
          }`,
        });
      });
  }, [appChannelLoaded, hasUser, performanceSaved, selectedAppChannel]);

  const loadAppReleases = useCallback(
    async (options?: { forceRefresh?: boolean }) => {
      const result = await fetchAppReleases(selectedAppChannel, options);
      const releases = result.releases;
      setAppReleases(releases);
      setAppReleaseMetadataStatus(result.metadataStatus);
      setSelectedAppVersion((current) =>
        current && releases.some((release) => release.version === current)
          ? current
          : releases[0]?.version || ''
      );
    },
    [selectedAppChannel]
  );

  const setSelectedAppChannel = useCallback((channel: UpdateChannel) => {
    setSelectedAppChannelState(channel);
    setSelectedAppVersion('');
    try {
      localStorage.setItem('whylowdps_update_channel', channel);
    } catch {}
    window.dispatchEvent(
      new CustomEvent('whylowdps-updater-check', {
        detail: { channel },
      })
    );
  }, []);

  const loadDockerReleases = useCallback(async (options?: { forceRefresh?: boolean }) => {
    const result = await fetchDockerImageReleases(options);
    setDockerReleases(result.releases);
    setDockerReleaseMetadataStatus(result.metadataStatus);
  }, []);

  const loadDockerUpdateStatus = useCallback(async () => {
    const result = await fetchJson<DockerUpdateStatus>(`${API_URL}/api/admin/docker-updates`, {
      timeoutMs: 3000,
    });
    setDockerUpdateStatus(result);
    return result;
  }, []);

  const saveDockerUpdateSettings = useCallback(
    async (mode: DockerUpdateMode, intervalMinutes: number) => {
      const result = await fetchJson<DockerUpdateStatus>(`${API_URL}/api/admin/docker-updates`, {
        method: 'POST',
        body: JSON.stringify({ mode, interval_minutes: intervalMinutes }),
      });
      setDockerUpdateStatus(result);
      return result;
    },
    []
  );

  const triggerDockerUpdate = useCallback(async () => {
    const result = await fetchJson<DockerUpdateStatus>(`${API_URL}/api/admin/docker-updates`, {
      method: 'POST',
      body: JSON.stringify({ action: 'update' }),
      timeoutMs: 15000,
    });
    setDockerUpdateStatus(result);
    return result;
  }, []);

  useEffect(() => {
    if (isDesktop) void loadAppReleases();
    if (isHostedPrivate) void loadDockerReleases();
  }, [loadAppReleases, loadDockerReleases]);

  useEffect(() => {
    if (!isHostedPrivate || !isAdmin) {
      setDockerUpdateStatus(null);
      return;
    }
    void loadDockerUpdateStatus().catch(() => setDockerUpdateStatus(null));
  }, [isAdmin, loadDockerUpdateStatus]);

  useEffect(() => {
    if (!isHostedPrivate) return;
    fetchJson<DeploymentInfo>(`${API_URL}/health`)
      .then(setDeploymentInfo)
      .catch(() => setDeploymentInfo(null));
  }, []);

  const checkForUpdatesNow = useCallback(() => {
    setUpdateCheckState('checking');
    setUpdateMessage(null);
    window.dispatchEvent(
      new CustomEvent('whylowdps-updater-check', {
        detail: { channel: selectedAppChannel },
      })
    );
  }, [selectedAppChannel]);

  const downloadAndInstallLatest = useCallback(() => {
    setUpdateCheckState('installing');
    setUpdateMessage(null);
    const release =
      appReleases.find((item) => item.version === selectedAppVersion) || appReleases[0];
    window.dispatchEvent(
      new CustomEvent('whylowdps-updater-install', {
        detail: release
          ? {
              channel: selectedAppChannel,
              version: release.version,
              notes: release.notes,
              manualDownloadUrl: release.downloadUrl,
              fallbackOnly: true,
            }
          : { channel: selectedAppChannel },
      })
    );
  }, [appReleases, selectedAppChannel, selectedAppVersion]);

  return {
    updateCheckState,
    updateMessage,
    appReleases,
    appReleaseMetadataStatus,
    selectedAppChannel,
    setSelectedAppChannel,
    selectedAppVersion,
    setSelectedAppVersion,
    loadAppReleases,
    deploymentInfo,
    dockerReleases,
    dockerReleaseMetadataStatus,
    loadDockerReleases,
    dockerUpdateStatus,
    loadDockerUpdateStatus,
    saveDockerUpdateSettings,
    triggerDockerUpdate,
    checkForUpdatesNow,
    downloadAndInstallLatest,
  };
}

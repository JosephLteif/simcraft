'use client';

import { useEffect, useState } from 'react';
import { LogIn, X } from 'lucide-react';
import {
  API_URL,
  type BlizzardCredentialProfile,
  isDesktop,
  isHostedPrivate,
  listBlizzardCredentialProfiles,
} from '../lib/api';
import { useAuth } from './AuthContext';
import { invoke } from '@tauri-apps/api/core';
import { APP_VERSION, APP_VERSION_WITH_PREFIX } from '../lib/version';
import { formatBytesDecimal, formatElapsedCompact, formatTransferSpeed } from '../lib/format';
import DesktopWindowTitleBar from './DesktopWindowTitleBar';
import LanPairingScanner from './LanPairingScanner';
import { readinessDataMessage } from '../lib/readiness';

interface SplashScreenProps {
  status: string;
  progress: string;
  onRetry?: () => void;
  retriesRemaining?: number;
  retriesDone?: number;
  retriesTotal?: number;
}

type SplashProgress = {
  task: string;
  current: number;
  total: number;
  details: string;
  downloadedBytes: number;
  totalBytes: number;
  elapsedSeconds: number;
  speedBytesPerSec: number;
};

export default function SplashScreen({
  status,
  progress,
  onRetry,
  retriesRemaining = 0,
  retriesDone = 0,
  retriesTotal = 0,
}: SplashScreenProps) {
  const { login, setSystemCredentials, enableLightMode } = useAuth();
  const redirectUri =
    !isDesktop && typeof window !== 'undefined'
      ? `${window.location.origin}/api/auth/bnet/callback`
      : 'http://localhost:17384/api/auth/bnet/callback';
  const allowedDomain =
    !isDesktop && typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [credentialProfiles, setCredentialProfiles] = useState<BlizzardCredentialProfile[]>([]);
  const [selectedCredentialId, setSelectedCredentialId] = useState('');
  const [saveNewCredentials, setSaveNewCredentials] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [showDebugButton, setShowDebugButton] = useState(false);
  const isDebugMode = process.env.NODE_ENV === 'development';
  const usableCredentialProfiles = credentialProfiles.filter(
    (profile) => profile.has_secret !== false
  );
  const missingSecretProfiles = credentialProfiles.filter(
    (profile) => profile.has_secret === false
  );
  const selectedProfile = credentialProfiles.find((profile) => profile.id === selectedCredentialId);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowDebugButton(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    listBlizzardCredentialProfiles()
      .then((profiles) => {
        if (cancelled) return;
        setCredentialProfiles(profiles);
        setSelectedCredentialId(
          (current) => current || profiles.find((profile) => profile.has_secret !== false)?.id || ''
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchDebugInfo = async () => {
    if (isDesktop) {
      try {
        const info = await invoke('get_system_info');
        setDebugInfo(info);
        setShowDebug(true);
      } catch (err) {
        console.error('Failed to fetch debug info:', err);
      }
    }
  };

  const openDataFolder = async () => {
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
  };

  const quitAppNow = async () => {
    if (!isDesktop) return;
    try {
      await invoke('quit_app_now');
    } catch {
      try {
        await invoke('apply_close_behavior_choice', { minimizeToTrayOnClose: false });
      } catch (fallbackErr) {
        console.error('Failed to quit app immediately:', fallbackErr);
      }
    }
  };

  const handleSaveAndLogin = async () => {
    setIsSaving(true);
    try {
      if (selectedCredentialId) {
        if (selectedProfile?.has_secret === false) {
          alert(
            'These saved Blizzard credentials are missing their secure secret on this device. Re-enter the client secret and save again.'
          );
          setSelectedCredentialId('');
          return;
        }
        await login(undefined, undefined, selectedCredentialId);
        return;
      }

      if (!saveNewCredentials) {
        await login(clientId, clientSecret);
        return;
      }

      const success = await setSystemCredentials(clientId, clientSecret);
      if (!success) {
        alert('Failed to save Blizzard API credentials. Please check your inputs.');
        return;
      }

      await login(clientId, clientSecret);
    } finally {
      setIsSaving(false);
    }
  };

  const statusString = typeof status === 'string' ? status : JSON.stringify(status);
  const isError = statusString.toLowerCase().includes('error');
  const isAutoRetrying = isError && retriesRemaining > 0;
  const isSyncing =
    statusString === 'syncing' || (typeof status === 'string' && status === 'syncing');

  // Helper to parse: "TASK:CURRENT:TOTAL:DETAILS"
  const parseProgress = (str: string): SplashProgress => {
    const parts = str.split(':');
    if (parts.length < 4) {
      return {
        task: '',
        current: 0,
        total: 0,
        details: str,
        downloadedBytes: 0,
        totalBytes: 0,
        elapsedSeconds: 0,
        speedBytesPerSec: 0,
      };
    }
    const downloadedBytes = Number(parts[4] || 0);
    const totalBytes = Number(parts[5] || 0);
    const elapsedMs = Number(parts[6] || 0);
    const speedBytesPerSec = Number(parts[7] || 0);
    return {
      task: parts[0],
      current: parseInt(parts[1], 10),
      total: parseInt(parts[2], 10),
      details: parts[3],
      downloadedBytes: Number.isFinite(downloadedBytes) ? downloadedBytes : 0,
      totalBytes: Number.isFinite(totalBytes) ? totalBytes : 0,
      elapsedSeconds: Number.isFinite(elapsedMs) ? elapsedMs / 1000 : 0,
      speedBytesPerSec: Number.isFinite(speedBytesPerSec) ? speedBytesPerSec : 0,
    };
  };

  const progressData = parseProgress(
    progress ||
      readinessDataMessage(statusString, statusString === 'degraded', 'Syncing with Blizzard...')
  );
  const extractedUrls = Array.from(statusString.matchAll(/https?:\/\/[^\s)]+/g)).map((m) => m[0]);
  const primaryFailedUrl = extractedUrls[0] || '';
  const primaryFailedFile = primaryFailedUrl
    ? primaryFailedUrl.split('/').pop() || 'required file'
    : 'required file';
  const lowerStatus = statusString.toLowerCase();
  const isBlizzardAuthOrApiIssue =
    lowerStatus.includes('blizzard') &&
    (lowerStatus.includes('auth') ||
      lowerStatus.includes('oauth') ||
      lowerStatus.includes('token') ||
      lowerStatus.includes('authenticate') ||
      lowerStatus.includes('unauthorized') ||
      lowerStatus.includes('forbidden') ||
      lowerStatus.includes('service unavailable') ||
      lowerStatus.includes('timed out') ||
      lowerStatus.includes('timeout'));
  const needsMetadataFallback = primaryFailedFile.toLowerCase() === 'metadata.json';
  const manualDownloadUrl = needsMetadataFallback
    ? 'https://www.raidbots.com/static/data/live/metadata.json'
    : primaryFailedUrl;
  const progressPercent =
    progressData.total > 0 ? Math.round((progressData.current / progressData.total) * 100) : 0;
  const fileProgressPercent =
    progressData.totalBytes > 0
      ? Math.min(100, Math.round((progressData.downloadedBytes / progressData.totalBytes) * 100))
      : null;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center overflow-y-auto bg-zinc-950">
      <DesktopWindowTitleBar overlay />

      {/* Background Glows */}
      <div className="absolute left-1/4 top-1/4 h-96 w-96 animate-pulse rounded-full bg-gold/10 blur-[120px]" />
      <div className="absolute bottom-1/4 right-1/4 h-96 w-96 animate-pulse rounded-full bg-gold-dark/10 blur-[120px] delay-1000" />

      <div className="relative flex min-h-full w-full max-w-md shrink-0 flex-col items-center justify-center px-6 py-12">
        {/* Animated Logo Container */}
        <div className="relative mb-12">
          <div className="absolute inset-0 animate-pulse rounded-full bg-gold/20 blur-2xl" />
          <img
            src="/icon.png"
            alt="WhyLowDps"
            className="relative h-24 w-24 object-contain drop-shadow-2xl"
          />
        </div>

        <h1 className="mb-2 text-center text-3xl font-bold tracking-tight text-gray-100">
          WhyLowDps
        </h1>

        <p className="mb-8 text-center text-sm font-medium uppercase tracking-wide text-zinc-400">
          Initial Synchronization
        </p>

        {/* Status Bubble */}
        <div className="w-full rounded-2xl border border-white/5 bg-white/[0.03] p-6 backdrop-blur-xl">
          <div className="flex flex-col items-center">
            {isSyncing ? (
              <div className="w-full">
                <div className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider">
                  <span className="text-gold">{progressData.task || 'Initializing'}</span>
                  <span className="text-zinc-500">
                    {progressData.total > 0
                      ? `${progressData.current} / ${progressData.total}`
                      : ''}
                  </span>
                </div>

                <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10">
                  {progressData.total > 0 ? (
                    <div
                      className="shadow-glow-sm h-full bg-gradient-to-r from-gold-dark to-gold transition-all duration-500 ease-out"
                      style={{ width: `${progressPercent}%` }}
                    />
                  ) : (
                    <div className="animate-progress-indefinite shadow-glow-sm h-full bg-gold" />
                  )}
                </div>

                <div className="flex flex-col items-center gap-1">
                  <p className="w-full truncate text-center text-sm font-medium text-zinc-100">
                    {progressData.details || 'Syncing with Blizzard...'}
                  </p>
                  {progressData.total > 0 && (
                    <p className="text-[10px] text-zinc-500">{progressPercent}% Complete</p>
                  )}
                  {progressData.task === 'Files' && (
                    <div className="mt-2 grid w-full grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-zinc-500">
                      <span>File size</span>
                      <span className="text-right text-zinc-300">
                        {formatBytesDecimal(progressData.totalBytes)}
                      </span>
                      <span>Downloaded</span>
                      <span className="text-right text-zinc-300">
                        {formatBytesDecimal(progressData.downloadedBytes)}
                        {fileProgressPercent != null ? ` (${fileProgressPercent}%)` : ''}
                      </span>
                      <span>Speed</span>
                      <span className="text-right text-zinc-300">
                        {formatTransferSpeed(progressData.speedBytesPerSec)}
                      </span>
                      <span>Time spent</span>
                      <span className="text-right text-zinc-300">
                        {formatElapsedCompact(progressData.elapsedSeconds)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : status === 'lan_access_required' ? (
              <div className="w-full space-y-4 text-center">
                <p className="text-sm font-semibold text-zinc-100">Access required</p>
                <p className="text-sm leading-relaxed text-zinc-400">
                  This phone is not paired with the WhyLowDPS desktop app, or its access was
                  removed. Scan a new QR code from the desktop app to continue.
                </p>
                <LanPairingScanner />
              </div>
            ) : status === 'unauthenticated' ? (
              <div className="w-full text-center">
                <p className="mb-6 text-sm font-medium text-zinc-300">Authentication Required</p>
                {usableCredentialProfiles.length > 1 && (
                  <select
                    value={selectedCredentialId}
                    onChange={(event) => setSelectedCredentialId(event.target.value)}
                    className="mb-3 w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 focus:border-gold/50 focus:outline-none"
                    aria-label="Blizzard application credentials"
                  >
                    {usableCredentialProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={() => login(undefined, undefined, selectedCredentialId || undefined)}
                  className="flex w-full items-center justify-center gap-3 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-500 active:scale-95"
                >
                  <LogIn className="h-5 w-5" strokeWidth={2.25} />
                  Login with Battle.net
                </button>
                {!isHostedPrivate && (
                  <button
                    onClick={enableLightMode}
                    className="mt-3 flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-zinc-100 transition-all hover:bg-white/10 active:scale-95"
                  >
                    Continue in Light mode
                  </button>
                )}
              </div>
            ) : status === 'unauthenticated_needs_keys' ? (
              <div className="w-full space-y-4 text-center">
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-400">
                  Blizzard API Credentials Required
                </p>

                <div className="space-y-3">
                  {credentialProfiles.length > 0 && (
                    <div className="space-y-2">
                      {credentialProfiles.map((profile) => (
                        <button
                          key={profile.id}
                          type="button"
                          onClick={() =>
                            profile.has_secret !== false && setSelectedCredentialId(profile.id)
                          }
                          disabled={profile.has_secret === false}
                          className={`w-full rounded-xl border px-4 py-2.5 text-left transition-colors ${
                            profile.has_secret === false
                              ? 'cursor-not-allowed border-amber-500/20 bg-amber-500/10 text-amber-100 opacity-80'
                              : selectedCredentialId === profile.id
                                ? 'border-gold/60 bg-gold/10 text-white'
                                : 'border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10'
                          }`}
                        >
                          <span className="block truncate text-sm font-semibold">
                            {profile.name}
                          </span>
                          <span className="block truncate text-[11px] text-zinc-500">
                            {profile.client_id}
                          </span>
                          {profile.has_secret === false && (
                            <span className="mt-1 block text-[11px] text-amber-200">
                              Secure secret missing. Re-enter it to repair this saved login.
                            </span>
                          )}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setSelectedCredentialId('')}
                        className={`w-full rounded-xl border px-4 py-2.5 text-left text-sm font-semibold transition-colors ${
                          selectedCredentialId
                            ? 'border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10'
                            : 'border-gold/60 bg-gold/10 text-white'
                        }`}
                      >
                        Use new credentials
                      </button>
                    </div>
                  )}
                  {missingSecretProfiles.length > 0 && (
                    <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-left text-[12px] text-amber-100">
                      One or more saved credentials are incomplete on this device. Enter the client
                      secret again to repair them.
                    </p>
                  )}
                  {usableCredentialProfiles.length === 0 && credentialProfiles.length > 0 && (
                    <p className="text-left text-[12px] text-zinc-500">
                      No working saved credentials are available on this device right now.
                    </p>
                  )}
                  {!selectedCredentialId && (
                    <>
                      <input
                        type="text"
                        placeholder="Client ID"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-zinc-500 transition-colors focus:border-gold/50 focus:outline-none"
                      />
                      <input
                        type="password"
                        placeholder="Client Secret"
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-zinc-500 transition-colors focus:border-gold/50 focus:outline-none"
                      />
                      <label className="flex items-center gap-2 text-left text-[12px] text-zinc-400">
                        <input
                          type="checkbox"
                          checked={saveNewCredentials}
                          onChange={(e) => setSaveNewCredentials(e.target.checked)}
                          className="h-4 w-4 rounded border-white/20 bg-white/5"
                        />
                        Save these credentials securely on this{' '}
                        {isHostedPrivate ? 'instance' : 'device'}
                      </label>
                    </>
                  )}
                </div>

                <div className="text-left">
                  <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">
                    <span className="font-bold text-zinc-400">Setup Instructions:</span>
                    <br />
                    1. Create a client on the{' '}
                    <a
                      href="https://community.developer.battle.net/access/clients"
                      target="_blank"
                      className="text-gold hover:underline"
                    >
                      Blizzard Developer Portal
                    </a>
                    .<br />
                    2. In the portal&apos;s{' '}
                    <span className="font-bold text-zinc-400">Redirect URLs</span> field, add this
                    exact value:
                    <br />
                    <code className="mt-1 block break-all text-zinc-300">{redirectUri}</code>
                    <br />
                    If it asks for an{' '}
                    <span className="font-bold text-zinc-400">Allowed Domain</span> or service URL,
                    use the hostname only:
                    <br />
                    <code className="mt-1 block break-all text-zinc-300">{allowedDomain}</code>
                    <br />
                    Do not add a trailing slash or the callback path to the domain field.
                  </p>
                </div>

                <button
                  onClick={handleSaveAndLogin}
                  disabled={(!selectedCredentialId && (!clientId || !clientSecret)) || isSaving}
                  className="flex w-full items-center justify-center gap-3 rounded-xl bg-gold px-4 py-4 text-sm font-bold text-black shadow-lg shadow-gold/20 transition-all hover:bg-gold-light active:scale-95 disabled:opacity-50 disabled:grayscale"
                >
                  {isSaving ? (
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                      <span>Processing...</span>
                    </div>
                  ) : (
                    <>
                      <LogIn className="h-5 w-5" strokeWidth={2.25} />
                      {selectedCredentialId
                        ? 'Login with Battle.net'
                        : 'Save & Login with Battle.net'}
                    </>
                  )}
                </button>
                {!isHostedPrivate && (
                  <button
                    onClick={enableLightMode}
                    className="flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-zinc-100 transition-all hover:bg-white/10 active:scale-95"
                  >
                    Continue in Light mode
                  </button>
                )}
              </div>
            ) : isError ? (
              <div className="w-full text-left">
                <div className="space-y-3 p-1">
                  <p className="text-xs leading-relaxed text-zinc-300">
                    {isAutoRetrying
                      ? `Automatic retry in progress (${retriesDone}/${retriesTotal} attempts done, ${retriesRemaining} remaining).`
                      : `Automatic retries were exhausted (${retriesDone}/${retriesTotal} attempts done).`}
                  </p>

                  {!isAutoRetrying && (
                    <>
                      <div className="max-h-16 overflow-auto rounded-lg border border-red-500/20 bg-red-500/5 p-2">
                        <p className="break-all text-[11px] leading-tight text-red-300">{status}</p>
                      </div>
                      <div className="space-y-1 text-xs text-zinc-300">
                        <p className="font-semibold text-zinc-200">Manual recovery</p>
                        {isBlizzardAuthOrApiIssue ? (
                          <>
                            <p>1. Blizzard API may be temporarily unavailable.</p>
                            <p>2. Wait a few minutes, then click Try Again.</p>
                          </>
                        ) : manualDownloadUrl ? (
                          <>
                            <p>
                              1. Download:{' '}
                              <a
                                href={manualDownloadUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-gold underline"
                              >
                                {primaryFailedFile}
                              </a>
                            </p>
                            <p>
                              2. Save it as {primaryFailedFile} (not {primaryFailedFile}.txt).
                            </p>
                          </>
                        ) : (
                          <p>1. Check your internet/firewall/proxy and keep the app open.</p>
                        )}
                        {!isBlizzardAuthOrApiIssue && (
                          <>
                            <p>
                              3. Press Open Data Folder next to this message, then put the file
                              there.
                            </p>
                            <p>4. Click Try Again.</p>
                          </>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={onRetry}
                          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-white/10 active:scale-95"
                        >
                          Try Again
                        </button>
                        <button
                          onClick={openDataFolder}
                          className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-zinc-100 transition-all hover:bg-white/10 active:scale-95"
                        >
                          Open Data Folder
                        </button>
                      </div>
                      <button
                        onClick={quitAppNow}
                        className="w-full rounded-xl border border-red-400/35 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-100 transition-all hover:bg-red-500/20 active:scale-95"
                      >
                        Quit App
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-zinc-300">Preparing workspace...</p>
            )}
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center gap-4">
          <div className="hidden text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            Version 0.2.4-STABILITY-V2 • Production Ready
          </div>

          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            Version {APP_VERSION_WITH_PREFIX} • Production Ready
          </div>

          {showDebugButton && isDesktop && isDebugMode && (
            <button
              onClick={fetchDebugInfo}
              className="text-[9px] font-bold uppercase tracking-widest text-zinc-700 transition-colors hover:text-gold"
            >
              Show System Info
            </button>
          )}
        </div>
      </div>

      <div className="fixed bottom-4 left-4 z-50">
        <span className="rounded border border-white/5 bg-black/40 px-2 py-1 font-mono text-[10px] text-zinc-700">
          Build: {APP_VERSION}
        </span>
      </div>

      {showDebug && debugInfo && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-zinc-900 p-8 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">System Diagnostics</h2>
              <button
                onClick={() => setShowDebug(false)}
                className="text-zinc-500 hover:text-white"
              >
                <X className="h-6 w-6" strokeWidth={2} />
              </button>
            </div>

            <div className="space-y-4 font-mono text-xs leading-relaxed">
              <div className="rounded-lg border border-white/5 bg-black/40 p-4">
                <p className="mb-2 font-bold uppercase tracking-widest text-zinc-500">Data Path</p>
                <p className={debugInfo.data_exists ? 'text-emerald-400' : 'text-red-400'}>
                  {debugInfo.data_dir}
                </p>
                <p className="mt-1 text-[10px] text-zinc-600">
                  Exists: {debugInfo.data_exists ? 'YES' : 'NO (CRITICAL)'}
                </p>
              </div>

              <div className="rounded-lg border border-white/5 bg-black/40 p-4">
                <p className="mb-2 font-bold uppercase tracking-widest text-zinc-500">SimC Path</p>
                <p className={debugInfo.simc_exists ? 'text-emerald-400' : 'text-red-400'}>
                  {debugInfo.simc_dir}
                </p>
                <p className="mt-1 text-[10px] text-zinc-600">
                  Exists: {debugInfo.simc_exists ? 'YES' : 'NO (CRITICAL)'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex justify-between border-b border-white/5 py-1.5">
                  <span className="text-zinc-500">Data Directory</span>
                  <span className="font-mono text-zinc-300">{debugInfo.data_dir}</span>
                </div>
                <div className="flex justify-between border-b border-white/5 py-1.5">
                  <span className="text-zinc-500">Classes Data Loaded</span>
                  <span
                    className={`font-mono ${debugInfo.data_valid ? 'text-emerald-400' : 'text-red-400'}`}
                  >
                    {debugInfo.data_valid ? 'Valid / Found' : 'MISSING (Check installation)'}
                  </span>
                </div>
                <div className="flex justify-between border-b border-white/5 py-1.5">
                  <span className="text-zinc-500">SimC Executable</span>
                  <span
                    className={`font-mono ${debugInfo.simc_valid ? 'text-emerald-400' : 'text-red-400'}`}
                  >
                    {debugInfo.simc_valid ? 'Found' : 'NOT FOUND'}
                  </span>
                </div>
                <div className="flex justify-between border-b border-white/5 py-1.5">
                  <span className="text-zinc-500">Backend Version</span>
                  <span className="font-mono text-zinc-300">{debugInfo.version || 'Unknown'}</span>
                </div>
                <div className="flex justify-between border-b border-white/5 py-1.5">
                  <span className="text-zinc-500">Current URL</span>
                  <span
                    className="max-w-[200px] truncate font-mono text-[10px] text-zinc-300"
                    title={typeof window !== 'undefined' ? window.location.href : ''}
                  >
                    {typeof window !== 'undefined' ? window.location.href : 'N/A'}
                  </span>
                </div>
                <div className="overflow-hidden whitespace-nowrap rounded-lg border border-white/5 bg-black/40 p-4">
                  <p className="mb-1 font-bold uppercase tracking-widest text-zinc-500">API URL</p>
                  <p className="text-zinc-300">{API_URL}</p>
                </div>
              </div>

              <div className="rounded-lg border border-white/5 bg-black/40 p-4">
                <p className="mb-1 font-bold uppercase tracking-widest text-zinc-500">
                  Executable Path
                </p>
                <p className="break-all text-[10px] text-zinc-400">{debugInfo.exe_path}</p>
              </div>
            </div>

            <p className="mt-6 text-center text-[10px] italic text-zinc-600">
              Please provide a screenshot of this screen if you are still experiencing issues.
            </p>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes progress-indefinite {
          0% {
            transform: translateX(-100%);
            width: 30%;
          }
          50% {
            width: 60%;
          }
          100% {
            transform: translateX(400%);
            width: 30%;
          }
        }
      `}</style>
    </div>
  );
}

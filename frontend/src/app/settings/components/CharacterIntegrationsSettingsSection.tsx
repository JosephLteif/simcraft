'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getAdminWarcraftLogsCredentials,
  getIntegrationSettings,
  removeAdminWarcraftLogsCredentials,
  removeWarcraftLogsCredentials,
  saveAdminWarcraftLogsCredentials,
  saveWarcraftLogsCredentials,
  testWarcraftLogsCredentials,
  updateIntegrationSettings,
  type IntegrationSettings,
  type WarcraftLogsAdminSettings,
} from '../../lib/api';

type CharacterIntegrationsSettingsSectionProps = {
  isHostedPrivate: boolean;
  isAdmin: boolean;
};

type Message = { type: 'success' | 'error'; text: string } | null;

const DEFAULT_SETTINGS: IntegrationSettings = {
  raider_io_enabled: true,
  warcraft_logs_enabled: false,
  warcraft_logs: {
    user_configured: false,
    user_client_id: null,
    effective_source: null,
    environment_configured: false,
    admin_configured: false,
  },
};

export default function CharacterIntegrationsSettingsSection({
  isHostedPrivate,
  isAdmin,
}: CharacterIntegrationsSettingsSectionProps) {
  const [settings, setSettings] = useState<IntegrationSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [savingProvider, setSavingProvider] = useState<'raider_io' | 'warcraft_logs' | null>(null);
  const [userClientId, setUserClientId] = useState('');
  const [userClientSecret, setUserClientSecret] = useState('');
  const [userTesting, setUserTesting] = useState(false);
  const [userSaving, setUserSaving] = useState(false);
  const [userRemoving, setUserRemoving] = useState(false);
  const [userMessage, setUserMessage] = useState<Message>(null);
  const [adminSettings, setAdminSettings] = useState<WarcraftLogsAdminSettings | null>(null);
  const [adminClientId, setAdminClientId] = useState('');
  const [adminClientSecret, setAdminClientSecret] = useState('');
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminRemoving, setAdminRemoving] = useState(false);
  const [adminMessage, setAdminMessage] = useState<Message>(null);
  const [appOrigin, setAppOrigin] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nextSettings = await getIntegrationSettings();
      setSettings(nextSettings);
      setUserClientId(nextSettings.warcraft_logs.user_client_id || '');
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
    if (isHostedPrivate && isAdmin) {
      try {
        const nextAdmin = await getAdminWarcraftLogsCredentials();
        setAdminSettings(nextAdmin);
        setAdminClientId(nextAdmin.client_id || '');
      } catch {
        setAdminSettings(null);
      }
    }
    setLoading(false);
  }, [isAdmin, isHostedPrivate]);

  useEffect(() => {
    setAppOrigin(window.location.origin);
    void load();
  }, [load]);

  const setProviderEnabled = async (provider: 'raider_io' | 'warcraft_logs', enabled: boolean) => {
    setSavingProvider(provider);
    try {
      setSettings(await updateIntegrationSettings(provider, enabled));
    } catch {
      setUserMessage({ type: 'error', text: 'Unable to update the integration.' });
    } finally {
      setSavingProvider(null);
    }
  };

  const testUserCredentials = async () => {
    setUserTesting(true);
    setUserMessage(null);
    try {
      await testWarcraftLogsCredentials(userClientId.trim(), userClientSecret.trim());
      setUserMessage({ type: 'success', text: 'Warcraft Logs credentials verified.' });
    } catch {
      setUserMessage({ type: 'error', text: 'Warcraft Logs credentials could not be verified.' });
    } finally {
      setUserTesting(false);
    }
  };

  const saveUserCredentials = async () => {
    setUserSaving(true);
    setUserMessage(null);
    try {
      await saveWarcraftLogsCredentials(userClientId.trim(), userClientSecret.trim());
      setUserClientSecret('');
      setUserMessage({ type: 'success', text: 'Warcraft Logs credentials saved and enabled.' });
      await load();
    } catch {
      setUserMessage({ type: 'error', text: 'Warcraft Logs credentials could not be saved.' });
    } finally {
      setUserSaving(false);
    }
  };

  const removeUserCredentials = async () => {
    setUserRemoving(true);
    setUserMessage(null);
    try {
      await removeWarcraftLogsCredentials();
      setUserClientSecret('');
      setUserMessage({ type: 'success', text: 'Personal Warcraft Logs credentials removed.' });
      await load();
    } catch {
      setUserMessage({
        type: 'error',
        text: 'Personal Warcraft Logs credentials could not be removed.',
      });
    } finally {
      setUserRemoving(false);
    }
  };

  const saveAdminCredentials = async () => {
    setAdminSaving(true);
    setAdminMessage(null);
    try {
      await saveAdminWarcraftLogsCredentials(adminClientId.trim(), adminClientSecret.trim());
      setAdminClientSecret('');
      setAdminMessage({ type: 'success', text: 'Shared Warcraft Logs fallback saved.' });
      await load();
    } catch {
      setAdminMessage({
        type: 'error',
        text: 'Shared Warcraft Logs credentials could not be saved.',
      });
    } finally {
      setAdminSaving(false);
    }
  };

  const removeAdminCredentials = async () => {
    setAdminRemoving(true);
    setAdminMessage(null);
    try {
      await removeAdminWarcraftLogsCredentials();
      setAdminClientSecret('');
      setAdminMessage({ type: 'success', text: 'Shared Warcraft Logs fallback removed.' });
      await load();
    } catch {
      setAdminMessage({
        type: 'error',
        text: 'Shared Warcraft Logs credentials could not be removed.',
      });
    } finally {
      setAdminRemoving(false);
    }
  };

  const effectiveSource = settings.warcraft_logs.effective_source;
  const hasUserCredentials = settings.warcraft_logs.user_configured;

  return (
    <section className="border-border/50 bg-surface/30 rounded-xl border p-6 backdrop-blur-sm">
      <div className="max-w-3xl space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Character data providers</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
            Optional public profile data loads automatically on authenticated character pages. The
            existing Blizzard profile and external profile links remain available independently.
          </p>
        </div>

        <ProviderToggle
          label="Raider.IO"
          description="Current-season Mythic+ score, best runs, and raid progression. Enabled by default."
          enabled={settings.raider_io_enabled}
          disabled={loading || savingProvider === 'raider_io'}
          onChange={(enabled) => void setProviderEnabled('raider_io', enabled)}
        />

        <div className="border-border/70 bg-surface space-y-4 rounded-lg border px-4 py-4">
          <ProviderToggle
            label="Warcraft Logs"
            description="Recent public reports and latest-zone ranking metrics. Private reports and OAuth/PKCE are not supported."
            enabled={settings.warcraft_logs_enabled}
            disabled={loading || savingProvider === 'warcraft_logs'}
            onChange={(enabled) => void setProviderEnabled('warcraft_logs', enabled)}
          />
          <p className="text-[12px] text-zinc-500">
            {effectiveSource
              ? `Active credentials: ${effectiveSource === 'user' ? 'your account' : `shared ${effectiveSource}`}.`
              : 'Add personal credentials below, or use a shared server fallback.'}
            {effectiveSource === 'environment' &&
              ' Environment credentials take priority over the admin fallback.'}
          </p>

          <div className="space-y-3 border-t border-white/5 pt-4">
            <div>
              <p className="text-sm font-semibold text-zinc-200">Personal credentials</p>
              <p className="mt-1 text-[12px] text-zinc-500">
                Personal credentials take priority over shared credentials and are stored using the
                app&apos;s protected credential storage.
              </p>
              <p className="mt-1 text-[12px] text-zinc-500">
                Create a Warcraft Logs API client in the{' '}
                <a
                  href="https://www.warcraftlogs.com/api/clients/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gold hover:underline"
                >
                  Warcraft Logs client manager
                </a>{' '}
                and paste its Client ID and Client Secret here.
              </p>
              <div className="border-border/50 bg-surface-2/50 mt-3 rounded-lg border px-3 py-3">
                <p className="text-sm font-semibold text-zinc-200">
                  What to enter in Warcraft Logs
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                  When creating the client, use these values:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-[12px] text-zinc-400">
                  <li>
                    <span className="font-semibold text-zinc-300">Application name:</span>{' '}
                    WhyLowDPS, or another name you recognize.
                  </li>
                  <li>
                    <span className="font-semibold text-zinc-300">Redirect URLs:</span> Enter this
                    exact host and port:{' '}
                    {appOrigin ? (
                      <code className="text-zinc-300">{appOrigin}</code>
                    ) : (
                      <span className="text-zinc-300">detecting the current host…</span>
                    )}{' '}
                    Warcraft Logs requires a value, although this integration uses client
                    credentials rather than a sign-in redirect.
                  </li>
                  <li>
                    <span className="font-semibold text-zinc-300">Public Client:</span> Leave
                    unchecked. WhyLowDPS needs the generated client secret.
                  </li>
                </ul>
                <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">
                  After creating the client, paste its generated Client ID and Client Secret into
                  the fields below.
                </p>
              </div>
            </div>
            <label className="block text-[12px] font-medium text-zinc-300">
              Client ID
              <input
                value={userClientId}
                onChange={(event) => setUserClientId(event.target.value)}
                placeholder="Warcraft Logs client ID"
                className="border-border/50 bg-surface-2 focus:border-gold/50 mt-1 w-full rounded-lg border px-3 py-2 text-sm text-white focus:outline-none"
              />
              <p className="mt-1 text-[11px] font-normal text-zinc-500">
                Paste the Client ID generated by Warcraft Logs.
              </p>
            </label>
            <label className="block text-[12px] font-medium text-zinc-300">
              Client Secret
              <input
                type="password"
                value={userClientSecret}
                onChange={(event) => setUserClientSecret(event.target.value)}
                placeholder={
                  hasUserCredentials
                    ? 'Saved secret; enter to replace'
                    : 'Warcraft Logs client secret'
                }
                className="border-border/50 bg-surface-2 focus:border-gold/50 mt-1 w-full rounded-lg border px-3 py-2 text-sm text-white focus:outline-none"
              />
              <p className="mt-1 text-[11px] font-normal text-zinc-500">
                Paste the generated Client Secret. It is stored protected and never returned by
                WhyLowDPS.
              </p>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void testUserCredentials()}
                disabled={userTesting || !userClientId.trim() || !userClientSecret.trim()}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[12px] font-semibold text-zinc-100 hover:bg-white/10 disabled:opacity-50"
              >
                {userTesting ? 'Testing…' : 'Test credentials'}
              </button>
              <button
                type="button"
                onClick={() => void saveUserCredentials()}
                disabled={userSaving || !userClientId.trim() || !userClientSecret.trim()}
                className="bg-gold/10 text-gold hover:bg-gold/20 rounded-lg px-4 py-2 text-[12px] font-semibold disabled:opacity-50"
              >
                {userSaving ? 'Saving…' : 'Save credentials'}
              </button>
              {hasUserCredentials && (
                <button
                  type="button"
                  onClick={() => void removeUserCredentials()}
                  disabled={userRemoving}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[12px] font-semibold text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                >
                  {userRemoving ? 'Removing…' : 'Remove personal credentials'}
                </button>
              )}
            </div>
            {userMessage && <p className={messageClass(userMessage)}>{userMessage.text}</p>}
          </div>
        </div>

        {isHostedPrivate && isAdmin && (
          <div className="border-gold/20 bg-gold/5 space-y-4 rounded-lg border px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-zinc-200">Shared hosted fallback</p>
              <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                {adminSettings?.environment_configured
                  ? 'Environment credentials are configured and take precedence over this fallback.'
                  : 'All hosted users can use this fallback when they have no personal credentials.'}
              </p>
            </div>
            <label className="block text-[12px] font-medium text-zinc-300">
              Client ID
              <input
                value={adminClientId}
                onChange={(event) => setAdminClientId(event.target.value)}
                placeholder="Shared Warcraft Logs client ID"
                className="border-border/50 bg-surface-2 focus:border-gold/50 mt-1 w-full rounded-lg border px-3 py-2 text-sm text-white focus:outline-none"
              />
              <p className="mt-1 text-[11px] font-normal text-zinc-500">
                Paste the Client ID from the shared Warcraft Logs client.
              </p>
            </label>
            <label className="block text-[12px] font-medium text-zinc-300">
              Client Secret
              <input
                type="password"
                value={adminClientSecret}
                onChange={(event) => setAdminClientSecret(event.target.value)}
                placeholder={
                  adminSettings?.configured
                    ? 'Saved secret; enter to replace'
                    : 'Shared Warcraft Logs client secret'
                }
                className="border-border/50 bg-surface-2 focus:border-gold/50 mt-1 w-full rounded-lg border px-3 py-2 text-sm text-white focus:outline-none"
              />
              <p className="mt-1 text-[11px] font-normal text-zinc-500">
                Paste the Client Secret from that client. It is stored protected and never returned
                by WhyLowDPS.
              </p>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void saveAdminCredentials()}
                disabled={adminSaving || !adminClientId.trim() || !adminClientSecret.trim()}
                className="bg-gold/10 text-gold hover:bg-gold/20 rounded-lg px-4 py-2 text-[12px] font-semibold disabled:opacity-50"
              >
                {adminSaving ? 'Saving…' : 'Save shared fallback'}
              </button>
              {adminSettings?.configured && (
                <button
                  type="button"
                  onClick={() => void removeAdminCredentials()}
                  disabled={adminRemoving}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[12px] font-semibold text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                >
                  {adminRemoving ? 'Removing…' : 'Remove shared fallback'}
                </button>
              )}
            </div>
            {adminMessage && <p className={messageClass(adminMessage)}>{adminMessage.text}</p>}
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-zinc-600">
          Raider.IO requires attribution and may rate-limit requests. Warcraft Logs cards only use
          public data returned by the client-credentials API.
        </p>
      </div>
    </section>
  );
}

function ProviderToggle({
  label,
  description,
  enabled,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  enabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-semibold text-zinc-200">{label}</span>
        <span className="mt-1 block max-w-2xl text-[12px] leading-relaxed text-zinc-500">
          {description}
        </span>
      </span>
      <input
        type="checkbox"
        checked={enabled}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 accent-[var(--gold)] disabled:opacity-50"
      />
    </label>
  );
}

function messageClass(message: Message): string {
  return message?.type === 'error' ? 'text-[12px] text-red-300' : 'text-[12px] text-emerald-300';
}

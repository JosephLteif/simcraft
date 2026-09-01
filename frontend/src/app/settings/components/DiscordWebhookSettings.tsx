'use client';

import { useEffect, useState } from 'react';
import { API_URL, fetchJson } from '../../lib/api';

type DiscordWebhookSettingsResponse = {
  enabled: boolean;
  configured: boolean;
  notification_types?: Partial<Record<NotificationTypeKey, boolean>>;
};

type NotificationTypeKey =
  | 'quick'
  | 'top_gear'
  | 'droptimizer'
  | 'stat_weights'
  | 'stat_plot'
  | 'upgrade_compare'
  | 'matrices'
  | 'heatmaps'
  | 'other';

const NOTIFICATION_TYPES: Array<{
  key: NotificationTypeKey;
  label: string;
  description: string;
}> = [
  { key: 'quick', label: 'Quick Sims', description: 'Single-character simulations.' },
  { key: 'top_gear', label: 'Top Gear', description: 'Gear combination and exact-stat sims.' },
  { key: 'droptimizer', label: 'Drop Finder', description: 'Upgrade value from potential drops.' },
  { key: 'stat_weights', label: 'Quick Weights', description: 'Single-point stat weights.' },
  { key: 'stat_plot', label: 'Stat Plot', description: 'DPS curves across stat ranges.' },
  {
    key: 'upgrade_compare',
    label: 'Crest Upgrades',
    description: 'Direct item upgrade comparisons.',
  },
  { key: 'matrices', label: 'Matrices', description: 'External buff and consumable matrices.' },
  { key: 'heatmaps', label: 'Heatmaps', description: 'Trinket and tier heatmaps.' },
  { key: 'other', label: 'Other Sims', description: 'Any unrecognized simulation type.' },
];

const DEFAULT_NOTIFICATION_TYPES: Record<NotificationTypeKey, boolean> = {
  quick: true,
  top_gear: true,
  droptimizer: true,
  stat_weights: true,
  stat_plot: true,
  upgrade_compare: true,
  matrices: true,
  heatmaps: true,
  other: true,
};

type SettingsMessage = {
  type: 'success' | 'error' | 'info';
  text: string;
} | null;

export default function DiscordWebhookSettings() {
  const [enabled, setEnabled] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [notificationTypes, setNotificationTypes] = useState(DEFAULT_NOTIFICATION_TYPES);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<SettingsMessage>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<DiscordWebhookSettingsResponse>(`${API_URL}/api/user/discord-webhook`)
      .then((settings) => {
        if (cancelled) return;
        setEnabled(settings.enabled);
        setConfigured(settings.configured);
        setNotificationTypes({ ...DEFAULT_NOTIFICATION_TYPES, ...settings.notification_types });
      })
      .catch(() => {
        if (!cancelled) {
          setMessage({ type: 'error', text: 'Could not load Discord webhook settings.' });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const settings = await fetchJson<DiscordWebhookSettingsResponse>(
        `${API_URL}/api/user/discord-webhook`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled,
            url: url.trim() || null,
            notification_types: notificationTypes,
          }),
        }
      );
      setEnabled(settings.enabled);
      setConfigured(settings.configured);
      setUrl('');
      setMessage({
        type: 'success',
        text: settings.enabled
          ? 'Discord notifications enabled.'
          : 'Discord notifications disabled.',
      });
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error?.message || 'Could not save Discord webhook settings.',
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await fetchJson(`${API_URL}/api/user/discord-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false, url: null, clear: true }),
      });
      setEnabled(false);
      setConfigured(false);
      setUrl('');
      setMessage({ type: 'success', text: 'Discord webhook removed.' });
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error?.message || 'Could not remove the Discord webhook.',
      });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setMessage(null);
    try {
      await fetchJson(`${API_URL}/api/user/discord-webhook/test`, { method: 'POST' });
      setMessage({ type: 'success', text: 'Test notification sent to Discord.' });
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error?.message || 'Discord did not accept the test notification.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="rounded-lg border border-border/70 bg-surface px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Discord webhook notifications</h3>
          <p className="mt-1 max-w-2xl text-[13px] text-zinc-400">
            Get a Discord message when one of your simulations finishes. The webhook URL is stored
            securely and never shown after it is saved.
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${
            enabled
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-border/70 bg-surface-2 text-zinc-500'
          }`}
        >
          {enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      <div className="mt-4 max-w-2xl space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300" htmlFor="discord-webhook-url">
            Discord Webhook URL
          </label>
          <input
            id="discord-webhook-url"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={
              configured
                ? 'Saved securely — paste a new URL to rotate it'
                : 'https://discord.com/api/webhooks/...'
            }
            disabled={loading || saving || testing}
            className="w-full rounded-lg border border-border/50 bg-surface-2 px-4 py-2.5 font-mono text-sm text-white transition-colors focus:border-gold/50 focus:outline-none disabled:opacity-60"
          />
          <p className="text-[12px] leading-relaxed text-zinc-500">
            Create a webhook in Discord under Server Settings → Integrations → Webhooks. Leave the
            field blank to keep the saved URL.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-4">
          <div>
            <p className="text-sm font-medium text-zinc-200">Notify me when sims finish</p>
            <p className="mt-1 text-[12px] text-zinc-500">
              Notifications are sent after a successful result is saved.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEnabled((value) => !value)}
            disabled={loading || saving || testing}
            aria-pressed={enabled}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              enabled ? 'bg-gold' : 'border border-border bg-surface-2'
            } disabled:opacity-60`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
                enabled ? 'left-[22px] bg-black' : 'left-0.5 bg-gray-500'
              }`}
            />
          </button>
        </div>

        <div className="border-t border-border/60 pt-4">
          <div>
            <p className="text-sm font-medium text-zinc-200">Notification types</p>
            <p className="mt-1 text-[12px] text-zinc-500">
              Choose which finished simulation categories should send a Discord message.
            </p>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {NOTIFICATION_TYPES.map(({ key, label, description }) => {
              const typeEnabled = notificationTypes[key];
              return (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-surface-2/50 px-3 py-2.5"
                >
                  <div>
                    <p className="text-sm text-zinc-200">{label}</p>
                    <p className="text-[11px] text-zinc-500">{description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setNotificationTypes((current) => ({ ...current, [key]: !current[key] }))
                    }
                    disabled={loading || saving || testing}
                    aria-label={`${typeEnabled ? 'Disable' : 'Enable'} ${label} notifications`}
                    aria-pressed={typeEnabled}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      typeEnabled ? 'bg-gold' : 'border border-border bg-surface-2'
                    } disabled:opacity-60`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
                        typeEnabled ? 'left-[22px] bg-black' : 'left-0.5 bg-gray-500'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={loading || saving || testing || (enabled && !configured && !url.trim())}
            className="rounded-lg bg-gold/10 px-5 py-2.5 text-sm font-semibold text-gold transition-colors hover:bg-gold/20 disabled:opacity-50"
          >
            {saving ? 'Saving Discord settings...' : 'Save Discord settings'}
          </button>
          <button
            type="button"
            onClick={() => void sendTest()}
            disabled={loading || saving || testing || !configured}
            className="rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-zinc-100 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {testing ? 'Sending test...' : 'Send test'}
          </button>
          {configured && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={loading || saving || testing}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-5 py-2.5 text-sm font-semibold text-red-200 transition-colors hover:bg-red-500/20 disabled:opacity-50"
            >
              Remove webhook
            </button>
          )}
          {message && (
            <p
              role={message.type === 'error' ? 'alert' : 'status'}
              className={`text-xs ${
                message.type === 'error'
                  ? 'text-red-300'
                  : message.type === 'success'
                    ? 'text-emerald-300'
                    : 'text-zinc-400'
              }`}
            >
              {message.text}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

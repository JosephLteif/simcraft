import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  useAuth: vi.fn(),
  replace: vi.fn(),
  isNetworkUnavailableError: vi.fn(() => false),
}));

vi.mock('../lib/api', () => ({
  API_URL: 'http://localhost:17384',
  LAN_ACCESS_REQUIRED_STORAGE_KEY: 'whylowdps_lan_access_required',
  fetchJson: mocks.fetchJson,
  isDesktop: true,
  isNetworkUnavailableError: mocks.isNetworkUnavailableError,
}));

vi.mock('./AuthContext', () => ({
  useAuth: mocks.useAuth,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('./SplashScreen', () => ({
  default: ({
    status,
    retriesRemaining,
    onRetry,
  }: {
    status: string;
    retriesRemaining?: number;
    onRetry?: () => void;
  }) => (
    <>
      <div data-testid="splash">{status}</div>
      <div data-testid="retries-remaining">{retriesRemaining ?? 0}</div>
      {onRetry && <button onClick={onRetry}>Retry</button>}
    </>
  ),
}));

import DataGuard from './DataGuard';

describe('DataGuard auth gating', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    mocks.replace.mockReset();
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url.endsWith('/api/data/status')) return Promise.resolve({ status: 'ready' });
      if (url.endsWith('/api/data/files')) return Promise.resolve({ files: [] });
      return Promise.resolve({});
    });
    mocks.isNetworkUnavailableError.mockReturnValue(false);
  });

  it('shows app content for an authenticated user even if credentials status is stale false', async () => {
    localStorage.setItem('whylowdps_data_ready', 'true');
    mocks.useAuth.mockReturnValue({
      user: { battletag: 'User#1234' },
      loading: false,
      lightMode: false,
      checkCredentialsStatus: vi.fn().mockResolvedValue({ globally_configured: false }),
    });

    render(
      <DataGuard>
        <div>App content</div>
      </DataGuard>
    );

    await waitFor(() => {
      expect(screen.getByText('App content')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('splash')).not.toBeInTheDocument();
  });

  it('shows a failed sync POST as a manual-retry error instead of a stuck auto-retry state', async () => {
    mocks.useAuth.mockReturnValue({
      user: { battletag: 'User#1234' },
      loading: false,
      lightMode: false,
      checkCredentialsStatus: vi.fn().mockResolvedValue({ globally_configured: true }),
    });
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url.endsWith('/api/data/status')) return Promise.reject(new Error('status unavailable'));
      if (url.endsWith('/api/data/sync')) return Promise.reject(new Error('sync unavailable'));
      if (url.endsWith('/api/data/files')) return Promise.resolve({ files: [] });
      return Promise.resolve({});
    });

    render(
      <DataGuard>
        <div>App content</div>
      </DataGuard>
    );

    await waitFor(() => expect(screen.getByTestId('splash')).toHaveTextContent('error'));
    expect(screen.getByTestId('retries-remaining')).toHaveTextContent('0');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('waits for the desktop backend and resumes initial synchronization automatically', async () => {
    let backendAvailable = false;
    mocks.useAuth.mockReturnValue({
      user: { battletag: 'User#1234' },
      loading: false,
      lightMode: false,
      checkCredentialsStatus: vi.fn().mockResolvedValue({ globally_configured: true }),
    });
    mocks.isNetworkUnavailableError.mockReturnValue(true);
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url.endsWith('/api/data/status')) {
        return backendAvailable
          ? Promise.resolve({ status: 'ready' })
          : Promise.reject(new Error('backend starting'));
      }
      if (url.endsWith('/api/data/sync')) {
        return backendAvailable
          ? Promise.resolve({})
          : Promise.reject(new Error('backend starting'));
      }
      if (url.endsWith('/api/data/files')) return Promise.resolve({ files: [] });
      return Promise.resolve({});
    });

    render(
      <DataGuard>
        <div>App content</div>
      </DataGuard>
    );

    await waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledWith(
        expect.stringContaining('/api/data/sync'),
        { method: 'POST' }
      );
    });
    expect(screen.getByTestId('splash')).toHaveTextContent('syncing');
    expect(screen.getByTestId('retries-remaining')).toHaveTextContent('3');

    backendAvailable = true;
    await waitFor(
      () => {
        expect(screen.getByText('App content')).toBeInTheDocument();
        expect(
          mocks.fetchJson.mock.calls.filter(([url]) => String(url).endsWith('/api/data/sync'))
            .length
        ).toBeGreaterThan(1);
      },
      { timeout: 6000 }
    );
  });

  it('prioritizes LAN pairing over credential entry and Light mode', () => {
    mocks.useAuth.mockReturnValue({
      user: null,
      loading: false,
      lanAccessRequired: true,
      lightMode: true,
      checkCredentialsStatus: vi.fn().mockResolvedValue({ globally_configured: false }),
    });

    render(
      <DataGuard>
        <div>App content</div>
      </DataGuard>
    );

    expect(screen.getByTestId('splash')).toHaveTextContent('lan_access_required');
    expect(screen.queryByText('App content')).not.toBeInTheDocument();
  });

  it('redirects a revoked LAN session to the resync page', () => {
    mocks.useAuth.mockReturnValue({
      user: null,
      loading: false,
      lanAccessRequired: true,
      lightMode: false,
      checkCredentialsStatus: vi.fn().mockResolvedValue({ globally_configured: false }),
    });

    render(
      <DataGuard>
        <div>App content</div>
      </DataGuard>
    );

    expect(mocks.replace).toHaveBeenCalledWith('/lan/resync');
  });

  it('keeps missing required data actionable while an app update is available', async () => {
    localStorage.setItem('whylowdps_data_ready', 'true');
    mocks.useAuth.mockReturnValue({
      user: { battletag: 'User#1234' },
      loading: false,
      lightMode: false,
      checkCredentialsStatus: vi.fn().mockResolvedValue({ globally_configured: true }),
    });
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url.endsWith('/api/data/status')) return Promise.resolve({ status: 'ready' });
      if (url.endsWith('/api/data/files')) {
        return Promise.resolve({
          files: [{ required: true, exists: false, label: 'WoW Seasons' }],
        });
      }
      return Promise.resolve({});
    });

    render(
      <DataGuard>
        <div>App content</div>
      </DataGuard>
    );

    await waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledWith(expect.stringContaining('/api/data/files'));
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent('whylowdps-updater-status', { detail: { status: 'available' } })
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Critical data files are missing')).toBeInTheDocument();
    });
  });

  it('keeps the repair action available while a desktop update is available', async () => {
    localStorage.setItem('whylowdps_data_ready', 'true');
    mocks.useAuth.mockReturnValue({
      user: { battletag: 'User#1234' },
      loading: false,
      lightMode: false,
      checkCredentialsStatus: vi.fn().mockResolvedValue({ globally_configured: true }),
    });
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url.endsWith('/api/data/status')) return Promise.resolve({ status: 'ready' });
      if (url.endsWith('/api/data/files')) {
        return Promise.resolve({
          files: [{ required: true, exists: false, label: 'WoW Seasons' }],
        });
      }
      return Promise.resolve({});
    });

    render(
      <DataGuard>
        <div>App content</div>
      </DataGuard>
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent('whylowdps-updater-status', { detail: { status: 'available' } })
      );
    });

    await waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledWith(expect.stringContaining('/api/data/files'));
    });
    expect(await screen.findByRole('button', { name: 'Repair Missing Files' })).toBeInTheDocument();
  });

  it('rechecks required files and opens repair on app focus', async () => {
    localStorage.setItem('whylowdps_data_ready', 'true');
    let files = [] as Array<{ required: boolean; exists: boolean; label: string }>;
    mocks.useAuth.mockReturnValue({
      user: { battletag: 'User#1234' },
      loading: false,
      lightMode: false,
      checkCredentialsStatus: vi.fn().mockResolvedValue({ globally_configured: true }),
    });
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url.endsWith('/api/data/status')) return Promise.resolve({ status: 'ready' });
      if (url.endsWith('/api/data/files')) return Promise.resolve({ files });
      return Promise.resolve({});
    });

    render(
      <DataGuard>
        <div>App content</div>
      </DataGuard>
    );

    await waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledWith(expect.stringContaining('/api/data/files'));
    });
    expect(screen.queryByText('Critical data files are missing')).not.toBeInTheDocument();

    files = [{ required: true, exists: false, label: 'WoW Seasons' }];
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(await screen.findByText('Critical data files are missing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Repair Missing Files' })).toBeInTheDocument();
  });

  it('shows recovery snapshot progress while repair is running', async () => {
    const user = userEvent.setup();
    localStorage.setItem('whylowdps_data_ready', 'true');
    mocks.useAuth.mockReturnValue({
      user: { battletag: 'User#1234' },
      loading: false,
      lightMode: false,
      checkCredentialsStatus: vi.fn().mockResolvedValue({ globally_configured: true }),
    });
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url.endsWith('/api/data/status')) {
        return Promise.resolve({
          status: 'ready',
          progress: 'Repair:1:3:Downloading verified recovery snapshot:512:1024:1000:512',
        });
      }
      if (url.endsWith('/api/data/files')) {
        return Promise.resolve({ files: [{ required: true, exists: false, label: 'Items' }] });
      }
      if (url.endsWith('/api/data/files/missing/download')) return new Promise(() => {});
      return Promise.resolve({});
    });

    render(
      <DataGuard>
        <div>App content</div>
      </DataGuard>
    );

    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent('whylowdps-updater-status', { detail: { status: 'none' } })
      );
    });
    await user.click(await screen.findByRole('button', { name: 'Repair Missing Files' }));

    expect(
      await screen.findByText('Downloading verified recovery snapshot', {}, { timeout: 3000 })
    ).toBeInTheDocument();
    expect(screen.getByText('Downloaded: 512 B / 1 KB')).toBeInTheDocument();
  });

  it('allows the missing-data repair request to outlive the default API timeout', async () => {
    localStorage.setItem('whylowdps_data_ready', 'true');
    mocks.useAuth.mockReturnValue({
      user: { battletag: 'User#1234' },
      loading: false,
      lightMode: false,
      checkCredentialsStatus: vi.fn().mockResolvedValue({ globally_configured: true }),
    });
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url.endsWith('/api/data/status')) return Promise.resolve({ status: 'ready' });
      if (url.endsWith('/api/data/files')) {
        return Promise.resolve({ files: [{ required: true, exists: false, label: 'Items' }] });
      }
      if (url.endsWith('/api/data/files/missing/download')) {
        return Promise.resolve({ sources: {}, failed: [] });
      }
      return Promise.resolve({});
    });

    render(
      <DataGuard>
        <div>App content</div>
      </DataGuard>
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Repair Missing Files' }));

    expect(mocks.fetchJson).toHaveBeenCalledWith(
      expect.stringContaining('/api/data/files/missing/download'),
      { method: 'POST', timeoutMs: 120_000 }
    );
  });

  it('reports the recovery snapshot source without exposing a metadata link', async () => {
    localStorage.setItem('whylowdps_data_ready', 'true');
    mocks.useAuth.mockReturnValue({
      user: { battletag: 'User#1234' },
      loading: false,
      lightMode: false,
      checkCredentialsStatus: vi.fn().mockResolvedValue({ globally_configured: true }),
    });
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url.endsWith('/api/data/status')) return Promise.resolve({ status: 'ready' });
      if (url.endsWith('/api/data/files')) {
        return Promise.resolve({ files: [{ required: true, exists: false, label: 'Items' }] });
      }
      if (url.endsWith('/api/data/files/missing/download')) {
        return Promise.resolve({
          sources: { bundled: [], recovery_snapshot: ['items'], raidbots: [] },
          failed: [],
        });
      }
      return Promise.resolve({});
    });

    render(
      <DataGuard>
        <div>App content</div>
      </DataGuard>
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent('whylowdps-updater-status', { detail: { status: 'none' } })
      );
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Repair Missing Files' }));

    expect(await screen.findByText(/Repaired from verified recovery snapshot/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'metadata.json' })).not.toBeInTheDocument();
  });
});

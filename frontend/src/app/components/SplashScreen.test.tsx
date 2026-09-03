import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SplashScreen from './SplashScreen';

const loginMock = vi.fn();
const setSystemCredentialsMock = vi.fn();
const enableLightModeMock = vi.fn();
const apiMocks = vi.hoisted(() => ({
  listBlizzardCredentialProfiles: vi.fn(),
}));

vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    login: loginMock,
    setSystemCredentials: setSystemCredentialsMock,
    enableLightMode: enableLightModeMock,
  }),
}));

vi.mock('./DesktopWindowTitleBar', () => ({
  default: () => null,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  API_URL: 'http://localhost:17384',
  isDesktop: true,
  isHostedPrivate: false,
  listBlizzardCredentialProfiles: apiMocks.listBlizzardCredentialProfiles,
}));

describe('SplashScreen credential flow', () => {
  beforeEach(() => {
    loginMock.mockReset();
    setSystemCredentialsMock.mockReset();
    enableLightModeMock.mockReset();
    apiMocks.listBlizzardCredentialProfiles.mockReset();
    apiMocks.listBlizzardCredentialProfiles.mockResolvedValue([]);
  });

  it('clears processing state after saving credentials and starting login', async () => {
    const user = userEvent.setup();
    setSystemCredentialsMock.mockResolvedValue(true);
    loginMock.mockResolvedValue(undefined);

    render(<SplashScreen status="unauthenticated_needs_keys" progress="" />);

    await user.type(screen.getByPlaceholderText('Client ID'), 'client-id');
    await user.type(screen.getByPlaceholderText('Client Secret'), 'client-secret');
    await user.click(screen.getByRole('button', { name: /save & login with battle\.net/i }));

    await waitFor(() => {
      expect(setSystemCredentialsMock).toHaveBeenCalledWith('client-id', 'client-secret');
      expect(loginMock).toHaveBeenCalledWith('client-id', 'client-secret');
    });
    await waitFor(() => {
      expect(screen.queryByText('Processing...')).not.toBeInTheDocument();
    });
  });

  it('uses saved credentials without showing new credential fields', async () => {
    apiMocks.listBlizzardCredentialProfiles.mockResolvedValue([
      {
        id: 'profile-1',
        name: 'Main credentials',
        client_id: 'client-id',
        created_at: 1,
        updated_at: 1,
        has_secret: true,
      },
    ]);

    render(<SplashScreen status="unauthenticated_needs_keys" progress="" />);

    expect(await screen.findByRole('button', { name: /main credentials/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Client ID')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Client Secret')).not.toBeInTheDocument();
  });

  it('passes the saved profile when the configured-auth login screen is shown', async () => {
    const user = userEvent.setup();
    apiMocks.listBlizzardCredentialProfiles.mockResolvedValue([
      {
        id: 'profile-1',
        name: 'Main credentials',
        client_id: 'client-id',
        created_at: 1,
        updated_at: 1,
        has_secret: true,
      },
    ]);
    loginMock.mockResolvedValue(undefined);

    render(<SplashScreen status="unauthenticated" progress="" />);

    await waitFor(() => expect(apiMocks.listBlizzardCredentialProfiles).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: /login with battle\.net/i }));

    expect(loginMock).toHaveBeenCalledWith(undefined, undefined, 'profile-1');
  });

  it('shows repair flow when a saved credential is missing its secure secret', async () => {
    apiMocks.listBlizzardCredentialProfiles.mockResolvedValue([
      {
        id: 'profile-1',
        name: 'Main credentials',
        client_id: 'client-id',
        created_at: 1,
        updated_at: 1,
        has_secret: false,
      },
    ]);

    render(<SplashScreen status="unauthenticated_needs_keys" progress="" />);

    expect(await screen.findByText(/secure secret missing/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Client ID')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Client Secret')).toBeInTheDocument();
  });

  it('offers a QR scanner when LAN access is required', () => {
    render(<SplashScreen status="lan_access_required" progress="" />);

    expect(screen.getByRole('button', { name: 'Scan desktop QR code' })).toBeInTheDocument();
  });

  it('keeps the credentials screen scrollable when its content exceeds the viewport', () => {
    render(<SplashScreen status="unauthenticated_needs_keys" progress="" />);

    const logo = screen.getByAltText('WhyLowDps');
    const content = logo.parentElement?.parentElement;
    const viewport = content?.parentElement;

    expect(content).toHaveClass('min-h-full', 'shrink-0', 'py-12');
    expect(viewport).toHaveClass('overflow-y-auto');
  });
});

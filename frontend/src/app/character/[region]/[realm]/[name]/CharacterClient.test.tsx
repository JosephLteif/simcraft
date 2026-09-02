import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchJson, listCharacterProfiles } from '@/app/lib/api';
import { CHARACTER_DATA_TTL_MS } from '@/app/lib/character-refresh';
import CharacterClient from './CharacterClient';

vi.mock('next/navigation', () => ({
  useParams: () => ({ region: 'us', realm: 'aerie-peak', name: 'hero' }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/app/lib/api', () => ({
  API_URL: '',
  deleteCharacterProfile: vi.fn(),
  fetchJson: vi.fn(),
  listCharacterProfiles: vi.fn(),
}));

vi.mock('../../../../components/CharacterPanel', () => ({
  default: ({ mythicPlus }: { mythicPlus?: Record<string, unknown> | null }) => (
    <div data-testid="character-panel">{JSON.stringify(mythicPlus)}</div>
  ),
}));

vi.mock('../../../../components/ConfirmModal', () => ({
  default: () => null,
}));

vi.mock('../../../../components/shared/ToggleOptionCard', () => ({
  default: () => null,
}));

const fetchJsonMock = vi.mocked(fetchJson);
const listCharacterProfilesMock = vi.mocked(listCharacterProfiles);

function mockCharacterResponses() {
  fetchJsonMock.mockImplementation(async (url) => {
    if (url.includes('/profile')) {
      return {
        name: 'Hero',
        level: 80,
        realm: { name: 'Aerie Peak', slug: 'aerie-peak' },
        race: { name: 'Human' },
        character_class: { name: 'Mage' },
        equipped_item_level: 720,
        average_item_level: 718,
      };
    }
    if (url.includes('/equipment')) return { equipped_items: [] };
    return {};
  });
}

describe('CharacterClient refresh lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockCharacterResponses();
    listCharacterProfilesMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('bypasses the cache on the initial load when the snapshot is stale', async () => {
    localStorage.setItem(
      'whylowdps_last_refresh_us|aerie-peak|hero',
      String(Date.now() - CHARACTER_DATA_TTL_MS - 1)
    );

    render(<CharacterClient />);

    await waitFor(() => expect(screen.getByTestId('character-panel')).toBeInTheDocument());
    expect(fetchJsonMock).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/blizzard/character/aerie-peak/hero/profile?region=us&refresh=true'
      )
    );
  });

  it('uses an immediate cache bypass for the manual Refresh button', async () => {
    localStorage.setItem('whylowdps_last_refresh_us|aerie-peak|hero', String(Date.now()));

    render(<CharacterClient />);
    await waitFor(() => expect(screen.getByTestId('character-panel')).toBeInTheDocument());
    const refreshButton = screen.getByRole('button', { name: 'Refresh' });

    await act(async () => {
      refreshButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const profileRequests = fetchJsonMock.mock.calls.filter(([url]) => url.includes('/profile'));
    expect(profileRequests).toHaveLength(2);
    expect(profileRequests[1][0]).toContain('refresh=true');
  });

  it('refreshes stale data on the active-page timer while retaining the page', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-09-02T10:00:00Z');
    vi.setSystemTime(now);
    localStorage.setItem('whylowdps_last_refresh_us|aerie-peak|hero', String(now.getTime()));

    render(<CharacterClient />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const profileRequestsBeforeTimer = fetchJsonMock.mock.calls.filter(([url]) =>
      url.includes('/profile')
    );
    expect(profileRequestsBeforeTimer).toHaveLength(1);
    expect(profileRequestsBeforeTimer[0][0]).not.toContain('refresh=true');

    await act(async () => {
      vi.advanceTimersByTime(CHARACTER_DATA_TTL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    const profileRequestsAfterTimer = fetchJsonMock.mock.calls.filter(([url]) =>
      url.includes('/profile')
    );
    expect(profileRequestsAfterTimer).toHaveLength(2);
    expect(profileRequestsAfterTimer[1][0]).toContain('refresh=true');
    expect(screen.getByTestId('character-panel')).toBeInTheDocument();
  });

  it('waits while hidden, refreshes on visibility, and keeps the last snapshot on failure', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-09-02T10:00:00Z');
    vi.setSystemTime(now);
    localStorage.setItem('whylowdps_last_refresh_us|aerie-peak|hero', String(now.getTime()));
    let profileRequestCount = 0;
    fetchJsonMock.mockImplementation(async (url) => {
      if (url.includes('/profile')) {
        profileRequestCount += 1;
        if (profileRequestCount > 1) throw new Error('Blizzard unavailable');
        return {
          name: 'Hero',
          level: 80,
          realm: { name: 'Aerie Peak', slug: 'aerie-peak' },
          race: { name: 'Human' },
          character_class: { name: 'Mage' },
        };
      }
      if (url.includes('/equipment')) return { equipped_items: [] };
      return {};
    });

    render(<CharacterClient />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    await act(async () => {
      vi.advanceTimersByTime(CHARACTER_DATA_TTL_MS);
      await Promise.resolve();
    });
    expect(profileRequestCount).toBe(1);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(profileRequestCount).toBe(2);
    expect(screen.getByTestId('character-panel')).toBeInTheDocument();
    expect(screen.getByText(/last successful snapshot/i)).toBeInTheDocument();
  });

  it('retains a successful Mythic+ snapshot when a refresh returns an empty payload', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-09-02T10:00:00Z');
    vi.setSystemTime(now);
    localStorage.setItem('whylowdps_last_refresh_us|aerie-peak|hero', String(now.getTime()));
    let mythicRequestCount = 0;
    fetchJsonMock.mockImplementation(async (url) => {
      if (url.includes('/profile')) {
        return {
          name: 'Hero',
          level: 80,
          realm: { name: 'Aerie Peak', slug: 'aerie-peak' },
          race: { name: 'Human' },
          character_class: { name: 'Mage' },
        };
      }
      if (url.includes('/equipment')) return { equipped_items: [] };
      if (url.includes('/mythic-keystone-profile')) {
        mythicRequestCount += 1;
        return mythicRequestCount === 1
          ? {
              current_period: {
                best_runs: [{ keystone_level: 12, dungeon: { name: 'The Dawnbreaker' } }],
              },
            }
          : {};
      }
      return {};
    });

    render(<CharacterClient />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('character-panel')).toHaveTextContent('The Dawnbreaker');

    await act(async () => {
      vi.advanceTimersByTime(CHARACTER_DATA_TTL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mythicRequestCount).toBe(2);
    expect(screen.getByTestId('character-panel')).toHaveTextContent('The Dawnbreaker');
  });
});

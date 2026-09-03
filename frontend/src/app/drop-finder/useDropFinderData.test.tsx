import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDropFinderData } from './useDropFinderData';

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  API_URL: 'http://localhost:17384',
  fetchJson: mocks.fetchJson,
}));

const seasonConfig = {
  season: 'current',
  raid_difficulties: [],
  dungeon_categories: [],
};

const upgradeTracks = {
  Hero: [{ level: 1, max_level: 6, ilvl: 600, bonus_id: 1, quality: 4 }],
};

function mockCatalog() {
  mocks.fetchJson.mockImplementation((url: string) => {
    if (url.endsWith('/api/season-config')) return Promise.resolve(seasonConfig);
    if (url.endsWith('/api/upgrade-tracks')) return Promise.resolve(upgradeTracks);
    if (url.endsWith('/api/instances')) return Promise.resolve([]);
    return Promise.resolve({});
  });
}

describe('useDropFinderData', () => {
  beforeEach(() => {
    mocks.fetchJson.mockReset();
    mockCatalog();
  });

  it('distinguishes an empty drop response from a request error', async () => {
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url.endsWith('/api/season-config')) return Promise.resolve(seasonConfig);
      if (url.endsWith('/api/upgrade-tracks')) return Promise.resolve(upgradeTracks);
      if (url.endsWith('/api/instances')) return Promise.resolve([]);
      return Promise.resolve({});
    });

    const { result } = renderHook(() => useDropFinderData('', new Set()));

    act(() => result.current.setSelectedId('123'));
    await waitFor(() => expect(result.current.dropState).toBe('empty'));
    expect(result.current.dropError).toBeNull();

    mocks.fetchJson.mockImplementation((url: string) => {
      if (url.includes('/drops')) return Promise.reject(new Error('drop service unavailable'));
      if (url.endsWith('/api/season-config')) return Promise.resolve(seasonConfig);
      if (url.endsWith('/api/upgrade-tracks')) return Promise.resolve(upgradeTracks);
      if (url.endsWith('/api/instances')) return Promise.resolve([]);
      return Promise.resolve({});
    });

    act(() => result.current.setSelectedId('456'));
    await waitFor(() => expect(result.current.dropState).toBe('error'));
    expect(result.current.dropError).toBe('drop service unavailable');
  });

  it('ignores a stale response after the user changes the instance selection', async () => {
    let dropCall = 0;
    let resolveFirst: ((value: unknown) => void) | undefined;
    let resolveSecond: ((value: unknown) => void) | undefined;
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondResponse = new Promise((resolve) => {
      resolveSecond = resolve;
    });

    mocks.fetchJson.mockImplementation((url: string) => {
      if (url.includes('/drops')) {
        dropCall += 1;
        return dropCall === 1 ? firstResponse : secondResponse;
      }
      if (url.endsWith('/api/season-config')) return Promise.resolve(seasonConfig);
      if (url.endsWith('/api/upgrade-tracks')) return Promise.resolve(upgradeTracks);
      if (url.endsWith('/api/instances')) return Promise.resolve([]);
      return Promise.resolve({});
    });

    const { result } = renderHook(() => useDropFinderData('', new Set()));
    act(() => result.current.setSelectedId('123'));
    await waitFor(() => expect(dropCall).toBe(1));
    act(() => result.current.setSelectedId('456'));
    await waitFor(() => expect(dropCall).toBe(2));

    act(() => {
      resolveSecond?.({ Head: [{ item_id: 2, name: 'New item' }] });
    });
    await waitFor(() => expect(result.current.drops?.Head?.[0]?.item_id).toBe(2));

    act(() => {
      resolveFirst?.({ Head: [{ item_id: 1, name: 'Old item' }] });
    });
    await waitFor(() => expect(result.current.drops?.Head?.[0]?.item_id).toBe(2));
  });
});

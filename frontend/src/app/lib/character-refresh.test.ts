import { describe, expect, it } from 'vitest';
import { CHARACTER_DATA_TTL_MS, isCharacterDataStale } from './character-refresh';

describe('character data freshness', () => {
  const now = 1_000_000;

  it('treats missing and expired snapshots as stale', () => {
    expect(isCharacterDataStale(null, now)).toBe(true);
    expect(isCharacterDataStale(now - CHARACTER_DATA_TTL_MS, now)).toBe(true);
    expect(isCharacterDataStale(now - CHARACTER_DATA_TTL_MS - 1, now)).toBe(true);
  });

  it('keeps snapshots fresh until the 15-minute window expires', () => {
    expect(isCharacterDataStale(now - CHARACTER_DATA_TTL_MS + 1, now)).toBe(false);
    expect(isCharacterDataStale(now + 1, now)).toBe(false);
  });
});

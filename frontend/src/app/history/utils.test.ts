import { describe, expect, it } from 'vitest';
import { decodeHistoryCharacterFilter, encodeHistoryCharacterFilter } from './utils';

describe('history character filters', () => {
  it('round-trips names and realms containing hyphens', () => {
    const character = { name: 'Anne-Marie', realm: 'Aerie-Peak', region: 'eu' };
    const encoded = encodeHistoryCharacterFilter(character);

    expect(decodeHistoryCharacterFilter(encoded)).toEqual(character);
  });

  it('rejects malformed filter values instead of selecting a partial character', () => {
    expect(decodeHistoryCharacterFilter('Anne-Marie-Aerie-Peak')).toBeNull();
    expect(decodeHistoryCharacterFilter('all')).toBeNull();
  });
});

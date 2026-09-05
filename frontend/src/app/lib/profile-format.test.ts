import { describe, expect, it } from 'vitest';
import { buildCharacterBackgroundUrl } from './profile-format';

describe('buildCharacterBackgroundUrl', () => {
  it('resolves a display spec and class to the class artwork asset', () => {
    expect(buildCharacterBackgroundUrl('Arcane Mage')).toBe(
      'https://render.worldofwarcraft.com/profile-backgrounds/v2/armory_bg_class_mage.jpg'
    );
  });

  it('uses the canonical underscore slug for multi-word classes', () => {
    expect(buildCharacterBackgroundUrl('Death Knight')).toBe(
      'https://render.worldofwarcraft.com/profile-backgrounds/v2/armory_bg_class_death_knight.jpg'
    );
  });

  it('returns no background URL for an unknown class', () => {
    expect(buildCharacterBackgroundUrl('')).toBeNull();
    expect(buildCharacterBackgroundUrl('Unknown')).toBeNull();
  });
});

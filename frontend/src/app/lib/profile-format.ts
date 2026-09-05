import { CLASS_COLORS } from './types';

function normalizeClassKey(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, '_');
}

const CHARACTER_BACKGROUND_CLASS_KEYS = [
  'death_knight',
  'demon_hunter',
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'monk',
  'druid',
  'evoker',
] as const;

export function buildCharacterBackgroundUrl(className?: string | null): string | null {
  const normalizedClassName = className?.trim();
  if (!normalizedClassName) return null;
  const normalized = normalizeClassKey(normalizedClassName);
  const compact = normalized.replace(/_/g, '');
  const classKey = CHARACTER_BACKGROUND_CLASS_KEYS.find(
    (candidate) =>
      normalized === candidate ||
      normalized.endsWith(`_${candidate}`) ||
      compact.endsWith(candidate.replace(/_/g, ''))
  );
  if (!classKey) return null;
  return `https://render.worldofwarcraft.com/profile-backgrounds/v2/armory_bg_class_${classKey}.jpg`;
}

export function resolveClassColor(className?: string | null): string | undefined {
  if (!className) return undefined;
  const normalized = normalizeClassKey(className);
  return CLASS_COLORS[normalized] || CLASS_COLORS[normalized.replace(/_/g, '')];
}

export function formatRealmName(realm?: string | null): string {
  if (!realm) return '';
  return realm.charAt(0).toUpperCase() + realm.slice(1);
}

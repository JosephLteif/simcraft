import { API_URL } from './api';
import { wowInstances } from './wow-season-content';
import type { Instance } from '../drop-finder/types';

const FALLBACK_INSTANCE_IMAGES: Record<string, string> = {
  'world bosses':
    'https://bnetcmsus-a.akamaihd.net/cms/content_entry_media/X0MQBJPBDS5J1781742460649.png',
  'the tidebound grotto':
    'https://bnetcmsus-a.akamaihd.net/cms/blog_header/7t/7TRTKV368HRY1785353626933.jpg',
  'the venomous abyss':
    'https://bnetcmsus-a.akamaihd.net/cms/content_entry_media/SSA6NR4LD1VX1785170429186.png',
};

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function resolveAssetUrl(url: string): string {
  return url.startsWith('/') ? `${API_URL}${url}` : url;
}

export function getInstanceImageSources(
  instance: Pick<Instance, 'id' | 'name' | 'image_url'>
): string[] {
  if (instance.id <= 0) return [];

  const apiImageUrl = instance.image_url ? resolveAssetUrl(instance.image_url) : undefined;
  const bundledImageUrl = wowInstances.find((candidate) => candidate.id === instance.id)?.imageUrl;
  const fallbackImageUrl = FALLBACK_INSTANCE_IMAGES[normalizeName(instance.name)];

  return [
    ...new Set(
      [
        apiImageUrl && !apiImageUrl.includes('/api/data/images/') ? apiImageUrl : undefined,
        bundledImageUrl,
        fallbackImageUrl,
        apiImageUrl,
      ].filter((url): url is string => Boolean(url))
    ),
  ];
}

export interface HistoryCharacterFilter {
  name: string;
  realm: string;
  region?: string;
}

export function encodeHistoryCharacterFilter(character: HistoryCharacterFilter): string {
  return encodeURIComponent(
    JSON.stringify({
      name: character.name,
      realm: character.realm,
      region: character.region || undefined,
    })
  );
}

export function decodeHistoryCharacterFilter(value: string): HistoryCharacterFilter | null {
  if (!value || value === 'all') return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Record<string, unknown>;
    if (typeof parsed.name !== 'string' || typeof parsed.realm !== 'string') return null;
    if (!parsed.name || !parsed.realm) return null;
    return {
      name: parsed.name,
      realm: parsed.realm,
      ...(typeof parsed.region === 'string' && parsed.region ? { region: parsed.region } : {}),
    };
  } catch {
    return null;
  }
}

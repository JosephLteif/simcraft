export const CHARACTER_DATA_TTL_MS = 15 * 60 * 1000;

export function isCharacterDataStale(lastRefreshedAt: number | null, now = Date.now()): boolean {
  if (lastRefreshedAt === null || !Number.isFinite(lastRefreshedAt) || lastRefreshedAt <= 0) {
    return true;
  }
  return now - lastRefreshedAt >= CHARACTER_DATA_TTL_MS;
}

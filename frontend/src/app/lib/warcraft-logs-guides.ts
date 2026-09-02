import guideMappings from '../../../../backend/resources/wow/warcraft-logs-guides.json';

export function normalizeEncounterName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

type GuideMapping = {
  slug: string;
  encounterNames: string[];
};

const guideUrlByEncounterName = new Map<string, string>();

for (const mapping of guideMappings as GuideMapping[]) {
  const guideUrl = `https://www.warcraftlogs.com/guide/${mapping.slug}`;
  for (const encounterName of mapping.encounterNames ?? []) {
    guideUrlByEncounterName.set(normalizeEncounterName(encounterName), guideUrl);
  }
}

export function getWarcraftLogsGuideUrl(encounterName: string): string | null {
  if (!encounterName) return null;
  return guideUrlByEncounterName.get(normalizeEncounterName(encounterName)) ?? null;
}

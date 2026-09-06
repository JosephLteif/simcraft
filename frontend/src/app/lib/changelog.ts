import generatedChangelogData from './changelog.generated.json';

export type ChangelogCategory = 'feature' | 'improvement' | 'fix' | 'documentation';

export type ChangelogEntry = {
  category: ChangelogCategory;
  title: string;
  summary: string;
  items?: string[];
};

export type ChangelogRelease = {
  version: string;
  date: string;
  title: string;
  entries: ChangelogEntry[];
};

export const CHANGELOG_HISTORY_URL = 'https://josephlteif.github.io/WhyLowDPS/changelog.html';

const changelogData = generatedChangelogData as unknown as {
  contentRevision: string;
  releases: ChangelogRelease[];
};

export const CHANGELOG_CONTENT_REVISION = changelogData.contentRevision;
export const CHANGELOG_RELEASES = changelogData.releases;
export const LATEST_CHANGELOG_RELEASE = CHANGELOG_RELEASES[0];

type ParsedChangelogVersion = {
  major: number;
  minor: number;
  patch: number;
};

function parseChangelogVersion(value: string | null | undefined): ParsedChangelogVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? '').trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareChangelogVersions(a: ParsedChangelogVersion, b: ParsedChangelogVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function isMajorChangelogRelease(version: string): boolean {
  const parsed = parseChangelogVersion(version);
  return parsed?.minor === 0 && parsed.patch === 0;
}

export function getChangelogReleasesToShow(
  releases: ChangelogRelease[],
  currentVersion: string,
  lastSeenVersion: string | null
): ChangelogRelease[] {
  const stableReleases = releases.filter((release) => parseChangelogVersion(release.version));
  const current = parseChangelogVersion(currentVersion);
  const availableReleases = current
    ? stableReleases.filter((release) => {
        const parsed = parseChangelogVersion(release.version);
        return parsed ? compareChangelogVersions(parsed, current) <= 0 : false;
      })
    : stableReleases;
  const currentRelease =
    (current
      ? availableReleases.find((release) => {
          const parsed = parseChangelogVersion(release.version);
          return parsed ? compareChangelogVersions(parsed, current) === 0 : false;
        })
      : null) ??
    availableReleases[0] ??
    null;
  const lastSeen = parseChangelogVersion(lastSeenVersion);

  let stableToShow: ChangelogRelease[];
  if (lastSeen) {
    stableToShow = availableReleases.filter((release) => {
      const parsed = parseChangelogVersion(release.version);
      return parsed ? compareChangelogVersions(parsed, lastSeen) > 0 : false;
    });
  } else if (current) {
    const majorRelease = availableReleases
      .filter((release) => parseChangelogVersion(release.version)?.major === current.major)
      .reduce<ChangelogRelease | null>((oldest, release) => {
        if (!oldest) return release;
        const releaseVersion = parseChangelogVersion(release.version);
        const oldestVersion = parseChangelogVersion(oldest.version);
        return releaseVersion &&
          oldestVersion &&
          compareChangelogVersions(releaseVersion, oldestVersion) < 0
          ? release
          : oldest;
      }, null);
    stableToShow = [currentRelease, majorRelease].filter((release): release is ChangelogRelease =>
      Boolean(release)
    );
  } else {
    stableToShow = availableReleases.slice(0, 1);
  }

  if (stableToShow.length === 0 && currentRelease) stableToShow = [currentRelease];

  const unreleased = releases.filter(
    (release) => release.version.trim().toLowerCase() === 'unreleased' && release.entries.length > 0
  );
  const seenVersions = new Set<string>();
  return [...unreleased, ...stableToShow].filter((release) => {
    const key = release.version.trim().toLowerCase();
    if (seenVersions.has(key)) return false;
    seenVersions.add(key);
    return true;
  });
}

export const CHANGELOG_CATEGORY_LABELS: Record<ChangelogCategory, string> = {
  feature: 'New features',
  improvement: 'Improvements',
  fix: 'Bug fixes',
  documentation: 'Documentation',
};

export const CHANGELOG_CATEGORY_ORDER: ChangelogCategory[] = [
  'feature',
  'improvement',
  'fix',
  'documentation',
];

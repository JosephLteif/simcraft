import { describe, expect, it } from 'vitest';
import { getChangelogReleasesToShow, type ChangelogRelease } from './changelog';

const release = (version: string): ChangelogRelease => ({
  version,
  date: '',
  title: version,
  entries: [{ category: 'feature', title: version, summary: version }],
});

describe('changelog release selection', () => {
  const releases = [release('6.0.1'), release('6.0.0'), release('5.0.1')];

  it('includes the current major release for a fresh install on a patch', () => {
    expect(
      getChangelogReleasesToShow(releases, '6.0.1', null).map(({ version }) => version)
    ).toEqual(['6.0.1', '6.0.0']);
  });

  it('shows only releases newer than the last seen version', () => {
    expect(
      getChangelogReleasesToShow(releases, '6.0.1', '5.0.1').map(({ version }) => version)
    ).toEqual(['6.0.1', '6.0.0']);
    expect(
      getChangelogReleasesToShow(releases, '6.0.1', '6.0.0').map(({ version }) => version)
    ).toEqual(['6.0.1']);
  });

  it('keeps unreleased notes ahead of versioned releases', () => {
    const withUnreleased = [release('Unreleased'), ...releases];
    expect(
      getChangelogReleasesToShow(withUnreleased, '6.0.1', '6.0.0').map(({ version }) => version)
    ).toEqual(['Unreleased', '6.0.1']);
  });
});

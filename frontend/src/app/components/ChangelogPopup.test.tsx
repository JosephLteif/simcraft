import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import ChangelogPopup, {
  CHANGELOG_CONTENT_REVISION,
  CHANGELOG_LAST_SEEN_VERSION_KEY,
  CHANGELOG_OPEN_EVENT,
} from './ChangelogPopup';
import { APP_VERSION } from '../lib/version';
import { CHANGELOG_HISTORY_URL, LATEST_CHANGELOG_RELEASE } from '../lib/changelog';

const seenKey = `whylowdps_changelog_seen_${APP_VERSION}_${CHANGELOG_CONTENT_REVISION}`;

describe('ChangelogPopup', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the current version changelog once and records dismissal', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ChangelogPopup />);

    const dialog = await screen.findByRole('dialog', { name: /what's new/i });
    expect(dialog).toBeInTheDocument();
    expect(
      dialog.querySelector(`[data-changelog-release="${LATEST_CHANGELOG_RELEASE.version}"]`)
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 4 }).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: /changelog item|changelog page/i })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /changelog history/i })).toHaveAttribute(
      'href',
      CHANGELOG_HISTORY_URL
    );

    await user.click(screen.getByRole('button', { name: /got it/i }));
    expect(localStorage.getItem(seenKey)).toBe('1');
    expect(localStorage.getItem(CHANGELOG_LAST_SEEN_VERSION_KEY)).toBe(APP_VERSION);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /what's new/i })).not.toBeInTheDocument();
    });

    unmount();
    render(<ChangelogPopup />);

    expect(screen.queryByRole('dialog', { name: /what's new/i })).not.toBeInTheDocument();
  });

  it('opens on demand even after the current version was dismissed', async () => {
    localStorage.setItem(seenKey, '1');
    render(<ChangelogPopup />);

    expect(screen.queryByRole('dialog', { name: /what's new/i })).not.toBeInTheDocument();

    window.dispatchEvent(new Event(CHANGELOG_OPEN_EVENT));

    expect(await screen.findByRole('dialog', { name: /what's new/i })).toBeInTheDocument();
  });

  it('keeps the desktop header region uncovered while open', async () => {
    render(<ChangelogPopup />);

    const dialog = await screen.findByRole('dialog', { name: /what's new/i });
    const overlay = dialog.parentElement;

    expect(overlay).toHaveStyle({ top: 'var(--app-header-height)' });
  });

  it('renders every release note in one categorized scrollable page', async () => {
    render(<ChangelogPopup />);

    const dialog = await screen.findByRole('dialog', { name: /what's new/i });

    expect(dialog.querySelector('header')).toHaveClass('shrink-0', 'bg-[#111218]');
    const article = dialog.querySelector('article');
    expect(article).toHaveClass('overflow-y-auto');

    const categories = dialog.querySelectorAll<HTMLElement>(
      'section[aria-labelledby^="changelog-"]'
    );
    expect(categories.length).toBeGreaterThan(0);
    for (const category of categories) {
      expect(within(category).getByRole('heading', { level: 3 })).toBeInTheDocument();
      expect(within(category).getAllByRole('heading', { level: 4 }).length).toBeGreaterThan(0);
    }

    expect(screen.queryByRole('button', { name: /next changelog item/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /previous changelog item/i })
    ).not.toBeInTheDocument();
  });

  it('renders detailed changelog content as rich text', async () => {
    render(<ChangelogPopup />);

    await screen.findByRole('dialog', { name: /what's new/i });

    const noteHeadings = screen.getAllByRole('heading', { level: 4 });
    expect(noteHeadings.length).toBeGreaterThan(0);
    for (const heading of noteHeadings) {
      expect(heading.parentElement?.querySelector('p, ul')).not.toBeNull();
    }
  });
});

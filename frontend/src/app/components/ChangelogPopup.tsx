'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHANGELOG_CATEGORY_LABELS,
  CHANGELOG_CATEGORY_ORDER,
  CHANGELOG_CONTENT_REVISION,
  CHANGELOG_HISTORY_URL,
  CHANGELOG_RELEASES,
  LATEST_CHANGELOG_RELEASE,
  getChangelogReleasesToShow,
  isMajorChangelogRelease,
  type ChangelogRelease,
  type ChangelogCategory,
} from '../lib/changelog';
import { APP_VERSION } from '../lib/version';

export const CHANGELOG_OPEN_EVENT = 'whylowdps:open-changelog';
export const CHANGELOG_STATUS_EVENT = 'whylowdps:changelog-status';
export { CHANGELOG_CONTENT_REVISION } from '../lib/changelog';

export const CHANGELOG_SEEN_KEY = `whylowdps_changelog_seen_${APP_VERSION}_${CHANGELOG_CONTENT_REVISION}`;
export const CHANGELOG_LAST_SEEN_VERSION_KEY = 'whylowdps_changelog_last_seen_version';

function readLastSeenVersion(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(CHANGELOG_LAST_SEEN_VERSION_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function isChangelogUnread(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(CHANGELOG_SEEN_KEY) !== '1';
  } catch {
    return true;
  }
}

function notifyChangelogStatus(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGELOG_STATUS_EVENT));
}

export default function ChangelogPopup() {
  const [isOpen, setIsOpen] = useState(false);
  const [lastSeenVersion, setLastSeenVersion] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [visibleReleases, setVisibleReleases] = useState<ChangelogRelease[]>(() =>
    getChangelogReleasesToShow(CHANGELOG_RELEASES, APP_VERSION, null)
  );
  const versionFilters = Array.from(new Set(visibleReleases.map((release) => release.version)));
  const activeVersionFilter =
    selectedVersion && versionFilters.includes(selectedVersion) ? selectedVersion : null;
  const releasesToRender = activeVersionFilter
    ? visibleReleases.filter((release) => release.version === activeVersionFilter)
    : visibleReleases;
  const dialogRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const previous = readLastSeenVersion();
    setLastSeenVersion(previous);
    setVisibleReleases(getChangelogReleasesToShow(CHANGELOG_RELEASES, APP_VERSION, previous));
    if (isChangelogUnread()) setIsOpen(true);
    notifyChangelogStatus();

    const open = () => {
      setIsOpen(true);
    };
    window.addEventListener(CHANGELOG_OPEN_EVENT, open);
    return () => window.removeEventListener(CHANGELOG_OPEN_EVENT, open);
  }, []);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(CHANGELOG_SEEN_KEY, '1');
      window.localStorage.setItem(CHANGELOG_LAST_SEEN_VERSION_KEY, APP_VERSION);
    } catch {}
    setLastSeenVersion(APP_VERSION);
    setIsOpen(false);
    notifyChangelogStatus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []
      );
    focusable()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [dismiss, isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[90] flex items-center justify-center bg-black/70 px-4 py-6"
      style={{ top: 'var(--app-header-height)' }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-title"
        tabIndex={-1}
        className="flex max-h-[min(800px,calc(100vh-var(--app-header-height)-3rem))] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#111218] shadow-2xl"
      >
        <header className="relative isolate z-10 shrink-0 overflow-hidden border-b border-white/10 bg-[#111218] px-6 py-8 shadow-[0_8px_20px_-18px_rgba(0,0,0,0.9)] sm:px-8 sm:py-9">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(212,168,67,0.18),transparent_58%)]"
          />
          <div className="relative flex items-start justify-between gap-6">
            <div className="flex items-center gap-4">
              <span className="border-gold/40 bg-gold/10 text-gold inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border font-mono text-lg font-black tracking-tight shadow-[0_0_24px_rgba(212,168,67,0.14)]">
                v
              </span>
              <div>
                <p className="text-gold/75 text-[10px] font-semibold tracking-[0.2em] uppercase">
                  What&apos;s new · WhyLowDPS release
                </p>
                <p className="text-gold mt-0.5 font-mono text-2xl font-black tracking-tight">
                  {LATEST_CHANGELOG_RELEASE.version}
                </p>
                <p className="mt-2 text-sm text-zinc-400">
                  {lastSeenVersion
                    ? `Updates since ${lastSeenVersion}.`
                    : 'Latest updates and major-release highlights.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/[0.1] hover:text-white"
              aria-label="Close changelog"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
          <h2 id="changelog-title" className="sr-only">
            What&apos;s new
          </h2>
          <div className="relative mt-6 border-t border-white/[0.08] pt-4">
            <p
              id="changelog-version-filter-label"
              className="text-[10px] font-semibold tracking-[0.18em] text-zinc-500 uppercase"
            >
              Browse by version
            </p>
            <div
              className="mt-3 flex flex-wrap gap-2"
              role="group"
              aria-labelledby="changelog-version-filter-label"
            >
              <button
                type="button"
                onClick={() => setSelectedVersion(null)}
                aria-pressed={activeVersionFilter === null}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeVersionFilter === null
                    ? 'border-gold/40 bg-gold/15 text-gold'
                    : 'border-white/10 bg-white/[0.04] text-zinc-400 hover:bg-white/[0.1] hover:text-zinc-100'
                }`}
              >
                All versions
              </button>
              {versionFilters.map((version) => (
                <button
                  key={version}
                  type="button"
                  onClick={() => setSelectedVersion(version)}
                  aria-pressed={activeVersionFilter === version}
                  className={`rounded-full border px-3 py-1.5 font-mono text-xs font-semibold transition-colors ${
                    activeVersionFilter === version
                      ? 'border-gold/40 bg-gold/15 text-gold'
                      : 'border-white/10 bg-white/[0.04] text-zinc-400 hover:bg-white/[0.1] hover:text-zinc-100'
                  }`}
                >
                  {version}
                </button>
              ))}
            </div>
          </div>
        </header>

        <article className="relative z-0 min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-6">
          <div className="space-y-10">
            {releasesToRender.map((release, releaseIndex) => {
              const releaseSlug = `${release.version}-${releaseIndex}`
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-');
              return (
                <div
                  key={`${release.version}-${releaseIndex}`}
                  data-changelog-release={release.version}
                >
                  <div className="mb-4 flex items-center gap-3">
                    <p className="text-gold text-xs font-bold tracking-[0.18em] uppercase">
                      {release.version}
                    </p>
                    {isMajorChangelogRelease(release.version) ? (
                      <span className="border-gold/25 bg-gold/10 text-gold rounded border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                        Major release highlights
                      </span>
                    ) : null}
                    <div className="from-gold/25 h-px flex-1 bg-gradient-to-r to-transparent" />
                  </div>
                  <div className="space-y-8">
                    {CHANGELOG_CATEGORY_ORDER.map((category: ChangelogCategory) => {
                      const notes = release.entries.filter((note) => note.category === category);
                      if (notes.length === 0) return null;

                      return (
                        <section
                          key={`${release.version}-${category}`}
                          aria-labelledby={`changelog-${releaseSlug}-${category}`}
                        >
                          <div className="mb-3 flex items-center gap-3">
                            <h3
                              id={`changelog-${releaseSlug}-${category}`}
                              className="text-gold text-xs font-bold tracking-[0.18em] uppercase"
                            >
                              {CHANGELOG_CATEGORY_LABELS[category]}
                            </h3>
                            <div className="from-gold/25 h-px flex-1 bg-gradient-to-r to-transparent" />
                          </div>
                          <div className="space-y-3">
                            {notes.map((note) => (
                              <div
                                key={`${release.version}-${note.title}`}
                                className="hover:border-gold/25 rounded-xl border border-white/[0.08] bg-white/[0.025] p-4 transition-colors"
                              >
                                <h4 className="text-base font-semibold text-zinc-100">
                                  {note.title}
                                </h4>
                                <div className="mt-3 space-y-3 text-sm leading-6 text-zinc-300">
                                  <p>{note.summary}</p>
                                  {note.items && (
                                    <ul className="marker:text-gold list-disc space-y-2 pl-5">
                                      {note.items.map((item) => (
                                        <li key={item}>{item}</li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 p-5 sm:px-6">
          <a
            href={CHANGELOG_HISTORY_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            View changelog history
          </a>
          <button
            type="button"
            onClick={dismiss}
            className="border-gold/35 bg-gold/15 text-gold hover:bg-gold/25 rounded-md border px-4 py-2 text-sm font-semibold transition-colors"
          >
            Got it
          </button>
        </div>
      </section>
    </div>
  );
}

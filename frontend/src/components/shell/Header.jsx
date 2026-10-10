import React from 'react';
import { href, SECTIONS } from '../../router';
import { useInFlight } from '../jobs/jobsStore';
import JobsBadge from './JobsBadge';

const LABELS = { split: 'Split', library: 'Library', arrange: 'Arrange' };
const REPO_URL = 'https://github.com/JonPark0/web_audio_splitter';

// Last place visited in each section, so an inactive section link resumes
// where you left it (e.g. the job you were looking at), while the active
// one goes back to its home.
const lastPath = { split: '/split', library: '/library', arrange: '/arrange' };

export function rememberRoute(route) {
  const qs = new URLSearchParams(route.query).toString();
  lastPath[route.section] = qs ? `${route.path}?${qs}` : route.path;
}

/**
 * One sticky 48px row on every size: wordmark, jobs badge, sections, and
 * (from 640px) Info / GitHub. On phones the badge takes the wordmark's place
 * so the row never wraps.
 */
export default function Header({ route }) {
  const inFlight = useInFlight();
  return (
    <header className="sticky top-0 z-30 h-12 border-b border-line bg-paper">
      <div className="px-safe mx-auto flex h-full w-full max-w-[1920px] items-center gap-4 sm:gap-6">
        <a
          href={href('/split')}
          className={`flex h-full min-w-0 items-center truncate whitespace-nowrap font-brand text-p uppercase leading-none tracking-logo sm:text-h4 ${
            inFlight ? 'max-sm:hidden' : ''
          }`}
        >
          Audio Splitter
        </a>
        <JobsBadge />
        <nav aria-label="Sections" className="ml-auto flex shrink-0 items-center gap-4 sm:gap-6">
          {SECTIONS.map((s) => {
            const current = route.section === s;
            const to = current ? `/${s}` : lastPath[s] || `/${s}`;
            return (
              <a
                key={s}
                href={href(to)}
                data-label={LABELS[s]}
                aria-current={current ? 'page' : undefined}
                className={`link ${current ? 'is-current' : ''}`}
                onClick={() => {
                  // Already at the section's home: the link is a no-op, so
                  // at least bring the top of the screen back.
                  if (current && route.path === `/${s}` && !Object.keys(route.query).length) window.scrollTo(0, 0);
                }}
              >
                {LABELS[s]}
              </a>
            );
          })}
        </nav>
        <div className="hidden shrink-0 items-center gap-4 text-caption sm:flex">
          <a href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer" data-label="Info" className="link">
            Info
          </a>
          <a href={REPO_URL} target="_blank" rel="noreferrer" data-label="GitHub" className="link">
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}

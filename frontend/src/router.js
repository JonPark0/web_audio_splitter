/**
 * Hash router: the app's place (section, job, project, filters) lives in the
 * URL, so refresh, Back/Forward, new tabs and bookmarks keep it. Before this,
 * all of it was React state and a refresh dropped you on the upload screen.
 *
 * Routes (the part after `#`):
 *   /split                      new split + jobs list
 *   /split/job/<taskId>         one job: progress, YouTube confirm, or stems
 *   /library?q=&tags=&key=&bpm_min=&bpm_max=&sort=
 *   /arrange                    last/first project
 *   /arrange/<projectId>
 *
 * API:
 *   const route = useRoute();   // { section, segments, query, path }
 *   navigate('/split/job/' + id);              // pushes a history entry
 *   navigate('/library', { replace: true });   // replaces it
 *   setQuery({ q: 'drum', tags: null });       // merge into the current
 *                                              // route's query (replace by
 *                                              // default: filter typing
 *                                              // shouldn't flood history)
 *   <a href={href('/split/job/' + id)}>        // real links: middle-click,
 *                                              // new tab
 */
import { useEffect, useState } from 'react';

export const SECTIONS = ['split', 'library', 'arrange'];
const DEFAULT_PATH = '/split';

/** @returns {{section: string, segments: string[], query: Object<string,string>, path: string}} */
export function parseHash(hash = window.location.hash) {
  const raw = hash.replace(/^#/, '') || DEFAULT_PATH;
  const [pathPart, queryPart = ''] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const section = SECTIONS.includes(segments[0]) ? segments[0] : 'split';
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  return { section, segments: segments.slice(1), query, path: `/${[section, ...segments.slice(1)].join('/')}` };
}

export function href(to) {
  return `#${to}`;
}

export function navigate(to, { replace = false } = {}) {
  const target = href(to);
  if (target === window.location.hash) return;
  if (replace) {
    // Same screen (a filter change): keep the entry's state, which holds its
    // scroll-restore key (components/shell/useRouteFocus).
    const same = parseHash(target).path === parseHash().path;
    window.history.replaceState(same ? window.history.state : null, '', target);
    // replaceState doesn't fire hashchange; notify listeners ourselves.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = to;
  }
}

/** Merge params into the current route's query; null/'' removes a key. */
export function setQuery(params, { replace = true } = {}) {
  const { path, query } = parseHash();
  const next = { ...query };
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') delete next[key];
    else next[key] = String(value);
  }
  const qs = new URLSearchParams(next).toString();
  navigate(qs ? `${path}?${qs}` : path, { replace });
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash());
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

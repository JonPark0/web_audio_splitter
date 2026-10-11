import { useLayoutEffect, useRef } from 'react';
import { parseHash } from '../../router';

/**
 * On every path change (not query changes — filters shouldn't jump): set the
 * scroll and move focus to the new screen's heading, so keyboard and
 * screen-reader users land on the new screen instead of a stale link. Lazy
 * screens mount a little later, so it looks for a heading for up to ~1 s,
 * then falls back to <main>. Focus isn't moved on the first load.
 *
 * Scroll: a new screen starts at the top; one reached with Back/Forward (or
 * a reload) gets back the position it was left at, once it has grown tall
 * enough again (up to ~1 s; scrolling yourself meanwhile wins). The
 * browser's own restoration can't do this — it scrolls before the screen
 * has rendered — so it's off, and positions are kept here per history entry:
 * each entry carries a key in history.state and its position is recorded as
 * you scroll, so Back, which gives no warning, loses nothing.
 *
 * Its effects are layout effects, and App runs the hook in a component that
 * comes before <main>: React runs layout effects in tree order, so a new
 * screen is sent to the top before the screen's own layout effects run, and
 * one that puts back its own scroll (the Library's list) keeps it.
 */

const STORE_KEY = 'audioSplitter.scroll';
const positions = new Map(); // history entry key -> scrollY
let currentKey = null; // the entry whose position scrolling records
let settling = false; // its position is still being set
let arrival = null; // { id, at }: heading to show instead of the top (revealOnArrival)

const SETTLE_FRAMES = 60; // ~1 s to place the scroll and find a heading
// How long a focused heading is watched: a screen may swap a placeholder
// heading for the real one (a job's name, then its stems screen).
const WATCH_FRAMES = 300;

function stateObject() {
  const state = window.history.state;
  return state && typeof state === 'object' ? state : null;
}

/** The current entry's key, given one if it has none yet. */
function entryKey() {
  const state = stateObject();
  if (state?.scrollKey) return state.scrollKey;
  const key = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 7)}`;
  try {
    window.history.replaceState({ ...state, scrollKey: key }, '');
  } catch (e) {
    // Safari throttles replaceState: this entry just won't be restored
  }
  return key;
}

function loadPositions() {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(STORE_KEY) || '[]');
    if (Array.isArray(saved)) saved.forEach(([k, y]) => Number.isFinite(y) && positions.set(k, y));
  } catch (e) {
    // storage unavailable: positions last until a reload
  }
}

function savePositions() {
  try {
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify([...positions].slice(-50)));
  } catch (e) {
    // see loadPositions
  }
}

function focusQuietly(el) {
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

/**
 * Bring a heading's section to the top of the screen and focus the heading
 * (e.g. the jobs list from the header badge). False if it isn't on screen.
 */
export function revealHeading(id) {
  const el = document.getElementById(id);
  if (!el || !el.getClientRects().length) return false;
  (el.closest('section') || el).scrollIntoView({ block: 'start' });
  focusQuietly(el);
  return true;
}

/**
 * Reveal this heading instead of the top after the path change a link click
 * is about to make (ignored if none follows right away).
 */
export function revealOnArrival(id) {
  arrival = { id, at: Date.now() };
}

export default function useRouteFocus(path, mainId = 'main') {
  // What this path still needs (a position, a focus); kept in a ref so a
  // re-run of the effect for the same path (StrictMode) resumes it.
  const plan = useRef(null);

  // Record the position of the entry being looked at. Only while
  // history.state still names it: once the URL moves on, the scroll that the
  // next screen's render causes (a shorter page clamps it) isn't the old
  // entry's, whichever of React's update and this file's code runs first.
  useLayoutEffect(() => {
    try {
      window.history.scrollRestoration = 'manual';
    } catch (e) {
      // not supported: the browser restores (too early) as before
    }
    loadPositions();
    currentKey = entryKey();
    const onScroll = () => {
      if (!settling && stateObject()?.scrollKey === currentKey) positions.set(currentKey, window.scrollY);
    };
    // query-only changes (filters) keep the screen and its scroll
    const onHashChange = () => {
      if (parseHash().path === plan.current?.path) currentKey = entryKey();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('pagehide', savePositions);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('pagehide', savePositions);
    };
  }, []);

  useLayoutEffect(() => {
    let p = plan.current;
    if (p?.path !== path) {
      const isFirst = !p;
      currentKey = entryKey();
      // a position saved for this entry: Back/Forward or a reload
      const y = positions.get(currentKey) || null;
      const target = !isFirst && arrival && Date.now() - arrival.at < 1000 ? arrival.id : null;
      arrival = null;
      p = { path, y, target, placed: !y && !target, focused: isFirst, heading: null, frames: 0, until: SETTLE_FRAMES };
      plan.current = p;
      if (p.placed && !isFirst) window.scrollTo(0, 0);
      settling = !p.placed;
    }
    const pending = () => !p.placed || !p.focused || (!!p.heading && p.frames < WATCH_FRAMES);
    if (!pending()) return undefined;

    const settle = () => {
      p.placed = true;
      settling = false;
      positions.set(currentKey, window.scrollY);
    };
    // Scrolling, a key or a click before the position is set: leave it be.
    const USER = ['wheel', 'touchstart', 'keydown', 'mousedown'];
    const onUser = () => {
      if (!p.placed) settle();
    };
    USER.forEach((t) => window.addEventListener(t, onUser, { capture: true, passive: true }));

    let raf = 0;
    const tick = () => {
      const last = ++p.frames >= SETTLE_FRAMES;
      if (!p.placed) {
        if (p.target) {
          if (revealHeading(p.target)) {
            p.focused = true;
            settle();
          } else if (last) {
            window.scrollTo(0, 0);
            settle();
          }
        } else if (document.documentElement.scrollHeight - window.innerHeight >= p.y - 1 || last) {
          window.scrollTo(0, p.y);
          settle();
        }
      }
      // The heading that got focus was replaced (or hidden) and took focus
      // with it to <body>: look for the new one.
      const active = document.activeElement;
      const lost = p.heading && (!p.heading.isConnected || !p.heading.getClientRects().length);
      if (lost && (!active || active === document.body)) {
        p.heading = null;
        p.focused = false;
        p.until = p.frames + 2 * SETTLE_FRAMES;
      }
      if (!p.focused) {
        const main = document.getElementById(mainId);
        // While a lazy screen loads, Suspense keeps the previous screen in
        // the DOM but display:none — skip headings that aren't rendered.
        const heading = main && Array.from(main.querySelectorAll('h1, h2')).find((h) => h.getClientRects().length > 0);
        if (heading) {
          focusQuietly(heading);
          p.focused = true;
          p.heading = heading;
        } else if (p.frames >= p.until) {
          main?.focus({ preventScroll: true });
          p.focused = true;
        }
      }
      if (pending()) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      USER.forEach((t) => window.removeEventListener(t, onUser, { capture: true }));
    };
  }, [path, mainId]);
}

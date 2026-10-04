import { useEffect, useState } from 'react';
import { getSamplePeaks } from '../../samplesApi';

// Peaks never change for a sample (the audio is immutable), so they're kept
// for the session: scrolling back or re-sorting draws instantly.
const cache = new Map(); // `${id}:${points}` -> number[] | null (failed)
const waiting = new Map(); // key -> Set<callback>
const queue = [];
let active = 0;
const MAX_ACTIVE = 4; // leave connections free for audio

function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const { id, points, key } = queue.shift();
    if (cache.has(key)) continue;
    active += 1;
    getSamplePeaks(id, points)
      .then((res) => res.data?.peaks || null)
      .catch(() => null) // no thumbnail is not an error worth showing
      .then((peaks) => {
        cache.set(key, peaks);
        waiting.get(key)?.forEach((cb) => cb(peaks));
        waiting.delete(key);
        active -= 1;
        pump();
      });
  }
}

function request(id, points, cb) {
  const key = `${id}:${points}`;
  if (cache.has(key)) {
    cb(cache.get(key));
    return () => {};
  }
  if (!waiting.has(key)) {
    waiting.set(key, new Set());
    queue.push({ id, points, key });
  }
  waiting.get(key).add(cb);
  pump();
  return () => {
    const set = waiting.get(key);
    if (!set) return;
    set.delete(cb);
    if (!set.size) {
      // nobody wants it any more (scrolled past): drop it from the queue
      waiting.delete(key);
      const i = queue.findIndex((q) => q.key === key);
      if (i >= 0) queue.splice(i, 1);
    }
  };
}

/** Peaks for a sample once `enabled` (e.g. scrolled into view). */
export default function usePeaks(id, points, enabled = true) {
  const key = `${id}:${points}`;
  const [state, setState] = useState(() => ({ key, peaks: cache.get(key) }));
  useEffect(() => {
    if (!enabled || !id) return undefined;
    return request(id, points, (peaks) => setState({ key, peaks }));
  }, [id, points, key, enabled]);
  return state.key === key ? state.peaks : cache.get(key);
}

// One IntersectionObserver for every thumbnail on the page.
let observer = null;
const targets = new Map(); // element -> callback

function getObserver() {
  if (!observer && typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) targets.get(e.target)?.();
        }
      },
      { rootMargin: '300px 0px' }
    );
  }
  return observer;
}

/** True once the element has come near the viewport (and stays true). */
export function useSeen(ref) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return undefined;
    const obs = getObserver();
    if (!obs) {
      setSeen(true);
      return undefined;
    }
    targets.set(el, () => setSeen(true));
    obs.observe(el);
    return () => {
      targets.delete(el);
      obs.unobserve(el);
    };
  }, [ref, seen]);
  return seen;
}

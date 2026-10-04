import { useEffect, useLayoutEffect, useState } from 'react';

// Breakpoints of the phase-2 layout contract: phone < 640, tablet 640-1023,
// desktop >= 1024 (Tailwind sm / lg).
const QUERIES = { desktop: '(min-width: 1024px)', tablet: '(min-width: 640px)' };

function currentMode() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop';
  if (window.matchMedia(QUERIES.desktop).matches) return 'desktop';
  if (window.matchMedia(QUERIES.tablet).matches) return 'tablet';
  return 'phone';
}

/** 'phone' | 'tablet' | 'desktop', live. */
export function useLayoutMode() {
  const [mode, setMode] = useState(currentMode);
  useEffect(() => {
    const lists = Object.values(QUERIES).map((q) => window.matchMedia(q));
    const on = () => setMode(currentMode());
    lists.forEach((l) => l.addEventListener('change', on));
    return () => lists.forEach((l) => l.removeEventListener('change', on));
  }, []);
  return mode;
}

/** True on touch-first devices ((pointer: coarse)). */
export function useCoarsePointer() {
  const q = '(pointer: coarse)';
  const [coarse, setCoarse] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const l = window.matchMedia(q);
    const on = () => setCoarse(l.matches);
    l.addEventListener('change', on);
    return () => l.removeEventListener('change', on);
  }, []);
  return coarse;
}

/**
 * Height from an element's top to the bottom of the viewport (minus
 * `reserve`, e.g. a fixed bottom bar), kept current on resize. The Arrange
 * view fills the screen and scrolls inside, so the page itself never does.
 */
export function useFillHeight(ref, reserve = 0, min = 240) {
  const [height, setHeight] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      setHeight(Math.max(min, Math.floor(vh - top - reserve)));
    };
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(document.body);
    return () => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [ref, reserve, min]);
  return height;
}

/** A per-project UI preference in localStorage (lane height, browser open, ...). */
export function usePref(key, initial) {
  const read = () => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : JSON.parse(raw);
    } catch (e) {
      return initial;
    }
  };
  const [value, setValue] = useState(read);
  // Re-read when the key changes (another project opened).
  useEffect(() => {
    setValue(read());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = (v) => {
    setValue((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch (e) {
        // not remembered; still applied
      }
      return next;
    });
  };
  return [value, set];
}

import { useEffect, useLayoutEffect, useState } from 'react';
import { useDevice } from '../../device';

/** 'phone' | 'tablet' | 'desktop', live (src/device.js: a landscape phone is
 * a phone; touch needs >= 1366 px for the desktop chrome). */
export function useLayoutMode() {
  return useDevice().size;
}

/** True when any touch input is present ((any-pointer: coarse)). */
export function useCoarsePointer() {
  return useDevice().coarse;
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

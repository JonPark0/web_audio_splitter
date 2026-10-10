import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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

/**
 * How many low-priority items a one-line bar has to hand to its overflow
 * menu to fit (0 = everything shows). Measured rather than guessed from
 * breakpoints, since touch targets, fonts and the project name all change
 * what fits: while the row overflows, each layout pass raises the level a
 * step before paint; a width change (or the web fonts arriving, or
 * `resetKey` changing) starts over from 0. Content that grows later
 * ("Saving…", a Clip button) only raises it, so items don't blink in and
 * out of the menu with every autosave. Returns [callback ref, level].
 */
export function useFitLevel(max, resetKey) {
  const [el, setEl] = useState(null);
  const [level, setLevel] = useState(0);
  useLayoutEffect(() => {
    if (!el) return undefined;
    let width = el.clientWidth;
    let live = true;
    // flushSync: refit before the browser paints the overflowing row.
    const refit = () => live && flushSync(() => setLevel(0));
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            if (el.clientWidth === width) return;
            width = el.clientWidth;
            refit();
          })
        : null;
    ro?.observe(el);
    document.fonts?.ready?.then(refit);
    return () => {
      live = false;
      ro?.disconnect();
    };
  }, [el]);
  const keyRef = useRef(resetKey);
  useLayoutEffect(() => {
    if (keyRef.current !== resetKey) {
      keyRef.current = resetKey;
      if (level) {
        setLevel(0);
        return;
      }
    }
    if (el && level < max && el.scrollWidth > el.clientWidth + 1) setLevel(level + 1);
  });
  return [setEl, Math.min(level, max)];
}

/** Border-box height of an element (a fixed bar incl. its safe-area padding), live. */
export function useBoxHeight(fallback = 0) {
  const [el, setEl] = useState(null);
  const [height, setHeight] = useState(fallback);
  useLayoutEffect(() => {
    if (!el) return undefined;
    const measure = () => setHeight(Math.ceil(el.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, el ? height : fallback];
}

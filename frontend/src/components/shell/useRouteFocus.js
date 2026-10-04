import { useEffect, useRef } from 'react';

/**
 * On every path change (not query changes — filters shouldn't jump): scroll
 * to the top and move focus to the new screen's heading, so keyboard and
 * screen-reader users land on the new screen instead of a stale link. Lazy
 * screens mount a little later, so it looks for a heading for up to ~1 s,
 * then falls back to <main>. Not on the first load.
 */
export default function useRouteFocus(path, mainId = 'main') {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    window.scrollTo(0, 0);
    let frames = 0;
    let raf = 0;
    const tryFocus = () => {
      const main = document.getElementById(mainId);
      if (!main) return;
      // While a lazy screen loads, Suspense keeps the previous screen in the
      // DOM but display:none — skip headings that aren't rendered.
      const heading = Array.from(main.querySelectorAll('h1, h2')).find((h) => h.getClientRects().length > 0);
      if (heading) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      } else if (++frames < 60) {
        raf = requestAnimationFrame(tryFocus);
      } else {
        main.focus({ preventScroll: true });
      }
    };
    raf = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(raf);
  }, [path, mainId]);
}

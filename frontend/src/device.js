/**
 * What the user is holding, shared by every screen. Layout used to be chosen
 * by width alone, so a landscape phone (640-932 px wide, ~330 px tall) got
 * the tablet chrome and an iPad in landscape (1024-1366 px, touch) got the
 * mouse-sized desktop chrome that no longer fit once its controls grew to
 * 44 px. Now:
 *
 *   coarse  any touch input at all ((any-pointer: coarse)): a touch laptop or
 *           an iPad with a trackpad attached still gets finger-sized targets
 *   short   a landscape phone (<= 500 px tall)
 *   size    'phone'   < 640 px wide, or short with touch
 *           'desktop' >= 1024 px with a mouse, >= 1366 px with touch
 *           'tablet'  everything between
 *   wide    >= 1280 px (room for a docked side panel)
 *
 * The same media queries back the Tailwind `coarse:` variant
 * (tailwind.config.js) and the touch rules in index.css.
 */
import { useEffect, useState } from 'react';

export const MQ = {
  coarse: '(any-pointer: coarse)',
  short: '(max-height: 500px)',
  tablet: '(min-width: 640px)',
  desktop: '(min-width: 1024px)',
  wide: '(min-width: 1280px)',
  touchDesktop: '(min-width: 1366px)',
};

const SSR = { size: 'desktop', coarse: false, short: false, wide: true };

function matches(q) {
  return typeof window !== 'undefined' && !!window.matchMedia?.(q).matches;
}

export function readDevice() {
  if (typeof window === 'undefined' || !window.matchMedia) return SSR;
  const coarse = matches(MQ.coarse);
  const short = matches(MQ.short);
  let size = 'tablet';
  if (!matches(MQ.tablet) || (short && coarse)) size = 'phone';
  else if (matches(MQ.desktop) && (!coarse || matches(MQ.touchDesktop))) size = 'desktop';
  return { size, coarse, short, wide: matches(MQ.wide) };
}

const same = (a, b) => a.size === b.size && a.coarse === b.coarse && a.short === b.short && a.wide === b.wide;

/** { size: 'phone'|'tablet'|'desktop', coarse, short, wide }, live. */
export function useDevice() {
  const [device, setDevice] = useState(readDevice);
  useEffect(() => {
    const lists = Object.values(MQ).map((q) => window.matchMedia(q));
    const onChange = () => setDevice((prev) => {
      const next = readDevice();
      return same(prev, next) ? prev : next;
    });
    lists.forEach((l) => l.addEventListener('change', onChange));
    onChange();
    return () => lists.forEach((l) => l.removeEventListener('change', onChange));
  }, []);
  return device;
}

export const isApple = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '');

/** iPhone/iPad, including iPadOS that reports itself as a Mac. */
export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

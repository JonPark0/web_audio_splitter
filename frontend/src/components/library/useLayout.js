import { useEffect, useState } from 'react';
import { useDevice } from '../../device';

// A mouse or trackpad is around, so most likely a keyboard too.
const FINE = '(any-pointer: fine)';

function useFinePointer() {
  const [fine, setFine] = useState(() => typeof window === 'undefined' || !window.matchMedia || window.matchMedia(FINE).matches);
  useEffect(() => {
    const list = window.matchMedia?.(FINE);
    if (!list) return undefined;
    const onChange = () => setFine(list.matches);
    list.addEventListener('change', onChange);
    onChange();
    return () => list.removeEventListener('change', onChange);
  }, []);
  return fine;
}

/**
 * { size: 'phone'|'tablet'|'desktop', wide, coarse, keys } from src/device.js.
 * Chosen in JS (not CSS-hidden) so only one layout's DOM exists - two hidden
 * copies of 1000 rows would double the node count the list is meant to cut.
 * A landscape phone gets the phone cards and a touch iPad the tablet grid
 * (the desktop grid's 32 px columns can't hold 44 px touch targets).
 * `keys`: worth showing keyboard hints ("Del", "Shift-click") - not on a
 * touch-only phone or tablet.
 */
export default function useLayout() {
  const { size, wide, coarse } = useDevice();
  const keys = useFinePointer();
  return { size, wide: size === 'desktop' && wide, coarse, keys };
}

/** Boolean preference persisted per browser (try/catch: private mode). */
export function useStoredState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : JSON.parse(raw);
    } catch (e) {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // storage unavailable - keep it for this session only
    }
  }, [key, value]);
  return [value, setValue];
}

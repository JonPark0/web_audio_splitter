import { useEffect, useState } from 'react';
import { useDevice } from '../../device';

/**
 * { size: 'phone'|'tablet'|'desktop', wide, coarse } from src/device.js. Chosen
 * in JS (not CSS-hidden) so only one layout's DOM exists - two hidden copies
 * of 1000 rows would double the node count the list is meant to cut. A
 * landscape phone gets the phone cards and a touch iPad the tablet grid (the
 * desktop grid's 32 px columns can't hold 44 px touch targets).
 */
export default function useLayout() {
  const { size, wide, coarse } = useDevice();
  return { size, wide: size === 'desktop' && wide, coarse };
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

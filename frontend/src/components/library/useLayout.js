import { useEffect, useState } from 'react';

// Same edges as Tailwind sm / lg / xl. JS-chosen (not CSS-hidden) so only
// one layout's DOM exists - two hidden copies of 1000 rows would double the
// node count the list is meant to cut.
const QUERIES = {
  tablet: '(min-width: 640px)',
  desktop: '(min-width: 1024px)',
  wide: '(min-width: 1280px)',
  coarse: '(pointer: coarse)',
};

function read() {
  const m = (q) => typeof window !== 'undefined' && window.matchMedia(q).matches;
  const tablet = m(QUERIES.tablet);
  const desktop = m(QUERIES.desktop);
  return {
    size: desktop ? 'desktop' : tablet ? 'tablet' : 'phone',
    wide: m(QUERIES.wide), // room for the docked inspector
    coarse: m(QUERIES.coarse),
  };
}

/** { size: 'phone'|'tablet'|'desktop', wide, coarse } */
export default function useLayout() {
  const [layout, setLayout] = useState(read);
  useEffect(() => {
    const lists = Object.values(QUERIES).map((q) => window.matchMedia(q));
    const onChange = () =>
      setLayout((prev) => {
        const next = read();
        return prev.size === next.size && prev.wide === next.wide && prev.coarse === next.coarse ? prev : next;
      });
    lists.forEach((l) => l.addEventListener('change', onChange));
    return () => lists.forEach((l) => l.removeEventListener('change', onChange));
  }, []);
  return layout;
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

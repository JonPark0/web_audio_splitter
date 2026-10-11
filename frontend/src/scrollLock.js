/**
 * The page behind a sheet stays put while it's open: a swipe on the veil, or
 * past the end of the sheet's own scroll, used to scroll the screen
 * underneath. Counted, for stacked sheets. Same lock as the Library's sheets
 * (components/library/Sheet.jsx keeps its own copy).
 */
import { useEffect } from 'react';

let locks = 0;
let savedOverflow = '';

export function useScrollLock() {
  useEffect(() => {
    const root = document.documentElement;
    if (locks++ === 0) {
      savedOverflow = root.style.overflow;
      root.style.overflow = 'hidden';
    }
    return () => {
      if (--locks === 0) root.style.overflow = savedOverflow;
    };
  }, []);
}

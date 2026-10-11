/**
 * Range inputs under a finger. Chromium moves the thumb to the touch point
 * on pointerdown, before it knows whether the finger is about to scroll the
 * page, so a vertical swipe that happened to start on a fader set it to
 * wherever the finger landed (and scrolled anyway). For touch, a new value
 * is held back until the finger moves sideways (a drag) or lifts without the
 * browser taking over (a tap); when the page scrolls instead (pointercancel)
 * it's dropped. Mouse, pen and keyboard changes apply at once.
 *
 *   const guard = useTouchSliderGuard((value) => setDb(value));
 *   <input type="range" value={db} {...guard} />
 *
 * Held back, the input stays controlled by `value`, so the thumb doesn't
 * move either. Pass an existing onPointerDown in `handlers` to keep it.
 */
import { useRef } from 'react';

const SLOP = 8; // px of sideways travel that make it a drag

export function useTouchSliderGuard(onValue, handlers = {}) {
  const gesture = useRef(null);
  const latest = useRef(onValue);
  latest.current = onValue;
  const commit = (v) => latest.current(v);

  return {
    onPointerDown(e) {
      handlers.onPointerDown?.(e);
      gesture.current = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY, pending: true, value: null } : null;
    },
    onPointerMove(e) {
      const g = gesture.current;
      if (!g?.pending) return;
      const dx = Math.abs(e.clientX - g.x);
      if (dx > SLOP && dx > Math.abs(e.clientY - g.y)) {
        g.pending = false;
        if (g.value !== null) commit(g.value);
      }
    },
    onPointerUp() {
      const g = gesture.current;
      gesture.current = null;
      if (g?.pending && g.value !== null) commit(g.value);
    },
    onPointerCancel() {
      gesture.current = null;
    },
    onChange(e) {
      const v = parseFloat(e.target.value);
      const g = gesture.current;
      if (g?.pending) g.value = v;
      else commit(v);
    },
  };
}

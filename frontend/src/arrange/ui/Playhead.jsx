import React, { useEffect, useRef } from 'react';
import { useClockListener } from './playheadClock';
import { beatToPx } from './snap';

const FOLLOW_SETTLE_MS = 250; // a scroll this recent is still under way
const FOLLOW_HOLD_MS = 3000; // then Follow brings the playhead back anyway

/**
 * Vertical playhead over the lanes (or, with `marker`, over the ruler).
 * Moves by writing `transform` on its own node from the position clock.
 * With `follow`, while playing it pages the scroll container along when the
 * line reaches the right edge (and back on a loop wrap). It stands aside
 * while `held()` (a drag owns the view) and after the user scrolls, until
 * the playhead is back in view or FOLLOW_HOLD_MS pass.
 */
export default function Playhead({ clock, pxPerBeat, scrollRef, headerWidth = 0, follow = true, marker = false, held }) {
  const ref = useRef(null);
  const lastX = useRef(0);
  const userAt = useRef(0); // when the user last scrolled the view (0: not waiting)
  const wrappedMeanwhile = useRef(false);
  const ownLeft = useRef(null); // the scrollLeft Follow itself set

  // Any scroll Follow didn't make is the user's (wheel, swipe, momentum,
  // scrollbar, keys, zoom).
  useEffect(() => {
    const el = scrollRef?.current;
    if (!follow || !el) return undefined;
    const onScroll = () => {
      if (ownLeft.current === null || Math.abs(el.scrollLeft - ownLeft.current) > 1) userAt.current = performance.now();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [follow, scrollRef]);

  useClockListener(
    clock,
    (beat, live) => {
      const x = beatToPx(beat, pxPerBeat);
      if (ref.current) ref.current.style.transform = `translateX(${x}px)`;
      const scroller = scrollRef?.current;
      let wrapped = x < lastX.current;
      lastX.current = x;
      if (!follow || !live || !scroller) return;
      const visible = scroller.clientWidth - headerWidth;
      const rel = x - scroller.scrollLeft;
      const now = performance.now();
      if (held?.()) userAt.current = now;
      if (userAt.current) {
        if (wrapped) wrappedMeanwhile.current = true;
        const idle = now - userAt.current;
        const inView = rel >= 0 && rel <= visible - 24;
        if (idle < FOLLOW_SETTLE_MS || (!inView && idle < FOLLOW_HOLD_MS)) return;
        userAt.current = 0;
        wrapped = wrappedMeanwhile.current;
        wrappedMeanwhile.current = false;
      }
      // Page right at the edge; jump back only on a loop wrap, so the user
      // can still scroll ahead of the playhead while it plays.
      if (rel > visible - 24 || (wrapped && rel < 0)) {
        scroller.scrollLeft = Math.max(0, x - 24);
        ownLeft.current = scroller.scrollLeft;
      }
    },
    [pxPerBeat, follow, headerWidth]
  );

  return (
    <div
      ref={ref}
      aria-hidden="true"
      // On the ruler, over the marker flags (z-30) as well as the loop handles.
      className={`pointer-events-none absolute left-0 w-px bg-ink will-change-transform ${marker ? 'bottom-0 z-40 h-2/3' : 'inset-y-0 z-20'}`}
    />
  );
}

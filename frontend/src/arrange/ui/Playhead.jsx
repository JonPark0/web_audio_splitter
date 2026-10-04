import React, { useRef } from 'react';
import { useClockListener } from './playheadClock';
import { beatToPx } from './snap';

/**
 * Vertical playhead over the lanes (or, with `marker`, over the ruler).
 * Moves by writing `transform` on its own node from the position clock.
 * With `follow`, while playing it pages the scroll container along when the
 * line reaches the right edge (and back on a loop wrap).
 */
export default function Playhead({ clock, pxPerBeat, scrollRef, headerWidth = 0, follow = true, marker = false }) {
  const ref = useRef(null);
  const lastX = useRef(0);

  useClockListener(
    clock,
    (beat, live) => {
      const x = beatToPx(beat, pxPerBeat);
      if (ref.current) ref.current.style.transform = `translateX(${x}px)`;
      const scroller = scrollRef?.current;
      const wrapped = x < lastX.current;
      lastX.current = x;
      if (!follow || !live || !scroller) return;
      const visible = scroller.clientWidth - headerWidth;
      const rel = x - scroller.scrollLeft;
      // Page right at the edge; jump back only on a loop wrap, so the user
      // can still scroll ahead of the playhead while it plays.
      if (rel > visible - 24 || (wrapped && rel < 0)) scroller.scrollLeft = Math.max(0, x - 24);
    },
    [pxPerBeat, follow, headerWidth]
  );

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none absolute left-0 z-20 w-px bg-ink will-change-transform ${marker ? 'bottom-0 h-2/3' : 'inset-y-0'}`}
    />
  );
}

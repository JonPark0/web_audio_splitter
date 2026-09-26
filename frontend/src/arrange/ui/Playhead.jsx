import React, { useRef } from 'react';
import { useClockListener } from './playheadClock';
import { beatToPx } from './snap';

/**
 * Vertical playhead over ruler + lanes. Moves by writing `transform` on its
 * own node from the position clock; while playing it also pages the scroll
 * container along when the line reaches the right edge.
 */
export default function Playhead({ clock, pxPerBeat, scrollRef, headerRef }) {
  const ref = useRef(null);
  const lastX = useRef(0);

  useClockListener(
    clock,
    (beat, live) => {
      const x = beatToPx(beat, pxPerBeat);
      if (ref.current) ref.current.style.transform = `translateX(${x}px)`;
      const scroller = scrollRef.current;
      if (!live || !scroller) return;
      const header = headerRef.current?.offsetWidth || 0;
      const visible = scroller.clientWidth - header;
      const rel = x - scroller.scrollLeft;
      // Page right at the edge; jump back only on a loop wrap, so the user
      // can still scroll ahead of the playhead while it plays.
      const wrapped = x < lastX.current;
      lastX.current = x;
      if (rel > visible - 24 || (wrapped && rel < 0)) scroller.scrollLeft = Math.max(0, x - 24);
    },
    [pxPerBeat]
  );

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0 z-20 w-px bg-ink will-change-transform"
    />
  );
}

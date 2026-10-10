import React, { useEffect, useRef } from 'react';
import { fmtTime } from './format';

/** "1:23.456 / 5:58.702", updated straight from the playhead (no re-render). */
export default function TimeReadout({ timeline, duration, className = '', short = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const set = (t) => {
      if (ref.current) ref.current.textContent = fmtTime(t);
    };
    set(timeline.getPlayhead());
    return timeline.subscribeHead(set);
  }, [timeline]);
  // A fixed box as wide as the longest time this job can show: Exo 2's
  // digits differ in width even with tabular-nums, so a bare span shifted
  // everything after it (Loop, zoom, Snap…) every frame. A tabular digit
  // is up to 1.04ch in Exo 2 (9.92 px vs the plain "0"'s 9.53); ":" and "."
  // are ~0.4ch.
  const longest = fmtTime(duration);
  const digits = longest.replace(/\D/g, '').length;
  const width = `${(digits * 1.06 + (longest.length - digits) * 0.4).toFixed(2)}ch`;
  return (
    <span className={`whitespace-nowrap tabular-nums ${className}`}>
      <span ref={ref} aria-live="off" className="inline-block text-right" style={{ width }}>
        0:00.000
      </span>
      <span className="text-muted"> / {fmtTime(duration, { ms: !short })}</span>
    </span>
  );
}

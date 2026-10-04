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
  return (
    <span className={`whitespace-nowrap tabular-nums ${className}`}>
      <span ref={ref} aria-live="off">
        0:00.000
      </span>
      <span className="text-muted"> / {fmtTime(duration, { ms: !short })}</span>
    </span>
  );
}

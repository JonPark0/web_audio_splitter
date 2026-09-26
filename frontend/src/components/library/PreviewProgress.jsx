import React, { useEffect, useRef } from 'react';

/**
 * 1px progress line for the playing row. Only that row mounts it; it reads
 * the shared audio element on each animation frame and writes the transform
 * straight to the DOM, so playback never causes React renders.
 */
export default function PreviewProgress({ audioRef, duration }) {
  const barRef = useRef(null);

  useEffect(() => {
    let frame;
    const tick = () => {
      const audio = audioRef.current;
      const bar = barRef.current;
      if (audio && bar) {
        // audio.duration is NaN until metadata loads; fall back to the sample's.
        const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
        const ratio = total ? Math.min(1, audio.currentTime / total) : 0;
        bar.style.transform = `scaleX(${ratio})`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [audioRef, duration]);

  return (
    <div className="relative h-px w-full bg-line" aria-hidden="true">
      <div ref={barRef} className="absolute inset-0 origin-left bg-ink" style={{ transform: 'scaleX(0)' }} />
    </div>
  );
}

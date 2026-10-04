import React, { memo, useEffect, useMemo, useRef } from 'react';
import usePeaks, { useSeen } from './usePeaks';

// Filled, mirrored envelope as ONE path (a few hundred bytes of DOM per
// row instead of one element per bar).
function envelope(peaks) {
  const n = peaks.length;
  // Quiet material (a -12 dB stem) is lifted up to 4x so its shape reads in
  // a 24 px thumbnail; real near-silence stays a flat line.
  const max = peaks.reduce((m, p) => (p > m ? p : m), 0);
  const gain = max > 0 ? Math.min(4, 1 / max) : 1;
  let top = 'M0,1';
  let bottom = '';
  for (let i = 0; i < n; i += 1) {
    const p = Math.max(0.03, Math.min(1, peaks[i] * gain)).toFixed(3);
    top += `L${i + 0.5},${(1 - p).toFixed(3)}`;
    bottom = `L${i + 0.5},${(1 + Number(p)).toFixed(3)}${bottom}`;
  }
  return `${top}L${n},1${bottom}Z`;
}

/**
 * Waveform thumbnail that doubles as the seek bar (P3): peaks load lazily
 * once it scrolls near the viewport; while its sample plays, the played
 * part is ink over a muted remainder, tracked by requestAnimationFrame
 * (no React renders). Click/tap seeks (or starts playback there).
 */
export default memo(function Waveform({
  sampleId,
  points = 120,
  playing = false,
  audioRef,
  onSeek,
  className = '',
  label,
}) {
  const boxRef = useRef(null);
  const seen = useSeen(boxRef);
  const peaks = usePeaks(sampleId, points, seen);
  const path = useMemo(() => (peaks?.length ? envelope(peaks) : null), [peaks]);
  const overlayRef = useRef(null);
  const headRef = useRef(null);

  useEffect(() => {
    if (!playing || !audioRef) return undefined;
    let frame;
    const tick = () => {
      const audio = audioRef.current;
      const r = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? Math.min(1, audio.currentTime / audio.duration) : 0;
      if (overlayRef.current) overlayRef.current.style.clipPath = `inset(0 ${(100 - r * 100).toFixed(2)}% 0 0)`;
      if (headRef.current) headRef.current.style.left = `${(r * 100).toFixed(2)}%`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, audioRef]);

  const seekAt = (clientX) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !onSeek) return;
    onSeek(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)));
  };

  return (
    <div
      ref={boxRef}
      className={`relative cursor-pointer select-none ${playing ? 'text-muted' : 'text-ink'} ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        seekAt(e.clientX);
      }}
      title={label}
      aria-hidden="true"
    >
      {path ? (
        <svg viewBox={`0 0 ${peaks.length} 2`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" fill="currentColor">
          <path d={path} />
        </svg>
      ) : (
        <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
      )}
      {playing && path && (
        <svg
          ref={overlayRef}
          viewBox={`0 0 ${peaks.length} 2`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full text-ink"
          fill="currentColor"
          style={{ clipPath: 'inset(0 100% 0 0)' }}
        >
          <path d={path} />
        </svg>
      )}
      {playing && <div ref={headRef} className="absolute inset-y-0 left-0 w-px bg-ink" />}
    </div>
  );
});

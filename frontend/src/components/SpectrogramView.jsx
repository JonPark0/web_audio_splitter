import React, { useEffect, useState } from 'react';
import { spectrogramUrl } from '../api';
import { useTimelineView } from './useWaveZoom';

// ffmpeg's showspectrumpic (s=800x400, legend=1) draws the spectrum in an
// 800×400 box inset by (W-800)/2 px left/right and 64 px top/bottom.
const SPEC_W = 800;
const SPEC_H = 400;
const SPEC_TOP = 64;

/**
 * A stem's spectrogram inside its mixer row, on the same time axis as the
 * waveform above it (the backend's PNG is cropped to its spectrum box and
 * stretched/scrolled with the shared timeline), so restored high frequencies
 * line up with what you see and hear. Follows the row's Original/Recovered
 * choice. Generated on demand server-side (ffmpeg), so only when opened.
 * It answers the lane gestures as part of the stem's lane (data-lane): tap
 * to seek, drag to select, pinch to zoom.
 */
export default function SpectrogramView({ taskId, trackName, variant, timeline, height = 64, sampleRate }) {
  const view = useTimelineView(timeline);
  const [natural, setNatural] = useState(null);
  const [failed, setFailed] = useState(false);
  const src = spectrogramUrl(taskId, trackName, variant);
  useEffect(() => {
    setNatural(null);
    setFailed(false);
  }, [src]);

  let transform;
  if (natural && view.width && view.pps > 0) {
    const inset = (natural.w - SPEC_W) / 2;
    const sx = (view.duration * view.pps) / SPEC_W;
    const sy = height / SPEC_H;
    transform = `translate(${-inset * sx - view.start * view.pps}px, ${-SPEC_TOP * sy}px) scale(${sx}, ${sy})`;
  }
  const nyquist = sampleRate ? `0–${Math.round(sampleRate / 2000)} kHz` : '';

  return (
    <div
      data-lane={trackName}
      className="rs-lane relative overflow-hidden border-t border-line"
      style={{ height }}
      aria-label={`${trackName.replace('.wav', '')} spectrogram (${variant})`}
      role="img"
    >
      {!failed && (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => setFailed(true)}
          className="rs-spec pointer-events-none absolute left-0 top-0 max-w-none origin-top-left select-none"
          style={{ transform, visibility: transform ? 'visible' : 'hidden', imageRendering: 'auto' }}
        />
      )}
      {!natural && !failed && <span className="absolute left-2 top-1 text-caption text-muted">Rendering spectrogram…</span>}
      {failed && <span className="absolute left-2 top-1 text-caption text-muted">Spectrogram unavailable</span>}
      {nyquist && <span className="pointer-events-none absolute right-1 top-0 bg-paper/80 px-1 text-[11px] text-muted">{nyquist}</span>}
    </div>
  );
}

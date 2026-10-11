import React, { memo, useEffect, useReducer, useRef } from 'react';
import { useTimelineView, useViewFrame } from '../useWaveZoom';
import { drawPeaks } from './peaks';
import { fmtTime } from './format';

const INK = '#141414';

/**
 * One stem's waveform on the shared timeline: a canvas of the visible window
 * (redrawn per frame on zoom/pan, never per playhead tick), a paper mask that
 * greys the unplayed part, the playhead, the selection and markers for
 * samples already cut from this job. Gestures are handled by the container
 * (useLaneGestures) through the data-* attributes. `height` is the
 * waveform's; a short touch lane with markers adds a strip for them.
 */
export default memo(function Lane({
  track,
  variant,
  peaks,
  timeline,
  height,
  scale,
  dim,
  selection,
  isTarget,
  markers,
  status,
  coarse,
  label,
}) {
  const canvasRef = useRef(null);
  const maskRef = useRef(null);
  const headRef = useRef(null);
  const view = useTimelineView(timeline);
  const [peaksVersion, bump] = useReducer((n) => n + 1, 0);

  useEffect(() => peaks.subscribe((t) => t === track && bump()), [peaks, track]);

  // Waveform: visible window only, at device resolution.
  useViewFrame(
    timeline,
    (v) => {
      const canvas = canvasRef.current;
      if (!canvas || !v.width) return;
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(v.width * dpr);
      const H = Math.round(height * dpr);
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      const t0 = performance.now();
      const level = peaks.pick(track, variant, v.pps * dpr);
      drawPeaks(canvas.getContext('2d'), level, v, W, H, dpr, scale, INK);
      if (import.meta.env.DEV && window.__resultPerf) window.__resultPerf.draw.push(performance.now() - t0);
      placeHead(timeline.getPlayhead(), v);
    },
    [track, variant, scale, height, peaksVersion]
  );

  function placeHead(t, v = timeline.get()) {
    const x = (t - v.start) * v.pps;
    if (maskRef.current) maskRef.current.style.transform = `translateX(${Math.max(0, Math.min(v.width, x))}px)`;
    if (headRef.current) {
      const visible = x >= 0 && x <= v.width;
      headRef.current.style.transform = `translateX(${x}px)`;
      headRef.current.style.visibility = visible ? 'visible' : 'hidden';
    }
  }

  useEffect(() => timeline.subscribeHead((t) => placeHead(t)), [timeline]); // eslint-disable-line react-hooks/exhaustive-deps

  const xAt = (t) => (t - view.start) * view.pps;
  let selBox = null;
  if (selection && view.width) {
    const x0 = xAt(selection.start);
    const x1 = xAt(selection.end);
    if (x1 >= -1 && x0 <= view.width + 1) selBox = { x0, x1, left: Math.max(-1, x0), right: Math.min(view.width + 1, x1) };
  }
  // A touch marker is a 44 px target. On a lane shorter than two of those
  // (56 px phone rows, the landscape sheet) it covered most of the waveform,
  // so a tap there selected the sample instead of seeking: such lanes get a
  // 44 px strip for their markers under the waveform instead.
  const band = coarse && markers?.length && height < 88 ? 44 : 0;
  const handleW = coarse ? 44 : 12;
  const grabH = coarse ? Math.min(44, height - 12) : 14;
  // A selection narrower than a handle: the handles meet in the middle
  // instead of overlapping (the end one covered the start one entirely).
  const inward = selBox ? Math.min(handleW / 2, Math.max(0, selBox.x1 - selBox.x0) / 2) : 0;

  return (
    <div
      data-lane={track}
      aria-label={label}
      className="rs-lane relative overflow-hidden"
      style={{ height: height + band }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-x-0 top-0 w-full"
        style={{ height, opacity: dim ? 0.3 : 1 }}
      />
      <div ref={maskRef} aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-full bg-paper/50" />

      {selBox && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 ${isTarget ? 'bg-ink/10' : 'bg-ink/[0.05]'}`}
          style={{ left: selBox.left, width: Math.max(1, selBox.right - selBox.left) }}
        />
      )}
      {selBox && isTarget && (
        <>
          {[
            ['start', selBox.x0, handleW - inward],
            ['end', selBox.x1, inward],
          ].map(([edge, x, at]) =>
            x >= -handleW && x <= view.width + handleW ? (
              <div
                key={edge}
                data-handle={edge}
                title={edge === 'start' ? 'Drag the start' : 'Drag the end'}
                className="rs-handle absolute inset-y-0 z-[2] cursor-ew-resize"
                style={{ left: x - at, width: handleW }}
              >
                <span className="pointer-events-none absolute inset-y-0 w-px bg-ink" style={{ left: at }} />
              </div>
            ) : null
          )}
          {selBox.right - selBox.left > 2 && (
            <div
              data-grab=""
              title="Drag to move the selection"
              className="absolute top-0 z-[1] flex cursor-grab items-center justify-center overflow-hidden bg-ink/20 text-[11px] leading-none text-ink active:cursor-grabbing"
              style={{ left: selBox.left, width: selBox.right - selBox.left, height: grabH }}
            >
              {selBox.right - selBox.left > 90 && <span className="pointer-events-none">{fmtTime(selection.end - selection.start)}</span>}
            </div>
          )}
        </>
      )}

      {markers?.map((m) => {
        const x0 = xAt(m.start);
        const x1 = xAt(m.end);
        if (x1 < 0 || x0 > view.width) return null;
        const left = Math.max(0, x0);
        const width = Math.max(4, Math.min(view.width, x1) - left);
        const tone = m.mix ? 'bg-muted' : 'bg-ink';
        if (coarse) {
          // Touch has no hover title: the name is written at the marker's
          // start, and only that word (44 px tall, under the selection's
          // strip and handles; in the strip when there is one) is a target,
          // so the rest of the lane keeps its taps. Tap = select the sample,
          // like a click.
          return (
            <React.Fragment key={m.id}>
              <span aria-hidden="true" className={`pointer-events-none absolute bottom-0 h-[3px] ${tone}`} style={{ left, width }} />
              <div
                data-marker={m.id}
                className="absolute bottom-0 flex items-end pb-1"
                style={{ left, height: Math.min(44, height + band), minWidth: 44, maxWidth: Math.max(44, Math.min(160, view.width - left)) }}
              >
                <span className="pointer-events-none truncate bg-paper/80 px-1 text-[11px] leading-4 text-muted">{m.name}</span>
              </div>
            </React.Fragment>
          );
        }
        return (
          <div
            key={m.id}
            data-marker={m.id}
            title={`${m.name} · ${fmtTime(m.start)}–${fmtTime(m.end)} (in the library) — click to select`}
            className="absolute bottom-0 z-[1] cursor-pointer"
            style={{ left, width, height: 8 }}
          >
            <span className={`pointer-events-none absolute inset-x-0 bottom-0 h-[3px] ${tone}`} />
          </div>
        );
      })}

      <div ref={headRef} aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-[3] w-px bg-ink" />

      {status}
    </div>
  );
});

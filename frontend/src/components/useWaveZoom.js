import { useCallback, useEffect, useRef, useState } from 'react';

// Upper zoom bound; the lower bound is "fit" (the whole track in view).
export const MAX_PX_PER_SEC = 1000;
// Zoom factor per wheel pixel: one ~100px mouse notch ≈ ×1.16.
const WHEEL_SENSITIVITY = 0.0015;
// px/s within this ratio of "fit" snap back to fit (wavesurfer's fillParent).
const FIT_SNAP = 1.02;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// wavesurfer's scroll container: the parent of its wrapper (in its shadow DOM).
const scrollContainerOf = (ws) => ws.getWrapper().parentElement;

/**
 * Shared horizontal zoom + scroll for every waveform in the mixer, so stems
 * stay aligned vertically. One zoom level (wavesurfer `minPxPerSec`, 0 = fit)
 * and one scroll offset (px) are applied to all tracks; since every track is
 * zoomed to the same px/s, equal pixel offsets mean equal times.
 *
 * TrackRow feeds it wheel events (`zoomWithWheel`), scroll events (`syncScroll`)
 * and freshly (re)loaded instances (`adopt`).
 */
export default function useWaveZoom(surfers) {
  const levelRef = useRef(0);
  const scrollRef = useRef(0);
  const pendingRef = useRef(null); // coalesced wheel input, applied per frame
  const frameRef = useRef(0);
  const [zoomed, setZoomed] = useState(false);

  const all = () => Object.values(surfers.current);

  const scrollAll = useCallback((px, except) => {
    scrollRef.current = px;
    all().forEach((ws) => {
      // The tolerance is the feedback-loop breaker: a programmatic setScroll
      // re-emits 'scroll', which then finds every track already in place.
      if (ws !== except && Math.abs(ws.getScroll() - px) >= 1) ws.setScroll(px);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomAll = useCallback((level) => {
    levelRef.current = level;
    setZoomed(level > 0);
    all().forEach((ws) => {
      // zoom() throws while a track has no decoded audio (mid A/B reload);
      // such a track picks the level up in adopt() once it's ready.
      if (ws.getDecodedData()) ws.zoom(level);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyPending = useCallback(() => {
    frameRef.current = 0;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    const { ws, clientX, delta } = pending;
    const duration = ws.getDuration();
    if (!duration || !ws.getDecodedData()) return;

    const container = scrollContainerOf(ws);
    const rect = container.getBoundingClientRect();
    const offsetX = clamp(clientX - rect.left, 0, rect.width);
    // Time under the cursor, from the current (possibly fit) layout.
    const time = ((ws.getScroll() + offsetX) / ws.getWrapper().clientWidth) * duration;

    const fit = container.clientWidth / duration;
    const current = ws.getWrapper().clientWidth / duration;
    const next = clamp(current * Math.exp(-delta * WHEEL_SENSITIVITY), fit, Math.max(fit, MAX_PX_PER_SEC));
    const level = next <= fit * FIT_SNAP ? 0 : next;
    if (level === levelRef.current) return;

    zoomAll(level);
    // wavesurfer re-anchors on the playhead when zooming; re-anchor on the
    // cursor instead so the time under it stays put.
    const target = level ? (time / duration) * ws.getWrapper().clientWidth - offsetX : 0;
    scrollAll(Math.max(0, target), null);
    scrollRef.current = ws.getScroll(); // what the browser clamped it to
  }, [scrollAll, zoomAll]);

  // Ctrl/⌘ + wheel over a waveform. Deltas are accumulated and applied once
  // per animation frame, since each zoom re-renders every track's canvases.
  const zoomWithWheel = useCallback(
    (ws, event) => {
      let delta = event.deltaY;
      if (event.deltaMode === 1) delta *= 16; // lines
      else if (event.deltaMode === 2) delta *= 400; // pages
      const prev = pendingRef.current;
      pendingRef.current = { ws, clientX: event.clientX, delta: (prev?.ws === ws ? prev.delta : 0) + delta };
      if (!frameRef.current) frameRef.current = requestAnimationFrame(applyPending);
    },
    [applyPending]
  );

  // A track scrolled (scrollbar, trackpad, autoscroll while playing, region
  // drag near the edge): move the others to the same offset.
  const syncScroll = useCallback(
    (ws, scrollLeft) => {
      if (Math.abs(scrollLeft - scrollRef.current) < 1) return;
      scrollAll(scrollLeft, ws);
    },
    [scrollAll]
  );

  // A track finished (re)loading: give it the shared zoom + scroll.
  const adopt = useCallback((ws) => {
    if (levelRef.current && ws.getDecodedData()) ws.zoom(levelRef.current);
    ws.setScroll(scrollRef.current);
  }, []);

  const fit = useCallback(() => {
    zoomAll(0);
    scrollAll(0, null);
  }, [scrollAll, zoomAll]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  return { zoomed, zoomWithWheel, syncScroll, adopt, fit };
}

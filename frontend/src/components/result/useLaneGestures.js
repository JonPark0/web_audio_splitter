import { useEffect, useRef } from 'react';
import { clamp } from './format';

const DRAG_PX = 4;
const TOUCH_SLOP = 8; // a finger wobbles more than a mouse
const HOLD_MS = 300; // a held finger may then drag in any direction

/**
 * Two-finger pinch on a time axis (a lane or the ruler: its left edge is the
 * timeline's x = 0), fingers at a and b ({ x, y } client px). The time under
 * their midpoint stays under it while their spread scales the zoom. Returns
 * the update to call with the fingers' new positions.
 */
export function pinchZoom(timeline, axis, a, b) {
  const left = axis.getBoundingClientRect().left;
  const d0 = Math.max(16, Math.hypot(a.x - b.x, a.y - b.y));
  const t0 = timeline.timeAt((a.x + b.x) / 2 - left);
  const pps0 = timeline.get().pps;
  return (p, q) => timeline.zoomTo((pps0 * Math.hypot(p.x - q.x, p.y - q.y)) / d0, t0, (p.x + q.x) / 2 - left);
}

/**
 * Pointer gestures for a container of lanes ([data-lane] elements that share
 * the timeline's width):
 *
 *   mouse/pen  click = seek · drag = new selection, exactly [down, up] (B4)
 *              drag a [data-handle] = move that edge · drag the [data-grab]
 *              strip = move the selection (B7: dragging inside a selection
 *              starts a new one) · click a [data-marker] = select that sample
 *   touch      tap = seek · horizontal drag = pan (when zoomed; vertical
 *              stays page scroll via touch-action: pan-y) · two fingers =
 *              pinch-zoom every lane together · handles/grab as above, but
 *              only once the finger moves sideways (or after a short hold),
 *              so a page scroll that starts on them stays a scroll
 *   wheel      horizontal or Shift = pan when zoomed · plain vertical = page
 *              scroll · Ctrl/⌘ zoom is useZoomGestures (whole mixer)
 *
 * Selection updates during a drag are coalesced to one per frame (B8). A
 * drag the browser cancels (pointercancel: it took the touch over) puts the
 * selection back as it was: onSelect(before, 'cancel').
 * opts: { timeline, getSelection, onSelect(sel, phase), onSeek(t, track),
 *         onMarker(id), snap(sel, movingEdge, track) }
 */
export default function useLaneGestures(ref, opts, deps = []) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const o = () => optsRef.current;
    const touches = new Map();
    let g = null;
    let frame = 0;
    let pending = null;

    const laneOf = (target) => target?.closest?.('[data-lane]');
    const localX = (lane, clientX) => {
      const r = lane.getBoundingClientRect();
      return clamp(clientX - r.left, 0, r.width);
    };
    const timeAt = (x) => clamp(o().timeline.timeAt(x), 0, o().timeline.get().duration);

    const flush = () => {
      frame = 0;
      const p = pending;
      pending = null;
      if (p) o().onSelect(p, 'drag');
    };
    const emit = (sel) => {
      pending = sel;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const commit = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      const p = pending;
      pending = null;
      o().onSelect(p || o().getSelection(), 'end');
    };

    function startPinch() {
      // A handle/strip drag in progress ends where it is (else onSelect never
      // gets 'end' and the mixer stays in its dragging state).
      if (g && !g.still && (g.mode === 'select' || g.mode === 'edge' || g.mode === 'move')) commit();
      const [a, b] = [...touches.values()];
      const lane = laneOf(document.elementFromPoint((a.x + b.x) / 2, (a.y + b.y) / 2)) || g?.lane || el.querySelector('[data-lane]');
      if (!lane) return;
      g = { mode: 'pinch', zoom: pinchZoom(o().timeline, lane, a, b) };
      pending = null;
    }

    function onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('button, a, input, select, textarea, [data-nogesture]')) return;
      const lane = laneOf(e.target);
      if (!lane) return;
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
          startPinch();
          return;
        }
        if (touches.size > 2) return;
      }
      const x = localX(lane, e.clientX);
      const t = timeAt(x);
      const sel = o().getSelection();
      const handle = e.target.closest('[data-handle]');
      const grab = e.target.closest('[data-grab]');
      const marker = e.target.closest('[data-marker]');
      const base = { lane, id: e.pointerId, x0: e.clientX, y0: e.clientY, at: e.timeStamp, touch: e.pointerType === 'touch', before: sel };
      if (handle && sel) {
        const edge = handle.dataset.handle;
        // off: where in the handle it was grabbed, so the edge doesn't jump
        // to the finger (a touch handle is 44 px, pushed outward when narrow).
        const at = edge === 'start' ? sel.start : sel.end;
        g = { ...base, mode: 'edge', edge, track: sel.track, fixed: edge === 'start' ? sel.end : sel.start, off: t - at, t0: t, still: true };
      } else if (grab && sel) {
        g = { ...base, mode: 'move', track: sel.track, off: t - sel.start, len: sel.end - sel.start, t0: t, still: true };
      } else {
        g = {
          ...base,
          mode: 'pending',
          track: lane.dataset.lane,
          t0: t,
          marker: marker?.dataset.marker,
          view0: o().timeline.get().start,
        };
      }
      try {
        el.setPointerCapture(e.pointerId);
      } catch (err) {
        /* not capturable */
      }
      if (g.mode !== 'pending') e.preventDefault();
    }

    function onMove(e) {
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (g?.mode === 'pinch') {
        const [a, b] = [...touches.values()];
        if (a && b) g.zoom(a, b);
        return;
      }
      if (!g || e.pointerId !== g.id) return;
      const t = timeAt(localX(g.lane, e.clientX));
      const { snap } = o();
      const dx = Math.abs(e.clientX - g.x0);
      if (g.touch && (g.still || g.mode === 'pending')) {
        // Touch: wait for the direction. Mostly vertical is the page scrolling
        // (the browser takes it over), not a pan or a selection move.
        const dy = Math.abs(e.clientY - g.y0);
        if (Math.max(dx, dy) < TOUCH_SLOP) return; // a tap, so far
        if (dy >= dx && e.timeStamp - g.at < HOLD_MS) {
          g.still = false;
          g.mode = 'none';
          return;
        }
      } else if (dx < DRAG_PX && (g.still || g.mode === 'pending')) {
        return; // a tap, so far
      }
      g.still = false;
      if (g.mode === 'pending') g.mode = g.touch ? (o().timeline.get().zoomed ? 'pan' : 'none') : 'select';
      if (g.mode === 'select') {
        const forward = t >= g.t0;
        const raw = forward ? { start: g.t0, end: t } : { start: t, end: g.t0 };
        const s = snap ? snap(raw, forward ? 'end' : 'start', g.track) : raw;
        emit({ start: s.start, end: s.end, track: g.track });
      } else if (g.mode === 'edge') {
        const te = clamp(t - g.off, 0, o().timeline.get().duration);
        let start = g.edge === 'start' ? te : g.fixed;
        let end = g.edge === 'end' ? te : g.fixed;
        let moving = g.edge;
        if (start > end) {
          [start, end] = [end, start];
          moving = moving === 'start' ? 'end' : 'start';
        }
        const s = snap ? snap({ start, end }, moving, g.track) : { start, end };
        emit({ start: s.start, end: s.end, track: g.track });
      } else if (g.mode === 'move') {
        const dur = o().timeline.get().duration;
        const start = clamp(t - g.off, 0, Math.max(0, dur - g.len));
        emit({ start, end: start + g.len, track: g.track });
      } else if (g.mode === 'pan') {
        const tl = o().timeline;
        tl.panTo(g.view0 - (e.clientX - g.x0) / tl.get().pps);
      }
    }

    function onUp(e) {
      touches.delete(e.pointerId);
      if (g?.mode === 'pinch') {
        if (touches.size < 2) g = null;
        return;
      }
      if (!g || e.pointerId !== g.id) return;
      // The selection ends exactly where the pointer was released (B4).
      if (g.mode === 'select' || g.mode === 'edge' || g.mode === 'move') onMove(e);
      const done = g;
      g = null;
      if (done.still) {
        // A tap on a handle or the grab strip moves the playhead, like a lane tap.
        o().onSeek(done.t0, done.track);
        return;
      }
      if (done.mode === 'pending') {
        if (done.marker) o().onMarker?.(done.marker);
        else o().onSeek(done.t0, done.track);
      } else if (done.mode === 'select' || done.mode === 'edge' || done.mode === 'move') {
        commit();
      }
    }

    function onCancel(e) {
      const finger = touches.delete(e.pointerId);
      if (!g) return;
      if (g.mode === 'pinch') {
        if (finger && touches.size < 2) g = null;
        return;
      }
      // Another pointer (a palm on the controls) losing its capture isn't ours.
      if (e.pointerId !== g.id) return;
      const done = g;
      g = null;
      if (done.mode === 'select' || done.mode === 'edge' || done.mode === 'move') {
        cancelAnimationFrame(frame);
        frame = 0;
        pending = null;
        o().onSelect(done.before, 'cancel');
      }
    }

    function onWheel(e) {
      const lane = laneOf(e.target);
      if (!lane || e.ctrlKey || e.metaKey) return;
      const tl = o().timeline;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (!tl.get().zoomed) return;
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      if (dx && Math.abs(dx) >= Math.abs(e.shiftKey ? 0 : e.deltaY)) {
        e.preventDefault();
        tl.panBy(dx * unit);
      }
    }

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('lostpointercapture', onCancel);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('lostpointercapture', onCancel);
      el.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps]);
}

/**
 * Zoom the timeline, not the page: Ctrl/⌘ + wheel (Chrome and Firefox send a
 * trackpad pinch as that) and Safari's trackpad pinch (gesture* events) over
 * any [data-zoom] area of `ref` — lanes, spectrograms, the ruler, the label
 * column — zoom around the pointer. Touch pinches stay with useLaneGestures
 * (iOS sends gesture* for those too; they're left alone here).
 */
export function useZoomGestures(ref, timeline) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fingers = new Set();
    let pinch = null;

    // Lanes and the ruler ([data-axis]) share the time axis' left edge/width.
    const anchor = (target, clientX) => {
      const area = target?.closest?.('[data-zoom]');
      const axis = area && (target.closest('[data-lane], [data-axis]') || area.querySelector('[data-lane], [data-axis]'));
      if (!axis) return null;
      const r = axis.getBoundingClientRect();
      const x = clamp(clientX - r.left, 0, r.width);
      return { x, t: timeline.timeAt(x) };
    };

    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const a = anchor(e.target, e.clientX);
      if (!a) return;
      e.preventDefault();
      if (pinch) return; // Safari: the gesture events zoom
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      timeline.zoomTo(timeline.get().pps * Math.exp(-e.deltaY * unit * 0.002), a.t, a.x);
    };
    const onGestureStart = (e) => {
      if (fingers.size) return; // a touch pinch
      const a = anchor(e.target, e.clientX);
      if (!a) return;
      e.preventDefault();
      pinch = { ...a, pps0: timeline.get().pps };
    };
    const onGestureChange = (e) => {
      if (!pinch) return;
      e.preventDefault();
      if (fingers.size) {
        pinch = null;
        return;
      }
      timeline.zoomTo(pinch.pps0 * e.scale, pinch.t, pinch.x);
    };
    const onGestureEnd = (e) => {
      if (!pinch) return;
      e.preventDefault();
      pinch = null;
    };
    const onDown = (e) => {
      if (e.pointerType === 'touch') fingers.add(e.pointerId);
    };
    const onUp = (e) => fingers.delete(e.pointerId);

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', onGestureEnd);
    el.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
      el.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, [ref, timeline]);
}

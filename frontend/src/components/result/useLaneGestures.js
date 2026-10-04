import { useEffect, useRef } from 'react';
import { clamp } from './format';

const DRAG_PX = 4;

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
 *              pinch-zoom every lane together · handles/grab as above
 *   wheel      Ctrl/⌘ (or trackpad pinch) = zoom at the cursor · horizontal
 *              or Shift = pan when zoomed · plain vertical = page scroll
 *
 * Selection updates during a drag are coalesced to one per frame (B8).
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
      const [a, b] = [...touches.values()];
      const lane = laneOf(document.elementFromPoint((a.x + b.x) / 2, (a.y + b.y) / 2)) || g?.lane || el.querySelector('[data-lane]');
      if (!lane) return;
      const left = lane.getBoundingClientRect().left;
      const tl = o().timeline;
      const cx = (a.x + b.x) / 2 - left;
      g = { mode: 'pinch', left, d0: Math.max(16, Math.hypot(a.x - b.x, a.y - b.y)), t0: tl.timeAt(cx), pps0: tl.get().pps };
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
      const base = { lane, id: e.pointerId, x0: e.clientX };
      if (handle && sel) {
        const edge = handle.dataset.handle;
        g = { ...base, mode: 'edge', edge, track: sel.track, fixed: edge === 'start' ? sel.end : sel.start, t0: t, still: true };
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
          touch: e.pointerType === 'touch',
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
        if (!a || !b) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        o().timeline.zoomTo((g.pps0 * d) / g.d0, g.t0, (a.x + b.x) / 2 - g.left);
        return;
      }
      if (!g || e.pointerId !== g.id) return;
      const t = timeAt(localX(g.lane, e.clientX));
      const { snap } = o();
      if (g.still) {
        if (Math.abs(e.clientX - g.x0) < DRAG_PX) return; // a tap, so far
        g.still = false;
      }
      if (g.mode === 'pending') {
        if (Math.abs(e.clientX - g.x0) < DRAG_PX) return;
        if (g.touch) g.mode = o().timeline.get().zoomed ? 'pan' : 'none';
        else g.mode = 'select';
      }
      if (g.mode === 'select') {
        const forward = t >= g.t0;
        const raw = forward ? { start: g.t0, end: t } : { start: t, end: g.t0 };
        const s = snap ? snap(raw, forward ? 'end' : 'start', g.track) : raw;
        emit({ start: s.start, end: s.end, track: g.track });
      } else if (g.mode === 'edge') {
        let start = g.edge === 'start' ? t : g.fixed;
        let end = g.edge === 'end' ? t : g.fixed;
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
      touches.delete(e.pointerId);
      if (!g) return;
      if (g.mode === 'pinch' && touches.size >= 2) return;
      const wasDrag = g.mode === 'select' || g.mode === 'edge' || g.mode === 'move';
      g = null;
      if (wasDrag) commit();
    }

    function onWheel(e) {
      const lane = laneOf(e.target);
      if (!lane) return;
      const tl = o().timeline;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const x = localX(lane, e.clientX);
        tl.zoomTo(tl.get().pps * Math.exp(-e.deltaY * unit * 0.002), tl.timeAt(x), x);
        return;
      }
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

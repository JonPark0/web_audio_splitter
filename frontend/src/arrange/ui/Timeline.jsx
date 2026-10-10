import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import TextButton from '../../components/TextButton';
import {
  canWarp,
  clipDurationBeats,
  clipEndBeat,
  clipRegionBeats,
  findOverlaps,
  isTrackAudible,
  projectEndBeat,
  trimClipEnd,
  trimClipStart,
} from '../project';
import ClipView from './ClipView';
import Playhead from './Playhead';
import { dragSession, followPointer, releaseFocus } from './pointerDrag';
import Ruler from './Ruler';
import { SAMPLE_MIME, sampleDrag } from './sampleDrag';
import TrackHeader from './TrackHeader';
import { NEW_TRACK_ROW_HEIGHT, RULER_HEIGHT, RULER_HEIGHT_TOUCH, beatToPx, clampZoom, pxToBeat, snapBeat } from './snap';

const DRAG_THRESHOLD_PX = 3;
const TOUCH_SLOP_PX = 8; // finger movement that still counts as a tap / press
const LONG_PRESS_MS = 300;
const MIN_BARS = 32;
const TAIL_BARS = 8;
const CLIP_INSET = 2; // px gap above/below a clip inside its lane
const WHEEL_ZOOM_SPEED = 0.0015; // per wheel pixel: ~100px notch = x1.16
const WHEEL_LINE_PX = 16; // deltaMode 1 (lines) -> pixels
const MOUSE_HANDLE_PX = 6; // trim handle inside the clip edge (mouse)
const TOUCH_HANDLE_PX = 44; // trim handle hit area (touch); the drawn bar stays 3 px
const TOUCH_HANDLE_MIN_OUT_PX = 12; // less room than this outside an edge: the handle goes inside

// Grid in palette colours only: bar lines `line`, beat lines `wash`.
function gridStyle(pxPerBeat, beatsPerBar) {
  return {
    backgroundImage:
      'linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to right, var(--wash) 1px, transparent 1px)',
    backgroundSize: `${pxPerBeat * beatsPerBar}px 100%, ${pxPerBeat}px 100%`,
  };
}

const OVERLAP_STYLE = {
  backgroundImage: 'repeating-linear-gradient(-45deg, var(--ink) 0 1px, transparent 1px 5px)',
};

/**
 * Free px beside a clip's edges [x0, x1] on its track: up to the nearest
 * other clip, and on the left at most to beat 0. `span(c)` = [start, end] px.
 */
function edgeRoom(track, id, x0, x1, span) {
  let before = x0;
  let after = Infinity;
  for (const c of track.clips) {
    if (c.id === id) continue;
    const [s, e] = span(c);
    if (s < x0) before = Math.min(before, Math.max(0, x0 - e));
    if (e > x1) after = Math.min(after, Math.max(0, s - x1));
  }
  return { before, after };
}

/**
 * Track headers + ruler + lanes in ONE scroll container (both axes): the
 * ruler row is `sticky top-0`, the header column `sticky left-0`, so they
 * line up with the lanes by construction and the page never scrolls
 * sideways. Clips live in a single absolute layer (top = track index * lane
 * height), so moving one between tracks is just a new `top`.
 *
 * Input:
 *   mouse  - drag a clip to move, its edges to trim, its top corners to
 *            fade; drag on an empty lane draws a selection box; Ctrl/Cmd+
 *            wheel zooms around the pointer.
 *   touch  - a swipe scrolls (also when it starts on a clip); long-press a
 *            clip (300 ms) to drag it, long-press an empty lane for a
 *            selection box; trim handles sit outside the selected clip;
 *            two fingers pinch-zoom. With an armed sample a tap places it.
 *   pen    - like the mouse, but holds the scroll for the whole drag; while
 *            a pen is in use the lanes, clips and ruler don't pan at all.
 *
 * One drag at a time, owned by the pointer that started it: other fingers
 * never move it, and pinch, touch scrolling and Follow wait until it ends.
 * Drags auto-scroll at the edges and track the content, not the screen, so
 * a scroll or zoom under a still pointer keeps the clip under it. Escape
 * cancels.
 */
export default function Timeline({
  project,
  engine,
  clock,
  meterClock,
  height,
  pxPerBeat,
  step,
  laneHeight,
  headerWidth,
  mode,
  coarse,
  follow,
  selection,
  selectedTrackId,
  pending,
  armedSample,
  onSelectClips,
  onSelectTrack,
  onUpdateTrack,
  onDeleteTrack,
  onMoveTrack,
  onOpenTrack,
  onAddTrack,
  onMoveClips,
  onPatchClip,
  onZoomTo,
  onDropSample,
  onPlaceArmed,
  onSeek,
  onLoopChange,
  onRenameMarker,
  onViewWidth,
}) {
  const scrollRef = useRef(null);
  const lanesRef = useRef(null);
  const [viewWidth, setViewWidth] = useState(0);
  // {type:'move', ids:Set, dBeat, dTrack} | {type:'patch', id, patch}
  const [drag, setDrag] = useState(null);
  const [band, setBand] = useState(null); // {x0, y0, x1, y1, ids}
  const [dropHint, setDropHint] = useState(null); // {trackIndex, beat, beats}
  const [ghost, setGhost] = useState(null); // armed-sample placement preview {trackIndex, beat}
  // owner: the drag holding the timeline (blocks touch scroll and pinch,
  // pauses Follow); pinching: two fingers down; pointer: last pointerType;
  // pen: a pen is in use (mirrors `pen` below for the handlers).
  const gesture = useRef({ owner: null, pinching: false, pointer: 'mouse', pen: false });
  const [pen, setPen] = useState(false);
  const rulerHeight = coarse ? RULER_HEIGHT_TOUCH : RULER_HEIGHT;

  const { tracks, samples = {}, bpm } = project;
  const beatsPerBar = project.beats_per_bar || 4;
  const loop = project.loop;
  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const lane = laneHeight;

  // Latest values for the stable handlers below (memoized clips).
  const live = useRef({});
  live.current = {
    project,
    pxPerBeat,
    step,
    selection,
    lane,
    headerWidth,
    rulerHeight,
    onSelectClips,
    onMoveClips,
    onPatchClip,
    armedSample,
  };

  /** The timeline for one drag: a release function, or null while another drag owns it. */
  const claim = useCallback(() => {
    const g = gesture.current;
    if (g.owner) return null;
    const token = {};
    g.owner = token;
    return () => {
      if (g.owner === token) g.owner = null;
    };
  }, []);
  const held = useCallback(() => gesture.current.owner !== null, []);
  // A drag session (pointerDrag.js): its edges auto-scroll inside the
  // pinned header column and ruler row.
  const session = useCallback(
    (onMove, axes) => {
      const inset = { left: live.current.headerWidth, top: live.current.rulerHeight };
      return dragSession({ scroller: scrollRef.current, claim, inset, axes }, onMove);
    },
    [claim]
  );

  // Width: at least 32 bars, the content plus 8 bars of room, the loop, and
  // whatever the viewport shows (so the grid never stops short).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setViewWidth(el.clientWidth - headerWidth));
    ro.observe(el);
    setViewWidth(el.clientWidth - headerWidth);
    return () => ro.disconnect();
  }, [headerWidth]);
  useEffect(() => {
    onViewWidth?.(viewWidth);
  }, [viewWidth, onViewWidth]);

  const endBeat = useMemo(() => projectEndBeat(project), [project]);
  // A drag past the end grows the timeline ahead of it, so the edge
  // auto-scroll can keep going.
  const dragEnd = useMemo(() => {
    if (!drag) return 0;
    let end = 0;
    for (const t of tracks) {
      for (const c of t.clips) {
        if (drag.type === 'move' ? !drag.ids.has(c.id) : drag.id !== c.id) continue;
        const shown = drag.type === 'move' ? { ...c, start_beat: c.start_beat + drag.dBeat } : { ...c, ...drag.patch };
        end = Math.max(end, clipEndBeat(shown, samples[c.sample_id], bpm));
      }
    }
    return end;
  }, [drag, tracks, samples, bpm]);
  const contentBeats = Math.max(
    endBeat + TAIL_BARS * beatsPerBar,
    MIN_BARS * beatsPerBar,
    (loop?.end_beat || 0) + beatsPerBar,
    dragEnd + TAIL_BARS * beatsPerBar
  );
  const viewBeats = pxToBeat(Math.max(0, viewWidth), pxPerBeat);
  const totalBeats = Math.ceil(Math.max(contentBeats, viewBeats) / beatsPerBar) * beatsPerBar;
  const width = beatToPx(totalBeats, pxPerBeat);
  const lanesHeight = tracks.length * lane + NEW_TRACK_ROW_HEIGHT;

  // Zoom keeps the beat at the left edge in place - or, for wheel / pinch,
  // the beat under the pointer (`anchor`).
  const prevZoom = useRef(pxPerBeat);
  const anchor = useRef(null); // {beat, clientX}
  const pendingZoom = useRef(null); // last zoom requested, not yet rendered
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchor.current;
    anchor.current = null;
    pendingZoom.current = null;
    if (el && prevZoom.current !== pxPerBeat) {
      if (a) {
        const lanesLeft = el.getBoundingClientRect().left + headerWidth;
        el.scrollLeft = beatToPx(a.beat, pxPerBeat) - (a.clientX - lanesLeft);
      } else {
        el.scrollLeft = (el.scrollLeft * pxPerBeat) / prevZoom.current;
      }
    }
    prevZoom.current = pxPerBeat;
  }, [pxPerBeat, headerWidth]);

  const zoomAround = useCallback(
    (next, clientX) => {
      const el = scrollRef.current;
      const from = pendingZoom.current ?? live.current.pxPerBeat;
      const z = clampZoom(next);
      if (!el || Math.abs(z - from) < 1e-6) return;
      const lanesLeft = el.getBoundingClientRect().left + headerWidth;
      const x = Math.max(clientX, lanesLeft);
      const renderPending = pendingZoom.current !== null && pendingZoom.current !== live.current.pxPerBeat;
      if (!renderPending || !anchor.current) {
        anchor.current = { beat: pxToBeat(el.scrollLeft + x - lanesLeft, live.current.pxPerBeat), clientX: x };
      }
      pendingZoom.current = z;
      onZoomTo(z);
    },
    [headerWidth, onZoomTo]
  );

  // Native listeners: wheel (Ctrl/Cmd zoom, Shift horizontal), touch (pinch
  // zoom; blocking the scroll while a drag owns the timeline) and Safari's
  // gesture events (trackpad pinch).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const g = gesture.current;
    let trackpad = null; // Safari trackpad pinch {z0}
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (trackpad) return; // already zooming through gesturechange
        const delta = e.deltaY * (e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? el.clientHeight : 1);
        const from = pendingZoom.current ?? live.current.pxPerBeat;
        zoomAround(from * Math.exp(-delta * WHEEL_ZOOM_SPEED), e.clientX);
      } else if (e.shiftKey && e.deltaX === 0 && e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY * (e.deltaMode === 1 ? WHEEL_LINE_PX : 1);
      }
    };
    let pinch = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e) => {
      if (e.touches.length >= 2) {
        g.pinching = true;
        trackpad = null;
        // A drag under way keeps its finger; the second one doesn't zoom
        // (pxPerBeat would change under the drag's maths).
        pinch = g.owner ? null : { d0: dist(e.touches) || 1, z0: live.current.pxPerBeat };
      }
    };
    const onTouchMove = (e) => {
      if (e.touches.length >= 2 && pinch) {
        e.preventDefault();
        const mid = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        zoomAround(pinch.z0 * (dist(e.touches) / pinch.d0), mid);
      } else if (g.owner) {
        e.preventDefault();
      }
    };
    const onTouchEnd = (e) => {
      if (e.touches.length < 2) {
        pinch = null;
        if (e.touches.length === 0) g.pinching = false;
      }
    };
    // Safari: a trackpad pinch is a gesture event, not Ctrl+wheel, and
    // zoomed the whole page. On iOS two fingers are the touch pinch above.
    // Like Ctrl+wheel it may zoom under a mouse drag (which tracks beats).
    const onGestureStart = (e) => {
      e.preventDefault();
      trackpad = g.pinching ? null : { z0: pendingZoom.current ?? live.current.pxPerBeat };
    };
    const onGestureChange = (e) => {
      e.preventDefault();
      if (trackpad && e.scale > 0) zoomAround(trackpad.z0 * e.scale, e.clientX);
    };
    const onGestureEnd = (e) => {
      e.preventDefault();
      trackpad = null;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', onGestureEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, [zoomAround]);

  // Pens. Chrome (Android, Windows) sends no touch events for a pen, so the
  // touchmove lock above can't hold one, and touch-action is fixed when a
  // stroke starts, before any of its events reach a handler: on `pan-x
  // pan-y` the browser took a pen drag as a pan (pointercancel). So while a
  // pen is in use the lanes, clips and ruler are `touch-action: none` and
  // the pen drags like a mouse. Most pens report themselves hovering
  // (pointerover / pointermove) before they touch; one that can't hover
  // may still pan on its first stroke, and is caught for the next ones.
  const notePen = useCallback((e) => {
    if (e.pointerType !== 'pen' || gesture.current.pen) return;
    gesture.current.pen = true;
    setPen(true);
  }, []);
  // A finger switches back on its pointerdown (its pointerover comes too
  // late as well: that stroke's touch-action was set before it). The stroke
  // itself still can't pan natively, so it pans the view by hand until a
  // long-press drag or a pinch takes over.
  const panByHand = useCallback((down) => {
    const el = scrollRef.current;
    const g = gesture.current;
    const left = el.scrollLeft;
    const top = el.scrollTop;
    let panning = false;
    let done = false;
    followPointer(down, {
      move: (ev) => {
        if (done || g.owner || g.pinching) {
          done = true;
          return;
        }
        const dx = ev.clientX - down.clientX;
        const dy = ev.clientY - down.clientY;
        if (!panning && Math.hypot(dx, dy) <= TOUCH_SLOP_PX) return;
        panning = true;
        el.scrollLeft = left - dx;
        el.scrollTop = top - dy;
      },
    });
  }, []);
  const onPointerDownCapture = (e) => {
    const g = gesture.current;
    g.pointer = e.pointerType;
    notePen(e);
    if (e.pointerType !== 'touch' || !g.pen) return;
    g.pen = false;
    setPen(false);
    if (e.target.closest('[data-lanes],[data-ruler]')) panByHand(e);
  };
  const pan = pen ? 'none' : 'pan-x pan-y';

  // Lanes coordinates (the rect includes the scroll) at the current zoom.
  const pointAt = useCallback((clientX, clientY) => {
    const rect = lanesRef.current.getBoundingClientRect();
    const { pxPerBeat: ppb, lane: lh } = live.current;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      beat: Math.max(0, pxToBeat(clientX - rect.left, ppb)),
      trackIndex: Math.max(0, Math.floor((clientY - rect.top) / lh)),
    };
  }, []);

  // ---- clip drag planning, shared by mouse and long-press touch ----
  /**
   * Starts a drag on `clip` with `mode` ('move' | 'trimStart' | 'trim' |
   * 'fadeIn' | 'fadeOut'); `lifted` (touch long-press) shows it dragging
   * at once. Returns { move(clientX, clientY) -> under way?, finish(commit) }.
   */
  const beginClipDrag = useCallback((clip, mode, x0, y0, shiftKey, lifted = false) => {
    const { project: p, pxPerBeat: ppb0, step: snap, selection: sel, lane: lh } = live.current;
    const trackIndex = p.tracks.findIndex((t) => t.clips.some((c) => c.id === clip.id));
    const wasSelected = sel.includes(clip.id);
    let ids;
    if (mode !== 'move') ids = [clip.id];
    else if (shiftKey) ids = wasSelected ? sel : [...sel, clip.id];
    else ids = wasSelected ? sel : [clip.id];
    live.current.onSelectClips(ids, p.tracks[trackIndex]?.id);

    const idSet = new Set(ids);
    const moving = [];
    p.tracks.forEach((t, ti) => t.clips.forEach((c) => idSet.has(c.id) && moving.push({ clip: c, trackIndex: ti })));
    const minStart = Math.min(...moving.map((m) => m.clip.start_beat));
    const minTrack = Math.min(...moving.map((m) => m.trackIndex));
    const maxTrack = Math.max(...moving.map((m) => m.trackIndex));
    const sample = p.samples?.[clip.sample_id];
    const spb = 60 / p.bpm;
    const durBeats = clipDurationBeats(clip, sample, p.bpm);
    // Lanes coordinates and beats, not screen pixels: the view may scroll
    // (edge auto-scroll, wheel) or zoom (Ctrl+wheel) under a still pointer.
    const lanesAt = (cx, cy) => {
      const r = lanesRef.current.getBoundingClientRect();
      return { x: cx - r.left, y: cy - r.top };
    };
    const origin = lanesAt(x0, y0);
    const beat0 = pxToBeat(origin.x, ppb0);
    let started = false;
    let result = null;
    if (lifted) {
      result = { type: 'move', ids: idSet, dBeat: 0, dTrack: 0 };
      setDrag(result);
    }

    const move = (cx, cy) => {
      const ppb = live.current.pxPerBeat;
      const pt = lanesAt(cx, cy);
      const dBeats = pxToBeat(pt.x, ppb) - beat0;
      const dy = pt.y - origin.y;
      if (!started && Math.hypot(beatToPx(dBeats, ppb), dy) < DRAG_THRESHOLD_PX) return false;
      started = true;
      if (mode === 'move') {
        // Snap where the grabbed clip lands, then move the group by that delta.
        const snapped = snapBeat(clip.start_beat + dBeats, snap);
        const dBeat = Math.max(snapped - clip.start_beat, -minStart);
        const dTrack = Math.min(Math.max(Math.round(dy / lh), -minTrack), p.tracks.length - 1 - maxTrack);
        result = { type: 'move', ids: idSet, dBeat, dTrack };
      } else if (mode === 'trimStart') {
        result = { type: 'patch', id: clip.id, patch: trimClipStart(clip, sample, p.bpm, snapBeat(clip.start_beat + dBeats, snap)) };
      } else if (mode === 'trim') {
        const end = clip.start_beat + durBeats;
        result = { type: 'patch', id: clip.id, patch: trimClipEnd(clip, sample, p.bpm, snapBeat(end + dBeats, snap)) };
      } else if (mode === 'fadeIn' || mode === 'fadeOut') {
        const dur = durBeats * spb;
        const other = mode === 'fadeIn' ? clip.fade_out_sec || 0 : clip.fade_in_sec || 0;
        const base = mode === 'fadeIn' ? clip.fade_in_sec || 0 : clip.fade_out_sec || 0;
        const sec = Math.min(Math.max(0, base + (mode === 'fadeIn' ? dBeats : -dBeats) * spb), Math.max(0, dur - other));
        result = { type: 'patch', id: clip.id, patch: { [mode === 'fadeIn' ? 'fade_in_sec' : 'fade_out_sec']: Math.round(sec * 1000) / 1000 } };
      }
      setDrag(result);
      return true;
    };

    const finish = (commit) => {
      setDrag(null);
      if (!commit) return;
      if (!started) {
        // Plain click: collapse to this clip, or Shift-click toggles it off.
        if (shiftKey && wasSelected) live.current.onSelectClips(sel.filter((id) => id !== clip.id));
        else if (!shiftKey && wasSelected && mode === 'move') live.current.onSelectClips([clip.id], p.tracks[trackIndex]?.id);
        return;
      }
      if (!result) return;
      if (result.type === 'move' && (result.dBeat !== 0 || result.dTrack !== 0)) {
        live.current.onMoveClips(
          moving.map((m) => ({
            clipId: m.clip.id,
            trackId: p.tracks[m.trackIndex + result.dTrack].id,
            start_beat: Math.max(0, m.clip.start_beat + result.dBeat),
          }))
        );
      } else if (result.type === 'patch') {
        live.current.onPatchClip(clip.id, result.patch, mode === 'trim' || mode === 'trimStart');
      }
    };
    return { move, finish };
  }, []);

  const onClipPointerDown = useCallback(
    (e, clip, mode) => {
      if (e.button !== 0 || live.current.armedSample) return;
      e.stopPropagation();
      if (gesture.current.owner) return; // another pointer is dragging
      // The preventDefault below stops the focus move: commit an open
      // rename, let go of the Snap select or a fader - otherwise Delete,
      // arrows and Space keep going to them. (Touch too: iOS never blurs.)
      releaseFocus(lanesRef.current);
      if (e.pointerType === 'touch' && mode === 'move') {
        // Touch: a swipe must scroll, so the clip only lifts after a still
        // long-press; until then the browser may take the gesture.
        const x0 = e.clientX;
        const y0 = e.clientY;
        let s = null;
        let d = null;
        let moved = false;
        const timer = setTimeout(() => {
          if (gesture.current.pinching || moved) return;
          s = session((cx, cy) => d.move(cx, cy));
          if (!s) return;
          navigator.vibrate?.(8);
          d = beginClipDrag(clip, 'move', x0, y0, false, true);
        }, LONG_PRESS_MS);
        const end = (commit) => {
          clearTimeout(timer);
          if (s) {
            s.end();
            d.finish(commit);
          } else if (commit && !moved && !gesture.current.pinching) {
            const p = live.current.project;
            const tid = p.tracks.find((t) => t.clips.some((c) => c.id === clip.id))?.id;
            live.current.onSelectClips([clip.id], tid); // tap selects
          }
        };
        followPointer(e, {
          move: (ev) => {
            if (s) s.move(ev.clientX, ev.clientY);
            else if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > TOUCH_SLOP_PX) {
              moved = true;
              clearTimeout(timer);
            }
          },
          up: () => end(true),
          cancel: () => end(false),
        });
        return;
      }
      e.preventDefault(); // no text selection / native drag
      // Mouse, pen and touch handles hold the timeline from the start: no
      // pan under a pen (Safari would cancel the drag), no pinch, no Follow.
      let d = null;
      const s = session((cx, cy) => d.move(cx, cy), mode === 'move' ? undefined : { y: false });
      if (!s) return;
      d = beginClipDrag(clip, mode, e.clientX, e.clientY, e.shiftKey);
      const finish = (commit) => {
        s.end();
        d.finish(commit);
      };
      followPointer(e, {
        move: (ev) => s.move(ev.clientX, ev.clientY),
        up: () => finish(true),
        cancel: () => finish(false),
      });
    },
    [beginClipDrag, session]
  );

  // ---- empty lane: click selects the track; drag (mouse/pen) or long-press
  // (touch) draws a selection box; with an armed sample, a click/tap places
  // it. ----
  const clipsInBox = (x0, y0, x1, y1) => {
    const { project: p, pxPerBeat: ppb, lane: lh } = live.current;
    const b0 = pxToBeat(Math.min(x0, x1), ppb);
    const b1 = pxToBeat(Math.max(x0, x1), ppb);
    const t0 = Math.floor(Math.min(y0, y1) / lh);
    const t1 = Math.floor(Math.max(y0, y1) / lh);
    const ids = [];
    p.tracks.forEach((t, ti) => {
      if (ti < t0 || ti > t1) return;
      for (const c of t.clips) {
        const s = c.start_beat;
        const e2 = clipEndBeat(c, p.samples[c.sample_id], p.bpm);
        if (e2 > b0 && s < b1) ids.push(c.id);
      }
    });
    return ids;
  };

  const onLanesPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('[data-clip],[data-handle]')) return;
    if (gesture.current.owner) return; // another pointer is dragging
    releaseFocus(lanesRef.current);
    const start = pointAt(e.clientX, e.clientY);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const armed = live.current.armedSample;
    const at = (pt) => ({
      trackIndex: Math.min(pt.trackIndex, tracks.length),
      beat: snapBeat(pt.beat, step, 'floor'),
    });
    if (armed && e.pointerType !== 'mouse') {
      // Touch/pen placement: a swipe still scrolls the lanes; only a tap
      // (no travel, not taken by the browser) places.
      let moved = false;
      followPointer(e, {
        move: (ev) => {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > TOUCH_SLOP_PX) moved = true;
        },
        up: () => {
          if (moved || gesture.current.pinching || gesture.current.owner) return;
          const g = at(start);
          onPlaceArmed(tracks[g.trackIndex]?.id ?? null, g.beat);
        },
      });
      return;
    }
    if (armed) {
      // Mouse placement: the ghost follows the pointer, release places it.
      e.preventDefault();
      const s = session((cx, cy) => {
        setGhost(at(pointAt(cx, cy)));
        return true;
      });
      if (!s) return;
      setGhost(at(start));
      followPointer(e, {
        move: (ev) => s.move(ev.clientX, ev.clientY),
        up: (ev) => {
          s.end();
          const g = at(pointAt(ev.clientX, ev.clientY));
          setGhost(null);
          onPlaceArmed(tracks[g.trackIndex]?.id ?? null, g.beat);
        },
        cancel: () => {
          s.end();
          setGhost(null);
        },
      });
      return;
    }

    const shift = e.shiftKey;
    const base = shift ? live.current.selection : [];
    let s = null; // the box's hold on the timeline (touch: from the long-press)
    let banding = false;
    let moved = false;
    let timer = null;
    const updateBand = (pt) => {
      const ids = clipsInBox(start.x, start.y, pt.x, pt.y);
      setBand({ x0: start.x, y0: start.y, x1: pt.x, y1: pt.y, ids: [...new Set([...base, ...ids])] });
    };
    const boxTo = (cx, cy) => {
      const pt = pointAt(cx, cy);
      if (!banding && Math.hypot(pt.x - start.x, pt.y - start.y) < DRAG_THRESHOLD_PX) return false;
      banding = true;
      updateBand(pt);
      return true;
    };
    if (e.pointerType === 'touch') {
      timer = setTimeout(() => {
        if (moved || gesture.current.pinching) return;
        s = session(boxTo);
        if (!s) return;
        banding = true;
        navigator.vibrate?.(8);
        updateBand(start);
      }, LONG_PRESS_MS);
    } else {
      // Mouse and pen: the box starts on drag (a pen holds the scroll).
      e.preventDefault();
      s = session(boxTo);
      if (!s) return;
    }
    const finish = (commit, ev) => {
      clearTimeout(timer);
      s?.end();
      if (banding) {
        const pt = ev ? pointAt(ev.clientX, ev.clientY) : start;
        const ids = [...new Set([...base, ...clipsInBox(start.x, start.y, pt.x, pt.y)])];
        setBand(null);
        if (commit) onSelectClips(ids, tracks[start.trackIndex]?.id);
        return;
      }
      setBand(null);
      if (commit && !moved && !gesture.current.pinching) onSelectClips(shift ? base : [], tracks[start.trackIndex]?.id);
    };
    followPointer(e, {
      move: (ev) => {
        if (s) s.move(ev.clientX, ev.clientY);
        else if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > TOUCH_SLOP_PX) {
          moved = true;
          clearTimeout(timer);
        }
      },
      up: (ev) => finish(true, ev),
      cancel: () => finish(false),
    });
  };

  // ---- sample drop from the browser (HTML5 drag and drop, mouse) ----
  const isSampleDrag = (e) => Array.from(e.dataTransfer?.types || []).includes(SAMPLE_MIME);
  const onDragOver = (e) => {
    if (!isSampleDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const { beat, trackIndex } = pointAt(e.clientX, e.clientY);
    const s = sampleDrag.current;
    const beats = s ? clipDurationBeats({ warp: canWarp(s), length_sec: s.duration_sec }, s, bpm) : beatsPerBar;
    const hint = { trackIndex: Math.min(trackIndex, tracks.length), beat: snapBeat(beat, step, 'floor'), beats };
    setDropHint((prev) =>
      prev && prev.trackIndex === hint.trackIndex && prev.beat === hint.beat && prev.beats === hint.beats ? prev : hint
    );
  };
  const onDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDropHint(null);
  };
  const onDrop = (e) => {
    if (!isSampleDrag(e)) return;
    e.preventDefault();
    setDropHint(null);
    let sample = sampleDrag.current;
    try {
      sample = JSON.parse(e.dataTransfer.getData(SAMPLE_MIME)) || sample;
    } catch (err) {
      // fall back to the in-page reference
    }
    if (!sample) return;
    const { beat, trackIndex } = pointAt(e.clientX, e.clientY);
    onDropSample(sample, tracks[trackIndex]?.id ?? null, snapBeat(beat, step, 'floor'));
  };

  // ---- render ----
  const hasClips = tracks.some((t) => t.clips.length > 0);
  const clipHeight = lane - CLIP_INSET * 2;
  const bandSet = band ? new Set(band.ids) : null;
  // Hidden while clips move (they reappear on the dropped clip).
  const showTouchHandles = coarse && drag?.type !== 'move';

  const overlaps = useMemo(() => findOverlaps(project), [project]);
  const overlapping = useMemo(() => {
    const ids = new Set();
    for (const o of overlaps) {
      for (const c of tracks[o.trackIndex].clips) {
        if (c.start_beat < o.end && clipEndBeat(c, samples[c.sample_id], bpm) > o.start) ids.add(c.id);
      }
    }
    return ids;
  }, [overlaps, tracks, samples, bpm]);

  const clipViews = [];
  const handles = [];
  tracks.forEach((track, ti) => {
    const dimmed = !isTrackAudible(track, tracks);
    for (const clip of track.clips) {
      const sample = samples[clip.sample_id];
      let shown = clip;
      let index = ti;
      let dragging = false;
      if (drag?.type === 'move' && drag.ids.has(clip.id)) {
        shown = { ...clip, start_beat: clip.start_beat + drag.dBeat };
        index += drag.dTrack;
        dragging = true;
      } else if (drag?.type === 'patch' && drag.id === clip.id) {
        shown = { ...clip, ...drag.patch };
        dragging = true;
      }
      const beats = clipDurationBeats(shown, sample, bpm);
      const regionBeats = clipRegionBeats(shown, sample, bpm);
      const left = beatToPx(shown.start_beat, pxPerBeat);
      const top = index * lane + CLIP_INSET;
      const w = beatToPx(beats, pxPerBeat);
      const selected = bandSet ? bandSet.has(clip.id) : selectedSet.has(clip.id);
      clipViews.push(
        <ClipView
          key={clip.id}
          clip={shown}
          sample={sample}
          bpm={bpm}
          pxPerBeat={pxPerBeat}
          left={left}
          top={top}
          width={w}
          regionWidth={beatToPx(regionBeats, pxPerBeat)}
          height={clipHeight}
          selected={selected}
          dimmed={dimmed}
          dragging={dragging}
          overlapping={overlapping.has(clip.id)}
          pending={pending?.has(clip.id)}
          coarse={coarse}
          handlePx={MOUSE_HANDLE_PX}
          engine={engine}
          touchAction={pan}
          onClipPointerDown={onClipPointerDown}
        />
      );
      // Touch trim handles: only on the selected clip, OUTSIDE its edges so a
      // narrow one-shot stays grabbable by its body - but never over a
      // neighbour (it would block its long-press) or left of beat 0 (under
      // the track headers): what doesn't fit outside goes inside the edge.
      if (showTouchHandles && selectedSet.has(clip.id) && selection.length <= 4) {
        const room = edgeRoom(track, clip.id, left, left + w, (c) => [
          beatToPx(c.start_beat, pxPerBeat),
          beatToPx(clipEndBeat(c, samples[c.sample_id], bpm), pxPerBeat),
        ]);
        for (const side of ['trimStart', 'trim']) {
          const free = side === 'trim' ? room.after : room.before;
          const out = free >= TOUCH_HANDLE_MIN_OUT_PX ? Math.min(TOUCH_HANDLE_PX, free) : 0;
          const inside = Math.min(TOUCH_HANDLE_PX - out, Math.floor(w / 3));
          const hw = out + inside;
          if (hw < 4) continue;
          // The drawn bar sits just outside the edge (inside when there's no room).
          const bar = side === 'trim' ? (out ? inside : hw - 3) : out ? out - 3 : 0;
          handles.push(
            <div
              key={`${clip.id}-${side}`}
              data-handle={side}
              role="slider"
              aria-label={side === 'trim' ? 'Trim clip end' : 'Trim clip start'}
              aria-valuenow={Math.round((side === 'trim' ? shown.start_beat + beats : shown.start_beat) * 100) / 100}
              onPointerDown={(e) => onClipPointerDown(e, clip, side)}
              className="absolute z-20"
              style={{ left: side === 'trim' ? left + w - inside : left - out, top, width: hw, height: clipHeight, touchAction: 'none' }}
            >
              <span className="absolute top-1/4 block h-1/2 w-[3px] bg-ink" style={{ left: bar }} />
            </div>
          );
        }
      }
    }
  });

  const loopShown = loop && loop.enabled && loop.end_beat > loop.start_beat;
  const markers = project.markers || [];

  return (
    <div
      ref={scrollRef}
      data-timeline=""
      onPointerDownCapture={onPointerDownCapture}
      onPointerOver={notePen}
      onPointerMove={notePen}
      // No native menu on a long-press (also on a touch laptop, whose mouse
      // keeps its right-click menu).
      onContextMenu={(e) => (e.nativeEvent.pointerType || gesture.current.pointer) !== 'mouse' && e.preventDefault()}
      className="relative isolate min-w-0 select-none overflow-auto overscroll-contain border-y border-line [-webkit-touch-callout:none]"
      style={{ height, touchAction: 'pan-x pan-y' }}
    >
      <div className="relative" style={{ width: headerWidth + width, minWidth: '100%' }}>
        {/* Ruler row, pinned to the top while the lanes scroll under it */}
        <div className="sticky top-0 z-30 flex bg-paper" style={{ height: rulerHeight }}>
          <div
            className="sticky left-0 z-10 flex shrink-0 items-end border-b border-r border-b-ink border-r-line bg-paper px-2 pb-1 text-caption text-muted"
            style={{ width: headerWidth }}
          >
            {`${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`}
          </div>
          {/* Own stacking context: loop handles and flags stay under the corner cell */}
          <div className="relative isolate" style={{ width }}>
            <Ruler
              pxPerBeat={pxPerBeat}
              beatsPerBar={beatsPerBar}
              totalBeats={totalBeats}
              loop={loop}
              step={step}
              markers={markers}
              coarse={coarse}
              pen={pen}
              scrollRef={scrollRef}
              headerWidth={headerWidth}
              claim={claim}
              onSeek={onSeek}
              onLoopChange={onLoopChange}
              onRenameMarker={onRenameMarker}
            />
            <Playhead clock={clock} pxPerBeat={pxPerBeat} scrollRef={scrollRef} headerWidth={headerWidth} follow={false} marker />
          </div>
        </div>

        <div className="flex">
          {/* Headers column, pinned while the lanes scroll under it */}
          <div className="sticky left-0 z-20 shrink-0 border-r border-line bg-paper" style={{ width: headerWidth }}>
            {tracks.map((track, i) => (
              <TrackHeader
                key={track.id}
                track={track}
                index={i}
                count={tracks.length}
                height={lane}
                mode={mode}
                audible={isTrackAudible(track, tracks)}
                selected={track.id === selectedTrackId}
                meterClock={meterClock}
                onSelect={onSelectTrack}
                onUpdate={onUpdateTrack}
                onDelete={onDeleteTrack}
                onMove={onMoveTrack}
                onOpen={onOpenTrack}
              />
            ))}
            <div className="flex items-center px-2" style={{ height: NEW_TRACK_ROW_HEIGHT }}>
              <TextButton muted onClick={onAddTrack} className="min-h-[44px] justify-center text-caption">
                Add track
              </TextButton>
            </div>
          </div>

          {/* Lanes: x = 0 is beat 0. Their own stacking context, so the
              playhead, a dragged clip, handles, ghost and box (z-10..30
              inside) never paint over - or take taps from - the headers. */}
          <div
            ref={lanesRef}
            data-lanes=""
            onPointerDown={onLanesPointerDown}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`relative isolate ${armedSample ? 'cursor-copy' : ''}`}
            style={{ width, height: lanesHeight, touchAction: pan }}
          >
            {tracks.map((track, i) => (
              <div
                key={track.id}
                aria-hidden="true"
                className={`pointer-events-none absolute inset-x-0 border-b border-line ${
                  track.id === selectedTrackId ? 'bg-wash' : ''
                }`}
                style={{ top: i * lane, height: lane }}
              />
            ))}

            {loopShown && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 bg-wash"
                style={{
                  left: beatToPx(loop.start_beat, pxPerBeat),
                  width: beatToPx(loop.end_beat - loop.start_beat, pxPerBeat),
                }}
              />
            )}

            {/* Grid above the opaque lane/loop fills so they never hide it */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={gridStyle(pxPerBeat, beatsPerBar)} />

            {markers.map((m) => (
              <div
                key={m.id}
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 border-l border-dashed border-ink opacity-55"
                style={{ left: beatToPx(m.beat, pxPerBeat) }}
              />
            ))}

            {!hasClips && tracks.length > 0 && !dropHint && !ghost && (
              <p className="pointer-events-none absolute left-3 m-0 text-caption text-ink" style={{ top: lane / 2 - 10 }}>
                {coarse ? 'Pick a sample in Samples, then tap a lane.' : 'Drag samples from the browser onto a track.'}
              </p>
            )}

            {clipViews}
            {handles}

            {overlaps.map((o, i) => (
              <div
                // eslint-disable-next-line react/no-array-index-key
                key={i}
                aria-hidden="true"
                className="pointer-events-none absolute z-10 border-x border-ink"
                style={{
                  ...OVERLAP_STYLE,
                  left: beatToPx(o.start, pxPerBeat),
                  width: Math.max(2, beatToPx(o.end - o.start, pxPerBeat)),
                  top: o.trackIndex * lane + CLIP_INSET,
                  height: clipHeight,
                }}
              />
            ))}

            {band && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute z-30 border border-dashed border-ink"
                style={{
                  left: Math.min(band.x0, band.x1),
                  top: Math.min(band.y0, band.y1),
                  width: Math.abs(band.x1 - band.x0),
                  height: Math.abs(band.y1 - band.y0),
                }}
              />
            )}

            {(dropHint || ghost) &&
              (() => {
                const g = dropHint || {
                  ...ghost,
                  beats: armedSample
                    ? clipDurationBeats({ warp: canWarp(armedSample), length_sec: armedSample.duration_sec }, armedSample, bpm)
                    : beatsPerBar,
                };
                const newRow = g.trackIndex >= tracks.length;
                return (
                  <>
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute z-20 border border-dashed border-ink bg-paper/60"
                      style={{
                        left: beatToPx(g.beat, pxPerBeat),
                        top: g.trackIndex * lane + CLIP_INSET,
                        width: Math.max(4, beatToPx(g.beats, pxPerBeat)),
                        height: (newRow ? NEW_TRACK_ROW_HEIGHT : lane) - CLIP_INSET * 2,
                      }}
                    />
                    {newRow && (
                      <p
                        className="pointer-events-none absolute m-0 whitespace-nowrap text-caption text-ink"
                        style={{ left: beatToPx(g.beat, pxPerBeat) + 8, top: tracks.length * lane + 12 }}
                      >
                        New track
                      </p>
                    )}
                  </>
                );
              })()}

            <Playhead clock={clock} pxPerBeat={pxPerBeat} scrollRef={scrollRef} headerWidth={headerWidth} follow={follow} held={held} />
          </div>
        </div>
      </div>
    </div>
  );
}


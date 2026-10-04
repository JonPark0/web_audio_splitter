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
import Ruler from './Ruler';
import { SAMPLE_MIME, sampleDrag } from './sampleDrag';
import TrackHeader from './TrackHeader';
import { NEW_TRACK_ROW_HEIGHT, RULER_HEIGHT, beatToPx, clampZoom, pxToBeat, snapBeat } from './snap';

const DRAG_THRESHOLD_PX = 3;
const TOUCH_SLOP_PX = 8; // finger movement that still counts as a tap / press
const LONG_PRESS_MS = 300;
const MIN_BARS = 32;
const TAIL_BARS = 8;
const CLIP_INSET = 2; // px gap above/below a clip inside its lane
const WHEEL_ZOOM_SPEED = 0.0015; // per wheel pixel: ~100px notch = x1.16
const WHEEL_LINE_PX = 16; // deltaMode 1 (lines) -> pixels
const MOUSE_HANDLE_PX = 6; // trim handle inside the clip edge (mouse)
const TOUCH_HANDLE_PX = 24; // trim handle outside the clip edge (touch), >= 22 px

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
 *            two fingers pinch-zoom.
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
  const [pressing, setPressing] = useState(null); // clip id under a long-press about to lift
  const gesture = useRef({ lockScroll: false, pinching: false });

  const { tracks, samples = {}, bpm } = project;
  const beatsPerBar = project.beats_per_bar || 4;
  const loop = project.loop;
  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const lane = laneHeight;

  // Latest values for the stable handlers below (memoized clips).
  const live = useRef({});
  live.current = { project, pxPerBeat, step, selection, lane, onSelectClips, onMoveClips, onPatchClip, armedSample };

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
  const contentBeats = Math.max(endBeat + TAIL_BARS * beatsPerBar, MIN_BARS * beatsPerBar, (loop?.end_beat || 0) + beatsPerBar);
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

  // Native listeners: wheel (Ctrl/Cmd zoom, Shift horizontal), and touch
  // (pinch zoom; blocking the scroll once a long-press drag has started).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
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
        gesture.current.pinching = true;
        pinch = { d0: dist(e.touches) || 1, z0: live.current.pxPerBeat };
      }
    };
    const onTouchMove = (e) => {
      if (e.touches.length >= 2 && pinch) {
        e.preventDefault();
        const mid = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        zoomAround(pinch.z0 * (dist(e.touches) / pinch.d0), mid);
      } else if (gesture.current.lockScroll) {
        e.preventDefault();
      }
    };
    const onTouchEnd = (e) => {
      if (e.touches.length < 2) {
        pinch = null;
        if (e.touches.length === 0) gesture.current.pinching = false;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [zoomAround]);

  const pointAt = useCallback(
    (clientX, clientY) => {
      const rect = lanesRef.current.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
        beat: Math.max(0, pxToBeat(clientX - rect.left, pxPerBeat)),
        trackIndex: Math.max(0, Math.floor((clientY - rect.top) / lane)),
      };
    },
    [pxPerBeat, lane]
  );

  // ---- clip drag planning, shared by mouse and long-press touch ----
  /**
   * Starts a drag on `clip` with `mode` ('move' | 'trimStart' | 'trim' |
   * 'fadeIn' | 'fadeOut'). Returns { move(clientX, clientY), finish(commit) }.
   */
  const beginClipDrag = useCallback((clip, mode, x0, y0, shiftKey) => {
    const { project: p, pxPerBeat: ppb, step: snap, selection: sel, lane: lh } = live.current;
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
    let started = false;
    let result = null;

    const move = (cx, cy) => {
      const dx = cx - x0;
      const dy = cy - y0;
      if (!started && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      started = true;
      const dBeats = pxToBeat(dx, ppb);
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
      if (e.pointerType === 'touch' && mode === 'move') {
        // Touch: a swipe must scroll, so the clip only lifts after a still
        // long-press; until then the browser may take the gesture.
        const x0 = e.clientX;
        const y0 = e.clientY;
        let drag = null;
        let moved = false;
        const timer = setTimeout(() => {
          if (gesture.current.pinching || moved) return;
          gesture.current.lockScroll = true;
          navigator.vibrate?.(8);
          setPressing(null);
          drag = beginClipDrag(clip, 'move', x0, y0, false);
        }, LONG_PRESS_MS);
        setPressing(clip.id);
        const onMove = (ev) => {
          if (drag) drag.move(ev.clientX, ev.clientY);
          else if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > TOUCH_SLOP_PX) {
            moved = true;
            clearTimeout(timer);
            setPressing(null);
          }
        };
        const end = (commit) => {
          clearTimeout(timer);
          setPressing(null);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onCancel);
          gesture.current.lockScroll = false;
          if (drag) drag.finish(commit);
          else if (commit && !moved && !gesture.current.pinching) {
            const p = live.current.project;
            const tid = p.tracks.find((t) => t.clips.some((c) => c.id === clip.id))?.id;
            live.current.onSelectClips([clip.id], tid); // tap selects
          }
        };
        const onUp = () => end(true);
        const onCancel = () => end(false);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        return;
      }
      e.preventDefault(); // no text selection / native drag
      // preventDefault also stops the focus move, so commit any open rename
      // (its blur saves) - otherwise Delete would keep typing into it.
      if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
      if (e.pointerType === 'touch') gesture.current.lockScroll = true; // handles: no scroll
      const d = beginClipDrag(clip, mode, e.clientX, e.clientY, e.shiftKey);
      const onMove = (ev) => d.move(ev.clientX, ev.clientY);
      const finish = (commit) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        gesture.current.lockScroll = false;
        d.finish(commit);
      };
      const onUp = () => finish(true);
      const onCancel = () => finish(false);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    },
    [beginClipDrag]
  );

  // ---- empty lane: click selects the track; drag (mouse) or long-press
  // (touch) draws a selection box; with an armed sample, tap places it. ----
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
    const start = pointAt(e.clientX, e.clientY);
    const armed = live.current.armedSample;
    if (armed) {
      // Placement: the ghost follows the finger/pointer, release places it.
      e.preventDefault();
      const at = (pt) => ({
        trackIndex: Math.min(pt.trackIndex, tracks.length),
        beat: snapBeat(pt.beat, step, 'floor'),
      });
      setGhost(at(start));
      const onMove = (ev) => setGhost(at(pointAt(ev.clientX, ev.clientY)));
      const onUp = (ev) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        const g = at(pointAt(ev.clientX, ev.clientY));
        setGhost(null);
        onPlaceArmed(tracks[g.trackIndex]?.id ?? null, g.beat);
      };
      const onCancel = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        setGhost(null);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      return;
    }

    const shift = e.shiftKey;
    const base = shift ? live.current.selection : [];
    let banding = false;
    let moved = false;
    let timer = null;
    const updateBand = (pt) => {
      const ids = clipsInBox(start.x, start.y, pt.x, pt.y);
      setBand({ x0: start.x, y0: start.y, x1: pt.x, y1: pt.y, ids: [...new Set([...base, ...ids])] });
    };
    if (e.pointerType === 'touch') {
      timer = setTimeout(() => {
        if (moved || gesture.current.pinching) return;
        banding = true;
        gesture.current.lockScroll = true;
        navigator.vibrate?.(8);
        updateBand(start);
      }, LONG_PRESS_MS);
    } else {
      e.preventDefault();
    }
    const onMove = (ev) => {
      const pt = pointAt(ev.clientX, ev.clientY);
      const dist = Math.hypot(pt.x - start.x, pt.y - start.y);
      if (e.pointerType === 'touch') {
        if (banding) updateBand(pt);
        else if (dist > TOUCH_SLOP_PX) {
          moved = true;
          clearTimeout(timer);
        }
        return;
      }
      if (!banding && dist >= DRAG_THRESHOLD_PX) banding = true;
      if (banding) updateBand(pt);
    };
    const finish = (commit, ev) => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      gesture.current.lockScroll = false;
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
    const onUp = (ev) => finish(true, ev);
    const onCancel = () => finish(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
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
  const showTouchHandles = coarse;

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
          pressing={pressing === clip.id}
          pending={pending?.has(clip.id)}
          coarse={coarse}
          handlePx={MOUSE_HANDLE_PX}
          engine={engine}
          onClipPointerDown={onClipPointerDown}
        />
      );
      // Touch trim handles: only on the selected clip, OUTSIDE its edges so a
      // narrow one-shot stays grabbable by its body.
      if (showTouchHandles && selectedSet.has(clip.id) && selection.length <= 4) {
        for (const side of ['trimStart', 'trim']) {
          handles.push(
            <div
              key={`${clip.id}-${side}`}
              data-handle={side}
              role="slider"
              aria-label={side === 'trim' ? 'Trim clip end' : 'Trim clip start'}
              aria-valuenow={Math.round((side === 'trim' ? shown.start_beat + beats : shown.start_beat) * 100) / 100}
              onPointerDown={(e) => onClipPointerDown(e, clip, side)}
              className="absolute z-20 flex items-center"
              style={{
                left: side === 'trim' ? left + w : left - TOUCH_HANDLE_PX,
                top,
                width: TOUCH_HANDLE_PX,
                height: clipHeight,
                touchAction: 'none',
                justifyContent: side === 'trim' ? 'flex-start' : 'flex-end',
              }}
            >
              <span className="block h-1/2 w-[3px] bg-ink" />
            </div>
          );
        }
      }
    }
  });

  const overlaps = useMemo(() => findOverlaps(project), [project]);
  const loopShown = loop && loop.enabled && loop.end_beat > loop.start_beat;
  const markers = project.markers || [];

  return (
    <div
      ref={scrollRef}
      data-timeline=""
      onContextMenu={(e) => coarse && e.preventDefault()}
      className="relative isolate min-w-0 select-none overflow-auto overscroll-contain border-y border-line [-webkit-touch-callout:none]"
      style={{ height, touchAction: 'pan-x pan-y' }}
    >
      <div className="relative" style={{ width: headerWidth + width, minWidth: '100%' }}>
        {/* Ruler row, pinned to the top while the lanes scroll under it */}
        <div className="sticky top-0 z-30 flex bg-paper" style={{ height: RULER_HEIGHT }}>
          <div
            className="sticky left-0 z-10 flex shrink-0 items-end border-b border-r border-b-ink border-r-line bg-paper px-2 pb-1 text-caption text-muted"
            style={{ width: headerWidth }}
          >
            {mode === 'phone' ? `${tracks.length}` : `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`}
          </div>
          <div className="relative" style={{ width }}>
            <Ruler
              pxPerBeat={pxPerBeat}
              beatsPerBar={beatsPerBar}
              totalBeats={totalBeats}
              loop={loop}
              step={step}
              markers={markers}
              coarse={coarse}
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
                {mode === 'phone' ? '+ Track' : 'Add track'}
              </TextButton>
            </div>
          </div>

          {/* Lanes: x = 0 is beat 0 */}
          <div
            ref={lanesRef}
            data-lanes=""
            onPointerDown={onLanesPointerDown}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`relative ${armedSample ? 'cursor-copy' : ''}`}
            style={{ width, height: lanesHeight, touchAction: armedSample ? 'none' : undefined }}
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
                {coarse ? 'Open Samples (⋯), tap one, then tap a lane.' : 'Drag samples from the browser onto a track.'}
              </p>
            )}

            {clipViews}
            {handles}

            {overlaps.map((o, i) => (
              <div
                // eslint-disable-next-line react/no-array-index-key
                key={i}
                aria-label="Overlapping clips"
                title="Overlapping clips: both play here. Move or trim one."
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

            <Playhead clock={clock} pxPerBeat={pxPerBeat} scrollRef={scrollRef} headerWidth={headerWidth} follow={follow} />
          </div>
        </div>
      </div>
    </div>
  );
}


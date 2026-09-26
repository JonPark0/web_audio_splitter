import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FiPlus } from 'react-icons/fi';
import TextButton from '../../components/TextButton';
import { canWarp, clipDurationBeats, clipRate, isTrackAudible, projectEndBeat, secondsPerBeat } from '../project';
import ClipView from './ClipView';
import Playhead from './Playhead';
import Ruler from './Ruler';
import { SAMPLE_MIME, sampleDrag } from './sampleDrag';
import TrackHeader from './TrackHeader';
import { LANE_HEIGHT, NEW_TRACK_ROW_HEIGHT, RULER_HEIGHT, beatToPx, clampZoom, pxToBeat, snapBeat } from './snap';

const DRAG_THRESHOLD_PX = 3;
const MIN_BARS = 32;
const TAIL_BARS = 8;
const MIN_CLIP_SEC = 0.05;
const CLIP_INSET = 4; // px gap above/below a clip inside its lane
const WHEEL_ZOOM_SPEED = 0.0015; // per wheel pixel: ~100px notch = x1.16
const WHEEL_LINE_PX = 16; // deltaMode 1 (lines) -> pixels

// Grid: bar lines stronger than beat lines, both as translucent ink.
function gridStyle(pxPerBeat, beatsPerBar) {
  return {
    backgroundImage:
      'linear-gradient(to right, rgba(20,20,20,0.13) 1px, transparent 1px), linear-gradient(to right, rgba(20,20,20,0.05) 1px, transparent 1px)',
    backgroundSize: `${pxPerBeat * beatsPerBar}px 100%, ${pxPerBeat}px 100%`,
  };
}

/**
 * Track headers + ruler + lanes in ONE horizontal scroll container: headers
 * are `sticky left-0`, so they line up with their lanes by construction and
 * the page itself never scrolls sideways. Clips live in a single absolute
 * layer (top = track index * lane height) so moving one between tracks is
 * just a new `top` - no remount mid-drag.
 */
export default function Timeline({
  project,
  engine,
  clock,
  pxPerBeat,
  step,
  selection,
  selectedTrackId,
  onSelectClips,
  onSelectTrack,
  onUpdateTrack,
  onDeleteTrack,
  onAddTrack,
  onMoveClips,
  onTrimClip,
  onZoomTo,
  onDropSample,
  onSeek,
  onLoopChange,
}) {
  const scrollRef = useRef(null);
  const headerRef = useRef(null);
  const lanesRef = useRef(null);
  const [viewWidth, setViewWidth] = useState(0);
  // {type:'move', ids, dBeat, dTrack} | {type:'trim', id, lengthSec}
  // | {type:'trimStart', id, startBeat, offsetSec, lengthSec}
  const [drag, setDrag] = useState(null);
  const [dropHint, setDropHint] = useState(null); // {trackIndex, beat, beats}

  const { tracks, samples = {}, bpm } = project;
  const beatsPerBar = project.beats_per_bar || 4;
  const loop = project.loop;
  const selectedSet = useMemo(() => new Set(selection), [selection]);

  // Latest values for the stable pointer handlers below (memoized clips).
  const live = useRef({});
  live.current = { project, pxPerBeat, step, selection, onSelectClips, onMoveClips, onTrimClip };

  // Width: at least 32 bars, the content plus 8 bars of room, the loop, and
  // whatever the viewport shows (so the grid never stops short).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setViewWidth(el.clientWidth - (headerRef.current?.offsetWidth || 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const endBeat = useMemo(() => projectEndBeat(project), [project]);
  const contentBeats = Math.max(endBeat + TAIL_BARS * beatsPerBar, MIN_BARS * beatsPerBar, (loop?.end_beat || 0) + beatsPerBar);
  const viewBeats = pxToBeat(viewWidth, pxPerBeat);
  const totalBeats = Math.ceil(Math.max(contentBeats, viewBeats) / beatsPerBar) * beatsPerBar;
  const width = beatToPx(totalBeats, pxPerBeat);
  const lanesHeight = tracks.length * LANE_HEIGHT + NEW_TRACK_ROW_HEIGHT;

  // Zoom keeps the beat at the left edge in place - or, for a wheel zoom,
  // the beat under the pointer (`anchor`, set by the wheel handler).
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
        const lanesLeft = el.getBoundingClientRect().left + (headerRef.current?.offsetWidth || 0);
        el.scrollLeft = beatToPx(a.beat, pxPerBeat) - (a.clientX - lanesLeft);
      } else {
        el.scrollLeft = (el.scrollLeft * pxPerBeat) / prevZoom.current;
      }
    }
    prevZoom.current = pxPerBeat;
  }, [pxPerBeat]);

  // Ctrl/Cmd + wheel zooms around the pointer. Native listener: React's
  // onWheel is passive, and the browser's page zoom must be prevented.
  const wheel = useRef({});
  wheel.current = { pxPerBeat, onZoomTo };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const { pxPerBeat: ppb, onZoomTo: zoomTo } = wheel.current;
        if (!zoomTo) return;
        const delta = e.deltaY * (e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? el.clientHeight : 1);
        const from = pendingZoom.current ?? ppb;
        const next = clampZoom(from * Math.exp(-delta * WHEEL_ZOOM_SPEED));
        if (Math.abs(next - from) < 1e-6) return;
        // Beat under the pointer, from the DOM as rendered (over the headers:
        // the first visible beat). Repeated events before a render reuse it.
        const lanesLeft = el.getBoundingClientRect().left + (headerRef.current?.offsetWidth || 0);
        const clientX = Math.max(e.clientX, lanesLeft);
        const renderPending = pendingZoom.current !== null && pendingZoom.current !== ppb;
        if (!renderPending || !anchor.current) {
          anchor.current = { beat: pxToBeat(el.scrollLeft + clientX - lanesLeft, ppb), clientX };
        }
        pendingZoom.current = next;
        zoomTo(next);
      } else if (e.shiftKey && e.deltaX === 0 && e.deltaY !== 0) {
        // Browsers that don't turn Shift+wheel into horizontal scrolling.
        e.preventDefault();
        el.scrollLeft += e.deltaY * (e.deltaMode === 1 ? WHEEL_LINE_PX : 1);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const pointAt = useCallback(
    (clientX, clientY) => {
      const rect = lanesRef.current.getBoundingClientRect();
      return {
        beat: Math.max(0, pxToBeat(clientX - rect.left, pxPerBeat)),
        trackIndex: Math.max(0, Math.floor((clientY - rect.top) / LANE_HEIGHT)),
      };
    },
    [pxPerBeat]
  );

  // ---- clip move / trim (pointer events, committed once on release) ----
  const onClipPointerDown = useCallback((e, clip, mode) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection / native drag
    e.stopPropagation();
    // preventDefault also stops the focus move, so commit any open rename
    // (its blur saves) - otherwise Delete would keep typing into it.
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
    const { project: p, pxPerBeat: ppb, step: snap, selection: sel } = live.current;
    const trackIndex = p.tracks.findIndex((t) => t.clips.some((c) => c.id === clip.id));
    const wasSelected = sel.includes(clip.id);
    let ids;
    if (mode !== 'move') ids = wasSelected && !e.shiftKey ? sel : e.shiftKey ? [...new Set([...sel, clip.id])] : [clip.id];
    else if (e.shiftKey) ids = wasSelected ? sel : [...sel, clip.id];
    else ids = wasSelected ? sel : [clip.id];
    live.current.onSelectClips(ids, p.tracks[trackIndex]?.id);

    const x0 = e.clientX;
    const y0 = e.clientY;
    let started = false;
    let result = null;

    // Everything the move needs, captured once.
    const idSet = new Set(ids);
    const moving = [];
    p.tracks.forEach((t, ti) => t.clips.forEach((c) => idSet.has(c.id) && moving.push({ clip: c, trackIndex: ti })));
    const minStart = Math.min(...moving.map((m) => m.clip.start_beat));
    const minTrack = Math.min(...moving.map((m) => m.trackIndex));
    const maxTrack = Math.max(...moving.map((m) => m.trackIndex));
    const sample = p.samples?.[clip.sample_id];

    const onMove = (ev) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (!started && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      started = true;
      if (mode === 'move') {
        // Snap where the grabbed clip lands, then move the group by that delta.
        const snapped = snapBeat(clip.start_beat + pxToBeat(dx, ppb), snap);
        const dBeat = Math.max(snapped - clip.start_beat, -minStart);
        const dTrack = Math.min(Math.max(Math.round(dy / LANE_HEIGHT), -minTrack), p.tracks.length - 1 - maxTrack);
        result = { type: 'move', ids: idSet, dBeat, dTrack };
      } else if (mode === 'trimStart') {
        if (!sample) return;
        // Left edge: the right edge stays put; start, offset and length move
        // together. Clamp the beat delta once, then derive the source delta
        // from it, so the two can never disagree.
        const spbRate = secondsPerBeat(p.bpm) * clipRate(clip, sample, p.bpm); // source seconds per beat
        const minD = Math.max(-clip.offset_sec / spbRate, -clip.start_beat);
        const maxD = Math.max(0, (clip.length_sec - MIN_CLIP_SEC) / spbRate);
        const snapped = snapBeat(clip.start_beat + pxToBeat(dx, ppb), snap);
        const dBeat = Math.min(Math.max(snapped - clip.start_beat, minD), maxD);
        const srcDelta = dBeat * spbRate;
        result = {
          type: 'trimStart',
          id: clip.id,
          startBeat: clip.start_beat + dBeat,
          offsetSec: Math.max(0, clip.offset_sec + srcDelta),
          lengthSec: clip.length_sec - srcDelta,
        };
      } else {
        if (!sample) return;
        const rate = clipRate(clip, sample, p.bpm);
        const endBeatNow = clip.start_beat + clipDurationBeats(clip, sample, p.bpm);
        const newEnd = snapBeat(endBeatNow + pxToBeat(dx, ppb), snap);
        // beats -> timeline seconds -> source seconds via the clip rate
        const raw = (newEnd - clip.start_beat) * secondsPerBeat(p.bpm) * rate;
        const maxLen = Math.max(MIN_CLIP_SEC, sample.duration_sec - clip.offset_sec);
        result = { type: 'trim', id: clip.id, lengthSec: Math.min(Math.max(raw, MIN_CLIP_SEC), maxLen) };
      }
      setDrag(result);
    };

    const finish = (commit) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      setDrag(null);
      if (!commit) return;
      if (!started) {
        // Plain click: collapse to this clip, or Shift-click toggles it off.
        if (e.shiftKey && wasSelected) live.current.onSelectClips(sel.filter((id) => id !== clip.id));
        else if (!e.shiftKey && wasSelected && mode === 'move') live.current.onSelectClips([clip.id], p.tracks[trackIndex]?.id);
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
      } else if (result.type === 'trim' && result.lengthSec !== clip.length_sec) {
        live.current.onTrimClip(clip.id, { length_sec: result.lengthSec });
      } else if (result.type === 'trimStart' && result.startBeat !== clip.start_beat) {
        live.current.onTrimClip(clip.id, {
          start_beat: result.startBeat,
          offset_sec: result.offsetSec,
          length_sec: result.lengthSec,
        });
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }, []);

  // Empty lane: deselect clips, select the track under the pointer.
  const onLanesPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('[data-clip]')) return;
    const { trackIndex } = pointAt(e.clientX, e.clientY);
    onSelectClips([], tracks[trackIndex]?.id);
  };

  // ---- sample drop from the browser (HTML5 drag and drop) ----
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
  const clipHeight = LANE_HEIGHT - CLIP_INSET * 2;

  const clipViews = [];
  tracks.forEach((track, ti) => {
    const dimmed = !isTrackAudible(track, tracks);
    for (const clip of track.clips) {
      const sample = samples[clip.sample_id];
      let start = clip.start_beat;
      let index = ti;
      let lengthSec = clip.length_sec;
      let offsetSec = clip.offset_sec;
      let dragging = false;
      if (drag?.type === 'move' && drag.ids.has(clip.id)) {
        start += drag.dBeat;
        index += drag.dTrack;
        dragging = true;
      } else if (drag?.type === 'trim' && drag.id === clip.id) {
        lengthSec = drag.lengthSec;
        dragging = true;
      } else if (drag?.type === 'trimStart' && drag.id === clip.id) {
        start = drag.startBeat;
        offsetSec = drag.offsetSec;
        lengthSec = drag.lengthSec;
        dragging = true;
      }
      const beats = clipDurationBeats(lengthSec === clip.length_sec ? clip : { ...clip, length_sec: lengthSec }, sample, bpm);
      clipViews.push(
        <ClipView
          key={clip.id}
          clip={clip}
          sample={sample}
          left={beatToPx(start, pxPerBeat)}
          top={index * LANE_HEIGHT + CLIP_INSET}
          width={beatToPx(beats, pxPerBeat)}
          height={clipHeight}
          offsetSec={offsetSec}
          lengthSec={lengthSec}
          selected={selectedSet.has(clip.id)}
          dimmed={dimmed}
          dragging={dragging}
          engine={engine}
          onClipPointerDown={onClipPointerDown}
        />
      );
    }
  });

  const loopShown = loop && loop.enabled && loop.end_beat > loop.start_beat;

  return (
    <div ref={scrollRef} className="relative min-w-0 overflow-x-auto overflow-y-hidden border-y border-line">
      <div className="flex w-max min-w-full">
        {/* Headers column, pinned while the lanes scroll under it */}
        <div ref={headerRef} className="sticky left-0 z-30 w-40 shrink-0 border-r border-line bg-paper md:w-56">
          <div
            className="flex items-end border-b border-ink/60 px-2 pb-0.5 text-caption text-muted md:px-3"
            style={{ height: RULER_HEIGHT }}
          >
            {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
          </div>
          {tracks.map((track) => (
            <TrackHeader
              key={track.id}
              track={track}
              audible={isTrackAudible(track, tracks)}
              selected={track.id === selectedTrackId}
              onSelect={onSelectTrack}
              onUpdate={onUpdateTrack}
              onDelete={onDeleteTrack}
            />
          ))}
          <div className="flex items-center px-2 md:px-3" style={{ height: NEW_TRACK_ROW_HEIGHT }}>
            <TextButton muted onClick={onAddTrack} label="Add track" className="text-caption">
              <span className="inline-flex items-center gap-1.5">
                <FiPlus className="icon" strokeWidth={1.5} aria-hidden="true" />
                <span>Add track</span>
              </span>
            </TextButton>
          </div>
        </div>

        {/* Timeline column: x = 0 is beat 0 */}
        <div className="relative flex-1" style={{ minWidth: width }}>
          <Ruler
            pxPerBeat={pxPerBeat}
            beatsPerBar={beatsPerBar}
            totalBeats={totalBeats}
            loop={loop}
            step={step}
            onSeek={onSeek}
            onLoopChange={onLoopChange}
          />
          <div
            ref={lanesRef}
            onPointerDown={onLanesPointerDown}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className="relative"
            style={{ height: lanesHeight, ...gridStyle(pxPerBeat, beatsPerBar) }}
          >
            {tracks.map((track, i) => (
              <div
                key={track.id}
                aria-hidden="true"
                className={`pointer-events-none absolute inset-x-0 border-b border-line ${
                  track.id === selectedTrackId ? 'bg-ink/[0.025]' : ''
                }`}
                style={{ top: i * LANE_HEIGHT, height: LANE_HEIGHT }}
              />
            ))}

            {loopShown && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 bg-ink/[0.04]"
                style={{
                  left: beatToPx(loop.start_beat, pxPerBeat),
                  width: beatToPx(loop.end_beat - loop.start_beat, pxPerBeat),
                }}
              />
            )}

            {!hasClips && tracks.length > 0 && !dropHint && (
              <p
                className="pointer-events-none absolute left-4 m-0 text-muted"
                style={{ top: LANE_HEIGHT / 2 - 12 }}
              >
                Drag samples from the browser onto a track.
              </p>
            )}

            {clipViews}

            {dropHint && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute z-20 border border-dashed border-ink bg-ink/5"
                style={{
                  left: beatToPx(dropHint.beat, pxPerBeat),
                  top: dropHint.trackIndex * LANE_HEIGHT + CLIP_INSET,
                  width: Math.max(4, beatToPx(dropHint.beats, pxPerBeat)),
                  height: (dropHint.trackIndex < tracks.length ? LANE_HEIGHT : NEW_TRACK_ROW_HEIGHT) - CLIP_INSET * 2,
                }}
              />
            )}
            {dropHint && dropHint.trackIndex >= tracks.length && (
              <p
                className="pointer-events-none absolute m-0 whitespace-nowrap text-caption text-muted"
                style={{ left: beatToPx(dropHint.beat, pxPerBeat) + 8, top: tracks.length * LANE_HEIGHT + 14 }}
              >
                New track
              </p>
            )}
          </div>
          <Playhead clock={clock} pxPerBeat={pxPerBeat} scrollRef={scrollRef} headerRef={headerRef} />
        </div>
      </div>
    </div>
  );
}

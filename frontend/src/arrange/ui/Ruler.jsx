import React, { memo, useRef, useState } from 'react';
import { DRAG_THRESHOLD_PX, LONG_PRESS_MS, TOUCH_SLOP_PX, dragSession, followPointer, onTapClick, releaseFocus, sidewaysTouch } from './pointerDrag';
import { RULER_HEIGHT, RULER_HEIGHT_TOUCH, beatToPx, pxToBeat, snapBeat } from './snap';

const MIN_LABEL_GAP_PX = 36;

/**
 * Marker label: click jumps, double-click renames in place, a drag moves it
 * (`onPress`, see the Ruler). The drawn flag stays 15 px; on touch the button
 * around it is a 44 px target.
 */
function MarkerFlag({ marker, left, lifted, onSeek, onRename, onPress }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(marker.name);
  const done = useRef(false);
  const dragged = useRef(false); // this press moved the marker: its click doesn't jump
  const finish = (commit) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const name = draft.trim();
    if (commit && name !== marker.name) onRename?.(marker.id, name);
  };
  // The drawn flag sits above the loop handles (z-20), so one by a loop edge
  // stays clickable. Nothing around it sets a z-index (that would trap it in
  // its own stacking context): the rest of the 44 px button stays under the
  // handles, which keep the ruler below the flag row.
  const flag = 'relative z-30 flex h-[15px] max-w-[120px] items-center border-l-2 border-ink bg-paper pl-1 pr-1';
  return (
    <div data-marker={marker.id} className="absolute top-0" style={{ left }} onPointerDown={(e) => e.stopPropagation()}>
      {editing ? (
        <div className={flag}>
          <input
            autoFocus
            value={draft}
            aria-label="Marker name"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => finish(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finish(true);
              if (e.key === 'Escape') finish(false);
              e.stopPropagation();
            }}
            className="ainput w-24 !pb-0 text-caption leading-none"
          />
        </div>
      ) : (
        <button
          type="button"
          onPointerDown={(e) => onPress(e, marker, dragged)}
          onClick={() => !dragged.current && onSeek(marker.beat)}
          onDoubleClick={() => {
            done.current = false;
            setDraft(marker.name);
            setEditing(true);
          }}
          title={`${marker.name || 'Marker'} — click to jump, drag to move, double-click to rename`}
          className="weight-hover flex items-start border-0 bg-transparent p-0 text-left text-caption leading-none text-ink coarse:min-h-[44px] coarse:min-w-[44px]"
        >
          <span className={`${flag} ${lifted ? 'opacity-80' : ''}`}>
            <span className="truncate">{marker.name || 'Marker'}</span>
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * Bar/beat ruler. Click/tap seeks (snapped). The loop region has a handle
 * at each edge to drag (snapped); with a mouse, dragging across empty ruler
 * draws a new loop. On touch a swipe scrolls instead — no accidental loops —
 * and a loop handle drags sideways only (a vertical swipe from it scrolls).
 * Markers sit on top: click to jump, double-click to rename, drag to move
 * (a finger: long-press, then drag). While a pen is in use (`pen`, see
 * Timeline) the ruler doesn't pan, so a pen draws loops.
 *
 * Drags go through the Timeline's `claim` (one drag at a time, no touch
 * scroll or Follow meanwhile) and scroll `scrollRef` at its edges.
 */
export default memo(function Ruler({
  pxPerBeat,
  beatsPerBar,
  totalBeats,
  loop,
  step,
  markers = [],
  coarse,
  pen = false,
  scrollRef,
  headerWidth = 0,
  claim = () => () => {},
  onSeek,
  onLoopChange,
  onRenameMarker,
  onMoveMarker,
}) {
  const ref = useRef(null);
  const [draft, setDraft] = useState(null); // {start, end} while dragging a loop or an edge
  const [moving, setMoving] = useState(null); // {id, beat} while dragging a marker

  const barPx = pxPerBeat * beatsPerBar;
  const bars = Math.ceil(totalBeats / beatsPerBar);
  // Label every Nth bar so numbers never collide when zoomed out.
  const labelEvery = [1, 2, 4, 8, 16, 32].find((n) => n * barPx >= MIN_LABEL_GAP_PX) ?? 32;
  const hasLoop = loop && loop.end_beat > loop.start_beat;
  const minLen = step || 0.25;
  const height = coarse ? RULER_HEIGHT_TOUCH : RULER_HEIGHT;

  // The ruler's own rect scrolls with the content, so this is scroll-proof.
  const beatAt = (clientX) => {
    const rect = ref.current.getBoundingClientRect();
    return Math.max(0, pxToBeat(clientX - rect.left, pxPerBeat));
  };

  // One drag's hold on the timeline: `move(clientX)` returns true once under way.
  const session = (move) =>
    dragSession({ scroller: scrollRef?.current, claim, inset: { left: headerWidth }, axes: { y: false } }, (cx) => move(cx));

  // One pointer's drag from its pointerdown.
  const drag = (e, move, up, cancel) => {
    const s = session(move);
    if (!s) return false;
    followPointer(e, {
      move: (ev) => s.move(ev.clientX, ev.clientY),
      up: (ev) => {
        s.end();
        setDraft(null);
        up(ev);
      },
      cancel: () => {
        s.end();
        setDraft(null);
        cancel?.();
      },
    });
    return true;
  };

  // Loop edge drag: mouse and pen at once, a finger once it goes sideways.
  const onEdgeDown = (e, edge) => {
    if (e.button !== 0 || !hasLoop) return;
    e.stopPropagation();
    releaseFocus();
    let cur = { start: loop.start_beat, end: loop.end_beat };
    const x0 = e.clientX;
    let moved = false;
    const move = (cx) => {
      if (!moved && Math.abs(cx - x0) < DRAG_THRESHOLD_PX) return false;
      moved = true;
      const b = snapBeat(beatAt(cx), step);
      cur =
        edge === 'start'
          ? { start: Math.min(Math.max(0, b), loop.end_beat - minLen), end: loop.end_beat }
          : { start: loop.start_beat, end: Math.max(b, loop.start_beat + minLen) };
      setDraft(cur);
      return true;
    };
    // A click / tap on a handle (no drag) still moves the playhead there.
    const seek = () => onSeek(snapBeat(beatAt(x0), step, 'round'));
    const commit = () => {
      if (cur.start !== loop.start_beat || cur.end !== loop.end_beat) onLoopChange({ ...loop, start_beat: cur.start, end_beat: cur.end });
    };
    if (e.pointerType === 'touch') {
      sidewaysTouch(e, {
        start: () => session(move),
        end: (ok) => {
          setDraft(null);
          if (ok) commit();
        },
        tap: seek,
      });
      return;
    }
    e.preventDefault();
    drag(e, move, () => (moved ? commit() : seek()));
  };

  // Marker drag, snapped and saved as one edit on release: mouse and pen at
  // once, a finger after a still long-press (a swipe from a flag scrolls,
  // as from a clip). `dragged` keeps the flag's click from jumping.
  const onMarkerDown = (e, marker, dragged) => {
    dragged.current = false;
    if (e.button !== 0) return;
    releaseFocus();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const b0 = beatAt(x0);
    let beat = marker.beat;
    const move = (cx) => {
      if (!dragged.current && Math.abs(cx - x0) < DRAG_THRESHOLD_PX) return false;
      dragged.current = true;
      beat = Math.max(0, snapBeat(marker.beat + beatAt(cx) - b0, step));
      setMoving({ id: marker.id, beat });
      return true;
    };
    const end = (commit) => {
      setMoving(null);
      if (commit && beat !== marker.beat) onMoveMarker?.(marker.id, beat);
    };
    if (e.pointerType !== 'touch') {
      e.preventDefault();
      drag(e, move, () => end(true), () => end(false));
      return;
    }
    let s = null;
    let still = true;
    const timer = setTimeout(() => {
      if (!still) return;
      s = session(move);
      if (!s) return;
      navigator.vibrate?.(8);
      setMoving({ id: marker.id, beat }); // lifted
    }, LONG_PRESS_MS);
    const finish = (commit) => {
      clearTimeout(timer);
      if (!s) return;
      s.end();
      end(commit);
    };
    followPointer(e, {
      move: (ev) => {
        if (s) s.move(ev.clientX, ev.clientY);
        else if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > TOUCH_SLOP_PX) {
          still = false;
          clearTimeout(timer);
        }
      },
      up: () => finish(true),
      cancel: () => finish(false),
    });
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    releaseFocus();
    const x0 = e.clientX;
    const anchor = beatAt(x0);
    if (e.pointerType === 'touch') {
      // Tap seeks (on its click: not a tap that stops a fling); anything
      // that moves, either way, is the browser's scroll. Not while another
      // finger drags something (a palm, a stray thumb).
      const y0 = e.clientY;
      let moved = false;
      followPointer(e, {
        move: (ev) => {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > TOUCH_SLOP_PX) moved = true;
        },
        up: () => {
          if (moved) return;
          onTapClick(() => {
            const release = claim();
            if (!release) return;
            release();
            onSeek(snapBeat(anchor, step, 'round'));
          });
        },
      });
      return;
    }
    // Mouse and pen: drag draws a loop (a pen holds the scroll meanwhile).
    e.preventDefault();
    let dragging = false;
    let current = null;
    const range = (clientX) => {
      const a = snapBeat(anchor, step);
      const b = snapBeat(beatAt(clientX), step);
      const start = Math.min(a, b);
      return { start, end: Math.max(Math.max(a, b), start + minLen) };
    };
    drag(
      e,
      (cx) => {
        if (!dragging && Math.abs(cx - x0) < DRAG_THRESHOLD_PX) return false;
        dragging = true;
        current = range(cx);
        setDraft(current);
        return true;
      },
      (ev) => {
        if (dragging) {
          const r = current || range(ev.clientX);
          onLoopChange({ enabled: true, start_beat: r.start, end_beat: r.end });
        } else {
          onSeek(snapBeat(anchor, step, 'round'));
        }
      }
    );
  };

  const shownLoop = draft
    ? { start: draft.start, end: draft.end, enabled: loop?.enabled || !hasLoop }
    : hasLoop
      ? { start: loop.start_beat, end: loop.end_beat, enabled: loop.enabled }
      : null;

  const labels = [];
  for (let i = 0; i < bars; i += labelEvery) labels.push(i);
  const edgeHit = coarse ? 44 : 12;

  return (
    <div
      ref={ref}
      data-ruler=""
      onPointerDown={onPointerDown}
      title={coarse ? 'Tap to move the playhead · drag the loop handles' : 'Click to move the playhead · drag to set the loop'}
      className="relative cursor-pointer select-none border-b border-ink text-caption"
      style={{ height, touchAction: pen ? 'none' : 'pan-x pan-y' }}
    >
      {/* Loop region: an enabled loop is the wash fill under an ink top edge;
          a disabled one keeps only its hairline ends. */}
      {shownLoop && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 ${shownLoop.enabled ? 'border-t-2 border-ink bg-wash' : 'border-x border-line'}`}
          style={{ left: beatToPx(shownLoop.start, pxPerBeat), width: beatToPx(shownLoop.end - shownLoop.start, pxPerBeat) }}
        />
      )}
      {/* Ticks above the loop fill so it never hides them: bar ticks full
          height in `line`, beat ticks along the bottom third in `wash`. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to right, var(--wash) 1px, transparent 1px)',
          backgroundSize: `${barPx}px 100%, ${pxPerBeat}px 33%`,
          backgroundPosition: '0 0, 0 100%',
          backgroundRepeat: 'repeat-x',
        }}
      />
      {labels.map((i) => (
        <span
          key={i}
          className="pointer-events-none absolute bottom-0.5 pl-1 leading-tight tabular-nums text-ink"
          style={{ left: beatToPx(i * beatsPerBar, pxPerBeat) }}
        >
          {i + 1}
        </span>
      ))}
      {markers.map((m) => (
        <MarkerFlag
          key={m.id}
          marker={m}
          left={beatToPx(moving?.id === m.id ? moving.beat : m.beat, pxPerBeat)}
          lifted={moving?.id === m.id}
          onSeek={onSeek}
          onRename={onRenameMarker}
          onPress={onMarkerDown}
        />
      ))}
      {shownLoop &&
        ['start', 'end'].map((edge) => {
          const x = beatToPx(edge === 'start' ? shownLoop.start : shownLoop.end, pxPerBeat);
          return (
            <div
              key={edge}
              role="slider"
              aria-label={edge === 'start' ? 'Loop start' : 'Loop end'}
              aria-valuenow={edge === 'start' ? shownLoop.start : shownLoop.end}
              onPointerDown={(e) => onEdgeDown(e, edge)}
              className="absolute -bottom-px top-0 z-20 flex cursor-ew-resize justify-center"
              style={{ left: x - edgeHit / 2, width: edgeHit, touchAction: pen ? 'none' : 'pan-y' }}
            >
              <span className={`block h-full w-[3px] ${shownLoop.enabled ? 'bg-ink' : 'bg-muted'}`} />
            </div>
          );
        })}
    </div>
  );
});

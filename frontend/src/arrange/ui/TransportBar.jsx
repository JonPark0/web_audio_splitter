import React, { useEffect, useRef, useState } from 'react';
import { FiMinus, FiPlay, FiPlus, FiSquare } from 'react-icons/fi';
import TextButton from '../../components/TextButton';
import { MAX_BPM, MIN_BPM } from '../project';
import { useClockListener } from './playheadClock';
import { SNAP_OPTIONS, ZOOM_LEVELS, formatPosition } from './snap';

/** bars.beats.16ths readout, written straight to the DOM from the clock. */
function PositionReadout({ clock, beatsPerBar }) {
  const ref = useRef(null);
  useClockListener(
    clock,
    (beat) => {
      const text = formatPosition(beat, beatsPerBar);
      if (ref.current && ref.current.textContent !== text) ref.current.textContent = text;
    },
    [beatsPerBar]
  );
  return (
    <span
      ref={ref}
      aria-label="Position (bar.beat.sixteenth)"
      className="inline-block min-w-[5.5rem] text-h3 tabular-nums leading-tight"
    >
      1.1.1
    </span>
  );
}

const roundBpm = (v) => Math.round(v * 100) / 100;

/** Project tempo: typed, committed on Enter/blur, reverted on Escape or bad input. */
function BpmInput({ bpm, onCommit }) {
  const [draft, setDraft] = useState(String(bpm));
  const focused = useRef(false);
  const cancel = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(String(bpm));
  }, [bpm]);

  // Enter commits directly rather than via blur(), which doesn't always
  // dispatch focus events (e.g. unfocused window); `focused` makes the
  // following blur a no-op.
  const commit = () => {
    if (!focused.current) return;
    focused.current = false;
    const value = Number(draft);
    if (cancel.current || draft.trim() === '' || !Number.isFinite(value)) {
      cancel.current = false;
      setDraft(String(bpm));
      return;
    }
    const next = roundBpm(Math.min(MAX_BPM, Math.max(MIN_BPM, value)));
    setDraft(String(next));
    if (next !== bpm) onCommit(next);
  };

  return (
    <label className="flex items-baseline gap-2">
      <input
        type="number"
        inputMode="decimal"
        min={MIN_BPM}
        max={MAX_BPM}
        step="0.01"
        value={draft}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          focused.current = true;
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            cancel.current = e.key === 'Escape';
            commit();
            e.currentTarget.blur();
          }
        }}
        aria-label="Project BPM"
        className="ainput w-16 !pb-0.5 tabular-nums"
      />
      <span className="text-caption text-muted">BPM</span>
    </label>
  );
}

/** Transport and view controls: play/stop, position, tempo, loop, click, snap, zoom. */
export default function TransportBar({
  clock,
  playing,
  loading,
  bpm,
  beatsPerBar,
  loopEnabled,
  metronome,
  snap,
  zoom,
  onTogglePlay,
  onBpmCommit,
  onToggleLoop,
  onToggleMetronome,
  onSnapChange,
  onZoom,
}) {
  const zoomIndex = ZOOM_LEVELS.indexOf(zoom);

  return (
    <div className="flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-line pt-3">
      <div className="flex items-center gap-4">
        <TextButton
          onClick={onTogglePlay}
          label=""
          aria-label={playing ? 'Stop (Space)' : 'Play (Space)'}
          aria-pressed={playing}
          title={playing ? 'Stop (Space)' : 'Play (Space)'}
          current={playing}
          className="text-h3"
        >
          {playing ? (
            <FiSquare className="icon" strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <FiPlay className="icon" strokeWidth={1.5} aria-hidden="true" />
          )}
        </TextButton>
        <PositionReadout clock={clock} beatsPerBar={beatsPerBar} />
      </div>

      <BpmInput bpm={bpm} onCommit={onBpmCommit} />

      <div className="flex items-baseline gap-5">
        <TextButton muted current={loopEnabled} aria-pressed={loopEnabled} onClick={onToggleLoop} title="Loop the ruler region">
          Loop
        </TextButton>
        <TextButton muted current={metronome} aria-pressed={metronome} onClick={onToggleMetronome} title="Metronome">
          Click
        </TextButton>
      </div>

      <label className="flex items-baseline gap-2">
        <span className="text-caption text-muted">Snap</span>
        <select value={snap} onChange={(e) => onSnapChange(e.target.value)} className="ainput w-24 !pb-0.5" aria-label="Snap">
          {SNAP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-3">
        <span className="text-caption text-muted">Zoom</span>
        <TextButton
          muted
          label=""
          onClick={() => onZoom(-1)}
          disabled={zoomIndex <= 0}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <FiMinus className="icon" strokeWidth={1.5} aria-hidden="true" />
        </TextButton>
        <TextButton
          muted
          label=""
          onClick={() => onZoom(1)}
          disabled={zoomIndex >= ZOOM_LEVELS.length - 1}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <FiPlus className="icon" strokeWidth={1.5} aria-hidden="true" />
        </TextButton>
      </div>

      {loading > 0 && (
        <span role="status" className="text-caption text-muted">
          Loading audio…
        </span>
      )}
    </div>
  );
}

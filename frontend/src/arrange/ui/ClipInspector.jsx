import React, { useEffect, useRef, useState } from 'react';
import { FiMinus, FiPlus } from 'react-icons/fi';
import TextButton from '../../components/TextButton';
import { formatBpm } from '../../components/library/format';
import { canWarp, clipDurationBeats, clipRate } from '../project';
import { formatBarBeat, formatBeats } from './snap';

function formatGain(gain) {
  if (gain <= 0) return '−∞ dB';
  const db = 20 * Math.log10(gain);
  const r = Math.round(db * 10) / 10;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)} dB`;
}

function findClip(project, id) {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return { clip, track };
  }
  return null;
}

export const MIN_SEMITONES = -24;
export const MAX_SEMITONES = 24;
const clampSemitones = (v) => Math.min(MAX_SEMITONES, Math.max(MIN_SEMITONES, Math.round(v)));

function formatSemitones(st) {
  if (!st) return '0 st';
  return `${st > 0 ? '+' : '−'}${Math.abs(st)} st`;
}

/** Semitones typed: Enter/blur commits (rounded, clamped), Escape or bad input reverts. */
function SemitoneInput({ value, onCommit }) {
  const shown = value == null ? '' : String(value);
  const [draft, setDraft] = useState(shown);
  const focused = useRef(false);
  const cancel = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(shown);
  }, [shown]);

  const commit = () => {
    if (!focused.current) return;
    focused.current = false;
    const n = Number(draft);
    if (cancel.current || draft.trim() === '' || !Number.isFinite(n)) {
      cancel.current = false;
      setDraft(shown);
      return;
    }
    const next = clampSemitones(n);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      min={MIN_SEMITONES}
      max={MAX_SEMITONES}
      step="1"
      value={draft}
      placeholder="—"
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
      aria-label="Pitch in semitones"
      className="ainput w-12 !pb-0.5 text-center tabular-nums"
    />
  );
}

/**
 * Pitch shift for one or several clips: -/+ a semitone, typed value, reset.
 * Shifted clips are rendered on the server and stay silent until the render
 * arrives, so say so while the engine is fetching.
 */
function PitchControl({ clips, loading, onApply }) {
  const values = clips.map((c) => c.semitones || 0);
  const common = values.every((v) => v === values[0]) ? values[0] : null;
  const shifted = values.some((v) => v !== 0);
  const apply = (fn) => onApply(clips.map((c) => ({ clipId: c.id, patch: { semitones: clampSemitones(fn(c.semitones || 0)) } })));

  let status = 'Original pitch';
  if (shifted) status = loading > 0 ? 'Rendering…' : 'Rendered on the server';
  if (common === null) status = `Mixed · ${status.toLowerCase()}`;

  return (
    <div
      className="flex min-w-0 flex-col"
      title="Pitch shift in semitones. Shifted clips are rendered on the server and play once the render has loaded."
    >
      <span className="flex justify-between gap-2 text-caption text-muted">
        <span>Pitch</span>
        <span className="tabular-nums">{common === null ? 'Mixed' : formatSemitones(common)}</span>
      </span>
      <span className="flex items-center gap-2">
        <TextButton
          muted
          label=""
          onClick={() => apply((v) => v - 1)}
          disabled={values.every((v) => v <= MIN_SEMITONES)}
          aria-label="Pitch down a semitone"
          title="Down a semitone"
        >
          <FiMinus className="icon" strokeWidth={1.5} aria-hidden="true" />
        </TextButton>
        <SemitoneInput value={common} onCommit={(st) => apply(() => st)} />
        <TextButton
          muted
          label=""
          onClick={() => apply((v) => v + 1)}
          disabled={values.every((v) => v >= MAX_SEMITONES)}
          aria-label="Pitch up a semitone"
          title="Up a semitone"
        >
          <FiPlus className="icon" strokeWidth={1.5} aria-hidden="true" />
        </TextButton>
        <TextButton muted onClick={() => apply(() => 0)} disabled={!shifted} className="text-caption">
          Reset
        </TextButton>
      </span>
      <span role="status" className="truncate text-caption text-muted">
        {status}
      </span>
    </div>
  );
}

function Stat({ label, children }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-caption text-muted">{label}</span>
      <span className="truncate tabular-nums">{children}</span>
    </div>
  );
}

/** Selected-clip details: timing, warp, pitch, gain; bulk actions for a multi-selection. */
export default function ClipInspector({ project, selection, loading = 0, onUpdateClip, onUpdateClips, onDuplicate, onDelete }) {
  const actions = (
    <div className="flex items-baseline gap-5 text-caption">
      <TextButton muted onClick={onDuplicate} title="Duplicate (Ctrl/Cmd+D)">
        Duplicate
      </TextButton>
      <TextButton muted onClick={onDelete} title="Delete (Del / Backspace)">
        Delete
      </TextButton>
    </div>
  );

  if (selection.length === 0) {
    return (
      <p className="m-0 text-caption text-muted">
        Click a clip to select it · Shift adds · drag to move · drag its edges to trim · Space plays ·
        Ctrl/Cmd+Z undoes · Ctrl/Cmd+wheel zooms
      </p>
    );
  }

  if (selection.length > 1) {
    const clips = selection.map((id) => findClip(project, id)?.clip).filter(Boolean);
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
          <span>{selection.length} clips selected</span>
          {actions}
        </div>
        {clips.length > 0 && (
          <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-4">
            <PitchControl clips={clips} loading={loading} onApply={onUpdateClips} />
          </div>
        )}
      </div>
    );
  }

  const found = findClip(project, selection[0]);
  if (!found) return null;
  const { clip, track } = found;
  const sample = project.samples?.[clip.sample_id];
  const bpb = project.beats_per_bar || 4;
  const warpable = canWarp(sample);
  const rate = clipRate(clip, sample, project.bpm);
  const beats = clipDurationBeats(clip, sample, project.bpm);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <p className="m-0 min-w-0 truncate text-h4">
          {sample?.name || 'Missing sample'}
          <span className="text-caption text-muted"> · {track.name}</span>
        </p>
        {actions}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 xl:grid-cols-[repeat(4,minmax(0,1fr))_repeat(3,minmax(0,1.5fr))]">
        <Stat label="Start">{formatBarBeat(clip.start_beat, bpb)}</Stat>
        <Stat label="Length">{formatBeats(beats)} beats</Stat>
        <Stat label="Source">
          {clip.offset_sec.toFixed(2)}–{(clip.offset_sec + clip.length_sec).toFixed(2)} s
        </Stat>
        <Stat label="Tempo">
          {sample?.bpm != null ? formatBpm(sample.bpm) : '—'} → {formatBpm(project.bpm)} BPM
        </Stat>

        <div className="flex min-w-0 flex-col">
          <span className="text-caption text-muted">Warp</span>
          <span className="flex flex-wrap items-baseline gap-x-3">
            <TextButton
              current={clip.warp && warpable}
              aria-pressed={clip.warp && warpable}
              disabled={!warpable}
              onClick={() => onUpdateClip(clip.id, { warp: !clip.warp })}
              title={warpable ? 'Stretch to follow the project tempo' : 'This sample has no BPM — set one in the Library'}
              label="Off"
            >
              {clip.warp && warpable ? 'On' : 'Off'}
            </TextButton>
            <span className="text-caption text-muted">
              {!warpable ? 'No sample BPM' : clip.warp ? `×${rate.toFixed(2)} speed` : 'Original speed'}
            </span>
          </span>
        </div>

        <PitchControl clips={[clip]} loading={loading} onApply={onUpdateClips} />

        <label className="flex min-w-0 flex-col" title="Clip gain (double-click resets)">
          <span className="flex justify-between text-caption text-muted">
            <span>Gain</span>
            <span className="tabular-nums">{formatGain(clip.gain)}</span>
          </span>
          <input
            type="range"
            min="0"
            max="2"
            step="0.01"
            value={clip.gain}
            onChange={(e) => onUpdateClip(clip.id, { gain: parseFloat(e.target.value) }, `gain:${clip.id}`)}
            onDoubleClick={() => onUpdateClip(clip.id, { gain: 1 })}
            className="slider"
            aria-label="Clip gain"
          />
        </label>
      </div>
    </div>
  );
}

import React from 'react';
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

function Stat({ label, children }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-caption text-muted">{label}</span>
      <span className="truncate tabular-nums">{children}</span>
    </div>
  );
}

/** Selected-clip details: timing, warp, gain; bulk actions for a multi-selection. */
export default function ClipInspector({ project, selection, onUpdateClip, onDuplicate, onDelete }) {
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
        Click a clip to select it · Shift adds · drag to move · drag its right edge to trim · Space plays
      </p>
    );
  }

  if (selection.length > 1) {
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <span>{selection.length} clips selected</span>
        {actions}
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

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.5fr)_minmax(0,1.5fr)]">
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
            onChange={(e) => onUpdateClip(clip.id, { gain: parseFloat(e.target.value) })}
            onDoubleClick={() => onUpdateClip(clip.id, { gain: 1 })}
            className="slider"
            aria-label="Clip gain"
          />
        </label>
      </div>
    </div>
  );
}

import React, { useRef, useState } from 'react';
import { FiMinus, FiPlus } from 'react-icons/fi';
import TextButton from '../../components/TextButton';
import { MAX_BPM, MIN_BPM, canWarp, clipDurationBeats, clipDurationSeconds, clipRate, clipRegionBeats, isLooped } from '../project';
import { CommitField, Group } from './fields';
import { MIN_DB, dbToGain, formatBarBeat, formatBeats, formatBpm, formatDb, gainToDb } from './snap';

export const MIN_SEMITONES = -24;
export const MAX_SEMITONES = 24;
const clampSemitones = (v) => Math.min(MAX_SEMITONES, Math.max(MIN_SEMITONES, Math.round(v)));
const clampCents = (v) => Math.min(100, Math.max(-100, Math.round(v)));
const roundBpm = (v) => Math.round(v * 100) / 100;
const inBpmRange = (v) => v >= MIN_BPM && v <= MAX_BPM;
const FIT_BARS = [1, 2, 4, 8];

function findClip(project, id) {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return { clip, track };
  }
  return null;
}

const signed = (v, unit) => (v ? `${v > 0 ? '+' : '−'}${Math.abs(v)}${unit}` : `0${unit}`);

const iconBtn = 'min-w-[20px] items-center justify-center [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px]';
const wordBtn = '[@media(pointer:coarse)]:min-h-[44px] justify-center';

/** On/Off word toggle (Palnarium: current weight when on). */
function Toggle({ on, onChange, disabled, title, label }) {
  return (
    <TextButton
      current={on}
      aria-pressed={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      title={title}
      label="Off"
      className={wordBtn}
    >
      {on ? 'On' : 'Off'}
    </TextButton>
  );
}

/** Pitch for one or several clips: −/+ a semitone, typed semitones and cents. */
function PitchControl({ clips, onApply, className = '' }) {
  const st = clips.map((c) => c.semitones || 0);
  const ct = clips.map((c) => c.cents || 0);
  const commonSt = st.every((v) => v === st[0]) ? st[0] : null;
  const commonCt = ct.every((v) => v === ct[0]) ? ct[0] : null;
  const apply = (patchFn) => onApply(clips.map((c) => ({ clipId: c.id, patch: patchFn(c) })));
  return (
    <Group label="Pitch (st · cents)" className={className} title="Pitch shift; rendered on the server, the clip is hatched until the render arrives">
      <TextButton
        muted
        label=""
        onClick={() => apply((c) => ({ semitones: clampSemitones((c.semitones || 0) - 1) }))}
        aria-label="Pitch down a semitone"
        className={iconBtn}
      >
        <FiMinus className="icon" strokeWidth={1.5} aria-hidden="true" />
      </TextButton>
      <CommitField
        value={commonSt}
        label="Semitones"
        inputMode="numeric"
        parse={(t) => (Number.isFinite(Number(t)) ? clampSemitones(Number(t)) : null)}
        onCommit={(v) => apply(() => ({ semitones: v }))}
        className="w-9 text-center"
      />
      <TextButton
        muted
        label=""
        onClick={() => apply((c) => ({ semitones: clampSemitones((c.semitones || 0) + 1) }))}
        aria-label="Pitch up a semitone"
        className={iconBtn}
      >
        <FiPlus className="icon" strokeWidth={1.5} aria-hidden="true" />
      </TextButton>
      <CommitField
        value={commonCt}
        label="Cents"
        inputMode="numeric"
        parse={(t) => (Number.isFinite(Number(t)) ? clampCents(Number(t)) : null)}
        onCommit={(v) => apply(() => ({ cents: v }))}
        className="w-10 text-center"
        title="Fine pitch, −100..100 cents"
      />
    </Group>
  );
}

/** Tap tempo: 2+ taps show a BPM to apply; resets after 2 s idle. */
function TapTempo({ onApply }) {
  const taps = useRef([]);
  const [bpm, setBpm] = useState(null);
  const tap = () => {
    const now = performance.now();
    const list = taps.current.filter((t) => now - t < 2000 * Math.max(1, taps.current.length));
    if (list.length && now - list[list.length - 1] > 2000) list.length = 0;
    list.push(now);
    taps.current = list.slice(-8);
    if (taps.current.length >= 2) {
      const span = taps.current[taps.current.length - 1] - taps.current[0];
      setBpm(roundBpm((60000 * (taps.current.length - 1)) / span));
    } else setBpm(null);
  };
  return (
    <>
      <TextButton muted onClick={tap} className={wordBtn} title="Tap along to the sample">
        Tap
      </TextButton>
      {bpm !== null && inBpmRange(bpm) && (
        <TextButton
          onClick={() => {
            onApply(bpm);
            taps.current = [];
            setBpm(null);
          }}
          className={wordBtn}
          title="Use the tapped tempo"
        >
          {`Set ${formatBpm(bpm)}`}
        </TextButton>
      )}
    </>
  );
}

/** Library BPM of the clip's sample: typed, ×2 / ÷2, tap, or fit the trimmed length to N bars. */
function SampleBpmControl({ clip, sample, beatsPerBar, onSampleBpm, className = '' }) {
  if (!sample) return null;
  const bpm = sample.bpm;
  const set = (v, opts) => inBpmRange(v) && onSampleBpm(sample, roundBpm(v), opts);
  const fit = (bars) => (bars * beatsPerBar * 60) / clip.length_sec;
  return (
    <Group label="Sample BPM (library)" className={className} title="The sample's own tempo, saved to the Library; warped clips stretch from it">
      <CommitField
        value={bpm}
        label="Sample BPM"
        format={(v) => (v == null ? '' : formatBpm(v))}
        parse={(t) => {
          const n = Number(t);
          return Number.isFinite(n) && inBpmRange(n) ? roundBpm(n) : null;
        }}
        onCommit={(v) => set(v)}
        className="w-14"
      />
      <TextButton muted onClick={() => set(bpm * 2)} disabled={bpm == null || !inBpmRange(bpm * 2)} className={wordBtn} title="Double">
        ×2
      </TextButton>
      <TextButton muted onClick={() => set(bpm / 2)} disabled={bpm == null || !inBpmRange(bpm / 2)} className={wordBtn} title="Halve">
        ÷2
      </TextButton>
      <TapTempo onApply={(v) => set(v)} />
      <span className="text-caption text-muted">Fit</span>
      {FIT_BARS.map((n) => (
        <TextButton
          key={n}
          muted
          onClick={() => set(fit(n), { warpClipId: clip.id })}
          disabled={!inBpmRange(fit(n))}
          className={wordBtn}
          title={`Set the BPM so the trimmed region is ${n} ${n === 1 ? 'bar' : 'bars'} long, and warp this clip`}
        >
          {`${n}`}
        </TextButton>
      ))}
    </Group>
  );
}

function ClipActions({ onDuplicate, onDuplicateNextBar, onSplit, onDelete, compact }) {
  return (
    <div className={`flex flex-wrap items-center ${compact ? 'gap-x-4' : 'gap-x-5'} gap-y-1 text-caption`}>
      <TextButton muted onClick={onDuplicate} title="Duplicate right after (Ctrl/Cmd+D)" className={wordBtn}>
        Duplicate
      </TextButton>
      <TextButton muted onClick={onDuplicateNextBar} title="Copy to the next bar line" className={wordBtn}>
        Next bar
      </TextButton>
      <TextButton muted onClick={onSplit} title="Split at the playhead (S or Ctrl/Cmd+E)" className={wordBtn}>
        Split
      </TextButton>
      <TextButton muted onClick={onDelete} title="Delete (Del / Backspace)" className={wordBtn}>
        Delete
      </TextButton>
    </div>
  );
}

/**
 * Selected-clip editor: timing, loop, warp + sample BPM tools, pitch,
 * gain, fades, reverse; bulk pitch and actions for a multi-selection.
 * `variant` 'dock' (desktop bottom dock: dense rows) or 'sheet'.
 */
export default function ClipInspector({
  project,
  selection,
  pending,
  variant = 'dock',
  onPatchClip,
  onPatchClips,
  onDuplicate,
  onDuplicateNextBar,
  onSplit,
  onDelete,
  onSampleBpm,
}) {
  const sheet = variant === 'sheet';
  const actions = (
    <ClipActions onDuplicate={onDuplicate} onDuplicateNextBar={onDuplicateNextBar} onSplit={onSplit} onDelete={onDelete} compact={!sheet} />
  );
  // Sheet: two columns even on a phone (short groups pair up; the wide
  // BPM and pitch rows span both), so the sheet stays short.
  const grid = sheet ? 'grid grid-cols-2 gap-x-4 gap-y-1 px-4 py-2 sm:grid-cols-3' : 'flex flex-wrap items-start gap-x-7 gap-y-1';
  const wide = sheet ? 'col-span-2 sm:col-span-3' : '';

  if (selection.length > 1) {
    const clips = selection.map((id) => findClip(project, id)?.clip).filter(Boolean);
    const allRev = clips.every((c) => c.reverse);
    return (
      <div className={`flex flex-col ${sheet ? '' : 'gap-1'}`}>
        <div className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-1 ${sheet ? 'px-4 pt-3' : ''}`}>
          <span className="text-h4">{selection.length} clips selected</span>
          {actions}
        </div>
        {clips.length > 0 && (
          <div className={grid}>
            <PitchControl clips={clips} onApply={onPatchClips} className={wide} />
            <Group label="Reverse">
              <Toggle
                on={allRev}
                label="Reverse"
                onChange={(on) => onPatchClips(clips.map((c) => ({ clipId: c.id, patch: { reverse: on } })))}
              />
            </Group>
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
  const regionBeats = clipRegionBeats(clip, sample, project.bpm);
  const looped = isLooped(clip);
  const durSec = clipDurationSeconds(clip, sample, project.bpm);
  const patch = (p, opts) => onPatchClip(clip.id, p, opts);
  const msField = (key) => (
    <CommitField
      value={Math.round((clip[key] || 0) * 1000)}
      label={key === 'fade_in_sec' ? 'Fade in (ms)' : 'Fade out (ms)'}
      inputMode="numeric"
      parse={(t) => {
        const n = Number(t);
        return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
      }}
      onCommit={(ms) => {
        const other = key === 'fade_in_sec' ? clip.fade_out_sec || 0 : clip.fade_in_sec || 0;
        patch({ [key]: Math.min(ms / 1000, Math.max(0, durSec - other)) });
      }}
      className="w-14"
    />
  );

  return (
    <div className={`flex flex-col ${sheet ? '' : 'gap-0.5'}`}>
      <div className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-1 ${sheet ? 'px-4 pt-3' : ''}`}>
        <p className="m-0 min-w-0 truncate text-h4 leading-tight">
          {sample?.name || 'Missing sample'}
          <span className="text-caption text-muted">
            {' '}
            · {track.name} · {formatBarBeat(clip.start_beat, bpb)} · {formatBeats(beats)} beats
            {pending?.has(clip.id) ? ' · rendering…' : ''}
          </span>
        </p>
        {actions}
      </div>

      <div className={grid}>
        <Group label={looped ? `Loop · ${formatBeats(regionBeats)}-beat region` : 'Loop'} title="Repeat the trimmed region; drag the clip's right edge to extend">
          <Toggle
            on={looped}
            label="Loop"
            onChange={(on) => patch({ loop_beats: on ? Math.max(regionBeats, 1 / 16) : null }, { resolve: true })}
          />
          {looped && (
            <>
              <CommitField
                value={clip.loop_beats}
                label="Loop length (beats)"
                format={(v) => formatBeats(v)}
                parse={(t) => {
                  const n = Number(t);
                  return Number.isFinite(n) && n >= 1 / 16 ? n : null;
                }}
                onCommit={(v) => patch({ loop_beats: v }, { resolve: true })}
                className="w-12"
              />
              <span className="text-caption text-muted">beats</span>
            </>
          )}
        </Group>

        <Group label="Warp" title={warpable ? 'Stretch to follow the project tempo' : 'This sample has no BPM — set one here'}>
          <Toggle on={clip.warp && warpable} label="Warp" disabled={!warpable} onChange={(on) => patch({ warp: on }, { resolve: true })} />
          <span className="whitespace-nowrap text-caption text-muted">
            {!warpable ? 'No sample BPM' : clip.warp ? `×${rate.toFixed(3)}` : 'Original speed'}
          </span>
        </Group>

        <SampleBpmControl clip={clip} sample={sample} beatsPerBar={bpb} onSampleBpm={onSampleBpm} className={wide} />

        <PitchControl clips={[clip]} onApply={onPatchClips} className={sheet ? 'col-span-2' : ''} />

        <Group label={`Gain · ${formatDb(clip.gain)}`} title="Clip gain (double-click resets)" className={sheet ? '' : 'w-36'}>
          <input
            type="range"
            min={MIN_DB}
            max="12"
            step="0.5"
            value={gainToDb(clip.gain)}
            onChange={(e) => patch({ gain: Math.min(4, Math.round(dbToGain(parseFloat(e.target.value)) * 10000) / 10000) }, { coalesce: `gain:${clip.id}` })}
            onDoubleClick={() => patch({ gain: 1 })}
            className="slider [@media(pointer:coarse)]:h-11"
            aria-label="Clip gain"
            aria-valuetext={formatDb(clip.gain)}
          />
        </Group>

        <Group label="Fade in · out (ms)">
          {msField('fade_in_sec')}
          {msField('fade_out_sec')}
        </Group>

        <Group label="Reverse">
          <Toggle on={!!clip.reverse} label="Reverse" onChange={(on) => patch({ reverse: on })} />
        </Group>

        <Group label="Source (s)">
          <span className="whitespace-nowrap text-caption tabular-nums">
            {clip.offset_sec.toFixed(2)}–{(clip.offset_sec + clip.length_sec).toFixed(2)}
          </span>
        </Group>
      </div>
    </div>
  );
}

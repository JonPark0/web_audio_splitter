import React, { useEffect, useState } from 'react';
import { createSample } from '../api';
import TextButton from './TextButton';

export function formatClock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/**
 * Shown under a track while it's in extract mode: the selected region's
 * bounds, a name, and save-to-library. The region itself lives on the
 * track's waveform (TrackRow owns the wavesurfer Regions plugin, and the
 * selection playback these controls drive).
 */
export default function ExtractPanel({
  taskId,
  trackName,
  variant,
  selection,
  playing,
  loop,
  onTogglePlay,
  onToggleLoop,
  onCancel,
}) {
  const base = trackName.replace('.wav', '');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Suggest a name from the selection start until the user types their own.
  const [nameTouched, setNameTouched] = useState(false);
  useEffect(() => {
    if (selection && !nameTouched) setName(`${base} ${formatClock(selection.start).split('.')[0]}`);
  }, [selection, nameTouched, base]);

  const save = async () => {
    if (!selection) return;
    setSaving(true);
    setMessage('');
    try {
      await createSample({
        taskId,
        track: trackName,
        variant,
        startSec: selection.start,
        endSec: selection.end,
        name: name.trim() || undefined,
      });
      setMessage(`Saved "${name.trim() || base}" to the library.`);
      setNameTouched(false);
    } catch (e) {
      setMessage(e.response?.data?.detail || 'Could not save the sample.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 border-t border-line py-4 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
        {selection ? (
          <p className="m-0 text-caption text-muted">
            {formatClock(selection.start)} – {formatClock(selection.end)} · {(selection.end - selection.start).toFixed(2)}s ·{' '}
            {variant}
          </p>
        ) : (
          <p className="m-0 text-caption text-muted">Drag across the waveform to select a region.</p>
        )}
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameTouched(true);
          }}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="Sample name"
          aria-label="Sample name"
          disabled={!selection}
          className="ainput max-w-sm"
        />
        {message && (
          <p className="m-0 text-caption" role="status">
            {message}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-baseline gap-5">
        <TextButton
          muted
          current={playing}
          aria-pressed={playing}
          onClick={onTogglePlay}
          disabled={!selection}
          title="Play this track from the selection start to its end"
        >
          {playing ? 'Stop' : 'Play selection'}
        </TextButton>
        <TextButton
          muted
          current={loop}
          aria-pressed={loop}
          onClick={onToggleLoop}
          title="Repeat the selection until stopped"
        >
          Loop
        </TextButton>
        <TextButton onClick={save} disabled={!selection || saving}>
          {saving ? 'Saving...' : 'Save sample'}
        </TextButton>
        <TextButton muted onClick={onCancel}>
          Done
        </TextButton>
      </div>
    </div>
  );
}

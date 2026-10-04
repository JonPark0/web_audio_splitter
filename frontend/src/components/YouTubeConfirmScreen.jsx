import React, { useRef, useState } from 'react';
import { deleteTask, errorDetail, youtubeConfirm, youtubePreviewUrl } from '../api';
import { navigate } from '../router';
import TextButton from './TextButton';
import Hairline from './jobs/Hairline';
import { jobsChanged } from './jobs/jobsStore';

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec - m * 60)).padStart(2, '0')}`;
}

/**
 * Text Play/Pause + hairline seek slider + time, in place of the browser's
 * own <audio controls> (a rounded, grey, per-browser widget that has no
 * place in the monochrome system).
 */
function PreviewPlayer({ src }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => setPlaying(false));
    else audio.pause();
  };

  return (
    <div className="flex max-w-2xl items-center gap-4">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
      />
      {/* fixed width so Play <-> Pause doesn't nudge the slider */}
      <span className="w-12 shrink-0 text-left">
        <TextButton onClick={toggle} aria-pressed={playing} className="!items-start" label="Pause">
          {playing ? 'Pause' : 'Play'}
        </TextButton>
      </span>
      <input
        type="range"
        min="0"
        max={duration || 0}
        step="0.1"
        value={Math.min(time, duration || 0)}
        disabled={!duration}
        onChange={(e) => {
          const t = parseFloat(e.target.value);
          if (audioRef.current) audioRef.current.currentTime = t;
          setTime(t);
        }}
        className="slider slider-touch min-w-0 flex-1"
        aria-label="Seek"
      />
      <span className="shrink-0 text-caption tabular-nums text-muted">
        {formatTime(time)} / {formatTime(duration)}
      </span>
    </div>
  );
}

/**
 * A YouTube job before separation (the job view polls and passes the
 * /status payload as `task`): while downloading, the percentage; once the
 * audio is in, thumbnail, title and a preview with Confirm & split /
 * Discard. Title and thumbnail only exist once the download finished.
 */
export default function YouTubeConfirmScreen({ taskId, task, onChanged }) {
  const [busy, setBusy] = useState(''); // '' | 'confirm' | 'discard'
  const [error, setError] = useState('');
  const downloading = task.status === 'downloading';
  const percent = Number.isFinite(task.download_percent) ? task.download_percent : null;

  const confirm = async () => {
    setBusy('confirm');
    setError('');
    try {
      await youtubeConfirm(taskId);
      jobsChanged();
      onChanged?.();
    } catch (e) {
      setError(errorDetail(e, 'Could not start the separation.'));
    } finally {
      setBusy('');
    }
  };

  const discard = async () => {
    setBusy('discard');
    setError('');
    try {
      await deleteTask(taskId);
      jobsChanged();
      navigate('/split', { replace: true });
    } catch (e) {
      setError(errorDetail(e, 'Could not discard this download.'));
      setBusy('');
    }
  };

  if (downloading) {
    return (
      <div className="flex max-w-3xl flex-col gap-2">
        <p className="m-0 break-all text-caption text-muted">{task.source_name}</p>
        <p className="m-0" role="status">
          Downloading audio from YouTube{percent !== null ? ` · ${percent}%` : '...'}
        </p>
        <Hairline value={percent !== null ? percent / 100 : 'indeterminate'} label="Download progress" />
        <p className="m-0 text-caption text-muted">You can leave this page — the download keeps going and shows in Jobs.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {task.thumbnail && (
          <img
            src={task.thumbnail}
            alt=""
            className="aspect-video w-full max-w-xs shrink-0 object-cover sm:w-56"
            onError={(e) => {
              e.currentTarget.style.display = 'none'; // offline / blocked: no broken-image box
            }}
          />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <p className="m-0 text-caption text-muted">
            {[task.duration_formatted && `Duration ${task.duration_formatted}`, task.model && `${task.model}${task.recover ? ` + ${task.recovery_model}` : ''}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {/* an instruction the reader acts on, so ink, not muted */}
          <p className="m-0">Preview the audio to make sure this is the right track.</p>
        </div>
      </div>
      <PreviewPlayer src={youtubePreviewUrl(taskId)} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <TextButton onClick={confirm} disabled={!!busy} className="text-h3" label="Confirm & split">
          {busy === 'confirm' ? 'Starting...' : 'Confirm & split'}
        </TextButton>
        <TextButton onClick={discard} disabled={!!busy} label="Discard">
          {busy === 'discard' ? 'Discarding...' : 'Discard'}
        </TextButton>
        {error && (
          <p className="m-0 text-caption" role="alert">
            <span className="text-muted">Error — </span>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

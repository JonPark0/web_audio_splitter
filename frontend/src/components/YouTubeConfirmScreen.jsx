import React, { useEffect, useRef, useState } from 'react';
import { getStatus, isTaskGone, youtubeConfirm, youtubePreviewUrl } from '../api';
import ErrorBanner from './ErrorBanner';
import Split from './Split';
import TextButton from './TextButton';

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
    <div className="flex items-center gap-4">
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
        <TextButton onClick={toggle} aria-pressed={playing} className="!items-start">
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
        className="slider min-w-0 flex-1"
        aria-label="Seek"
      />
      <span className="shrink-0 text-caption tabular-nums text-muted">
        {formatTime(time)} / {formatTime(duration)}
      </span>
    </div>
  );
}

export default function YouTubeConfirmScreen({ taskId, ytMeta, setStep }) {
  const [downloadStatus, setDownloadStatus] = useState('downloading');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Self-scheduling poll (see ProcessingScreen): no overlapping requests.
    let cancelled = false;
    let timer;

    const poll = async () => {
      try {
        const res = await getStatus(taskId);
        if (cancelled) return;
        const status = res.data.status;
        setDownloadStatus(status);
        if (status === 'downloaded' || status === 'download_failed') return;
      } catch (e) {
        if (cancelled) return;
        if (isTaskGone(e)) {
          setDownloadStatus('missing');
          return;
        }
        console.error(e);
      }
      if (!cancelled) timer = setTimeout(poll, 1500);
    };
    timer = setTimeout(poll, 1500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [taskId]);

  const handleConfirm = async () => {
    setConfirming(true);
    setError('');
    try {
      await youtubeConfirm(taskId);
      setStep('processing');
    } catch (e) {
      setError('Failed to start processing. Please try again.');
      setConfirming(false);
    }
  };

  return (
    <Split title="Confirm">
      <div className="flex flex-col gap-6">
        <ErrorBanner message={error} onDismiss={() => setError('')} />

        {ytMeta && (
          <div className="flex flex-col items-center gap-4 md:flex-row md:items-start">
            {ytMeta.thumbnail && (
              <img src={ytMeta.thumbnail} alt={ytMeta.title} className="w-full max-w-56 shrink-0 object-cover" />
            )}
            <div className="flex min-w-0 flex-col gap-2">
              <h2 className="m-0 text-h3 font-light">{ytMeta.title}</h2>
              <p className="m-0 text-caption text-muted">Duration {ytMeta.duration_formatted}</p>
            </div>
          </div>
        )}

        {downloadStatus === 'downloading' && (
          // Same indeterminate hairline as the processing screen - Palnarium
          // has no pulsing/blinking motion.
          <div className="flex flex-col gap-3">
            <div className="relative h-px w-full overflow-hidden bg-line" role="progressbar" aria-label="Downloading">
              <div className="absolute inset-y-0 left-0 w-1/3 animate-slide bg-ink" />
            </div>
            <p className="m-0 text-muted" role="status">
              Downloading audio from YouTube...
            </p>
          </div>
        )}

        {(downloadStatus === 'download_failed' || downloadStatus === 'missing') && (
          <div className="flex flex-col items-center gap-4 md:items-start">
            <p className="m-0" role="alert">
              <span className="text-muted">Error — </span>
              {downloadStatus === 'missing'
                ? 'This download is no longer on the server (it may have restarted). Please try again.'
                : 'Download failed. Please try again.'}
            </p>
            <TextButton onClick={() => setStep('upload')}>Go Back</TextButton>
          </div>
        )}

        {downloadStatus === 'downloaded' && (
          <>
            {/* an instruction the reader acts on, so ink, not muted */}
            <p className="m-0">Preview the audio to make sure this is the correct track.</p>
            <PreviewPlayer src={youtubePreviewUrl(taskId)} />
            <div className="flex items-baseline justify-center gap-6 pt-2 md:justify-start">
              <TextButton onClick={handleConfirm} disabled={confirming} className="text-h3">
                {confirming ? 'Starting...' : 'Confirm & Split'}
              </TextButton>
              <TextButton muted onClick={() => setStep('upload')}>
                Cancel
              </TextButton>
            </div>
          </>
        )}
      </div>
    </Split>
  );
}

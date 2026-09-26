import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiPlay, FiPause } from 'react-icons/fi';
import TrackRow from './TrackRow';
import TextButton from './TextButton';
import useWaveZoom from './useWaveZoom';

export default function Mixer({ taskId, tracks, recoveredTracks }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [readyCount, setReadyCount] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [volumes, setVolumes] = useState({});
  const [muted, setMuted] = useState({});
  const [soloed, setSoloed] = useState({});

  const surfers = useRef({});
  const playingRef = useRef(false);
  // Stop function of the track currently playing its extract selection, if
  // any. Selection playback and mixer playback are mutually exclusive.
  const selectionStop = useRef(null);
  const recoveredSet = new Set(recoveredTracks || []);
  const zoom = useWaveZoom(surfers);

  useEffect(() => {
    if (readyCount > 0 && readyCount === tracks.length) setIsReady(true);
  }, [readyCount, tracks.length]);

  const anySoloed = Object.values(soloed).some(Boolean);

  const setPlaying = (playing) => {
    playingRef.current = playing;
    setIsPlaying(playing);
  };

  const togglePlay = () => {
    if (!isReady) return;
    const playing = !isPlaying;
    // Ends the selection loop and re-aligns every stem at its start first.
    if (playing) selectionStop.current?.();
    setPlaying(playing);
    Object.values(surfers.current).forEach((ws) => (playing ? ws.play() : ws.pause()));
  };

  // Stable callbacks (functional updates / ref reads only) so the memoized
  // TrackRows skip re-rendering when another row's state changes.
  const handleSeek = useCallback((progress) => {
    Object.values(surfers.current).forEach((ws) => {
      if (ws.getDuration()) ws.seekTo(progress);
    });
  }, []);
  // A click on any waveform seeks every stem; it also ends a playing
  // selection (the click picks a new position, so no rewind to its start).
  const handleInteraction = useCallback(
    (progress) => {
      selectionStop.current?.({ rewind: false });
      handleSeek(progress);
    },
    [handleSeek]
  );
  const handleVolumeChange = useCallback((t, v) => setVolumes((s) => ({ ...s, [t]: v })), []);
  const handleToggleMute = useCallback((t) => setMuted((s) => ({ ...s, [t]: !s[t] })), []);
  const handleToggleSolo = useCallback((t) => setSoloed((s) => ({ ...s, [t]: !s[t] })), []);
  const handleReady = useCallback(() => setReadyCount((c) => c + 1), []);
  // The first track to reach the end stops and rewinds them all, so the
  // button returns to "Play" and the next press starts from the top. Stems
  // can differ by a few ms (resampled recoveries), so the rest are paused
  // rather than left to finish on their own.
  const handleFinish = useCallback(() => {
    playingRef.current = false;
    setIsPlaying(false);
    Object.values(surfers.current).forEach((ws) => {
      ws.pause();
      ws.seekTo(0);
    });
  }, []);

  // A track is about to play its selection: pause the mixer and stop any
  // other track's selection, then remember how to stop this one.
  const handleSelectionStart = useCallback((stop) => {
    if (selectionStop.current && selectionStop.current !== stop) selectionStop.current();
    if (playingRef.current) {
      playingRef.current = false;
      setIsPlaying(false);
      Object.values(surfers.current).forEach((ws) => ws.pause());
    }
    selectionStop.current = stop;
  }, []);
  const handleSelectionEnd = useCallback((stop) => {
    if (selectionStop.current === stop) selectionStop.current = null;
  }, []);

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col items-center gap-2">
        <TextButton label={isPlaying ? 'Pause' : 'Play'} onClick={togglePlay} disabled={!isReady} className="text-h2">
          <span className="inline-flex items-center gap-3">
            {isPlaying ? (
              <FiPause className="icon" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <FiPlay className="icon" strokeWidth={1.5} aria-hidden="true" />
            )}
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </span>
        </TextButton>
        {!isReady ? (
          <p className="m-0 text-caption text-muted" role="status">
            Loading waveforms... ({readyCount}/{tracks.length})
          </p>
        ) : (
          <p className="m-0 flex items-baseline gap-4 text-caption text-muted">
            <span>Ctrl/⌘ + wheel over a waveform to zoom</span>
            <TextButton muted onClick={zoom.fit} disabled={!zoom.zoomed} title="Zoom out to show whole tracks">
              Fit
            </TextButton>
          </p>
        )}
      </div>

      <div className="flex flex-col border-b border-line">
        {tracks.map((track) => (
          <TrackRow
            key={track}
            taskId={taskId}
            trackName={track}
            hasRecovered={recoveredSet.has(track)}
            volume={volumes[track] ?? 1}
            muted={!!muted[track]}
            soloed={!!soloed[track]}
            anySoloed={anySoloed}
            onVolumeChange={handleVolumeChange}
            onToggleMute={handleToggleMute}
            onToggleSolo={handleToggleSolo}
            surfers={surfers}
            onReady={handleReady}
            onFinish={handleFinish}
            onSeek={handleSeek}
            onInteraction={handleInteraction}
            onSelectionStart={handleSelectionStart}
            onSelectionEnd={handleSelectionEnd}
            onWheelZoom={zoom.zoomWithWheel}
            onWaveScroll={zoom.syncScroll}
            onSurferReady={zoom.adopt}
          />
        ))}
      </div>
    </div>
  );
}

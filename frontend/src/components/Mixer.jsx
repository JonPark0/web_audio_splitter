import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiPlay, FiPause } from 'react-icons/fi';
import TrackRow from './TrackRow';
import TextButton from './TextButton';

export default function Mixer({ taskId, tracks, recoveredTracks }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [readyCount, setReadyCount] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [volumes, setVolumes] = useState({});
  const [muted, setMuted] = useState({});
  const [soloed, setSoloed] = useState({});

  const surfers = useRef({});
  const recoveredSet = new Set(recoveredTracks || []);

  useEffect(() => {
    if (readyCount > 0 && readyCount === tracks.length) setIsReady(true);
  }, [readyCount, tracks.length]);

  const anySoloed = Object.values(soloed).some(Boolean);

  const togglePlay = () => {
    if (!isReady) return;
    const playing = !isPlaying;
    setIsPlaying(playing);
    Object.values(surfers.current).forEach((ws) => (playing ? ws.play() : ws.pause()));
  };

  // Stable callbacks (functional updates / ref reads only) so the memoized
  // TrackRows skip re-rendering when another row's state changes.
  const handleSeek = useCallback((progress) => {
    Object.values(surfers.current).forEach((ws) => {
      if (ws.getDuration()) ws.seekTo(progress);
    });
  }, []);
  const handleVolumeChange = useCallback((t, v) => setVolumes((s) => ({ ...s, [t]: v })), []);
  const handleToggleMute = useCallback((t) => setMuted((s) => ({ ...s, [t]: !s[t] })), []);
  const handleToggleSolo = useCallback((t) => setSoloed((s) => ({ ...s, [t]: !s[t] })), []);
  const handleReady = useCallback(() => setReadyCount((c) => c + 1), []);

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
        {!isReady && (
          <p className="m-0 text-caption text-muted" role="status">
            Loading waveforms... ({readyCount}/{tracks.length})
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
            onSeek={handleSeek}
          />
        ))}
      </div>
    </div>
  );
}

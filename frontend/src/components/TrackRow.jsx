import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { FiDownload, FiVolume2, FiVolumeX } from 'react-icons/fi';
import { trackUrl } from '../api';
import ABToggle from './ABToggle';
import SpectrogramView from './SpectrogramView';
import TextButton from './TextButton';

// Monochrome waveform: unplayed in grey, played portion + cursor in ink.
const WAVE_COLOR = '#b4b4b0';
const PROGRESS_COLOR = '#141414';

export default function TrackRow({
  taskId,
  trackName,
  hasRecovered,
  volume,
  muted,
  soloed,
  anySoloed,
  onVolumeChange,
  onToggleMute,
  onToggleSolo,
  surfers,
  onReady,
  onSeek,
}) {
  const containerRef = useRef(null);
  const wsRef = useRef(null);
  const hasInitialized = useRef(false);
  const [variant, setVariant] = useState('original');
  const name = trackName.replace('.wav', '');

  const audible = anySoloed ? soloed : !muted;

  // Create the WaveSurfer instance once per track.
  useEffect(() => {
    if (!containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: WAVE_COLOR,
      progressColor: PROGRESS_COLOR,
      cursorColor: PROGRESS_COLOR,
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 0,
      height: 88,
      normalize: true,
      backend: 'MediaElement',
      fillParent: true,
      interact: true,
    });

    ws.load(trackUrl(taskId, trackName, 'original'));

    ws.on('ready', () => {
      wsRef.current = ws;
      surfers.current[trackName] = ws;
      if (!hasInitialized.current) {
        hasInitialized.current = true;
        onReady();
      }
    });

    ws.on('error', (err) => {
      console.error(`[TrackRow ${trackName}] wavesurfer error:`, err);
    });

    ws.on('interaction', (newTime) => {
      const duration = ws.getDuration();
      if (duration) onSeek(newTime / duration);
    });

    return () => {
      // wavesurfer's destroy() can throw synchronously (AbortError from an
      // in-flight load being cancelled) when this cleanup runs before load()
      // has resolved — notably during React 18 StrictMode's dev-only double
      // invoke of effects. An uncaught throw here stops React from running
      // the effect's second (real) setup, so the waveform never renders.
      try {
        ws.destroy();
      } catch (e) {
        // safe to ignore — the instance is being torn down either way.
      }
      delete surfers.current[trackName];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A/B: swap the audio source while preserving position + playback state.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !hasInitialized.current) return;

    const wasPlaying = ws.isPlaying();
    const duration = ws.getDuration();
    const progress = duration ? ws.getCurrentTime() / duration : 0;

    const handleReady = () => {
      if (progress > 0) ws.seekTo(progress);
      if (wasPlaying) ws.play();
      ws.un('ready', handleReady);
    };
    ws.on('ready', handleReady);
    ws.load(trackUrl(taskId, trackName, variant));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  // Keep audible volume in sync with the slider + mute/solo state.
  useEffect(() => {
    wsRef.current?.setVolume(audible ? volume : 0);
  }, [audible, volume]);

  return (
    <div className="border-t border-line">
      <div className="flex flex-col gap-4 py-6 md:flex-row md:items-stretch md:gap-8">
        <div className="flex shrink-0 flex-col justify-center gap-3 md:w-56">
          <div className="flex items-baseline justify-between gap-4">
            <span className="truncate text-h3 capitalize leading-tight">{name}</span>
            <div className="flex shrink-0 gap-4 text-caption">
              <TextButton muted current={muted} aria-pressed={muted} onClick={() => onToggleMute(trackName)} title="Mute">
                Mute
              </TextButton>
              <TextButton muted current={soloed} aria-pressed={soloed} onClick={() => onToggleSolo(trackName)} title="Solo">
                Solo
              </TextButton>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {audible ? (
              <FiVolume2 className="icon text-muted" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <FiVolumeX className="icon text-muted" strokeWidth={1.5} aria-hidden="true" />
            )}
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => onVolumeChange(trackName, parseFloat(e.target.value))}
              className="slider"
              title="Volume"
              aria-label={`${name} volume`}
            />
          </div>

          {hasRecovered && <ABToggle name={`ab-${trackName}`} variant={variant} onChange={setVariant} />}
        </div>

        {/*
          Deliberately NOT `display:flex` here. WaveSurfer's own wrapper div
          (its direct child, sized via `fillParent: true`) needs the default
          block-level "children fill available width" behavior. Making this
          a flex *container* turns that child into a flex item that sizes to
          its own (initially empty, ~1px) content instead — a circular
          sizing deadlock where the canvas never gets a real width to draw
          into, so it's simply never created. Confirmed by direct inspection
          in a real browser: the container itself measured correctly via
          getBoundingClientRect, but WaveSurfer's internal wrapper stayed at
          clientWidth: 1 the whole time.
        */}
        <div className="relative min-w-0 flex-1" ref={containerRef} />

        <div className="flex shrink-0 items-center justify-center md:w-28 md:justify-end">
          <TextButton as="a" href={trackUrl(taskId, trackName, variant)} download label="Download" title="Download track">
            <span className="inline-flex items-center gap-2">
              <FiDownload className="icon" strokeWidth={1.5} aria-hidden="true" />
              <span>Download</span>
            </span>
          </TextButton>
        </div>
      </div>

      <SpectrogramView taskId={taskId} trackName={trackName} hasRecovered={hasRecovered} />
    </div>
  );
}

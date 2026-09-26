import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { FiDownload, FiVolume2, FiVolumeX } from 'react-icons/fi';
import { trackUrl } from '../api';
import ABToggle from './ABToggle';
import ExtractPanel from './ExtractPanel';
import SpectrogramView from './SpectrogramView';
import TextButton from './TextButton';

// Monochrome waveform: unplayed in grey, played portion + cursor in ink.
const WAVE_COLOR = '#b4b4b0';
const PROGRESS_COLOR = '#141414';
const REGION_COLOR = 'rgba(20, 20, 20, 0.12)';

// Memoized so dragging one row's volume slider (Mixer state change) doesn't
// re-render every other row; Mixer keeps the callback props stable.
export default memo(function TrackRow({
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
  onFinish,
  onSeek,
  onInteraction,
  onSelectionStart,
  onSelectionEnd,
  onWheelZoom,
  onWaveScroll,
  onSurferReady,
}) {
  const containerRef = useRef(null);
  const wsRef = useRef(null);
  const regionsRef = useRef(null);
  const regionRef = useRef(null);
  const hasInitialized = useRef(false);
  const [variant, setVariant] = useState('original');
  const [isReady, setIsReady] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [selection, setSelection] = useState(null);
  // Extract-mode selection playback: plays regionRef's bounds (read live on
  // every tick, so dragging the region while it plays keeps it in bounds).
  const [selPlaying, setSelPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const selActiveRef = useRef(false);
  const loopRef = useRef(false);
  loopRef.current = loop;
  const name = trackName.replace('.wav', '');

  // A muted / non-soloed stem is still heard while previewing its selection.
  const audible = (anySoloed ? soloed : !muted) || selPlaying;

  // Ends selection playback. By default it pauses and re-aligns every stem
  // at the selection start (so the next mixer Play starts them together);
  // `rewind: false` leaves positions alone (a click elsewhere just seeked).
  // Only reads refs and stable props, so it's safe from the create-effect's
  // wavesurfer listeners and from Mixer (which calls it to end a selection).
  const endSelection = useCallback(({ pause = true, rewind = true } = {}) => {
    if (!selActiveRef.current) return;
    selActiveRef.current = false;
    setSelPlaying(false);
    onSelectionEnd(endSelection);
    const ws = wsRef.current;
    if (!ws) return;
    if (pause && ws.isPlaying()) ws.pause();
    const duration = ws.getDuration();
    if (rewind && duration) onSeek((regionRef.current?.start ?? ws.getCurrentTime()) / duration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Plays the selection from `fromTime` if that's inside it, else its start.
  const startSelection = useCallback((fromTime) => {
    const ws = wsRef.current;
    const region = regionRef.current;
    if (!ws || !region) return;
    onSelectionStart(endSelection); // pauses the mixer / other selections
    selActiveRef.current = true;
    setSelPlaying(true);
    const from = fromTime != null && fromTime >= region.start && fromTime < region.end ? fromTime : region.start;
    ws.play(from).catch(() => {
      if (selActiveRef.current && !ws.isPlaying()) endSelection({ pause: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSelection = () => (selActiveRef.current ? endSelection() : startSelection());

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
    regionsRef.current = ws.registerPlugin(RegionsPlugin.create());

    // Rejects (and emits 'error', logged below) if destroyed mid-load.
    ws.load(trackUrl(taskId, trackName, 'original')).catch(() => {});

    // Fires again after every A/B reload.
    ws.on('ready', () => {
      wsRef.current = ws;
      surfers.current[trackName] = ws;
      onSurferReady(ws);
      if (!hasInitialized.current) {
        hasInitialized.current = true;
        setIsReady(true);
        onReady();
      }
    });

    ws.on('error', (err) => {
      console.error(`[TrackRow ${trackName}] wavesurfer error:`, err);
    });

    ws.on('finish', () => {
      // A selection running up to the very end of the track.
      if (selActiveRef.current) {
        if (loopRef.current && regionRef.current) ws.play(regionRef.current.start).catch(() => {});
        else endSelection({ pause: false });
        return;
      }
      onFinish();
    });

    ws.on('interaction', (newTime) => {
      const duration = ws.getDuration();
      if (duration) onInteraction(newTime / duration);
    });

    // Keep selection playback inside the (live) region bounds: loop back or
    // stop at its end; jump in if the start was dragged past the playhead.
    // Reads the media position rather than the event's argument: a
    // 'timeupdate' carrying the pre-seek position can still arrive right
    // after play(regionStart) from a playhead past the region.
    ws.on('timeupdate', () => {
      if (!selActiveRef.current || !ws.isPlaying() || ws.isSeeking()) return;
      const time = ws.getCurrentTime();
      const region = regionRef.current;
      if (!region) {
        endSelection();
      } else if (time >= region.end) {
        if (loopRef.current) ws.setTime(region.start);
        else endSelection();
      } else if (time < region.start - 0.05) {
        ws.setTime(region.start);
      }
    });

    // Paused from outside (media keys, a reload): drop the selection state.
    // At the track's end 'pause' precedes 'finish' (handled there), and a
    // pause queued just before our own play() arrives while playing again.
    ws.on('pause', () => {
      if (!selActiveRef.current || ws.isPlaying() || ws.getMediaElement()?.ended) return;
      endSelection({ pause: false });
    });

    ws.on('scroll', (_start, _end, scrollLeft) => onWaveScroll(ws, scrollLeft));

    // Ctrl/Cmd + wheel zooms (all tracks together). A native non-passive
    // listener, since React's onWheel is passive and can't preventDefault,
    // which is needed here to stop the browser's own page zoom. A plain
    // wheel is left alone so the page keeps scrolling.
    const container = containerRef.current;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (wsRef.current) onWheelZoom(wsRef.current, e);
    };
    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', onWheel);
      endSelection({ pause: false, rewind: false });
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

    // A selection preview is paused across the reload (loading pauses the
    // media anyway) and re-armed afterwards, so it stays within bounds.
    const wasSelecting = selActiveRef.current;
    if (wasSelecting) endSelection({ rewind: false });
    const wasPlaying = ws.isPlaying();
    const duration = ws.getDuration();
    const progress = duration ? ws.getCurrentTime() / duration : 0;

    // Unsubscribed on cleanup too: a rapid re-toggle aborts this load before
    // 'ready', and a leftover listener would seek to a stale position later.
    const unsubscribe = ws.once('ready', () => {
      if (progress > 0) ws.seekTo(progress);
      if (wasSelecting) startSelection(ws.getCurrentTime());
      else if (wasPlaying) ws.play();
    });
    // Rejects with AbortError when superseded; the 'error' listener logs it.
    ws.load(trackUrl(taskId, trackName, variant)).catch(() => {});
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  // Extract mode: dragging on the waveform draws a single selection region.
  // Click-to-seek is switched off meanwhile, since it would fire (and seek
  // every track) on the same drag gesture.
  useEffect(() => {
    const ws = wsRef.current;
    const regions = regionsRef.current;
    if (!extracting || !ws || !regions) return;

    ws.setOptions({ interact: false });
    const disableDrag = regions.enableDragSelection({ color: REGION_COLOR });
    const track = (region) => {
      regionRef.current = region;
      setSelection({ start: region.start, end: region.end });
    };
    const unsubCreated = regions.on('region-created', (region) => {
      regions.getRegions().forEach((r) => r !== region && r.remove());
      track(region); // a playing selection carries on within the new bounds
    });
    const unsubUpdated = regions.on('region-updated', track);

    return () => {
      endSelection();
      disableDrag();
      unsubCreated();
      unsubUpdated();
      regions.clearRegions();
      regionRef.current = null;
      setSelection(null);
      ws.setOptions({ interact: true });
    };
  }, [extracting]);

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
        <div
          className="relative min-w-0 flex-1 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          ref={containerRef}
          // Focusable in extract mode so Space can toggle selection playback.
          tabIndex={extracting ? 0 : undefined}
          aria-label={extracting ? `${name} waveform, Space plays the selection` : undefined}
          onKeyDown={(e) => {
            if (!extracting || e.key !== ' ' || e.target !== e.currentTarget || !selection) return;
            e.preventDefault();
            toggleSelection();
          }}
        />

        <div className="flex shrink-0 items-center justify-center gap-5 md:w-28 md:flex-col md:items-end md:justify-center md:gap-3">
          <TextButton
            muted
            current={extracting}
            aria-pressed={extracting}
            disabled={!isReady}
            onClick={() => setExtracting((x) => !x)}
            title="Select a region of this track and save it as a sample"
          >
            Extract
          </TextButton>
          <TextButton as="a" href={trackUrl(taskId, trackName, variant)} download label="Download" title="Download track">
            <span className="inline-flex items-center gap-2">
              <FiDownload className="icon" strokeWidth={1.5} aria-hidden="true" />
              <span>Download</span>
            </span>
          </TextButton>
        </div>
      </div>

      {extracting && (
        <ExtractPanel
          taskId={taskId}
          trackName={trackName}
          variant={variant}
          selection={selection}
          playing={selPlaying}
          loop={loop}
          onTogglePlay={toggleSelection}
          onToggleLoop={() => setLoop((l) => !l)}
          onCancel={() => setExtracting(false)}
        />
      )}

      <SpectrogramView taskId={taskId} trackName={trackName} hasRecovered={hasRecovered} />
    </div>
  );
});

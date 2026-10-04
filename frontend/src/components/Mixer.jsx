import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { FiMinus, FiPlus } from 'react-icons/fi';
import { getOnsets, trackUrl } from '../api';
import ABToggle from './ABToggle';
import ExtractPanel, { MIN_SAMPLE_SEC } from './ExtractPanel';
import TextButton from './TextButton';
import TrackRow, { ROW_COLUMNS } from './TrackRow';
import WordToggle from './WordToggle';
import Fader from './result/Fader';
import JobLine from './result/JobLine';
import Lane from './result/Lane';
import Ruler from './result/Ruler';
import Sheet from './result/Sheet';
import Transport, { PhoneBar, TransportOptions } from './result/Transport';
import MixEngine from './result/engine';
import { clamp, dbToGain, stemLabel } from './result/format';
import { createPeaksStore } from './result/peaks';
import { listJobSamples, sampleTracks } from './result/samples';
import useLaneGestures from './result/useLaneGestures';
import { ZOOM_STEP, createTimeline, useLayoutSize, useTimelineWidth } from './useWaveZoom';
import './result/result.css';

// Stems that are mixes of the others (BS-Roformer's instrumental), for
// /result responses from before `derived_tracks` existed.
const DERIVED = new Set(['instrumental']);

function nearest(sorted, t) {
  let lo = 0;
  let hi = sorted.length - 1;
  if (hi < 0) return null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  const a = sorted[lo];
  const b = lo > 0 ? sorted[lo - 1] : a;
  return Math.abs(a - t) < Math.abs(b - t) ? a : b;
}

/**
 * The stem mixer: sticky transport + ruler, one compact row per stem, a
 * docked extract panel (sheet on phones) and a phone bottom bar. Playback is
 * the MixEngine (one AudioContext clock, sample-aligned stems); waveforms are
 * server peaks drawn on one shared timeline (useWaveZoom).
 */
export default function Mixer({ taskId, result, bpm, songKey, retrying, onRetryToggle, retryPanel }) {
  const tracks = result.tracks || [];
  const derivedSet = useMemo(
    () => new Set(result.derived_tracks ?? tracks.filter((t) => DERIVED.has(stemLabel(t)))),
    [result] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const recoveredSet = useMemo(() => new Set(result.recovered_tracks || []), [result]);
  const recTracks = tracks.filter((t) => recoveredSet.has(t));
  const { size, coarse } = useLayoutSize();
  const phone = size === 'phone';
  const touchRows = !phone && coarse; // two 44 px lines of controls per row
  const rowH = touchRows ? 88 : size === 'desktop' ? (tracks.length <= 4 ? 96 : 72) : 80;
  const columns = ROW_COLUMNS[touchRows ? 'touch' : size];

  const peaks = useMemo(() => createPeaksStore(taskId), [taskId]);
  const timeline = useMemo(() => createTimeline(result.duration || 0), [taskId]); // eslint-disable-line react-hooks/exhaustive-deps
  const engineRef = useRef(null);
  const [engineTick, setEngineTick] = useState(0);

  // ---- mix state (B2: derived stems start muted) -----------------------------
  const [mix, setMix] = useState(() =>
    Object.fromEntries(tracks.map((t) => [t, { db: 0, muted: derivedSet.has(t), soloed: false, variant: 'original' }]))
  );
  const mixRef = useRef(mix);
  mixRef.current = mix;
  const anySolo = tracks.some((t) => mix[t].soloed);
  const audibleOf = (t, m = mix) => (tracks.some((x) => m[x].soloed) ? m[t].soloed : !m[t].muted);
  const gainOf = useCallback(
    (t) => {
      const m = mixRef.current;
      const audible = tracks.some((x) => m[x].soloed) ? m[t].soloed : !m[t].muted;
      return audible ? dbToGain(m[t].db) : 0;
    },
    [tracks]
  );
  const variantOf = useCallback((t) => mixRef.current[t]?.variant || 'original', []);
  const updateStem = useCallback((t, patch) => setMix((m) => ({ ...m, [t]: { ...m[t], ...patch } })), []);
  const onDb = useCallback((t, db) => updateStem(t, { db }), [updateStem]);
  const onMute = useCallback((t) => setMix((m) => ({ ...m, [t]: { ...m[t], muted: !m[t].muted } })), []);
  const onSolo = useCallback((t) => setMix((m) => ({ ...m, [t]: { ...m[t], soloed: !m[t].soloed } })), []);
  const onVariant = useCallback((t, variant) => updateStem(t, { variant }), [updateStem]);
  const allVariant = recTracks.length
    ? recTracks.every((t) => mix[t].variant === 'recovered')
      ? 'recovered'
      : recTracks.every((t) => mix[t].variant === 'original')
        ? 'original'
        : null
    : null;
  const setAllVariant = (v) =>
    setMix((m) => {
      const next = { ...m };
      recTracks.forEach((t) => {
        next[t] = { ...next[t], variant: v };
      });
      return next;
    });

  // ---- engine ----------------------------------------------------------------
  const [playing, setPlaying] = useState(false);
  const [pending, setPending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [audioErrors, setAudioErrors] = useState({});

  useEffect(() => {
    const engine = new MixEngine({ duration: result.duration || 0 });
    tracks.forEach((t) =>
      engine.addStem(
        t,
        { original: trackUrl(taskId, t, 'original'), recovered: recoveredSet.has(t) ? trackUrl(taskId, t, 'recovered') : null },
        { gain: gainOf(t), variant: variantOf(t) }
      )
    );
    engineRef.current = engine;
    const off = engine.on((ev) => {
      if (ev.type === 'stem') {
        setAudioErrors((s) => ({ ...s, [`${ev.name}|${ev.variant}`]: ev.error }));
        return;
      }
      setPlaying(ev.playing);
      setPending(ev.pending);
      if (!ev.playing && !ev.pending) {
        setPreviewing(false);
        timeline.setPlayhead(engine.position());
      }
    });
    setEngineTick((n) => n + 1);
    if (import.meta.env.DEV) {
      window.__mixEngine = engine;
      window.__timeline = timeline;
    }
    return () => {
      off();
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    tracks.forEach((t) => {
      e.setStemGain(t, gainOf(t));
      e.setVariant(t, mix[t].variant);
    });
  }, [mix, engineTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- peaks (PF1) -------------------------------------------------------------
  const [, peaksChanged] = useReducer((n) => n + 1, 0);
  useEffect(() => peaks.subscribe(peaksChanged), [peaks]);
  const variantsKey = tracks.map((t) => mix[t].variant).join(',');
  useEffect(() => {
    tracks.forEach((t) => peaks.load(t, mix[t].variant));
  }, [peaks, variantsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const baseOf = (t) => peaks.base(t, mix[t].variant);
  const ready = tracks.every((t) => {
    const e = baseOf(t);
    return e && e.state !== 'loading';
  });
  useEffect(() => {
    if (!ready) return undefined;
    // Once the waveforms are up: WAV headers (a few KB each, so the first
    // Play is quick) and the recovered peaks (instant A/B waveforms).
    engineRef.current?.prefetchHeaders();
    const id = setTimeout(() => recTracks.forEach((t) => peaks.load(t, 'recovered')), 400);
    return () => clearTimeout(id);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const readyOriginals = tracks.map((t) => peaks.base(t, 'original')).filter((e) => e?.state === 'ready');
  const duration = readyOriginals.length ? Math.max(...readyOriginals.map((e) => e.duration)) : result.duration || 0;
  const sampleRate = readyOriginals[0]?.sampleRate;
  useEffect(() => {
    if (!duration) return;
    timeline.setDuration(duration);
    engineRef.current?.setDuration(duration);
  }, [duration, engineTick, timeline]);
  useEffect(() => {
    if (sampleRate) engineRef.current?.setPreferredRate(sampleRate);
  }, [sampleRate, engineTick]);

  const [scaleMode, setScaleMode] = useState('shared');
  const globalMax = Math.max(0.05, ...tracks.map((t) => baseOf(t)?.max || 0));
  const scaleOf = (t) => (scaleMode === 'shared' ? 1 / globalMax : 1 / Math.max(0.05, baseOf(t)?.max || 1));

  // ---- selection, loop, snap ---------------------------------------------------
  const [selection, setSelectionState] = useState(null);
  const selRef = useRef(null);
  selRef.current = selection;
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  draggingRef.current = dragging;
  const [activeEdge, setActiveEdge] = useState('end');
  const activeEdgeRef = useRef('end');
  activeEdgeRef.current = activeEdge;
  const [loopOn, setLoopOn] = useState(false);
  const [snapMode, setSnapMode] = useState('off');
  const snapRef = useRef('off');
  snapRef.current = snapMode;
  const [extract, setExtract] = useState(null); // { source: track | 'mix' }
  const extractRef = useRef(null);
  extractRef.current = extract;
  const durationRef = useRef(duration);
  durationRef.current = duration;

  const normalizeSel = (sel) => {
    if (!sel) return null;
    let { start, end } = sel;
    if (end < start) [start, end] = [end, start];
    const d = durationRef.current || Infinity;
    return { start: clamp(start, 0, d), end: clamp(end, 0, d), track: sel.track };
  };
  const setSelection = useCallback((sel) => setSelectionState(normalizeSel(sel)), []);

  const [onsets, setOnsets] = useState({});
  const onsetsRef = useRef(onsets);
  onsetsRef.current = onsets;
  const requested = useRef(new Set());
  const requestOnsets = useCallback(
    (t) => {
      if (!t || t === 'mix') return;
      const k = `${t}|${variantOf(t)}`;
      if (requested.current.has(k)) return;
      requested.current.add(k);
      getOnsets(taskId, t, variantOf(t))
        .then((r) => setOnsets((s) => ({ ...s, [k]: (r.data.onsets || []).slice().sort((a, b) => a - b) })))
        .catch(() => setOnsets((s) => ({ ...s, [k]: [] })));
    },
    [taskId, variantOf]
  );
  useEffect(() => {
    if (snapMode === 'transient') requestOnsets(selection?.track || (extract?.source !== 'mix' && extract?.source) || tracks[0]);
  }, [snapMode, selection?.track, extract?.source, variantsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // P1 snapping while dragging: transient (nearest onset within 12 px) or
  // beat length (start kept, length rounded to whole beats).
  const snap = useCallback(
    (sel, moving, track) => {
      const mode = snapRef.current;
      const out = { ...sel };
      const d = durationRef.current || Infinity;
      if (mode === 'transient' && track) {
        requestOnsets(track);
        const list = onsetsRef.current[`${track}|${variantOf(track)}`];
        const near = list && nearest(list, out[moving]);
        if (near != null && Math.abs(near - out[moving]) <= 12 / timeline.get().pps) out[moving] = near;
      } else if (mode === 'beat' && bpm > 0) {
        const beat = 60 / bpm;
        let n = Math.max(1, Math.round((out.end - out.start) / beat));
        if (moving === 'end') {
          while (n > 1 && out.start + n * beat > d) n -= 1;
          out.end = Math.min(d, out.start + n * beat);
        } else {
          while (n > 1 && out.end - n * beat < 0) n -= 1;
          out.start = Math.max(0, out.end - n * beat);
        }
      }
      return out;
    },
    [bpm, requestOnsets, timeline, variantOf]
  );

  const onSelect = useCallback((sel, phase) => {
    setDragging(phase === 'drag');
    if (!sel) return;
    const n = normalizeSel(sel);
    if (phase === 'end' && n.end - n.start < 0.0005) return;
    setSelectionState(n);
    if (phase === 'end') setExtract((x) => (x && x.source !== 'mix' && n.track && x.source !== n.track ? { source: n.track } : x));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Loop region → engine (the selection when there is one), not mid-drag.
  useEffect(() => {
    const e = engineRef.current;
    if (!e || dragging) return;
    const sel = selection && selection.end - selection.start >= MIN_SAMPLE_SEC ? selection : null;
    e.setLoop(loopOn ? (sel ? { start: sel.start, end: sel.end } : { start: 0, end: duration }) : null);
  }, [loopOn, selection?.start, selection?.end, dragging, duration, engineTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- transport ---------------------------------------------------------------
  useEffect(() => {
    if (!playing && !pending) return undefined;
    let raf = 0;
    const tick = () => {
      const e = engineRef.current;
      if (e) {
        const t = e.position();
        timeline.setPlayhead(t);
        if (!draggingRef.current) timeline.follow(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, pending, timeline]);

  const togglePlay = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    if (e.isActive()) e.pause();
    else if (durationRef.current > 0) e.play(e.pos);
  }, []);
  const seek = useCallback(
    (t) => {
      const e = engineRef.current;
      if (!e) return;
      setPreviewing(false);
      e.seek(t);
      timeline.setPlayhead(t);
    },
    [timeline]
  );
  const preview = useCallback(() => {
    const e = engineRef.current;
    const sel = selRef.current;
    if (!e || !sel) return;
    if (previewing) {
      e.pause();
      return;
    }
    const src = extractRef.current?.source;
    if (loopOn) e.setLoop({ start: sel.start, end: sel.end });
    e.play(sel.start, { endSec: loopOn ? null : sel.end, rewindTo: sel.start, solo: src && src !== 'mix' ? src : null });
    setPreviewing(true);
  }, [loopOn, previewing]);

  const zoomIn = useCallback(() => timeline.zoomBy(ZOOM_STEP), [timeline]);
  const zoomOut = useCallback(() => timeline.zoomBy(1 / ZOOM_STEP), [timeline]);
  const fit = useCallback(() => timeline.fit(), [timeline]);
  const zoomSel = useCallback(() => {
    const s = selRef.current;
    if (s) timeline.zoomToRange(s.start, s.end);
  }, [timeline]);
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => timeline.subscribe((v) => setZoomed(v.zoomed)), [timeline]);

  const nudge = useCallback(
    (dt) => {
      const sel = selRef.current;
      if (!sel) return;
      const edge = activeEdgeRef.current;
      const next = { ...sel, [edge]: sel[edge] + dt };
      if (next.end - next.start < 0.001) next[edge] = edge === 'start' ? next.end - 0.001 : next.start + 0.001;
      setSelection(next);
    },
    [setSelection]
  );

  // ---- markers: samples already cut from this job (P8) -------------------------
  const [samples, setSamples] = useState([]);
  const samplesRef = useRef(samples);
  samplesRef.current = samples;
  useEffect(() => {
    let off = false;
    listJobSamples(taskId)
      .then((s) => !off && setSamples(s))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [taskId]);
  const markersByTrack = useMemo(() => {
    const out = Object.fromEntries(tracks.map((t) => [t, []]));
    samples.forEach((s) => {
      if (s.source?.start_sec == null) return;
      sampleTracks(s, tracks).forEach((t) =>
        out[t]?.push({ id: s.id, name: s.name, start: s.source.start_sec, end: s.source.end_sec, mix: s.source.variant === 'mix' })
      );
    });
    return out;
  }, [samples, tracks]);
  const selectMarker = useCallback(
    (id) => {
      const s = samplesRef.current.find((x) => x.id === id);
      if (!s) return;
      setSelection({ start: s.source.start_sec, end: s.source.end_sec, track: sampleTracks(s, tracks)[0] });
    },
    [setSelection, tracks]
  );
  const onSaved = useCallback((sample) => setSamples((s) => [...s, sample]), []);
  const onRemoved = useCallback((id) => setSamples((s) => s.filter((x) => x.id !== id)), []);

  // ---- rows / panels -------------------------------------------------------------
  const [specOpen, setSpecOpen] = useState({});
  const onSpec = useCallback((t) => setSpecOpen((s) => ({ ...s, [t]: !s[t] })), []);
  const [menu, setMenu] = useState(null); // phone: track name or 'transport'
  const onExtract = useCallback(
    (t) => {
      setMenu(null);
      setExtract((x) => (x && x.source === t ? null : { source: t }));
      setSelectionState((s) => (s ? { ...s, track: t } : s));
    },
    []
  );
  const onSource = useCallback((src) => {
    setExtract({ source: src });
    if (src !== 'mix') setSelectionState((s) => (s ? { ...s, track: src } : s));
  }, []);
  const onRetry = useCallback(
    (t) => {
      const v = variantOf(t);
      if (peaks.base(t, v)?.state === 'error') peaks.retry(t, v);
      setAudioErrors((s) => {
        const next = { ...s };
        delete next[`${t}|original`];
        delete next[`${t}|recovered`];
        return next;
      });
      engineRef.current?.retry(t);
    },
    [peaks, variantOf]
  );
  const [panelH, setPanelH] = useState(0);

  // ---- keyboard ----------------------------------------------------------------
  const keyActions = useRef({});
  keyActions.current = { togglePlay, zoomSel, zoomIn, zoomOut, nudge };
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      const a = keyActions.current;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (!e.repeat) a.togglePlay();
          break;
        case 'z':
        case 'Z':
          a.zoomSel();
          break;
        case '+':
        case '=':
          a.zoomIn();
          break;
        case '-':
        case '_':
          a.zoomOut();
          break;
        case 'l':
        case 'L':
          setLoopOn((v) => !v);
          break;
        case '[':
          setActiveEdge('start');
          break;
        case ']':
          setActiveEdge('end');
          break;
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (!selRef.current) break;
          e.preventDefault();
          const beat = bpm > 0 ? 60 / bpm : null;
          const dt = e.altKey && beat ? beat : e.shiftKey ? 0.01 : 0.001;
          a.nudge(e.key === 'ArrowLeft' ? -dt : dt);
          break;
        }
        case 'Escape':
          if (extractRef.current) setExtract(null);
          else if (selRef.current) setSelectionState(null);
          break;
        default:
      }
    };
    // Space on a focused button must not also "click" it.
    const onKeyUp = (e) => {
      const tag = e.target?.tagName;
      if (e.key === ' ' && (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY')) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [bpm]);

  // ---- gestures ----------------------------------------------------------------
  const rowsRef = useRef(null);
  const rulerColRef = useRef(null);
  const sheetLaneRef = useRef(null);
  useTimelineWidth(timeline, rulerColRef);
  const gestureOpts = {
    timeline,
    getSelection: () => selRef.current,
    onSelect,
    onSeek: seek,
    onMarker: selectMarker,
    snap,
  };
  useLaneGestures(rowsRef, gestureOpts);
  const sheetOpen = phone && !!extract;
  useLaneGestures(sheetLaneRef, gestureOpts, [sheetOpen]);

  const [rulerChoice, setRulerChoice] = useState(null);
  const rulerMode = rulerChoice || (bpm ? 'bars' : 'time');

  const options = {
    snap: snapMode,
    onSnap: setSnapMode,
    bpm,
    allVariant,
    onAllVariant: setAllVariant,
    anyRecovered: recTracks.length > 0,
    scaleMode,
    onScaleMode: setScaleMode,
    rulerMode,
    onRulerMode: setRulerChoice,
  };
  const ruler = (
    <Ruler timeline={timeline} bpm={bpm} mode={rulerMode} selection={selection} onSeek={seek} coarse={coarse} height={coarse ? 30 : 20} />
  );

  // Phone extract sheet: ruler + the source stem's lane + zoom, sticky on top.
  const laneTrack = extract ? (extract.source !== 'mix' ? extract.source : selection?.track || tracks[0]) : null;
  const sheetViewer = sheetOpen ? (
    <div className="sticky top-11 z-[5] -mx-4 border-b border-line bg-paper px-4 pb-1">
      {ruler}
      <div ref={sheetLaneRef}>
        <Lane
          track={laneTrack}
          variant={mix[laneTrack].variant}
          peaks={peaks}
          timeline={timeline}
          height={112}
          scale={scaleOf(laneTrack)}
          dim={false}
          selection={selection}
          isTarget
          markers={markersByTrack[laneTrack]}
          coarse={coarse}
          label={`${stemLabel(laneTrack)} waveform`}
          status={null}
        />
      </div>
      <div className="flex items-center gap-1 text-caption">
        <button type="button" onClick={zoomOut} disabled={!zoomed} aria-label="Zoom out" className="link h-11 w-11 items-center justify-center">
          <FiMinus className="icon" aria-hidden="true" />
        </button>
        <button type="button" onClick={zoomIn} aria-label="Zoom in" className="link h-11 w-11 items-center justify-center">
          <FiPlus className="icon" aria-hidden="true" />
        </button>
        <TextButton muted onClick={fit} disabled={!zoomed} className="h-11 min-w-11 justify-center">
          Fit
        </TextButton>
        <TextButton muted onClick={zoomSel} disabled={!selection} className="h-11 justify-center px-2">
          Selection
        </TextButton>
        <span className="ml-auto text-muted">Pinch to zoom</span>
      </div>
    </div>
  ) : null;

  const menuTrack = menu && menu !== 'transport' ? menu : null;

  return (
    <div className="flex w-full flex-col">
      <JobLine
        taskId={taskId}
        result={result}
        bpm={bpm}
        songKey={songKey}
        duration={duration}
        retrying={retrying}
        onRetry={onRetryToggle}
        phone={phone}
      />
      {retryPanel}
      <div className="sticky top-12 z-20 -mx-4 border-b border-line bg-paper px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {!phone && (
          <Transport
            timeline={timeline}
            duration={duration}
            playing={playing}
            pending={pending}
            onToggle={togglePlay}
            loopOn={loopOn}
            onLoop={() => setLoopOn((v) => !v)}
            hasSelection={!!selection}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onFit={fit}
            onZoomSel={zoomSel}
            zoomed={zoomed}
            wide={size === 'desktop'}
            coarse={coarse}
            onMore={() => setMenu('transport')}
            options={options}
          />
        )}
        {phone ? (
          <div ref={rulerColRef}>{sheetOpen ? null : ruler}</div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: columns }}>
            <div className="flex items-start pr-3 text-caption">
              {bpm ? (
                <WordToggle
                  name="rs-ruler"
                  centerOnMobile={false}
                  className="gap-x-3"
                  value={rulerMode}
                  onChange={setRulerChoice}
                  options={[
                    { value: 'bars', label: 'Bars' },
                    { value: 'time', label: 'Time' },
                  ]}
                />
              ) : (
                <span className="text-muted">Time</span>
              )}
            </div>
            <div ref={rulerColRef} className="min-w-0">
              {ruler}
            </div>
            <div />
          </div>
        )}
      </div>

      <div ref={rowsRef} data-ready={ready} className="divide-y divide-line border-b border-line">
        {tracks.map((t) => {
          const m = mix[t];
          const base = baseOf(t);
          return (
            <TrackRow
              key={t}
              taskId={taskId}
              track={t}
              label={stemLabel(t)}
              derived={derivedSet.has(t)}
              hasRecovered={recoveredSet.has(t)}
              jobHasRecovered={recTracks.length > 0}
              recoveryModel={result.recovery_model}
              variant={m.variant}
              db={m.db}
              muted={m.muted}
              soloed={m.soloed}
              audible={audibleOf(t)}
              size={size}
              rowH={rowH}
              coarse={coarse}
              peaks={peaks}
              timeline={timeline}
              scale={scaleOf(t)}
              selection={selection}
              isTarget={selection?.track === t}
              markers={markersByTrack[t]}
              loadState={base?.state || 'loading'}
              loadError={base?.error}
              audioError={audioErrors[`${t}|${m.variant}`]}
              sampleRate={base?.sampleRate}
              peakMax={base?.state === 'ready' ? base.max : null}
              specOpen={!!specOpen[t]}
              extractActive={extract?.source === t}
              onVariant={onVariant}
              onDb={onDb}
              onMute={onMute}
              onSolo={onSolo}
              onExtract={onExtract}
              onSpec={onSpec}
              onRetry={onRetry}
              onMenu={setMenu}
            />
          );
        })}
      </div>
      {!ready && (
        <p className="m-0 py-2 text-caption text-muted" role="status">
          Loading waveforms… ({tracks.filter((t) => baseOf(t) && baseOf(t).state !== 'loading').length}/{tracks.length})
        </p>
      )}
      {anySolo && <span className="sr-only">Solo is on: only soloed stems play.</span>}
      <div aria-hidden="true" style={{ height: phone ? 'calc(72px + env(safe-area-inset-bottom))' : extract ? panelH + 8 : 24 }} />

      {extract && (
        <ExtractPanel
          key={phone ? 'sheet' : 'docked'}
          layout={phone ? 'sheet' : 'docked'}
          taskId={taskId}
          tracks={tracks}
          source={extract.source}
          onSource={onSource}
          selection={selection}
          onSelection={setSelection}
          activeEdge={activeEdge}
          onActiveEdge={setActiveEdge}
          bpm={bpm}
          snap={snapMode}
          variantOf={variantOf}
          gainOf={gainOf}
          getPlayhead={() => engineRef.current?.position() ?? timeline.getPlayhead()}
          previewing={previewing}
          onPreview={preview}
          loopOn={loopOn}
          onLoop={() => setLoopOn((v) => !v)}
          playing={playing || pending}
          onTogglePlay={togglePlay}
          onSaved={onSaved}
          onRemoved={onRemoved}
          onClose={() => setExtract(null)}
          onHeight={setPanelH}
          coarse={coarse}
          viewer={sheetViewer}
        />
      )}

      {phone && !extract && (
        <PhoneBar
          timeline={timeline}
          duration={duration}
          playing={playing}
          pending={pending}
          onToggle={togglePlay}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onFit={fit}
          zoomed={zoomed}
          onMore={() => setMenu('transport')}
        />
      )}

      {menu === 'transport' && (
        <Sheet title="Playback" onClose={() => setMenu(null)}>
          <div className="flex flex-col gap-1 pb-3 text-p">
            <TextButton
              muted
              current={loopOn}
              aria-pressed={loopOn}
              onClick={() => setLoopOn((v) => !v)}
              className="h-11 items-start justify-center"
            >
              {selection ? 'Loop the selection' : 'Loop the song'}
            </TextButton>
            <TextButton
              muted
              disabled={!selection}
              onClick={() => {
                zoomSel();
                setMenu(null);
              }}
              className="h-11 items-start justify-center"
            >
              Zoom to selection
            </TextButton>
            <div className="flex flex-col gap-1 text-caption">
              <TransportOptions {...options} stacked />
            </div>
          </div>
        </Sheet>
      )}

      {menuTrack && (
        <Sheet title={stemLabel(menuTrack)} onClose={() => setMenu(null)}>
          <div className="flex flex-col gap-1 pb-3 text-p">
            <TextButton onClick={() => onExtract(menuTrack)} className="h-11 items-start justify-center">
              Extract a sample
            </TextButton>
            <TextButton
              as="a"
              muted
              href={trackUrl(taskId, menuTrack, mix[menuTrack].variant)}
              download
              className="h-11 items-start justify-center"
            >
              Download ({mix[menuTrack].variant})
            </TextButton>
            <TextButton
              muted
              current={!!specOpen[menuTrack]}
              aria-pressed={!!specOpen[menuTrack]}
              onClick={() => onSpec(menuTrack)}
              className="h-11 items-start justify-center"
            >
              Spectrogram
            </TextButton>
            {recoveredSet.has(menuTrack) && (
              <div className="flex h-11 items-center gap-4 text-caption">
                <span className="text-muted">Version</span>
                <ABToggle variant={mix[menuTrack].variant} onChange={(v) => onVariant(menuTrack, v)} recoveryModel={result.recovery_model} />
              </div>
            )}
            <div className="flex items-center gap-3 text-caption">
              <span className="text-muted">Level</span>
              <Fader db={mix[menuTrack].db} onChange={(v) => onDb(menuTrack, v)} label={stemLabel(menuTrack)} className="flex-1" />
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

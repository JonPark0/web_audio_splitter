import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FiPlus } from 'react-icons/fi';
import ErrorBanner from '../../components/ErrorBanner';
import TextButton from '../../components/TextButton';
import { errorMessage } from '../../samplesApi';
import { clipEndBeat, makeClip, makeTrack, newId, projectEndBeat } from '../project';
import { createProject, deleteProject, getProject, listProjects } from '../projectsApi';
import { encodeWav } from '../wav';
import ClipInspector from './ClipInspector';
import ProjectBar from './ProjectBar';
import SampleBrowser from './SampleBrowser';
import Timeline from './Timeline';
import TransportBar from './TransportBar';
import { usePositionClock } from './playheadClock';
import { DEFAULT_SNAP, DEFAULT_ZOOM, clampZoom, snapBeat, snapStep, stepZoom } from './snap';
import useEngine, { engineCall, engineTry, useErrorReporter } from './useEngine';
import useProjectState from './useProjectState';

const LAST_PROJECT_KEY = 'arrange:lastProject';

function remember(id) {
  try {
    if (id) localStorage.setItem(LAST_PROJECT_KEY, id);
    else localStorage.removeItem(LAST_PROJECT_KEY);
  } catch (e) {
    // storage unavailable (private mode) - just don't remember
  }
}

function recall() {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch (e) {
    return null;
  }
}

// Defaults for anything an older/partial document might lack.
function normalize(p) {
  return {
    ...p,
    bpm: p.bpm || 120,
    beats_per_bar: p.beats_per_bar || 4,
    loop: p.loop || { enabled: false, start_beat: 0, end_beat: 0 },
    tracks: (p.tracks || []).map((t) => ({ ...t, clips: t.clips || [] })),
    samples: p.samples || {},
  };
}

function summarize(p) {
  return {
    id: p.id,
    name: p.name,
    bpm: p.bpm,
    track_count: p.tracks.length,
    clip_count: p.tracks.reduce((n, t) => n + t.clips.length, 0),
    updated_at: p.updated_at,
  };
}

// Shortcuts stay out of the way while the user types.
function isTyping(target) {
  if (!target || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

// Narrower, for undo/redo: only fields with their own text undo keep the
// shortcut (a focused slider or checkbox doesn't).
const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file']);
function isTextEntry(target) {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA') return true;
  return target.tagName === 'INPUT' && !NON_TEXT_INPUTS.has(target.type);
}

const EXPORT_SAMPLE_RATE = 48000;

function wavFileName(name) {
  // eslint-disable-next-line no-control-regex
  const base = (name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim();
  return `${base || 'mixdown'}.wav`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Arrange: place library samples on tracks at one project tempo, play them
 * through the arrangement engine, autosave to the backend.
 */
export default function ArrangeScreen() {
  const { project, dispatch, saveStatus, saveError, saveNow, load, discard, undo, redo, canUndo, canRedo } =
    useProjectState();
  const { error, report, clear } = useErrorReporter();

  const [projects, setProjects] = useState([]);
  const [listStatus, setListStatus] = useState('loading'); // loading | ready | error
  const [busy, setBusy] = useState(false); // opening / creating / deleting
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(0);
  const [cursorBeat, setCursorBeat] = useState(0); // playhead while stopped
  const [metronome, setMetronome] = useState(false);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [snap, setSnap] = useState(DEFAULT_SNAP);
  const [selection, setSelection] = useState([]);
  const [selectedTrackId, setSelectedTrackId] = useState(null);
  const [exporting, setExporting] = useState(false);

  const playingRef = useRef(false);
  const userStopRef = useRef(false); // distinguishes Stop from the engine ending by itself
  const playStartRef = useRef(0);
  const cursorRef = useRef(0);
  cursorRef.current = cursorBeat;
  const engineRef = useRef(null);

  const setPlayingBoth = useCallback((p) => {
    playingRef.current = p;
    setPlaying(p);
  }, []);

  const engine = useEngine({
    onState: ({ playing: p, loading: l } = {}) => {
      if (typeof l === 'number') setLoading(l);
      if (typeof p !== 'boolean') return;
      if (playingRef.current && !p && !userStopRef.current) {
        // Reached the end on its own: return to where playback started.
        const start = playStartRef.current;
        setCursorBeat(start);
        engineTry(() => engineRef.current?.seek(start));
      }
      userStopRef.current = false;
      setPlayingBoth(p);
    },
    onError: (message) => report(message),
    onTeardown: () => {
      saveNow();
    },
  });
  engineRef.current = engine;

  const clock = usePositionClock(engine, playing, cursorBeat);

  const bpb = project?.beats_per_bar || 4;
  const step = snapStep(snap, bpb);

  // Every project change goes to the engine (cheap and idempotent by contract).
  // The stub throws on each call, so its error is announced once only.
  useEffect(() => {
    if (!engine || !project) return;
    engineCall(() => engine.setProject(project)).catch((err) =>
      report(err?.message || 'Audio engine error', { once: true })
    );
  }, [engine, project, report]);

  // Selection survives only while its clips exist (delete, server sync, switch).
  const clipIds = useMemo(() => {
    const ids = new Set();
    project?.tracks.forEach((t) => t.clips.forEach((c) => ids.add(c.id)));
    return ids;
  }, [project]);
  const liveSelection = useMemo(() => selection.filter((id) => clipIds.has(id)), [selection, clipIds]);
  const trackId =
    project?.tracks.find((t) => t.id === selectedTrackId)?.id ?? project?.tracks[0]?.id ?? null;

  // ---------------- transport ----------------
  const stopTransport = useCallback(() => {
    if (!playingRef.current) return;
    userStopRef.current = true;
    engineTry(() => engineRef.current?.stop());
    setPlayingBoth(false);
  }, [setPlayingBoth]);

  const togglePlay = useCallback(async () => {
    const e = engineRef.current;
    if (!e) return;
    if (playingRef.current) {
      userStopRef.current = true;
      try {
        e.stop();
      } catch (err) {
        report(err?.message || 'Could not stop playback');
      }
      let pos = cursorRef.current;
      try {
        const b = e.getPositionBeats();
        if (Number.isFinite(b)) pos = b;
      } catch (err) {
        // keep the last cursor
      }
      setPlayingBoth(false);
      setCursorBeat(pos);
      return;
    }
    userStopRef.current = false;
    playStartRef.current = cursorRef.current;
    try {
      await engineCall(() => e.play(cursorRef.current));
      let now = true;
      try {
        now = e.isPlaying();
      } catch (err) {
        // assume it started
      }
      setPlayingBoth(now);
    } catch (err) {
      report(err?.message || 'Could not start playback');
    }
  }, [report, setPlayingBoth]);

  const seek = useCallback(
    (beat) => {
      setCursorBeat(beat);
      const e = engineRef.current;
      if (!e) return;
      if (playingRef.current) {
        playStartRef.current = beat;
        engineCall(() => e.seek(beat)).catch((err) => report(err?.message || 'Could not seek'));
      } else {
        engineTry(() => e.seek(beat)); // keep the engine in step; play() passes the beat anyway
      }
    },
    [report]
  );

  const toggleMetronome = useCallback(() => {
    const next = !metronome;
    setMetronome(next);
    engineCall(() => engineRef.current?.setMetronome(next)).catch((err) =>
      report(err?.message || 'Could not toggle the metronome')
    );
  }, [metronome, report]);

  // ---------------- projects ----------------
  const refreshList = useCallback(async () => {
    try {
      const res = await listProjects();
      const list = res.data?.projects || [];
      setProjects(list);
      setListStatus('ready');
      return list;
    } catch (err) {
      setListStatus('error');
      report(errorMessage(err, 'Could not load projects'));
      return null;
    }
  }, [report]);

  const openLoaded = useCallback(
    (data) => {
      stopTransport();
      const p = data ? normalize(data) : null;
      load(p);
      setSelection([]);
      setSelectedTrackId(p?.tracks[0]?.id ?? null);
      setCursorBeat(0);
      engineTry(() => engineRef.current?.seek(0));
      remember(p?.id ?? null);
    },
    [load, stopTransport]
  );

  const openProject = useCallback(
    async (id) => {
      setBusy(true);
      try {
        await saveNow(); // the previous project's pending edits go first
        const res = await getProject(id);
        openLoaded(res.data);
      } catch (err) {
        report(errorMessage(err, 'Could not open the project'));
      } finally {
        setBusy(false);
      }
    },
    [openLoaded, report, saveNow]
  );

  // Initial load: the last opened project, else the most recently updated.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await refreshList();
      if (cancelled || !list?.length) return;
      const last = recall();
      await openProject(list.some((p) => p.id === last) ? last : list[0].id);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = useCallback(async () => {
    setBusy(true);
    try {
      await saveNow();
      const res = await createProject({});
      const p = normalize(res.data);
      openLoaded(p);
      setProjects((prev) => [summarize(p), ...prev.filter((x) => x.id !== p.id)]);
      setListStatus('ready');
    } catch (err) {
      report(errorMessage(err, 'Could not create a project'));
    } finally {
      setBusy(false);
    }
  }, [openLoaded, report, saveNow]);

  const handleDelete = useCallback(async () => {
    if (!project) return;
    const id = project.id;
    setBusy(true);
    try {
      await discard(); // never PUT a project that's about to be gone
      await deleteProject(id);
      const rest = projects.filter((p) => p.id !== id);
      setProjects(rest);
      if (rest.length) await openProject(rest[0].id);
      else openLoaded(null);
    } catch (err) {
      report(errorMessage(err, 'Could not delete the project'));
    } finally {
      setBusy(false);
    }
  }, [discard, openLoaded, openProject, project, projects, report]);

  const handleRename = useCallback((name) => dispatch({ type: 'setMeta', patch: { name } }), [dispatch]);

  // The list follows the open project's name (rename, and its undo/redo).
  const openId = project?.id;
  const openName = project?.name;
  useEffect(() => {
    if (!openId) return;
    setProjects((prev) =>
      prev.some((p) => p.id === openId && p.name !== openName)
        ? prev.map((p) => (p.id === openId ? { ...p, name: openName } : p))
        : prev
    );
  }, [openId, openName]);

  // ---------------- edits ----------------
  const setBpm = useCallback((bpm) => dispatch({ type: 'setMeta', patch: { bpm } }), [dispatch]);
  const setLoop = useCallback((loop) => dispatch({ type: 'setMeta', patch: { loop } }), [dispatch]);

  const toggleLoop = useCallback(() => {
    if (!project) return;
    const { loop } = project;
    if (loop.end_beat > loop.start_beat) {
      setLoop({ ...loop, enabled: !loop.enabled });
    } else {
      // No region yet: four bars from the bar under the playhead.
      const start = snapBeat(cursorRef.current, bpb, 'floor');
      setLoop({ enabled: true, start_beat: start, end_beat: start + 4 * bpb });
    }
  }, [project, bpb, setLoop]);

  const addTrack = useCallback(() => {
    if (!project) return;
    const track = makeTrack(`Track ${project.tracks.length + 1}`);
    dispatch({ type: 'addTrack', track });
    setSelectedTrackId(track.id);
  }, [dispatch, project]);

  // `coalesce` (slider scrubs) merges a gesture into one undo step; see useProjectState.
  const updateTrack = useCallback(
    (id, patch, coalesce) => dispatch({ type: 'updateTrack', trackId: id, patch, coalesce }),
    [dispatch]
  );
  const deleteTrack = useCallback((id) => dispatch({ type: 'deleteTrack', trackId: id }), [dispatch]);

  const selectClips = useCallback((ids, trackOf) => {
    setSelection(ids);
    if (trackOf) setSelectedTrackId(trackOf);
  }, []);

  const moveClips = useCallback((moves) => dispatch({ type: 'moveClips', moves }), [dispatch]);
  const updateClip = useCallback(
    (clipId, patch, coalesce) => dispatch({ type: 'updateClip', clipId, patch, coalesce }),
    [dispatch]
  );
  /** Several clip patches as one undo step: [{clipId, patch}]. */
  const updateClips = useCallback(
    (items) =>
      dispatch({ type: 'batch', actions: items.map(({ clipId, patch }) => ({ type: 'updateClip', clipId, patch })) }),
    [dispatch]
  );
  /** Edge trims: {length_sec} (right) or {start_beat, offset_sec, length_sec} (left). */
  const trimClip = useCallback((clipId, patch) => updateClip(clipId, patch), [updateClip]);

  /** Put a library sample on a track (null = a new track) at `beat`. */
  const placeSample = useCallback(
    (sample, targetTrackId, beat) => {
      if (!project || !sample) return;
      const clip = makeClip(sample, Math.max(0, beat));
      let tid = targetTrackId;
      const actions = [];
      if (!tid) {
        const track = makeTrack(`Track ${project.tracks.length + 1}`);
        actions.push({ type: 'addTrack', track });
        tid = track.id;
      }
      actions.push({ type: 'insertClips', items: [{ trackId: tid, clip }], samples: [sample] });
      dispatch({ type: 'batch', actions }); // one undo step, new track included
      setSelection([clip.id]);
      setSelectedTrackId(tid);
    },
    [dispatch, project]
  );

  const addAtPlayhead = useCallback(
    (sample) => placeSample(sample, trackId, snapBeat(clock.get(), step, 'floor')),
    [placeSample, trackId, clock, step]
  );

  const deleteSelected = useCallback(() => {
    if (liveSelection.length) dispatch({ type: 'deleteClips', clipIds: liveSelection });
    setSelection([]);
  }, [dispatch, liveSelection]);

  // Duplicates the selection as a block right after itself (for one clip:
  // right after its end), keeping each copy on its own track.
  const duplicateSelected = useCallback(() => {
    if (!project || !liveSelection.length) return;
    const ids = new Set(liveSelection);
    const picked = [];
    for (const t of project.tracks) for (const c of t.clips) if (ids.has(c.id)) picked.push({ trackId: t.id, clip: c });
    const start = Math.min(...picked.map((x) => x.clip.start_beat));
    const end = Math.max(...picked.map((x) => clipEndBeat(x.clip, project.samples[x.clip.sample_id], project.bpm)));
    const items = picked.map(({ trackId: tid, clip }) => ({
      trackId: tid,
      clip: { ...clip, id: newId(), start_beat: clip.start_beat + (end - start) },
    }));
    dispatch({ type: 'insertClips', items });
    setSelection(items.map((x) => x.clip.id));
  }, [dispatch, project, liveSelection]);

  // ---------------- mixdown ----------------
  const exportMix = useCallback(
    async (scope) => {
      const p = project;
      const e = engineRef.current;
      if (!p || !e || exporting) return;
      const { loop } = p;
      const useLoop = scope === 'loop' && loop && loop.end_beat > loop.start_beat;
      const fromBeat = useLoop ? loop.start_beat : 0;
      const toBeat = useLoop ? loop.end_beat : projectEndBeat(p);
      if (!(toBeat > fromBeat)) {
        report('Nothing to export: the project has no clips.');
        return;
      }
      setExporting(true);
      try {
        const buffer = await engineCall(() => e.renderOffline(p, { fromBeat, toBeat, sampleRate: EXPORT_SAMPLE_RATE }));
        downloadBlob(encodeWav(buffer, { bitDepth: 24 }), wavFileName(p.name));
      } catch (err) {
        report(`Export failed: ${err?.message || 'could not render the mix'}`);
      } finally {
        setExporting(false);
      }
    },
    [project, exporting, report]
  );

  // ---------------- keyboard ----------------
  const keys = useRef({});
  keys.current = { project, liveSelection, togglePlay, deleteSelected, duplicateSelected, undo, redo };

  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented) return;
      const k = keys.current;
      const key = (e.key || '').toLowerCase();
      // Undo/redo: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y. Text fields keep their own undo.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'z' || (key === 'y' && e.ctrlKey))) {
        if (isTextEntry(e.target) || !k.project) return;
        e.preventDefault();
        if (key === 'y' || e.shiftKey) k.redo();
        else k.undo();
        return;
      }
      if (isTyping(e.target)) return;
      if (!k.project) return;
      if (e.code === 'Space' || e.key === ' ') {
        if (e.repeat) return;
        e.preventDefault(); // no page scroll, no activating the focused button
        k.togglePlay();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!k.liveSelection.length) return;
        e.preventDefault();
        k.deleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        if (!k.liveSelection.length) return;
        e.preventDefault(); // browser bookmark shortcut
        k.duplicateSelected();
      } else if (e.key === 'Escape') {
        setSelection([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A slider scrub is one undo step: releasing the pointer or key closes it.
  // Deferred a tick, since a range input's final `change` follows mouseup.
  useEffect(() => {
    let timer = null;
    const seal = () => {
      clearTimeout(timer);
      timer = setTimeout(() => dispatch({ type: 'sealHistory' }), 0);
    };
    window.addEventListener('pointerup', seal, true);
    window.addEventListener('pointercancel', seal, true);
    window.addEventListener('keyup', seal, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerup', seal, true);
      window.removeEventListener('pointercancel', seal, true);
      window.removeEventListener('keyup', seal, true);
    };
  }, [dispatch]);

  const onZoom = useCallback((dir) => setZoom((z) => stepZoom(z, dir)), []);
  const onZoomTo = useCallback((z) => setZoom(clampZoom(z)), []);

  const retryList = async () => {
    clear();
    setListStatus('loading');
    const list = await refreshList();
    if (list?.length) await openProject(list[0].id);
  };

  // ---------------- render ----------------
  let body;
  if (!project) {
    body =
      listStatus === 'loading' || busy ? (
        <p className="m-0 border-t border-line py-10 text-center text-muted">Loading…</p>
      ) : listStatus === 'error' ? (
        <div className="flex flex-col items-center gap-3 border-t border-line py-12 text-center">
          <p className="m-0 text-h4">Projects are unavailable.</p>
          <TextButton onClick={retryList}>Retry</TextButton>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 border-t border-line py-12 text-center">
          <p className="m-0 text-h4">No projects yet.</p>
          <p className="m-0 max-w-[480px] text-muted">
            A project lays library samples out on tracks at one tempo.
          </p>
          <TextButton onClick={handleCreate} disabled={busy} label="New project" className="mt-2">
            <span className="inline-flex items-center gap-2">
              <FiPlus className="icon" strokeWidth={1.5} aria-hidden="true" />
              <span>New project</span>
            </span>
          </TextButton>
        </div>
      );
  } else {
    body = (
      <>
        <TransportBar
          clock={clock}
          playing={playing}
          loading={loading}
          bpm={project.bpm}
          beatsPerBar={bpb}
          loopEnabled={!!project.loop?.enabled}
          metronome={metronome}
          snap={snap}
          zoom={zoom}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          onTogglePlay={togglePlay}
          onBpmCommit={setBpm}
          onToggleLoop={toggleLoop}
          onToggleMetronome={toggleMetronome}
          onSnapChange={setSnap}
          onZoom={onZoom}
        />
        <div className="flex min-w-0 flex-col gap-8 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <Timeline
              project={project}
              engine={engine}
              clock={clock}
              pxPerBeat={zoom}
              step={step}
              selection={liveSelection}
              selectedTrackId={trackId}
              onSelectClips={selectClips}
              onSelectTrack={setSelectedTrackId}
              onUpdateTrack={updateTrack}
              onDeleteTrack={deleteTrack}
              onAddTrack={addTrack}
              onMoveClips={moveClips}
              onTrimClip={trimClip}
              onZoomTo={onZoomTo}
              onDropSample={placeSample}
              onSeek={seek}
              onLoopChange={setLoop}
            />
            <ClipInspector
              project={project}
              selection={liveSelection}
              loading={loading}
              onUpdateClip={updateClip}
              onUpdateClips={updateClips}
              onDuplicate={duplicateSelected}
              onDelete={deleteSelected}
            />
          </div>
          <aside className="min-w-0 lg:w-72 lg:shrink-0 xl:w-80">
            <SampleBrowser onAdd={addAtPlayhead} onError={report} />
          </aside>
        </div>
      </>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-5 pb-8 pt-4">
      <ProjectBar
        projects={projects}
        project={project}
        saveStatus={saveStatus}
        saveError={saveError}
        busy={busy}
        onOpen={openProject}
        onCreate={handleCreate}
        onRename={handleRename}
        onDelete={handleDelete}
        onRetrySave={saveNow}
        onShowList={refreshList}
        exporting={exporting}
        onExport={exportMix}
      />
      <ErrorBanner message={error} onDismiss={clear} />
      {body}
    </div>
  );
}

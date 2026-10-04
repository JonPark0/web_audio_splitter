import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ErrorBanner from '../../components/ErrorBanner';
import TextButton from '../../components/TextButton';
import { navigate, useRoute } from '../../router';
import { errorMessage, updateSample } from '../../samplesApi';
import { exportAudio } from '../exportAudio';
import {
  clipEndBeat,
  makeClip,
  makeTrack,
  newId,
  normalizeProject,
  projectEndBeat,
  splitClip,
} from '../project';
import { createProject, deleteProject, getProject, listProjects } from '../projectsApi';
import ClipInspector from './ClipInspector';
import { useLayoutMode, useCoarsePointer, useFillHeight, usePref } from './layout';
import { useMeterClock } from './Meters';
import { Menu, Sheet } from './Overlay';
import ProjectPanel from './ProjectPanel';
import SampleBrowser from './SampleBrowser';
import Timeline from './Timeline';
import {
  BpmInput,
  ExportControl,
  MasterSection,
  MoreButton,
  PlayButton,
  PositionReadout,
  ProjectPicker,
  SaveIndicator,
  SnapSelect,
  ZoomButtons,
} from './Toolbar';
import { PanSlider, VolumeSlider } from './TrackHeader';
import InlineName from './InlineName';
import { usePositionClock } from './playheadClock';
import {
  DEFAULT_LANE,
  DEFAULT_SNAP,
  DEFAULT_ZOOM,
  HEADER_WIDTH,
  LANE_HEIGHTS,
  PHONE_LANE,
  clampZoom,
  snapBeat,
  snapStep,
  stepZoom,
} from './snap';
import useEngine, { engineCall, engineTry, useErrorReporter } from './useEngine';
import useProjectState, { clearDraft, readDraft, sameDocument } from './useProjectState';

const LAST_PROJECT_KEY = 'arrange:lastProject';
const CLIPBOARD_KEY = 'arrange:clipboard';
const BOTTOM_BAR = 56;

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

function formatAgo(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const tap = '[@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px] items-center justify-center';

/**
 * Arrange: place library samples on tracks at one project tempo, play them
 * through the arrangement engine, autosave to the backend.
 *
 * Layout: one 44 px toolbar (40 px project row on phones) under the shell
 * header; the timeline fills the rest of the viewport and scrolls inside;
 * desktop has the sample browser on the right and the inspector docked
 * below; tablets/phones open them as drawer / bottom sheets; phones get a
 * fixed 56 px bottom transport.
 */
export default function ArrangeScreen() {
  const route = useRoute();
  const routeId = route.segments[0] || null;
  const mode = useLayoutMode();
  const coarse = useCoarsePointer();
  const phone = mode === 'phone';
  const desktop = mode === 'desktop';
  const { error, report, clear } = useErrorReporter();
  const {
    project,
    dispatch,
    saveStatus,
    saveError,
    retryAt,
    conflict,
    saveNow,
    retryNow,
    load,
    discard,
    reloadFromServer,
    keepMine,
    restoreDraft,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useProjectState({ onError: report });

  const [projects, setProjects] = useState([]);
  const [listStatus, setListStatus] = useState('loading'); // loading | ready | error
  const [busy, setBusy] = useState(false); // opening / creating / deleting
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(0);
  const [pending, setPending] = useState(() => new Set());
  const [cursorBeat, setCursorBeat] = useState(0); // playhead while stopped
  const [metronome, setMetronome] = useState(false);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [snap, setSnap] = useState(DEFAULT_SNAP);
  const [selection, setSelection] = useState([]);
  const [selectedTrackId, setSelectedTrackId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(null);
  const [sheet, setSheet] = useState(null); // samples | clip | project | more | projects | track:<id>
  const [armedSample, setArmedSample] = useState(null);
  const [draftOffer, setDraftOffer] = useState(null);
  const [viewWidth, setViewWidth] = useState(0);
  const [follow, setFollow] = usePref('arrange:follow', true);
  const [browserOpen, setBrowserOpen] = usePref('arrange:browser', true);
  const [laneHeight, setLaneHeight] = usePref(`arrange:lane:${project?.id || 'none'}`, DEFAULT_LANE);
  const [masterGain, setMasterGain] = usePref(`arrange:master:${project?.id || 'none'}`, 1);

  const playingRef = useRef(false);
  const userStopRef = useRef(false); // distinguishes Stop from the engine ending by itself
  const playStartRef = useRef(0);
  const cursorRef = useRef(0);
  cursorRef.current = cursorBeat;
  const engineRef = useRef(null);
  const openingRef = useRef(null);
  const clipboardRef = useRef(null);
  const rootRef = useRef(null);
  const moreRef = useRef(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  const setPlayingBoth = useCallback((p) => {
    playingRef.current = p;
    setPlaying(p);
  }, []);

  const engine = useEngine({
    onState: ({ playing: p, loading: l, pending: pend } = {}) => {
      if (typeof l === 'number') setLoading(l);
      if (Array.isArray(pend)) {
        setPending((prev) => (prev.size === pend.length && pend.every((id) => prev.has(id)) ? prev : new Set(pend)));
      }
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
  const meterClock = useMeterClock(engine, playing);

  const bpb = project?.beats_per_bar || 4;
  const step = snapStep(snap, bpb);
  const lane = phone ? PHONE_LANE : laneHeight;
  const headerWidth = HEADER_WIDTH[mode];
  const fill = useFillHeight(rootRef, phone ? BOTTOM_BAR : 0, 260);

  // Every project change goes to the engine (cheap and idempotent by contract).
  useEffect(() => {
    if (!engine || !project) return;
    engineCall(() => engine.setProject(project)).catch((err) => report(err?.message || 'Audio engine error', { once: true }));
  }, [engine, project, report]);

  useEffect(() => {
    if (!engine) return;
    engineTry(() => engine.setMasterGain?.(masterGain));
  }, [engine, masterGain]);

  // Selection survives only while its clips exist (delete, server sync, switch).
  const clipIds = useMemo(() => {
    const ids = new Set();
    project?.tracks.forEach((t) => t.clips.forEach((c) => ids.add(c.id)));
    return ids;
  }, [project]);
  const liveSelection = useMemo(() => selection.filter((id) => clipIds.has(id)), [selection, clipIds]);
  const trackId = project?.tracks.find((t) => t.id === selectedTrackId)?.id ?? project?.tracks[0]?.id ?? null;

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
      let pos = cursorRef.current;
      try {
        const b = e.getDisplayPositionBeats ? e.getDisplayPositionBeats() : e.getPositionBeats();
        if (Number.isFinite(b)) pos = b;
      } catch (err) {
        // keep the last cursor
      }
      try {
        e.stop();
      } catch (err) {
        report(err?.message || 'Could not stop playback');
      }
      setPlayingBoth(false);
      setCursorBeat(pos);
      engineTry(() => e.seek(pos));
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
      const b = Math.max(0, beat);
      setCursorBeat(b);
      const e = engineRef.current;
      if (!e) return;
      if (playingRef.current) {
        playStartRef.current = b;
        engineCall(() => e.seek(b)).catch((err) => report(err?.message || 'Could not seek'));
      } else {
        engineTry(() => e.seek(b));
      }
    },
    [report]
  );

  const toggleMetronome = useCallback(() => {
    setMetronome((m) => {
      const next = !m;
      engineCall(() => engineRef.current?.setMetronome(next)).catch((err) => report(err?.message || 'Could not toggle the metronome'));
      return next;
    });
  }, [report]);

  // ---------------- projects + routing ----------------
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
      const p = data ? normalizeProject(data) : null;
      load(p);
      setSelection([]);
      setSelectedTrackId(p?.tracks[0]?.id ?? null);
      setCursorBeat(0);
      setSheet(null);
      setArmedSample(null);
      engineTry(() => engineRef.current?.seek(0));
      remember(p?.id ?? null);
      // Unsaved edits from an earlier session of this project?
      setDraftOffer(null);
      if (p) {
        const draft = readDraft(p.id);
        if (draft?.project) {
          if (sameDocument(normalizeProject(draft.project), p)) clearDraft(p.id);
          else setDraftOffer({ ...draft, serverVersion: p.version });
        }
      }
    },
    [load, stopTransport]
  );

  const openProject = useCallback(
    async (id) => {
      if (openingRef.current === id) return;
      openingRef.current = id;
      setBusy(true);
      try {
        await saveNow(); // the previous project's pending edits go first
        const res = await getProject(id);
        if (openingRef.current === id) openLoaded(res.data);
      } catch (err) {
        if (err?.response?.status === 404) {
          report('That project no longer exists.');
          if (recall() === id) remember(null);
          navigate('/arrange', { replace: true });
        } else {
          report(errorMessage(err, 'Could not open the project'));
        }
      } finally {
        if (openingRef.current === id) openingRef.current = null;
        setBusy(false);
      }
    },
    [openLoaded, report, saveNow]
  );

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // The URL decides which project is open: /arrange/<id>. Bare /arrange
  // opens the last one (or the most recent) by replacing the URL.
  // Opening follows the URL only (not list refreshes), and compares with the
  // latest open project: create/delete open the document first and then
  // change the URL, which must not re-open the previous one.
  useEffect(() => {
    if (routeId && routeId !== projectRef.current?.id) openProject(routeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);
  useEffect(() => {
    if (routeId || listStatus !== 'ready') return;
    if (!projects.length) {
      if (projectRef.current) openLoaded(null);
      return;
    }
    const last = recall();
    const id = projects.some((p) => p.id === last) ? last : projects[0].id;
    navigate(`/arrange/${id}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, listStatus, projects.length]);

  const handleCreate = useCallback(async () => {
    setBusy(true);
    try {
      await saveNow();
      const res = await createProject({});
      const p = normalizeProject(res.data);
      openLoaded(p);
      setProjects((prev) => [summarize(p), ...prev.filter((x) => x.id !== p.id)]);
      setListStatus('ready');
      navigate(`/arrange/${p.id}`);
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
      if (recall() === id) remember(null);
      if (rest.length) navigate(`/arrange/${rest[0].id}`, { replace: true });
      else {
        openLoaded(null);
        navigate('/arrange', { replace: true });
      }
    } catch (err) {
      report(errorMessage(err, 'Could not delete the project'));
    } finally {
      setBusy(false);
    }
  }, [discard, openLoaded, project, projects, report]);

  const openFromPicker = useCallback((id) => navigate(`/arrange/${id}`), []);
  const handleRename = useCallback((name) => dispatch({ type: 'setMeta', patch: { name } }), [dispatch]);

  // The list follows the open project's name (rename, and its undo/redo).
  const openId = project?.id;
  const openName = project?.name;
  useEffect(() => {
    if (!openId) return;
    setProjects((prev) =>
      prev.some((p) => p.id === openId && p.name !== openName) ? prev.map((p) => (p.id === openId ? { ...p, name: openName } : p)) : prev
    );
  }, [openId, openName]);

  // ---------------- edits ----------------
  const setMeta = useCallback((patch) => dispatch({ type: 'setMeta', patch }), [dispatch]);
  const setBpm = useCallback((bpm) => setMeta({ bpm }), [setMeta]);
  const setLoop = useCallback((loop) => setMeta({ loop }), [setMeta]);

  const toggleLoop = useCallback(() => {
    const p = projectRef.current;
    if (!p) return;
    const { loop } = p;
    if (loop.end_beat > loop.start_beat) setLoop({ ...loop, enabled: !loop.enabled });
    else {
      // No region yet: four bars from the bar under the playhead.
      const start = snapBeat(cursorRef.current, p.beats_per_bar, 'floor');
      setLoop({ enabled: true, start_beat: start, end_beat: start + 4 * p.beats_per_bar });
    }
  }, [setLoop]);

  const addTrack = useCallback(() => {
    if (!project) return;
    const track = makeTrack(`Track ${project.tracks.length + 1}`);
    dispatch({ type: 'addTrack', track });
    setSelectedTrackId(track.id);
  }, [dispatch, project]);

  const updateTrack = useCallback((id, patch, coalesce) => dispatch({ type: 'updateTrack', trackId: id, patch, coalesce }), [dispatch]);
  const deleteTrack = useCallback(
    (id) => {
      dispatch({ type: 'deleteTrack', trackId: id });
      setSheet((s) => (s === `track:${id}` ? null : s));
    },
    [dispatch]
  );
  const moveTrack = useCallback((id, toIndex) => dispatch({ type: 'moveTrack', trackId: id, toIndex }), [dispatch]);

  const selectClips = useCallback((ids, trackOf) => {
    setSelection(ids);
    if (trackOf) setSelectedTrackId(trackOf);
  }, []);

  const moveClips = useCallback((moves) => dispatch({ type: 'moveClips', moves, resolve: moves.map((m) => m.clipId) }), [dispatch]);
  /** opts: true (a trim: resolve overlaps) | { coalesce, resolve } */
  const patchClip = useCallback(
    (clipId, patch, opts) => {
      const o = opts === true ? { resolve: true } : opts || {};
      dispatch({ type: 'updateClip', clipId, patch, coalesce: o.coalesce, resolve: o.resolve ? [clipId] : undefined });
    },
    [dispatch]
  );
  /** Several clip patches as one undo step: [{clipId, patch}]. */
  const patchClips = useCallback(
    (items) =>
      dispatch({
        type: 'batch',
        actions: items.map(({ clipId, patch }) => ({ type: 'updateClip', clipId, patch })),
        resolve: items.map((i) => i.clipId),
      }),
    [dispatch]
  );

  /** Put a library sample on a track (null = a new track) at `beat`. */
  const placeSample = useCallback(
    (sample, targetTrackId, beat) => {
      const p = projectRef.current;
      if (!p || !sample) return;
      const clip = makeClip(sample, Math.max(0, beat));
      let tid = targetTrackId;
      const actions = [];
      if (!tid) {
        const track = makeTrack(`Track ${p.tracks.length + 1}`);
        actions.push({ type: 'addTrack', track });
        tid = track.id;
      }
      actions.push({ type: 'insertClips', items: [{ trackId: tid, clip }], samples: [sample] });
      dispatch({ type: 'batch', actions, resolve: [clip.id] }); // one undo step, new track included
      setSelection([clip.id]);
      setSelectedTrackId(tid);
    },
    [dispatch]
  );

  const addAtPlayhead = useCallback(
    (sample) => {
      placeSample(sample, trackId, snapBeat(clock.get(), step, 'floor'));
      if (!desktop) setSheet(null);
    },
    [placeSample, trackId, clock, step, desktop]
  );

  const armSample = useCallback((sample) => {
    setArmedSample(sample);
    setSheet(null);
  }, []);
  const placeArmed = useCallback(
    (tid, beat) => {
      if (!armedSample) return;
      placeSample(armedSample, tid, beat);
      setArmedSample(null);
    },
    [armedSample, placeSample]
  );

  const pickedClips = useCallback(() => {
    const p = projectRef.current;
    const ids = new Set(liveSelection);
    const picked = [];
    p.tracks.forEach((t, ti) => t.clips.forEach((c) => ids.has(c.id) && picked.push({ trackId: t.id, trackIndex: ti, clip: c })));
    return picked;
  }, [liveSelection]);

  const deleteSelected = useCallback(() => {
    if (liveSelection.length) dispatch({ type: 'deleteClips', clipIds: liveSelection });
    setSelection([]);
  }, [dispatch, liveSelection]);

  /** Copies of the selection shifted by `offset(start, end)` beats, as one undo step. */
  const duplicateBy = useCallback(
    (offsetFn) => {
      const p = projectRef.current;
      if (!p || !liveSelection.length) return;
      const picked = pickedClips();
      const start = Math.min(...picked.map((x) => x.clip.start_beat));
      const end = Math.max(...picked.map((x) => clipEndBeat(x.clip, p.samples[x.clip.sample_id], p.bpm)));
      const off = offsetFn(start, end, p);
      const items = picked.map(({ trackId: tid, clip }) => ({ trackId: tid, clip: { ...clip, id: newId(), start_beat: clip.start_beat + off } }));
      dispatch({ type: 'insertClips', items, resolve: items.map((x) => x.clip.id) });
      setSelection(items.map((x) => x.clip.id));
    },
    [dispatch, liveSelection, pickedClips]
  );
  const duplicateSelected = useCallback(() => duplicateBy((s, e) => e - s), [duplicateBy]);
  // Next bar line at or after the selection's end.
  const duplicateNextBar = useCallback(
    () => duplicateBy((s, e, p) => snapBeat(e, p.beats_per_bar, 'ceil') - snapBeat(s, p.beats_per_bar, 'floor')),
    [duplicateBy]
  );

  const splitAtPlayhead = useCallback(() => {
    const p = projectRef.current;
    if (!p) return;
    const at = clock.get();
    const sel = new Set(liveSelection);
    const targets = [];
    p.tracks.forEach((t) =>
      t.clips.forEach((c) => {
        const inside = c.start_beat < at && clipEndBeat(c, p.samples[c.sample_id], p.bpm) > at;
        if (inside && (sel.size ? sel.has(c.id) : t.id === trackId)) targets.push({ trackId: t.id, clip: c });
      })
    );
    if (!targets.length) return;
    const actions = [];
    const ids = [];
    for (const { trackId: tid, clip } of targets) {
      const parts = splitClip(clip, p.samples[clip.sample_id], p.bpm, at);
      if (!parts) continue;
      const [left, right] = parts;
      const { id, ...leftPatch } = left;
      actions.push({ type: 'updateClip', clipId: id, patch: leftPatch });
      actions.push({ type: 'insertClips', items: [{ trackId: tid, clip: right }] });
      ids.push(clip.id, right.id);
    }
    if (actions.length) {
      dispatch({ type: 'batch', actions });
      setSelection(ids);
    }
  }, [clock, dispatch, liveSelection, trackId]);

  const copySelected = useCallback(() => {
    const p = projectRef.current;
    if (!p || !liveSelection.length) return false;
    const picked = pickedClips();
    const start = Math.min(...picked.map((x) => x.clip.start_beat));
    const firstTrack = Math.min(...picked.map((x) => x.trackIndex));
    const data = {
      items: picked.map(({ trackIndex, clip }) => ({ dTrack: trackIndex - firstTrack, clip: { ...clip, start_beat: clip.start_beat - start } })),
      samples: picked.map(({ clip }) => p.samples[clip.sample_id]).filter(Boolean),
    };
    clipboardRef.current = data;
    try {
      localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(data));
    } catch (e) {
      // in-memory clipboard still works
    }
    return true;
  }, [liveSelection, pickedClips]);

  const cutSelected = useCallback(() => {
    if (copySelected()) deleteSelected();
  }, [copySelected, deleteSelected]);

  // Paste at the playhead on the selected track; multi-track copies keep
  // their track offsets (clamped to the last track).
  const paste = useCallback(() => {
    const p = projectRef.current;
    if (!p || !p.tracks.length) return;
    let data = clipboardRef.current;
    if (!data) {
      try {
        data = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) || 'null');
      } catch (e) {
        data = null;
      }
    }
    if (!data?.items?.length) return;
    const at = snapBeat(clock.get(), step, 'floor');
    const base = Math.max(0, p.tracks.findIndex((t) => t.id === trackId));
    const items = data.items.map(({ dTrack, clip }) => ({
      trackId: p.tracks[Math.min(p.tracks.length - 1, base + dTrack)].id,
      clip: { ...clip, id: newId(), start_beat: at + clip.start_beat },
    }));
    dispatch({ type: 'insertClips', items, samples: data.samples, resolve: items.map((x) => x.clip.id) });
    setSelection(items.map((x) => x.clip.id));
  }, [clock, dispatch, step, trackId]);

  const selectAll = useCallback(() => {
    const p = projectRef.current;
    if (p) setSelection(p.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  }, []);

  const nudge = useCallback(
    (dir, bar) => {
      const p = projectRef.current;
      if (!p || !liveSelection.length) return;
      const delta = (bar ? p.beats_per_bar : step || 0.25) * dir;
      const picked = pickedClips();
      const minStart = Math.min(...picked.map((x) => x.clip.start_beat));
      const d = Math.max(delta, -minStart);
      if (!d) return;
      moveClips(picked.map(({ trackId: tid, clip }) => ({ clipId: clip.id, trackId: tid, start_beat: clip.start_beat + d })));
    },
    [liveSelection, moveClips, pickedClips, step]
  );

  const moveSelectionTracks = useCallback(
    (dir) => {
      const p = projectRef.current;
      if (!p || !liveSelection.length) return;
      const picked = pickedClips();
      const min = Math.min(...picked.map((x) => x.trackIndex));
      const max = Math.max(...picked.map((x) => x.trackIndex));
      if (min + dir < 0 || max + dir >= p.tracks.length) return;
      moveClips(picked.map(({ trackIndex, clip }) => ({ clipId: clip.id, trackId: p.tracks[trackIndex + dir].id, start_beat: clip.start_beat })));
    },
    [liveSelection, moveClips, pickedClips]
  );

  // ---------------- markers ----------------
  const addMarker = useCallback(() => {
    const p = projectRef.current;
    if (!p) return;
    const beat = snapBeat(clock.get(), step || 0.25, 'round');
    const markers = [...(p.markers || []).filter((m) => Math.abs(m.beat - beat) > 1e-6), { id: newId(), beat, name: `Marker ${(p.markers?.length || 0) + 1}` }];
    setMeta({ markers: markers.sort((a, b) => a.beat - b.beat) });
  }, [clock, setMeta, step]);
  const renameMarker = useCallback(
    (id, name) => {
      const p = projectRef.current;
      if (p) setMeta({ markers: p.markers.map((m) => (m.id === id ? { ...m, name } : m)) });
    },
    [setMeta]
  );
  const deleteMarker = useCallback(
    (id) => {
      const p = projectRef.current;
      if (p) setMeta({ markers: p.markers.filter((m) => m.id !== id) });
    },
    [setMeta]
  );

  // ---------------- sample BPM (library) ----------------
  const setSampleBpm = useCallback(
    async (sample, bpm, { warpClipId } = {}) => {
      try {
        const res = await updateSample(sample.id, { bpm });
        dispatch({ type: 'updateSample', sample: res.data });
        if (warpClipId) patchClip(warpClipId, { warp: true }, { resolve: true });
      } catch (err) {
        report(errorMessage(err, 'Could not set the sample BPM'));
      }
    },
    [dispatch, patchClip, report]
  );

  // ---------------- view ----------------
  const onZoom = useCallback((dir) => setZoom((z) => stepZoom(z, dir)), []);
  const onZoomTo = useCallback((z) => setZoom(clampZoom(z)), []);
  const zoomToFit = useCallback(() => {
    const p = projectRef.current;
    if (!p || !viewWidth) return;
    const end = Math.max(projectEndBeat(p), p.loop?.enabled ? p.loop.end_beat : 0, p.beats_per_bar * 4);
    setZoom(clampZoom((viewWidth - 16) / end));
  }, [viewWidth]);

  // ---------------- export ----------------
  const doExport = useCallback(
    async (opts) => {
      const p = projectRef.current;
      const e = engineRef.current;
      if (!p || !e || exporting) return;
      setExporting(true);
      setExportProgress(null);
      try {
        await exportAudio(e, p, { ...opts, masterGain, onProgress: setExportProgress });
      } catch (err) {
        report(`Export failed: ${err?.message || 'could not render the mix'}`);
      } finally {
        setExporting(false);
        setExportProgress(null);
      }
    },
    [exporting, masterGain, report]
  );

  // ---------------- keyboard ----------------
  const keys = useRef({});
  keys.current = {
    project,
    liveSelection,
    togglePlay,
    deleteSelected,
    duplicateSelected,
    undo,
    redo,
    copySelected,
    cutSelected,
    paste,
    splitAtPlayhead,
    selectAll,
    nudge,
    moveSelectionTracks,
    toggleLoop,
    seek,
    onZoom,
    armedSample,
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented) return;
      const k = keys.current;
      const key = (e.key || '').toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      // Undo/redo: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y. Text fields keep their own undo.
      if (mod && !e.altKey && (key === 'z' || (key === 'y' && e.ctrlKey))) {
        if (isTextEntry(e.target) || !k.project) return;
        e.preventDefault();
        if (key === 'y' || e.shiftKey) k.redo();
        else k.undo();
        return;
      }
      if (isTyping(e.target) || !k.project) return;
      const sel = k.liveSelection.length > 0;
      const handled = (() => {
        if (e.code === 'Space' || e.key === ' ') {
          if (!e.repeat) k.togglePlay();
          return true;
        }
        if (mod && key === 'c') return sel && (k.copySelected(), true);
        if (mod && key === 'x') return sel && (k.cutSelected(), true);
        if (mod && key === 'v') return k.paste(), true;
        if (mod && key === 'a') return k.selectAll(), true;
        if (mod && key === 'd') return sel && (k.duplicateSelected(), true);
        if (mod && key === 'e') return k.splitAtPlayhead(), true;
        if (mod || e.altKey) return false;
        if (key === 's') return k.splitAtPlayhead(), true;
        if (key === 'l') return k.toggleLoop(), true;
        if (e.key === 'Home') return k.seek(0), true;
        if (e.key === '+' || e.key === '=') return k.onZoom(1), true;
        if (e.key === '-' || e.key === '_') return k.onZoom(-1), true;
        if (e.key === 'Delete' || e.key === 'Backspace') return sel && (k.deleteSelected(), true);
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return sel && (k.nudge(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey), true);
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') return sel && (k.moveSelectionTracks(e.key === 'ArrowUp' ? -1 : 1), true);
        if (e.key === 'Escape') {
          setSelection([]);
          setArmedSample(null);
          return true;
        }
        return false;
      })();
      if (handled) e.preventDefault();
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

  // The clip sheet closes itself when the selection goes away.
  useEffect(() => {
    if (sheet === 'clip' && !liveSelection.length) setSheet(null);
  }, [sheet, liveSelection.length]);

  const retryList = async () => {
    clear();
    setListStatus('loading');
    await refreshList();
  };

  // ---------------- render ----------------
  const pickerProps = {
    projects,
    project,
    busy,
    onOpen: openFromPicker,
    onCreate: handleCreate,
    onRename: handleRename,
    onDelete: handleDelete,
    onShowList: refreshList,
  };

  const saveIndicator = project && (
    <SaveIndicator status={saveStatus} error={saveError} retryAt={retryAt} onRetry={retryNow} compact={!desktop} />
  );

  const viewItems = project
    ? [
        ...LANE_HEIGHTS.map((h) => ({
          key: `lh${h}`,
          label: `Lanes: ${h === 40 ? 'small' : h === 64 ? 'medium' : 'large'} (${h} px)`,
          checked: laneHeight === h,
          onSelect: () => setLaneHeight(h),
        })),
        { separator: true },
        { label: 'Follow playhead', checked: !!follow, onSelect: () => setFollow((f) => !f) },
        { label: 'Zoom to fit', onSelect: zoomToFit },
        { separator: true },
        { label: 'Add marker at playhead', onSelect: addMarker },
        { label: 'Project settings…', onSelect: () => setSheet('project') },
      ]
    : [];
  const editItems = project
    ? [
        { label: 'Split at playhead', hint: 'S', onSelect: splitAtPlayhead },
        { label: 'Copy', hint: 'Ctrl+C', disabled: !liveSelection.length, onSelect: copySelected },
        { label: 'Paste at playhead', hint: 'Ctrl+V', onSelect: paste },
        { label: 'Select all', hint: 'Ctrl+A', onSelect: selectAll },
      ]
    : [];
  const moreItems = (
    desktop
      ? [{ label: 'Click (metronome)', checked: metronome, onSelect: toggleMetronome }, { separator: true }, ...viewItems, { separator: true }, ...editItems]
      : [
          { label: 'Redo', disabled: !canRedo, onSelect: redo },
          { label: 'Click (metronome)', checked: metronome, onSelect: toggleMetronome },
          { content: <SnapSelect snap={snap} onSnapChange={setSnap} />, key: 'snap' },
          { content: <ZoomButtons zoom={zoom} onZoom={onZoom} onFit={zoomToFit} />, key: 'zoom' },
          { separator: true },
          ...editItems,
          { separator: true },
          ...viewItems.filter((i) => !phone || !i.key?.startsWith('lh')),
        ]
  ).filter(Boolean);

  const selectedTrack = sheet?.startsWith('track:') ? project?.tracks.find((t) => `track:${t.id}` === sheet) : null;

  const inspector = project && liveSelection.length > 0 && (
    <ClipInspector
      project={project}
      selection={liveSelection}
      pending={pending}
      variant={desktop ? 'dock' : 'sheet'}
      onPatchClip={patchClip}
      onPatchClips={patchClips}
      onDuplicate={duplicateSelected}
      onDuplicateNextBar={duplicateNextBar}
      onSplit={splitAtPlayhead}
      onDelete={deleteSelected}
      onSampleBpm={setSampleBpm}
    />
  );
  const projectPanel = project && (
    <ProjectPanel
      project={project}
      variant={desktop ? 'dock' : 'sheet'}
      onLoopChange={setLoop}
      onMetaChange={setMeta}
      onAddMarker={addMarker}
      onJump={seek}
      onRenameMarker={renameMarker}
      onDeleteMarker={deleteMarker}
      showHints={desktop && !coarse}
    />
  );

  // ---- toolbar (tablet/desktop) or project row (phone) ----
  const toolbar = phone ? (
    <div className="sticky top-12 z-20 flex h-10 items-center gap-3 border-b border-line bg-paper">
      <ProjectPicker {...pickerProps} className="min-w-0 flex-1" />
      {saveIndicator}
      {project && (
        <TextButton muted current={sheet === 'samples'} onClick={() => setSheet((s) => (s === 'samples' ? null : 'samples'))} className={tap}>
          Samples
        </TextButton>
      )}
      {project && (
        <ExportControl project={project} exporting={exporting} progress={exportProgress} disabled={busy} onExport={doExport} />
      )}
    </div>
  ) : (
    <div className="sticky top-12 z-20 flex h-11 items-center gap-x-2.5 border-b border-line bg-paper lg:gap-x-4 xl:gap-x-5">
      <ProjectPicker {...pickerProps} className={desktop ? 'max-w-[200px]' : 'w-[112px] shrink-0'} />
      {desktop && saveIndicator}
      {project && (
        <>
          <span className="flex items-center gap-2">
            <PlayButton playing={playing} onToggle={togglePlay} />
            <PositionReadout clock={clock} beatsPerBar={bpb} className="w-[4.5rem] text-h4" />
          </span>
          <BpmInput bpm={project.bpm} onCommit={setBpm} showLabel={desktop} />
          <TextButton muted current={!!project.loop?.enabled} aria-pressed={!!project.loop?.enabled} onClick={toggleLoop} title="Loop (L)" className={tap}>
            Loop
          </TextButton>
          {desktop && (
            <TextButton muted current={metronome} aria-pressed={metronome} onClick={toggleMetronome} title="Metronome" className="hidden xl:inline-flex">
              Click
            </TextButton>
          )}
          {desktop && <SnapSelect snap={snap} onSnapChange={setSnap} />}
          {desktop && <ZoomButtons zoom={zoom} onZoom={onZoom} onFit={zoomToFit} />}
          <span className="flex items-center gap-3">
            <TextButton muted onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)" className={tap}>
              Undo
            </TextButton>
            {desktop && (
              <TextButton muted onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)" className={tap}>
                Redo
              </TextButton>
            )}
          </span>
          {loading > 0 && desktop && <span className="hidden text-caption text-muted 2xl:inline">Loading audio…</span>}
          <span className="ml-auto flex items-center gap-x-2.5 lg:gap-x-4">
            {!desktop && !['saved', 'idle'].includes(saveStatus) && saveIndicator}
            <ExportControl project={project} exporting={exporting} progress={exportProgress} disabled={busy} onExport={doExport} />
            {desktop && <MasterSection meterClock={meterClock} masterGain={masterGain} onMasterGain={setMasterGain} showFader />}
            {!desktop && liveSelection.length > 0 && (
              <TextButton muted current={sheet === 'clip'} onClick={() => setSheet((s) => (s === 'clip' ? null : 'clip'))} className={tap}>
                Clip
              </TextButton>
            )}
            <TextButton
              muted
              current={desktop ? browserOpen : sheet === 'samples'}
              aria-pressed={desktop ? browserOpen : sheet === 'samples'}
              onClick={() => (desktop ? setBrowserOpen((o) => !o) : setSheet((s) => (s === 'samples' ? null : 'samples')))}
              title={desktop ? 'Show or hide the sample browser' : 'Samples'}
              className={tap}
            >
              Samples
            </TextButton>
            <MoreButton open={sheet === 'more'} onToggle={() => setSheet((s) => (s === 'more' ? null : 'more'))} anchorRef={moreRef} />
            <Menu open={sheet === 'more'} onClose={() => setSheet(null)} items={moreItems} anchorRef={moreRef} title="More" />
          </span>
        </>
      )}
    </div>
  );

  // ---- banners: errors, conflict, draft restore, placement ----
  const banners = (
    <div className="flex flex-col empty:hidden">
      <ErrorBanner message={error} onDismiss={clear} />
      {conflict && (
        <div role="alert" className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line py-1">
          <span>Changed in another tab or window.</span>
          <TextButton onClick={reloadFromServer} className={tap} title="Load the saved version (your unsaved edits are dropped)">
            Reload
          </TextButton>
          <TextButton onClick={keepMine} className={tap} title="Save this version over the other one">
            Keep mine
          </TextButton>
        </div>
      )}
      {draftOffer && project && draftOffer.project?.id === project.id && (
        <div role="status" className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line py-1">
          <span>
            Unsaved changes from {formatAgo(draftOffer.savedAt)} are on this device
            {Number.isInteger(draftOffer.baseVersion) && Number.isInteger(draftOffer.serverVersion) && draftOffer.baseVersion !== draftOffer.serverVersion
              ? ' (the project was saved elsewhere since)'
              : ''}
            .
          </span>
          <TextButton
            onClick={() => {
              restoreDraft(draftOffer.project);
              setDraftOffer(null);
            }}
            className={tap}
          >
            Restore
          </TextButton>
          <TextButton
            muted
            onClick={() => {
              clearDraft(project.id);
              setDraftOffer(null);
            }}
            className={tap}
          >
            Discard
          </TextButton>
        </div>
      )}
      {armedSample && (
        <div role="status" className="flex items-baseline gap-4 border-b border-line py-1">
          <span className="min-w-0 truncate">Tap a lane to place “{armedSample.name}”.</span>
          <TextButton muted onClick={() => setArmedSample(null)} className={tap}>
            Cancel
          </TextButton>
        </div>
      )}
    </div>
  );

  let body;
  if (!project) {
    body =
      listStatus === 'loading' || busy ? (
        <p className="m-0 py-10 text-center text-muted">Loading…</p>
      ) : listStatus === 'error' ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="m-0 text-muted">Projects are unavailable.</p>
          <TextButton onClick={retryList}>Retry</TextButton>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="m-0 text-muted">No projects yet.</p>
          <p className="m-0 max-w-measure">A project lays library samples out on tracks at one tempo.</p>
          <TextButton onClick={handleCreate} disabled={busy} className="mt-2">
            New project
          </TextButton>
        </div>
      );
  } else {
    body = (
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <Timeline
              project={project}
              engine={engine}
              clock={clock}
              meterClock={meterClock}
              height="100%"
              pxPerBeat={zoom}
              step={step}
              laneHeight={lane}
              headerWidth={headerWidth}
              mode={mode}
              coarse={coarse}
              follow={follow}
              selection={liveSelection}
              selectedTrackId={trackId}
              pending={pending}
              armedSample={armedSample}
              onSelectClips={selectClips}
              onSelectTrack={setSelectedTrackId}
              onUpdateTrack={updateTrack}
              onDeleteTrack={deleteTrack}
              onMoveTrack={moveTrack}
              onOpenTrack={(id) => setSheet(`track:${id}`)}
              onAddTrack={addTrack}
              onMoveClips={moveClips}
              onPatchClip={patchClip}
              onZoomTo={onZoomTo}
              onDropSample={placeSample}
              onPlaceArmed={placeArmed}
              onSeek={seek}
              onLoopChange={setLoop}
              onRenameMarker={renameMarker}
              onViewWidth={setViewWidth}
            />
          </div>
          {desktop && (
            <div className="h-[124px] shrink-0 overflow-y-auto border-t border-line pt-1.5">{inspector || projectPanel}</div>
          )}
        </div>
        {desktop && browserOpen && (
          <aside className="flex w-[300px] shrink-0 flex-col border-l border-line pl-4 pt-1.5 2xl:w-[340px]">
            <div className="flex items-baseline justify-between pb-1">
              <h2 className="m-0 text-h4 font-light">Samples</h2>
              <TextButton muted onClick={() => setBrowserOpen(false)} className="text-caption">
                Hide
              </TextButton>
            </div>
            <SampleBrowser onAdd={addAtPlayhead} onArm={armSample} onError={report} coarse={coarse} className="min-h-0 flex-1" />
          </aside>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex w-full min-w-0 flex-col" style={{ height: project && fill ? fill : undefined }}>
      {toolbar}
      {banners}
      {body}

      {/* Phone: fixed bottom transport (one bottom bar per screen). */}
      {phone && project && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)]">
          <div className="flex h-14 items-center justify-between gap-1 px-2">
            <PlayButton playing={playing} onToggle={togglePlay} big />
            <PositionReadout clock={clock} beatsPerBar={bpb} className="w-[4.25rem] text-h4" />
            {liveSelection.length > 0 ? (
              <TextButton current={sheet === 'clip'} onClick={() => setSheet((s) => (s === 'clip' ? null : 'clip'))} className={tap}>
                Clip
              </TextButton>
            ) : (
              <BpmInput bpm={project.bpm} onCommit={setBpm} />
            )}
            <TextButton muted current={!!project.loop?.enabled} aria-pressed={!!project.loop?.enabled} onClick={toggleLoop} className={tap}>
              Loop
            </TextButton>
            <TextButton muted onClick={undo} disabled={!canUndo} className={tap}>
              Undo
            </TextButton>
            <MoreButton open={sheet === 'more'} onToggle={() => setSheet((s) => (s === 'more' ? null : 'more'))} anchorRef={moreRef} />
          </div>
        </div>
      )}
      {phone && <Menu open={sheet === 'more'} onClose={() => setSheet(null)} items={moreItems} anchorRef={moreRef} asSheet title="More" />}

      {/* Tablet/phone panels */}
      {!desktop && project && (
        <>
          <Sheet
            open={sheet === 'samples'}
            title="Samples"
            side={phone ? 'bottom' : 'right'}
            onClose={() => setSheet(null)}
            bodyClassName="flex flex-col px-4 py-2"
            maxHeight="75dvh"
          >
            <SampleBrowser onAdd={addAtPlayhead} onArm={armSample} onError={report} coarse={coarse} className={phone ? 'h-[60dvh]' : 'h-full'} />
          </Sheet>
          <Sheet open={sheet === 'clip' && liveSelection.length > 0} title={liveSelection.length > 1 ? `${liveSelection.length} clips` : 'Clip'} onClose={() => setSheet(null)}>
            {inspector}
          </Sheet>
          <Sheet open={sheet === 'project'} title="Project" onClose={() => setSheet(null)}>
            {projectPanel}
          </Sheet>
          <Sheet open={!!selectedTrack} title={selectedTrack?.name || 'Track'} onClose={() => setSheet(null)}>
            {selectedTrack && (
              <TrackSheet
                track={selectedTrack}
                index={project.tracks.indexOf(selectedTrack)}
                count={project.tracks.length}
                onUpdate={updateTrack}
                onMove={moveTrack}
                onDelete={deleteTrack}
              />
            )}
          </Sheet>
        </>
      )}
      {desktop && project && (
        <Sheet open={sheet === 'project'} title="Project" onClose={() => setSheet(null)}>
          {projectPanel}
        </Sheet>
      )}
    </div>
  );
}

/** Phone/tablet track settings: name, mute/solo, volume, pan, order, delete. */
function TrackSheet({ track, index, count, onUpdate, onMove, onDelete }) {
  const [asking, setAsking] = useState(false);
  const set = (patch, coalesce) => onUpdate(track.id, patch, coalesce);
  const btn = '[@media(pointer:coarse)]:min-h-[44px] justify-center';
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <InlineName value={track.name} label="Track name" onCommit={(name) => set({ name })} className="text-h4" inputClassName="w-full text-p" />
      <div className="flex items-center gap-6">
        <TextButton current={track.muted} aria-pressed={track.muted} onClick={() => set({ muted: !track.muted })} className={btn}>
          Mute
        </TextButton>
        <TextButton current={track.soloed} aria-pressed={track.soloed} onClick={() => set({ soloed: !track.soloed })} className={btn}>
          Solo
        </TextButton>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-caption text-muted">Volume</span>
        <VolumeSlider track={track} set={set} className="min-h-[44px]" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-caption text-muted">Pan</span>
        <PanSlider track={track} set={set} className="min-h-[44px]" />
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <TextButton muted disabled={index === 0} onClick={() => onMove(track.id, index - 1)} className={btn}>
          Move up
        </TextButton>
        <TextButton muted disabled={index >= count - 1} onClick={() => onMove(track.id, index + 1)} className={btn}>
          Move down
        </TextButton>
        {asking ? (
          <span className="flex items-center gap-4">
            <span>Delete with {track.clips.length} clips?</span>
            <TextButton onClick={() => onDelete(track.id)} className={btn}>
              Confirm
            </TextButton>
            <TextButton muted onClick={() => setAsking(false)} className={btn}>
              Cancel
            </TextButton>
          </span>
        ) : (
          <TextButton muted onClick={() => (track.clips.length ? setAsking(true) : onDelete(track.id))} className={btn}>
            Delete track
          </TextButton>
        )}
      </div>
    </div>
  );
}

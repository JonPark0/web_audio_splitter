import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { saveProject } from '../projectsApi';
import { errorMessage } from '../../samplesApi';

const SAVE_DEBOUNCE_MS = 800;
const HISTORY_LIMIT = 100;

// Only the fields the project model embeds (project.js ProjectSample).
export function toProjectSample(s) {
  return { id: s.id, name: s.name, duration_sec: s.duration_sec, bpm: s.bpm ?? null, key: s.key ?? null, audio_url: s.audio_url };
}

const mapTracks = (project, fn) => ({ ...project, tracks: project.tracks.map(fn) });

function withSample(project, sample) {
  if (!sample || project.samples?.[sample.id]) return project;
  return { ...project, samples: { ...(project.samples || {}), [sample.id]: toProjectSample(sample) } };
}

/** Pure edits to the Project document. Every one of them bumps `rev`. */
function applyEdit(project, action) {
  switch (action.type) {
    case 'setMeta': // { patch: {name?, bpm?, loop?} }
      return { ...project, ...action.patch };

    case 'addTrack': // { track, clips? }
      return { ...project, tracks: [...project.tracks, action.track] };

    case 'updateTrack': // { trackId, patch }
      return mapTracks(project, (t) => (t.id === action.trackId ? { ...t, ...action.patch } : t));

    case 'deleteTrack':
      return { ...project, tracks: project.tracks.filter((t) => t.id !== action.trackId) };

    case 'insertClips': {
      // { items: [{trackId, clip}], samples?: [sample] } - new clips (drop, add, duplicate)
      let next = project;
      for (const s of action.samples || []) next = withSample(next, s);
      const byTrack = new Map();
      for (const { trackId, clip } of action.items) {
        if (!byTrack.has(trackId)) byTrack.set(trackId, []);
        byTrack.get(trackId).push(clip);
      }
      return mapTracks(next, (t) => (byTrack.has(t.id) ? { ...t, clips: [...t.clips, ...byTrack.get(t.id)] } : t));
    }

    case 'updateClip': // { clipId, patch }
      return mapTracks(project, (t) =>
        t.clips.some((c) => c.id === action.clipId)
          ? { ...t, clips: t.clips.map((c) => (c.id === action.clipId ? { ...c, ...action.patch } : c)) }
          : t
      );

    case 'moveClips': {
      // { moves: [{clipId, trackId, start_beat}] } - may change tracks
      const moves = new Map(action.moves.map((m) => [m.clipId, m]));
      const moved = [];
      const stripped = project.tracks.map((t) => {
        if (!t.clips.some((c) => moves.has(c.id))) return t;
        const keep = [];
        for (const c of t.clips) {
          if (moves.has(c.id)) moved.push({ ...c, start_beat: moves.get(c.id).start_beat });
          else keep.push(c);
        }
        return { ...t, clips: keep };
      });
      return {
        ...project,
        tracks: stripped.map((t) => {
          const incoming = moved.filter((c) => moves.get(c.id).trackId === t.id);
          return incoming.length ? { ...t, clips: [...t.clips, ...incoming] } : t;
        }),
      };
    }

    case 'deleteClips': {
      const ids = new Set(action.clipIds);
      return mapTracks(project, (t) =>
        t.clips.some((c) => ids.has(c.id)) ? { ...t, clips: t.clips.filter((c) => !ids.has(c.id)) } : t
      );
    }

    case 'batch': // { actions: [...] } - several edits as ONE undo step
      return action.actions.reduce(applyEdit, project);

    default:
      return project;
  }
}

// The fields a patch-style edit may set; used to spot no-op edits (same
// value again) so they neither bump `rev` nor add an undo step.
function patchChanges(target, patch) {
  return Object.keys(patch).some((k) => target?.[k] !== patch[k]);
}

function isNoop(project, action) {
  switch (action.type) {
    case 'setMeta':
      return !Object.keys(action.patch).some((k) =>
        k === 'loop' ? JSON.stringify(project.loop) !== JSON.stringify(action.patch.loop) : project[k] !== action.patch[k]
      );
    case 'updateTrack':
      return !patchChanges(project.tracks.find((t) => t.id === action.trackId), action.patch);
    case 'updateClip': {
      for (const t of project.tracks) {
        const c = t.clips.find((x) => x.id === action.clipId);
        if (c) return !patchChanges(c, action.patch);
      }
      return true;
    }
    case 'batch':
      return action.actions.every((a) => isNoop(project, a));
    default:
      return false;
  }
}

/**
 * Undo restores the document, but keeps the current `samples` (a lookup
 * cache the server fills: a redone clip still needs its sample) and the
 * server-managed timestamps.
 */
function restore(snapshot, current) {
  return {
    ...snapshot,
    samples: { ...(snapshot.samples || {}), ...(current.samples || {}) },
    updated_at: current.updated_at ?? snapshot.updated_at,
  };
}

const EMPTY = [];

export function reducer(state, action) {
  switch (action.type) {
    case 'load': // a different project (or none); clean, never saved by itself; history starts over
      return { project: action.project, rev: state.rev + 1, loadedRev: state.rev + 1, past: EMPTY, future: EMPTY, gesture: null };
    case 'serverSync': // save response, only applied when nothing newer happened
      return { ...state, project: action.project };
    case 'mergeSamples': // stale save response: keep local edits, take its samples
      if (!state.project || state.project.id !== action.projectId) return state;
      return { ...state, project: { ...state.project, samples: { ...action.samples, ...state.project.samples } } };
    case 'sealHistory': // a continuous gesture (slider scrub) ended
      return state.gesture === null ? state : { ...state, gesture: null };
    case 'undo': {
      if (!state.project || !state.past.length) return state;
      const prev = state.past[state.past.length - 1];
      return {
        ...state,
        project: restore(prev, state.project),
        rev: state.rev + 1,
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future].slice(0, HISTORY_LIMIT),
        gesture: null,
      };
    }
    case 'redo': {
      if (!state.project || !state.future.length) return state;
      const [next, ...rest] = state.future;
      return {
        ...state,
        project: restore(next, state.project),
        rev: state.rev + 1,
        past: [...state.past, state.project].slice(-HISTORY_LIMIT),
        future: rest,
        gesture: null,
      };
    }
    default: {
      if (!state.project || isNoop(state.project, action)) return state;
      const project = applyEdit(state.project, action);
      if (project === state.project) return state;
      // Edits tagged with the same `coalesce` key (one slider being scrubbed)
      // share the undo step the first of them opened, until sealed.
      const continuing = !!action.coalesce && state.gesture === action.coalesce;
      return {
        ...state,
        project,
        rev: state.rev + 1,
        past: continuing ? state.past : [...state.past, state.project].slice(-HISTORY_LIMIT),
        future: continuing ? state.future : EMPTY,
        gesture: action.coalesce || null,
      };
    }
  }
}

/**
 * The open Project as one document, plus debounced autosave.
 *
 * `rev` increments on every edit (and on load). A save captures the rev it
 * sent; its response replaces local state only if `rev` is still the same,
 * so typing or dragging during a save is never clobbered. Saves are
 * serialised - a second one waits for the first - so the server always
 * sees them in order.
 *
 * History: every edit pushes the previous document onto `past` (capped);
 * undo/redo swap documents and bump `rev` like any edit, so they reach the
 * engine and autosave the same way. Continuous gestures coalesce: tag the
 * actions with `coalesce: key`; `sealHistory` (dispatched by the screen on
 * pointerup/keyup) closes the step.
 */
export default function useProjectState() {
  const [state, dispatch] = useReducer(reducer, {
    project: null,
    rev: 0,
    loadedRev: 0,
    past: EMPTY,
    future: EMPTY,
    gesture: null,
  });
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | pending | saving | saved | error
  const [saveError, setSaveError] = useState(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  const savedRevRef = useRef(0);
  const timerRef = useRef(null);
  const inFlightRef = useRef(null);
  const againRef = useRef(false);

  const isDirty = () => {
    const { project, rev, loadedRev } = stateRef.current;
    return !!project && rev > Math.max(savedRevRef.current, loadedRev);
  };

  const saveNow = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    if (inFlightRef.current) {
      againRef.current = true;
      return inFlightRef.current;
    }
    if (!isDirty()) return Promise.resolve();

    const { project, rev } = stateRef.current;
    setSaveStatus('saving');
    const run = (async () => {
      try {
        const res = await saveProject(project);
        savedRevRef.current = Math.max(savedRevRef.current, rev);
        const cur = stateRef.current;
        if (res?.data && cur.project?.id === project.id) {
          if (cur.rev === rev) dispatch({ type: 'serverSync', project: res.data });
          else if (res.data.samples) dispatch({ type: 'mergeSamples', projectId: project.id, samples: res.data.samples });
        }
        setSaveError(null);
        setSaveStatus(isDirty() ? 'pending' : 'saved');
      } catch (err) {
        setSaveError(errorMessage(err, 'Could not save the project'));
        setSaveStatus('error');
        againRef.current = false; // don't hammer a failing server; the next edit retries
      } finally {
        inFlightRef.current = null;
      }
      if (againRef.current) {
        againRef.current = false;
        await saveNow();
      }
    })();
    inFlightRef.current = run;
    return run;
  }, []);

  // Debounce on every edit. No cleanup that cancels the timer: unmount and
  // project switches flush explicitly instead.
  useEffect(() => {
    if (!isDirty()) return;
    setSaveStatus((s) => (s === 'saving' ? s : 'pending'));
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
  }, [state.rev, saveNow]);

  /** Open a project (or null). Callers flush the previous one first. */
  const load = useCallback((project) => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    setSaveStatus('idle');
    setSaveError(null);
    dispatch({ type: 'load', project });
  }, []);

  /**
   * Drop unsaved edits without sending them (the project is being deleted).
   * Waits for a save already on the wire so it can't land after the delete.
   */
  const discard = useCallback(async () => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    againRef.current = false;
    savedRevRef.current = stateRef.current.rev;
    if (inFlightRef.current) await inFlightRef.current.catch(() => {});
  }, []);

  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);

  return {
    project: state.project,
    dispatch,
    saveStatus,
    saveError,
    saveNow,
    load,
    discard,
    undo,
    redo,
    canUndo: !!state.project && state.past.length > 0,
    canRedo: !!state.project && state.future.length > 0,
  };
}

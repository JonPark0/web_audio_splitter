import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { normalizeProject, resolveOverlaps } from '../project';
import { projectBody, saveProject, saveProjectKeepalive } from '../projectsApi';
import { errorMessage } from '../../samplesApi';

const SAVE_DEBOUNCE_MS = 800;
const DRAFT_DEBOUNCE_MS = 250;
const HISTORY_LIMIT = 100;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30000;

// ---------------------------------------------------------------------------
// Local drafts: every unsaved edit is mirrored to localStorage per project,
// so a failed save, a crash or a closed tab never loses work. Cleared once
// the server has the same document.

const draftKey = (id) => `arrange:draft:${id}`;

export function readDraft(id) {
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeDraft(project, baseVersion) {
  try {
    localStorage.setItem(draftKey(project.id), JSON.stringify({ savedAt: Date.now(), baseVersion, project }));
  } catch (e) {
    // storage full / unavailable: the server save is still the main path
  }
}

export function clearDraft(id) {
  try {
    localStorage.removeItem(draftKey(id));
  } catch (e) {
    // ignore
  }
}

/** Whether two documents would save the same (server-managed fields ignored). */
export function sameDocument(a, b) {
  if (!a || !b) return false;
  return JSON.stringify(projectBody(a, null)) === JSON.stringify(projectBody(b, null));
}

// ---------------------------------------------------------------------------

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
    case 'setMeta': // { patch: {name?, bpm?, loop?, beats_per_bar?, markers?} }
      return { ...project, ...action.patch };

    case 'addTrack': // { track, index? }
      if (typeof action.index === 'number') {
        const tracks = [...project.tracks];
        tracks.splice(action.index, 0, action.track);
        return { ...project, tracks };
      }
      return { ...project, tracks: [...project.tracks, action.track] };

    case 'updateTrack': // { trackId, patch }
      return mapTracks(project, (t) => (t.id === action.trackId ? { ...t, ...action.patch } : t));

    case 'deleteTrack':
      return { ...project, tracks: project.tracks.filter((t) => t.id !== action.trackId) };

    case 'moveTrack': {
      // { trackId, toIndex }
      const from = project.tracks.findIndex((t) => t.id === action.trackId);
      if (from < 0) return project;
      const to = Math.max(0, Math.min(project.tracks.length - 1, action.toIndex));
      if (to === from) return project;
      const tracks = [...project.tracks];
      const [t] = tracks.splice(from, 1);
      tracks.splice(to, 0, t);
      return { ...project, tracks };
    }

    case 'insertClips': {
      // { items: [{trackId, clip}], samples?: [sample] } - new clips (drop, add, duplicate, paste)
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

    case 'replaceDocument': // { project } - restore a local draft (undoable)
      return { ...action.project, samples: { ...(project.samples || {}), ...(action.project.samples || {}) } };

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
        typeof action.patch[k] === 'object'
          ? JSON.stringify(project[k]) !== JSON.stringify(action.patch[k])
          : project[k] !== action.patch[k]
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
 * cache the server fills: a redone clip still needs its sample, and a
 * sample's BPM is library state, not an edit) and server-managed fields.
 */
function restore(snapshot, current) {
  return {
    ...snapshot,
    samples: { ...(snapshot.samples || {}), ...(current.samples || {}) },
    updated_at: current.updated_at ?? snapshot.updated_at,
    version: current.version,
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
    case 'updateSample': {
      // library-side sample change (e.g. its BPM): not an edit of the document
      if (!state.project?.samples?.[action.sample.id]) return state;
      return {
        ...state,
        project: { ...state.project, samples: { ...state.project.samples, [action.sample.id]: toProjectSample(action.sample) } },
      };
    }
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
      let project = applyEdit(state.project, action);
      // Overlap rule (Ableton): the clips this edit placed win over what they cover.
      if (action.resolve?.length) project = resolveOverlaps(project, action.resolve);
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
 * The open Project as one document, plus safe autosave.
 *
 * `rev` increments on every edit (and on load). A save captures the rev it
 * sent; its response replaces local state only if `rev` is still the same,
 * so typing or dragging during a save is never clobbered. Saves are
 * serialised - a second one waits for the first - so the server always
 * sees them in order.
 *
 * Nothing is lost silently:
 *   - every save sends `base_version`; a 409 (another tab saved first) stops
 *     autosave and raises `conflict` until the user picks Reload / Keep mine;
 *   - failures retry with backoff (1 s .. 30 s) and are reported via onError;
 *   - unsaved edits are mirrored to a local draft (offered back on open);
 *   - pagehide / tab hidden flushes with a keepalive PUT; beforeunload asks
 *     while anything is unsaved. That PUT's failures (offline, 409) can't be
 *     shown while hidden, so coming back runs the normal save, whose retry /
 *     conflict UI then appears.
 *
 * History: every edit pushes the previous document onto `past` (capped);
 * undo/redo swap documents and bump `rev` like any edit. Continuous gestures
 * coalesce: tag the actions with `coalesce: key`; `sealHistory` closes them.
 */
export default function useProjectState({ onError } = {}) {
  const [state, dispatch] = useReducer(reducer, {
    project: null,
    rev: 0,
    loadedRev: 0,
    past: EMPTY,
    future: EMPTY,
    gesture: null,
  });
  // idle | pending | saving | saved | error | conflict
  const [saveStatus, setSaveStatus] = useState('idle');
  const [saveError, setSaveError] = useState(null);
  const [retryAt, setRetryAt] = useState(null); // ms timestamp of the next automatic retry
  const [conflict, setConflict] = useState(null); // { project } - the server's newer document

  const stateRef = useRef(state);
  stateRef.current = state;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const savedRevRef = useRef(0);
  const baseVersionRef = useRef(null);
  const timerRef = useRef(null);
  const draftTimerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const backoffRef = useRef(RETRY_MIN_MS);
  const inFlightRef = useRef(null);
  const againRef = useRef(false);
  const conflictRef = useRef(null);
  conflictRef.current = conflict;

  const isDirty = () => {
    const { project, rev, loadedRev } = stateRef.current;
    return !!project && rev > Math.max(savedRevRef.current, loadedRev);
  };

  const saveNowRef = useRef(null);

  const scheduleRetry = () => {
    clearTimeout(retryTimerRef.current);
    const wait = backoffRef.current;
    backoffRef.current = Math.min(RETRY_MAX_MS, backoffRef.current * 2);
    setRetryAt(Date.now() + wait);
    retryTimerRef.current = setTimeout(() => {
      setRetryAt(null);
      saveNowRef.current?.();
    }, wait);
  };

  const saveNow = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    if (inFlightRef.current) {
      againRef.current = true;
      return inFlightRef.current;
    }
    if (!isDirty() || conflictRef.current) return Promise.resolve();

    clearTimeout(retryTimerRef.current);
    setRetryAt(null);
    const { project, rev } = stateRef.current;
    setSaveStatus('saving');
    const run = (async () => {
      try {
        const res = await saveProject(project, baseVersionRef.current);
        savedRevRef.current = Math.max(savedRevRef.current, rev);
        if (res?.data && Number.isInteger(res.data.version)) baseVersionRef.current = res.data.version;
        backoffRef.current = RETRY_MIN_MS;
        const cur = stateRef.current;
        if (res?.data && cur.project?.id === project.id) {
          const server = normalizeProject(res.data);
          // Take the server's copy (its clamps/rounding) only from a backend
          // that round-trips every field (it reports `version`); an older one
          // would silently drop loop/fade/reverse/cents from the local doc.
          const complete = Number.isInteger(res.data.version);
          if (cur.rev === rev && complete) {
            dispatch({ type: 'serverSync', project: { ...server, samples: { ...cur.project.samples, ...server.samples } } });
          } else {
            dispatch({ type: 'mergeSamples', projectId: project.id, samples: server.samples });
          }
        }
        setSaveError(null);
        if (isDirty()) setSaveStatus('pending');
        else {
          setSaveStatus('saved');
          clearDraft(project.id);
        }
      } catch (err) {
        const status = err?.response?.status;
        const theirs = status === 409 && err.response.data?.project ? normalizeProject(err.response.data.project) : null;
        if (theirs && Number.isInteger(theirs.version) && sameDocument(theirs, project)) {
          // The "other" save is this very document: the keepalive PUT from
          // when the page was hidden landed, its response didn't. Saved.
          baseVersionRef.current = theirs.version;
          savedRevRef.current = Math.max(savedRevRef.current, rev);
          setSaveError(null);
          if (isDirty()) setSaveStatus('pending');
          else {
            setSaveStatus('saved');
            clearDraft(project.id);
          }
        } else if (theirs && stateRef.current.project?.id === project.id) {
          // Someone else saved first. Stop here: the user decides.
          setConflict({ project: theirs });
          setSaveStatus('conflict');
          setSaveError(err.response.data.detail || 'Changed in another tab');
          againRef.current = false;
        } else {
          const message = errorMessage(err, 'Could not save the project');
          setSaveError(message);
          setSaveStatus('error');
          againRef.current = false;
          // A request the server rejected as invalid won't pass on retry;
          // anything else (offline, 5xx) retries by itself with backoff.
          const permanent = status === 400 || status === 404 || status === 422;
          if (!permanent) scheduleRetry();
          onErrorRef.current?.(
            `Could not save “${project.name}”: ${message}. ${permanent ? 'Your' : 'Retrying automatically — your'} edits are kept on this device.`
          );
        }
      } finally {
        inFlightRef.current = null;
      }
      if (againRef.current) {
        againRef.current = false;
        await saveNowRef.current();
      }
    })();
    inFlightRef.current = run;
    return run;
  }, []);
  saveNowRef.current = saveNow;

  // Debounce on every edit (and mirror it to the local draft). No cleanup
  // that cancels the timer: unmount and project switches flush explicitly.
  useEffect(() => {
    if (!isDirty()) return;
    setSaveStatus((s) => (s === 'saving' || s === 'conflict' ? s : 'pending'));
    clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const { project } = stateRef.current;
      if (project && isDirty()) writeDraft(project, baseVersionRef.current);
    }, DRAFT_DEBOUNCE_MS);
    if (conflictRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
  }, [state.rev, saveNow]);

  // Leaving: flush with keepalive, keep a draft, and ask while unsaved.
  useEffect(() => {
    const flush = () => {
      const { project, rev } = stateRef.current;
      if (!project || !isDirty()) return;
      writeDraft(project, baseVersionRef.current);
      if (conflictRef.current) return;
      if (inFlightRef.current) {
        againRef.current = true; // the draft covers it if the page dies first
        return;
      }
      clearTimeout(timerRef.current);
      timerRef.current = null;
      const run = saveProjectKeepalive(project, baseVersionRef.current)
        .then(async (res) => {
          if (!res || !res.ok) return;
          const data = await res.json().catch(() => null);
          savedRevRef.current = Math.max(savedRevRef.current, rev);
          if (data && Number.isInteger(data.version)) baseVersionRef.current = data.version;
          if (!isDirty()) {
            clearDraft(project.id);
            setSaveStatus('saved');
          }
        })
        .finally(() => {
          inFlightRef.current = null;
          if (againRef.current) {
            againRef.current = false;
            saveNowRef.current();
          }
        });
      inFlightRef.current = run;
    };
    // Back from another app / tab: whatever the hidden flush couldn't save
    // (offline, 409, killed request) goes through saveNow, so a failure shows
    // its retry / conflict UI instead of staying silent.
    const resume = () => {
      if (isDirty() && !conflictRef.current) saveNowRef.current();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
      else resume();
    };
    const onBeforeUnload = (e) => {
      if (isDirty() || inFlightRef.current || conflictRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('pageshow', resume); // back/forward cache restore
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  useEffect(
    () => () => {
      clearTimeout(retryTimerRef.current);
      clearTimeout(draftTimerRef.current);
    },
    []
  );

  /** Open a project (or null). Callers flush the previous one first. */
  const load = useCallback((project) => {
    clearTimeout(timerRef.current);
    clearTimeout(retryTimerRef.current);
    timerRef.current = null;
    backoffRef.current = RETRY_MIN_MS;
    baseVersionRef.current = Number.isInteger(project?.version) ? project.version : null;
    setRetryAt(null);
    setSaveStatus('idle');
    setSaveError(null);
    setConflict(null);
    dispatch({ type: 'load', project });
  }, []);

  /** Conflict: take the server's document (my unsaved edits are dropped). */
  const reloadFromServer = useCallback(() => {
    const c = conflictRef.current;
    if (!c) return;
    clearDraft(c.project.id);
    load(c.project);
  }, [load]);

  /** Conflict: overwrite the server with my document. */
  const keepMine = useCallback(() => {
    const c = conflictRef.current;
    if (!c) return;
    baseVersionRef.current = Number.isInteger(c.project.version) ? c.project.version : null;
    conflictRef.current = null;
    setConflict(null);
    setSaveError(null);
    setSaveStatus('pending');
    saveNowRef.current();
  }, []);

  /** Restore a local draft over the freshly opened server document (undoable). */
  const restoreDraft = useCallback((draftProject) => {
    dispatch({ type: 'replaceDocument', project: normalizeProject(draftProject) });
  }, []);

  /**
   * Drop unsaved edits without sending them (the project is being deleted).
   * Waits for a save already on the wire so it can't land after the delete.
   */
  const discard = useCallback(async () => {
    clearTimeout(timerRef.current);
    clearTimeout(retryTimerRef.current);
    timerRef.current = null;
    againRef.current = false;
    savedRevRef.current = stateRef.current.rev;
    if (stateRef.current.project) clearDraft(stateRef.current.project.id);
    if (inFlightRef.current) await inFlightRef.current.catch(() => {});
  }, []);

  const retryNow = useCallback(() => {
    backoffRef.current = RETRY_MIN_MS;
    clearTimeout(retryTimerRef.current);
    setRetryAt(null);
    return saveNowRef.current();
  }, []);

  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);

  return {
    project: state.project,
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
    canUndo: !!state.project && state.past.length > 0,
    canRedo: !!state.project && state.future.length > 0,
  };
}

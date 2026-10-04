import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * One shared timeline for every waveform on the result screen (stems, ruler,
 * spectrograms, the extract sheet): a single zoom level (px per second) and a
 * single view start (s). Lanes draw only the visible window from it, so there
 * are no per-stem scroll containers to keep in sync, and zooming/panning is a
 * cheap redraw of what's on screen.
 *
 * View changes notify subscribers synchronously; consumers coalesce redraws
 * per animation frame. The playhead has its own channel (it moves every frame
 * while playing and must not re-render React trees).
 */

export const MAX_PX_PER_SEC = 2000; // 0.5 ms per px
export const ZOOM_STEP = 1.6; // − / + buttons and keys
const FIT_SNAP = 1.01;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createTimeline(duration = 0) {
  let state = { duration, width: 0, pps: 0, start: 0, zoomed: false };
  let playhead = 0;
  const listeners = new Set();
  const headListeners = new Set();

  const fitPps = (s = state) => (s.duration > 0 && s.width > 0 ? s.width / s.duration : 1);

  function commit(next) {
    const fit = fitPps(next);
    let { pps, start } = next;
    if (!(pps > fit * FIT_SNAP)) {
      pps = fit;
      start = 0;
    } else {
      pps = Math.min(pps, MAX_PX_PER_SEC);
      start = clamp(start, 0, Math.max(0, next.duration - next.width / pps));
    }
    const zoomed = pps > fit * FIT_SNAP;
    if (pps === state.pps && start === state.start && next.width === state.width && next.duration === state.duration) return;
    state = { ...next, pps, start, zoomed };
    listeners.forEach((fn) => fn(state));
  }

  const api = {
    get: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    subscribeHead(fn) {
      headListeners.add(fn);
      return () => headListeners.delete(fn);
    },
    getPlayhead: () => playhead,
    setPlayhead(t) {
      playhead = t;
      headListeners.forEach((fn) => fn(t));
    },
    setDuration(d) {
      if (d > 0 && d !== state.duration) commit({ ...state, duration: d, pps: state.zoomed ? state.pps : 0 });
    },
    setWidth(w) {
      if (w > 0 && Math.abs(w - state.width) >= 0.5) commit({ ...state, width: w, pps: state.zoomed ? state.pps : 0 });
    },
    timeAt: (x) => state.start + x / state.pps,
    xAt: (t) => (t - state.start) * state.pps,
    visible: () => state.width / state.pps,
    /** Zoom to `pps`, keeping `anchorTime` under `anchorX` (px from the lane's left). */
    zoomTo(pps, anchorTime, anchorX) {
      const target = clamp(pps, 0, MAX_PX_PER_SEC);
      const t = anchorTime ?? state.start + state.width / state.pps / 2;
      const x = anchorX ?? state.width / 2;
      commit({ ...state, pps: target, start: t - x / target });
    },
    /** Multiply the zoom; anchored on the playhead when it's on screen, else the centre. */
    zoomBy(factor, anchorTime, anchorX) {
      let t = anchorTime;
      let x = anchorX;
      if (t == null) {
        const px = (playhead - state.start) * state.pps;
        if (px >= 0 && px <= state.width) {
          t = playhead;
          x = px;
        }
      }
      api.zoomTo(state.pps * factor, t, x);
    },
    fit() {
      commit({ ...state, pps: 0, start: 0 });
    },
    zoomToRange(a, b) {
      if (!(b > a) || !state.width) return;
      const pad = (b - a) * 0.08;
      const pps = state.width / (b - a + pad * 2);
      commit({ ...state, pps, start: a - pad });
    },
    panTo(start) {
      commit({ ...state, start });
    },
    panBy(px) {
      commit({ ...state, start: state.start + px / state.pps });
    },
    /** Page-follow: keep the playhead on screen while playing zoomed in. */
    follow(t) {
      if (!state.zoomed) return;
      const vis = state.width / state.pps;
      if (t < state.start || t > state.start + vis * 0.92) commit({ ...state, start: t - vis * 0.08 });
    },
  };
  return api;
}

/** The timeline's current view; re-renders on zoom/pan/resize. */
export function useTimelineView(timeline) {
  return useSyncExternalStore(timeline.subscribe, timeline.get);
}

/** Reports an element's width to the timeline (the lanes' shared width). */
export function useTimelineWidth(timeline, ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => timeline.setWidth(el.clientWidth));
    ro.observe(el);
    timeline.setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [timeline, ref]);
}

/** Calls `fn(view)` once per animation frame after the view changes. */
export function useViewFrame(timeline, fn, deps = []) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let frame = 0;
    const run = () => {
      frame = 0;
      fnRef.current(timeline.get());
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    const unsub = timeline.subscribe(schedule);
    schedule();
    return () => {
      unsub();
      cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, ...deps]);
}

/** Breakpoints of the layout contract: phone < 640, tablet < 1024, desktop. */
export function useLayoutSize() {
  const get = () => {
    if (typeof window === 'undefined') return { size: 'desktop', coarse: false };
    const w = window.innerWidth;
    return {
      size: w >= 1024 ? 'desktop' : w >= 640 ? 'tablet' : 'phone',
      coarse: window.matchMedia('(pointer: coarse)').matches,
    };
  };
  const [state, setState] = useState(get);
  useEffect(() => {
    const onChange = () => {
      const next = get();
      setState((s) => (s.size === next.size && s.coarse === next.coarse ? s : next));
    };
    window.addEventListener('resize', onChange);
    const mq = window.matchMedia('(pointer: coarse)');
    mq.addEventListener?.('change', onChange);
    return () => {
      window.removeEventListener('resize', onChange);
      mq.removeEventListener?.('change', onChange);
    };
  }, []);
  return state;
}

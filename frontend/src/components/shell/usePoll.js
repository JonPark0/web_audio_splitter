import { useCallback, useEffect, useRef } from 'react';

/**
 * Self-scheduling poll: the next request is only queued once the previous one
 * settles (slow responses never overlap), it pauses while the tab is hidden
 * and fetches at once when it's shown again — or when the window regains
 * focus, the network comes back, or the page returns from the back/forward
 * cache (a phone switching apps doesn't always send visibilitychange).
 *
 *   const refresh = usePoll(async (ctx) => {
 *     const res = await getThing();
 *     if (ctx.stale()) return;          // deps changed / unmounted meanwhile
 *     setThing(res.data);
 *     return res.data;                  // handed to interval()
 *   }, (result) => (busy(result) ? 2000 : 20000), [id]);
 *
 * `interval` is ms or a function of the last result; null/0 stops polling
 * (until deps change). `refresh()` runs it now.
 */
export default function usePoll(fn, interval, deps = [], enabled = true) {
  const fnRef = useRef(fn);
  const intervalRef = useRef(interval);
  fnRef.current = fn;
  intervalRef.current = interval;
  const runRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let done = false;
    let running = false;
    let again = false;
    let timer = null;
    let started = 0;
    const ctx = { stale: () => stopped };

    const run = async () => {
      if (stopped) return;
      clearTimeout(timer);
      timer = null;
      if (running) {
        again = true;
        return;
      }
      if (document.hidden) return; // resumed by visibilitychange
      running = true;
      started = Date.now();
      let result;
      try {
        result = await fnRef.current(ctx);
      } catch (e) {
        result = undefined;
      }
      running = false;
      if (stopped) return;
      if (again) {
        again = false;
        run();
        return;
      }
      const iv = typeof intervalRef.current === 'function' ? intervalRef.current(result) : intervalRef.current;
      done = !iv;
      if (iv) timer = setTimeout(run, iv);
    };

    // Coming back usually fires several of these at once (visibilitychange
    // then focus): one request for all of them. With no timer pending the
    // poll stopped while hidden and always resumes.
    const onWake = () => {
      if (document.hidden || done || running) return;
      if (!timer || Date.now() - started > 1000) run();
    };
    const WAKE = ['online', 'pageshow', 'focus'];
    document.addEventListener('visibilitychange', onWake);
    WAKE.forEach((t) => window.addEventListener(t, onWake));
    runRef.current = () => {
      done = false;
      run();
    };
    run();

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onWake);
      WAKE.forEach((t) => window.removeEventListener(t, onWake));
      runRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return useCallback(() => runRef.current?.(), []);
}

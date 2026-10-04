import { useCallback, useEffect, useRef } from 'react';

/**
 * Self-scheduling poll: the next request is only queued once the previous one
 * settles (slow responses never overlap), it pauses while the tab is hidden
 * and fetches at once when it's shown again.
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

    const onVisible = () => {
      if (!document.hidden && !done) run();
    };
    document.addEventListener('visibilitychange', onVisible);
    runRef.current = () => {
      done = false;
      run();
    };
    run();

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      runRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return useCallback(() => runRef.current?.(), []);
}

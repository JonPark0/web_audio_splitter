import { useEffect, useMemo, useRef } from 'react';

/**
 * Transport position as a tiny pub/sub instead of React state: while playing,
 * one requestAnimationFrame loop polls engine.getPositionBeats() and pushes
 * the value to subscribers (playhead line, position readout), which write to
 * their own DOM nodes. Nothing re-renders per frame.
 *
 * While stopped the position is `cursorBeat` (screen state).
 */
export function usePositionClock(engine, playing, cursorBeat) {
  const listeners = useRef(new Set());
  const beatRef = useRef(cursorBeat);

  const clock = useMemo(
    () => ({
      subscribe(fn) {
        listeners.current.add(fn);
        fn(beatRef.current, false);
        return () => listeners.current.delete(fn);
      },
      get: () => beatRef.current,
    }),
    []
  );

  useEffect(() => {
    const emit = (beat, live) => {
      beatRef.current = beat;
      listeners.current.forEach((fn) => fn(beat, live));
    };
    if (!playing || !engine) {
      emit(cursorBeat, false);
      return undefined;
    }
    let raf;
    const tick = () => {
      let beat = beatRef.current;
      try {
        const b = engine.getPositionBeats();
        if (Number.isFinite(b)) beat = b;
      } catch (e) {
        // keep the last known position
      }
      emit(beat, true);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [engine, playing, cursorBeat]);

  return clock;
}

/** Subscribe `fn(beat, live)` for the component's lifetime; `fn` may change freely. */
export function useClockListener(clock, fn, deps = []) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => clock.subscribe((b, live) => fnRef.current(b, live)), [clock]);
  // Re-run with the current beat when inputs (zoom, meter) change.
  useEffect(() => {
    fnRef.current(clock.get(), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { createEngine } from '../engine';

/**
 * Run an engine call that may throw synchronously (stub) or reject (real,
 * async) and always get a promise back, so callers need one `.catch`.
 */
export function engineCall(fn) {
  return Promise.resolve().then(fn);
}

/** Fire-and-forget variant for teardown paths: swallow everything. */
export function engineTry(fn) {
  try {
    const r = fn();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch (e) {
    // teardown - nothing useful to report
  }
}

/**
 * One engine per mount. Created inside the effect (not `useRef(createEngine())`)
 * because StrictMode's dev-only mount -> unmount -> mount would otherwise leave
 * us holding the instance the first cleanup disposed.
 *
 * `onTeardown` runs before stop/dispose (the screen flushes its save there).
 */
export default function useEngine({ onState, onError, onTeardown }) {
  const [engine, setEngine] = useState(null);
  const handlers = useRef({ onState, onError, onTeardown });
  handlers.current = { onState, onError, onTeardown };

  useEffect(() => {
    const e = createEngine();
    const offs = [];
    engineTry(() => offs.push(e.on('state', (s) => handlers.current.onState?.(s))));
    engineTry(() => offs.push(e.on('error', (err) => handlers.current.onError?.(err?.message || 'Audio engine error'))));
    setEngine(e);
    return () => {
      handlers.current.onTeardown?.();
      offs.forEach((off) => typeof off === 'function' && engineTry(off));
      engineTry(() => e.stop());
      engineTry(() => e.dispose());
      setEngine(null);
    };
  }, []);

  return engine;
}

/**
 * Error reporting that doesn't re-announce the same message on every
 * keystroke (setProject runs on each edit and the stub throws every time).
 * `report(msg, {once})`: once-messages are shown only the first time.
 */
export function useErrorReporter() {
  const [error, setError] = useState(null);
  const seenOnce = useRef(new Set());
  const report = useCallback((message, { once = false } = {}) => {
    if (!message) return;
    if (once) {
      if (seenOnce.current.has(message)) return;
      seenOnce.current.add(message);
    }
    setError((prev) => (prev === message ? prev : message));
  }, []);
  const clear = useCallback(() => setError(null), []);
  return { error, report, clear };
}

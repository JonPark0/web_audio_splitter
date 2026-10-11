import { useEffect, useState } from 'react';
import { IN_FLIGHT } from './format';

/**
 * Tiny shared state between the jobs list, the job view and the header
 * badge, so there is one /tasks poller at a time:
 * - `in_flight` (queued + running jobs): published by whoever polled /tasks
 *   last; the badge polls on its own only while no jobs list is mounted.
 * - "jobs changed" pings: after an upload, cancel, delete or retry, every
 *   poller refetches at once instead of waiting for its next tick.
 */
let inFlight = null;
const inFlightListeners = new Set();
let panes = 0;
const refreshListeners = new Set();

export function publishInFlight(n) {
  if (!Number.isFinite(n) || n === inFlight) return;
  inFlight = n;
  inFlightListeners.forEach((l) => l(n));
}

/** `data` is a /tasks response; old servers lack in_flight, so count rows. */
export function publishFromTasks(data) {
  const n = Number.isFinite(data?.in_flight)
    ? data.in_flight
    : (data?.tasks || []).filter((t) => IN_FLIGHT.has(t.status)).length;
  publishInFlight(n);
  return n;
}

export function useInFlight() {
  const [n, setN] = useState(inFlight);
  useEffect(() => {
    inFlightListeners.add(setN);
    setN(inFlight);
    return () => inFlightListeners.delete(setN);
  }, []);
  return n;
}

export function registerJobsPane() {
  panes += 1;
  return () => {
    panes -= 1;
  };
}

export function jobsPaneMounted() {
  return panes > 0;
}

export function onJobsChanged(fn) {
  refreshListeners.add(fn);
  return () => refreshListeners.delete(fn);
}

export function jobsChanged() {
  refreshListeners.forEach((fn) => fn());
}

// The jobs list's last rows and how many were loaded, per filter. A remount
// (Back to the Split home, opening a job) shows them at once at that length
// while the poll refreshes them — so the position Back restores exists
// again, instead of "Loading jobs..." and only the first page. Several
// filters are kept: a job page's own (unfiltered) list must not replace the
// searched list that Back returns to.
const CACHED_LISTS = 4;
const listCache = new Map(); // key -> { key, rows, limit, hasMore }, oldest first

export function cachedJobsList(key) {
  return listCache.get(key) || null;
}

export function cacheJobsList(entry) {
  listCache.delete(entry.key);
  listCache.set(entry.key, entry);
  if (listCache.size > CACHED_LISTS) listCache.delete(listCache.keys().next().value);
}

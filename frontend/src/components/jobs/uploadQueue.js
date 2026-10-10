import { useEffect, useState } from 'react';
import { errorDetail, getLimits, isCanceled, uploadFile } from '../../api';
import { jobsChanged } from './jobsStore';

/**
 * The new-split upload queue: files picked or dropped, uploaded one at a
 * time (one job each). It lives outside React so an upload keeps going when
 * you open a job or switch to the Library meanwhile; leaving the page while
 * one runs asks first.
 *
 * Item: { key, file, state, loaded, total, rate, error, retryable, taskId, batch, settings }
 * state: ready (picked) → waiting → uploading → checking (server probes the
 *        file) → done | error; Cancel upload puts them back to ready. Failed
 *        rows stay until removed or retried (a phone that locked mid-upload
 *        shouldn't lose the file from the list).
 */

// Extensions the server's ffprobe check accepts as audio. Browsers leave
// file.type empty for some (.flac/.aiff on Windows), so the extension counts.
export const AUDIO_EXTENSIONS = ['wav', 'mp3', 'flac', 'aif', 'aiff', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'wma', 'alac', 'caf', 'wv', 'mp2'];
// Video containers: the server keeps the audio stream (verified with an mp4).
export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'mkv', 'webm'];
export const VIDEO_ACCEPTED = true;

export const ACCEPT = [
  'audio/*',
  ...AUDIO_EXTENSIONS.map((e) => `.${e}`),
  ...(VIDEO_ACCEPTED ? ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', ...VIDEO_EXTENSIONS.map((e) => `.${e}`)] : []),
].join(',');

const extOf = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';

/** 'audio' | 'video' | null */
export function classifyFile(file) {
  const ext = extOf(file.name);
  if (file.type?.startsWith('audio/') || AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  if (file.type?.startsWith('video/') || VIDEO_EXTENSIONS.includes(ext)) return 'video';
  return null;
}

let items = [];
let current = null; // { key, ctrl }
let batchSeq = 0;
let activeBatch = null; // { id, settings } while a batch runs
let keySeq = 0;
let limits = null; // { max_upload_mb, ... } once known; null: no check here
const listeners = new Set();

function set(next) {
  items = next;
  listeners.forEach((l) => l(items));
}
function update(key, patch) {
  set(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));
}

const warnOnLeave = (e) => {
  e.preventDefault();
  e.returnValue = '';
};

// A phone locks its screen after ~30 s without a touch, and the upload of a
// locked or backgrounded tab is cut off. Keep the screen on while a batch
// runs; the lock is dropped whenever the tab is hidden, so take it again when
// it comes back. Unsupported or refused (battery saver): upload without it.
let wakeLock = null;
let wakePending = false;
async function holdScreen() {
  if (!activeBatch || wakeLock || wakePending || document.visibilityState !== 'visible') return;
  if (!navigator.wakeLock?.request) return;
  wakePending = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (activeBatch) {
      wakeLock = lock;
      lock.addEventListener?.('release', () => {
        if (wakeLock === lock) wakeLock = null;
      });
    } else {
      lock.release().catch(() => {});
    }
  } catch (e) {
    // not allowed right now: nothing to do
  } finally {
    wakePending = false;
  }
}
function releaseScreen() {
  const lock = wakeLock;
  wakeLock = null;
  lock?.release().catch(() => {});
}
const onVisibility = () => {
  if (document.visibilityState === 'visible') holdScreen();
};

export function useUploadQueue() {
  const [state, setState] = useState(items);
  useEffect(() => {
    listeners.add(setState);
    setState(items);
    getLimits().then((l) => {
      limits = l;
    });
    return () => listeners.delete(setState);
  }, []);
  return state;
}

export const isActive = (i) => i.state === 'uploading' || i.state === 'checking';

/**
 * Add picked/dropped files. Returns { added, rejected: [names],
 * tooBig: [names], maxMB } — tooBig only when the server's size limit is
 * known (an older server without /limits checks after the upload).
 * While a batch is uploading, new files join it (same settings).
 */
export function addFiles(fileList) {
  const files = Array.from(fileList || []);
  const rejected = [];
  const tooBig = [];
  const accepted = [];
  const maxMB = limits?.max_upload_mb;
  for (const f of files) {
    const kind = classifyFile(f);
    if (kind !== 'audio' && !(kind === 'video' && VIDEO_ACCEPTED)) rejected.push(f.name);
    else if (maxMB > 0 && f.size > maxMB * 1024 * 1024) tooBig.push(f.name);
    else accepted.push(f);
  }
  if (accepted.length) {
    // A finished batch's queued rows make way for the next selection (they
    // are in the jobs list now); failed ones wait for Retry or Remove.
    const keep = activeBatch ? items : items.filter((i) => i.state !== 'done');
    const fresh = accepted.map((file) => ({
      key: `u${++keySeq}`,
      file,
      state: activeBatch ? 'waiting' : 'ready',
      loaded: 0,
      total: file.size,
      rate: 0,
      error: '',
      retryable: false,
      taskId: null,
      batch: activeBatch?.id ?? null,
      settings: activeBatch?.settings ?? null,
    }));
    set([...keep, ...fresh]);
    if (activeBatch) pump();
  }
  return { added: accepted.length, rejected, tooBig, maxMB };
}

export function removeItem(key) {
  const item = items.find((i) => i.key === key);
  if (!item || isActive(item)) return;
  set(items.filter((i) => i.key !== key));
}

export function clearFinished() {
  set(items.filter((i) => i.state !== 'done' && i.state !== 'error'));
}

function beginBatch(settings) {
  activeBatch = { id: ++batchSeq, settings };
  window.addEventListener('beforeunload', warnOnLeave);
  document.addEventListener('visibilitychange', onVisibility);
  holdScreen();
}

/** Upload every picked file with these settings, one after another. */
export function startUploads(settings) {
  if (!items.some((i) => i.state === 'ready')) return;
  beginBatch(settings);
  set(
    items
      .filter((i) => i.state !== 'done')
      .map((i) => (i.state === 'ready' ? { ...i, state: 'waiting', batch: activeBatch.id, settings } : i))
  );
  pump();
}

/**
 * Upload a failed file again with the settings it was sent with: it joins
 * the running batch, or starts one of its own.
 */
export function retryItem(key) {
  const item = items.find((i) => i.key === key);
  if (!item || item.state !== 'error') return;
  if (!activeBatch) beginBatch(item.settings);
  update(key, { state: 'waiting', loaded: 0, rate: 0, error: '', batch: activeBatch.id });
  pump();
}

/**
 * Stop the running upload; it and the waiting ones go back to "ready". A file
 * already being checked is on the server, which queues its job whatever the
 * browser does — it finishes instead of coming back as "ready" (a second
 * Split would queue it twice).
 */
export function cancelUploads() {
  set(items.map((i) => (i.state === 'waiting' ? { ...i, state: 'ready', batch: null } : i)));
  const running = current && items.find((i) => i.key === current.key);
  if (running?.state !== 'checking') current?.ctrl.abort();
}

function finishBatch() {
  activeBatch = null;
  window.removeEventListener('beforeunload', warnOnLeave);
  document.removeEventListener('visibilitychange', onVisibility);
  releaseScreen();
}

function pump() {
  if (current) return;
  const next = items.find((i) => i.state === 'waiting');
  if (!next) {
    finishBatch();
    return;
  }
  run(next);
}

async function run(item) {
  const ctrl = new AbortController();
  current = { key: item.key, ctrl };
  update(item.key, { state: 'uploading', loaded: 0, total: item.file.size, rate: 0, error: '' });
  const meter = { t: performance.now(), loaded: 0, rate: 0 };
  try {
    const res = await uploadFile({
      file: item.file,
      model: item.settings.model,
      recover: item.settings.recover,
      recoveryModel: item.settings.recoveryModel,
      signal: ctrl.signal,
      onProgress: ({ loaded, total }) => {
        const size = total || item.file.size;
        const t = performance.now();
        const dt = (t - meter.t) / 1000;
        if (dt >= 0.25) {
          const inst = (loaded - meter.loaded) / dt;
          meter.rate = meter.rate ? meter.rate * 0.6 + inst * 0.4 : inst;
          meter.t = t;
          meter.loaded = loaded;
        }
        update(item.key, { loaded, total: size, rate: meter.rate, state: loaded >= size ? 'checking' : 'uploading' });
      },
    });
    update(item.key, { state: 'done', taskId: res.data.task_id, loaded: item.file.size });
    jobsChanged();
  } catch (e) {
    const status = e.response?.status;
    if (isCanceled(e)) update(item.key, { state: 'ready', loaded: 0, rate: 0, batch: null });
    else
      update(item.key, {
        state: 'error',
        // no response: the connection dropped (screen locked, app switched,
        // network gone) — worth another go, unlike "not audio" / "too large"
        error: status ? errorDetail(e, 'Upload failed.') : 'The upload was interrupted.',
        retryable: !status || status >= 500 || status === 408 || status === 429,
      });
  } finally {
    current = null;
    pump();
  }
}

import { useEffect, useState } from 'react';
import {
  completeUpload,
  createUpload,
  discardUpload,
  errorDetail,
  getLimits,
  getUpload,
  isCanceled,
  uploadChunk,
  uploadFile,
} from '../../api';
import { jobsChanged } from './jobsStore';

/**
 * The new-split upload queue: files picked or dropped, uploaded one at a
 * time (one job each). It lives outside React so an upload keeps going when
 * you open a job or switch to the Library meanwhile; leaving the page while
 * one runs asks first.
 *
 * Files go up in chunks (api.js createUpload), so a dropped connection costs
 * the chunk in flight, not the file: a failed chunk is resent after 1, 3 and
 * 10 s from wherever the server says it got to. After that the row is
 * "paused" and carries on by itself when the page is shown again (a phone
 * unlocked, the app switched back), when the network returns, every 30 s,
 * or on Retry. Servers without chunked uploads get the file in one request.
 *
 * Item: { key, file, state, loaded, total, rate, error, retryable, taskId,
 *         batch, settings, uploadId, chunkSize, committed, reconnecting }
 * state: ready (picked) → waiting → uploading (⇄ paused) → checking (server
 *        probes the file) → done | error; Cancel upload puts them back to
 *        ready. `committed`: the server has the whole file and makes the job
 *        whatever the browser does, so it can't be cancelled any more.
 *        Failed rows stay until removed or retried (a phone that locked
 *        mid-upload shouldn't lose the file from the list).
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

// Waits before resending after a network error, 5xx, 408 or 429; then paused.
const RETRY_DELAYS = [1000, 3000, 10000];
const PAUSED_RETRY_MS = 30000;
// A chunk that stops moving for this long is on a dead connection (one left
// behind by a phone changing networks can hang for minutes): give it up.
const STALL_MS = 30000;
const CHUNK_SIZE = 8 * 1024 * 1024; // until the server says otherwise

let items = [];
let current = null; // { key, ctrl }
let batchSeq = 0;
let activeBatch = null; // { id, settings } while a batch runs
let keySeq = 0;
let limits = null; // { max_upload_mb, ... } once known; null: no check here
let chunked = true; // false once the server turned out to have no /uploads
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

// Ends the running upload's wait between attempts early: Retry, the page
// shown again, the network back.
let wake = null;
function resumeNow() {
  wake?.();
}
const onVisibility = () => {
  if (document.visibilityState !== 'visible') return;
  holdScreen();
  resumeNow();
};

/** Resolves after `ms` or on resumeNow(); rejects once `signal` aborts. */
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const end = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', end);
      if (wake === end) wake = null;
      if (signal.aborted) reject(new Error('Cancelled'));
      else resolve();
    };
    const timer = setTimeout(end, ms);
    signal.addEventListener('abort', end);
    wake = end;
  });
}

function loadLimits() {
  return getLimits().then((l) => {
    limits = l;
  });
}

export function useUploadQueue() {
  const [state, setState] = useState(items);
  useEffect(() => {
    listeners.add(setState);
    setState(items);
    loadLimits();
    return () => listeners.delete(setState);
  }, []);
  return state;
}

export const isActive = (i) => i.state === 'uploading' || i.state === 'paused' || i.state === 'checking';

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
      uploadId: null,
      chunkSize: 0,
      committed: false,
      reconnecting: false,
    }));
    set([...keep, ...fresh]);
    if (activeBatch) pump();
  }
  return { added: accepted.length, rejected, tooBig, maxMB };
}

// Files dropped on a job page: added there, then reported by the Split
// home that opens for them (UploadScreen takes the report when it mounts).
let dropReport = null;

/**
 * addFiles() once the server's size limit is known (a job page opened from
 * a link hasn't asked yet). Resolves to the same report.
 */
export function addDroppedFiles(fileList) {
  const files = Array.from(fileList || []);
  return loadLimits().then(() => {
    dropReport = addFiles(files);
    return dropReport;
  });
}

export function takeDropReport() {
  const report = dropReport;
  dropReport = null;
  return report;
}

export function removeItem(key) {
  const item = items.find((i) => i.key === key);
  if (!item || isActive(item)) return;
  if (item.uploadId) discardUpload(item.uploadId).catch(() => {});
  set(items.filter((i) => i.key !== key));
}

export function clearFinished() {
  set(items.filter((i) => i.state !== 'done' && i.state !== 'error'));
}

function beginBatch(settings) {
  activeBatch = { id: ++batchSeq, settings };
  window.addEventListener('beforeunload', warnOnLeave);
  window.addEventListener('online', resumeNow);
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
 * A paused upload: try now. A failed file: upload it again with the
 * settings it was sent with (from where the server got to, when it kept the
 * bytes); it joins the running batch, or starts one of its own.
 */
export function retryItem(key) {
  const item = items.find((i) => i.key === key);
  if (item?.state === 'paused' && current?.key === key) {
    resumeNow();
    return;
  }
  if (!item || item.state !== 'error') return;
  if (!activeBatch) beginBatch(item.settings);
  update(key, { state: 'waiting', loaded: item.uploadId ? item.loaded : 0, rate: 0, error: '', batch: activeBatch.id });
  pump();
}

/**
 * Stop the running upload (the server drops what it has of it); it and the
 * waiting ones go back to "ready". A committed file is on the server, which
 * queues its job whatever the browser does — it finishes instead of coming
 * back as "ready" (a second Split would queue it twice).
 */
export function cancelUploads() {
  set(items.map((i) => (i.state === 'waiting' ? { ...i, state: 'ready', batch: null } : i)));
  const running = current && items.find((i) => i.key === current.key);
  if (!running?.committed) current?.ctrl.abort();
}

function finishBatch() {
  activeBatch = null;
  window.removeEventListener('beforeunload', warnOnLeave);
  window.removeEventListener('online', resumeNow);
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

const transient = (status) => !status || status >= 500 || status === 408 || status === 429;

/** Bytes per second, smoothed. reset() after a jump or a wait: neither is speed. */
function speedMeter() {
  let t = performance.now();
  let at = 0;
  let rate = 0;
  return {
    reset(position) {
      t = performance.now();
      at = position;
      rate = 0;
    },
    sample(position) {
      const now = performance.now();
      const dt = (now - t) / 1000;
      if (dt >= 0.25) {
        const inst = (position - at) / dt;
        rate = rate ? rate * 0.6 + inst * 0.4 : inst;
        t = now;
        at = position;
      }
      return rate;
    },
  };
}

async function run(item) {
  const ctrl = new AbortController();
  current = { key: item.key, ctrl };
  update(item.key, { state: 'uploading', total: item.file.size, rate: 0, error: '', committed: false, reconnecting: false });
  try {
    let taskId = chunked ? await sendInChunks(item, ctrl.signal) : null;
    if (taskId === null) taskId = await sendWhole(item, ctrl.signal);
    update(item.key, { state: 'done', taskId, loaded: item.file.size, rate: 0, uploadId: null, reconnecting: false });
    jobsChanged();
  } catch (e) {
    const status = e.response?.status;
    const uploadId = items.find((i) => i.key === item.key)?.uploadId;
    if (ctrl.signal.aborted || isCanceled(e)) {
      if (uploadId) discardUpload(uploadId).catch(() => {});
      update(item.key, { state: 'ready', loaded: 0, rate: 0, batch: null, uploadId: null, committed: false, reconnecting: false });
    } else {
      // no response: the connection dropped (screen locked, app switched,
      // network gone) — worth another go, unlike "not audio" / "too large"
      const retryable = transient(status);
      if (uploadId && !retryable) discardUpload(uploadId).catch(() => {});
      update(item.key, {
        state: 'error',
        error: status ? errorDetail(e, 'Upload failed.') : 'The upload was interrupted.',
        retryable,
        rate: 0,
        committed: false,
        reconnecting: false,
        ...(retryable ? null : { uploadId: null }),
      });
    }
  } finally {
    current = null;
    pump();
  }
}

/**
 * The file in chunks → its task id, or null when the server has no chunked
 * uploads (older backend). Transient failures are waited out (see the top);
 * anything else throws.
 */
async function sendInChunks(item, signal) {
  const { file, settings } = item;
  let uploadId = item.uploadId;
  let chunkSize = item.chunkSize || CHUNK_SIZE;
  let offset = 0;
  let synced = !uploadId; // a kept upload (Retry) asks the server first
  let committed = false;
  let failures = 0;
  let restarted = false;
  const meter = speedMeter();

  for (;;) {
    try {
      if (!uploadId) {
        const res = await createUpload({ file, ...settings, signal });
        uploadId = res.data.upload_id;
        chunkSize = res.data.chunk_size || chunkSize;
        offset = res.data.received || 0;
        synced = true;
        update(item.key, { uploadId, chunkSize });
      } else if (!synced) {
        const res = await getUpload(uploadId, { signal });
        if (res.data.task_id) return res.data.task_id; // done; the answer to complete got lost
        offset = res.data.received;
        synced = true;
        meter.reset(offset);
        update(item.key, { loaded: offset });
      }

      if (offset < file.size) {
        const start = offset;
        const chunk = file.slice(start, Math.min(file.size, start + chunkSize));
        const res = await sendChunk(uploadId, start, chunk, signal, (sent) =>
          update(item.key, { loaded: start + sent, rate: meter.sample(start + sent), reconnecting: false })
        );
        offset = res.data.received;
        failures = 0;
      } else {
        committed = true;
        update(item.key, { state: 'checking', committed, loaded: file.size, rate: 0 });
        const res = await completeUpload(uploadId, { signal });
        return res.data.task_id;
      }
    } catch (e) {
      if (signal.aborted) throw e;
      const status = e.response?.status;
      if (!uploadId && (status === 404 || status === 405)) {
        chunked = false;
        return null;
      }
      if (status === 409 && Number.isFinite(e.response.data?.received)) {
        // Out of step (a resent chunk that had arrived after all): carry on
        // from the server's count.
        offset = e.response.data.received;
        meter.reset(offset);
        if (committed && offset < file.size) {
          committed = false;
          update(item.key, { state: 'uploading', committed });
        }
        continue;
      }
      if (status === 404 && uploadId && !restarted) {
        // The server no longer has it (a day old, or deleted): start over.
        restarted = true;
        uploadId = null;
        offset = 0;
        committed = false;
        meter.reset(0);
        update(item.key, { uploadId: null, state: 'uploading', committed, loaded: 0 });
        continue;
      }
      if (!transient(status)) throw e;

      synced = false; // ask where it got to before resending
      if (failures < RETRY_DELAYS.length && navigator.onLine !== false) {
        update(item.key, { reconnecting: true, rate: 0 });
        await pause(RETRY_DELAYS[failures], signal);
        failures += 1;
      } else {
        update(item.key, {
          state: 'paused',
          error: status ? errorDetail(e, 'The server didn’t answer.') : 'The connection dropped.',
          rate: 0,
          reconnecting: false,
        });
        await pause(PAUSED_RETRY_MS, signal);
        failures = 0; // then the quick retries again
        update(item.key, { state: committed ? 'checking' : 'uploading', error: '', reconnecting: true });
      }
    }
  }
}

// One chunk; `onSent(bytes)` reports its progress. A chunk that stops
// moving for STALL_MS is abandoned (as a network error) instead of hanging.
function sendChunk(uploadId, offset, blob, signal, onSent) {
  const req = new AbortController();
  const abort = () => req.abort();
  let timer = setTimeout(abort, STALL_MS);
  signal.addEventListener('abort', abort);
  return uploadChunk(uploadId, offset, blob, {
    signal: req.signal,
    onProgress: (loaded) => {
      clearTimeout(timer);
      timer = setTimeout(abort, STALL_MS);
      onSent(Math.min(loaded, blob.size)); // the form's own bytes aren't the file's
    },
  }).finally(() => {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  });
}

// The whole file in one request (POST /upload), for servers without chunks.
async function sendWhole(item, signal) {
  const meter = speedMeter();
  const res = await uploadFile({
    file: item.file,
    model: item.settings.model,
    recover: item.settings.recover,
    recoveryModel: item.settings.recoveryModel,
    signal,
    onProgress: ({ loaded, total }) => {
      const size = total || item.file.size;
      const sent = loaded >= size;
      update(item.key, { loaded, total: size, rate: meter.sample(loaded), state: sent ? 'checking' : 'uploading', committed: sent });
    },
  });
  return res.data.task_id;
}

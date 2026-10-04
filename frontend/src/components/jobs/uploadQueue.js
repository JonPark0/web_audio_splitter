import { useEffect, useState } from 'react';
import { errorDetail, isCanceled, uploadFile } from '../../api';
import { jobsChanged } from './jobsStore';

/**
 * The new-split upload queue: files picked or dropped, uploaded one at a
 * time (one job each). It lives outside React so an upload keeps going when
 * you open a job or switch to the Library meanwhile; leaving the page while
 * one runs asks first.
 *
 * Item: { key, file, state, loaded, total, rate, error, taskId, batch, settings }
 * state: ready (picked) → waiting → uploading → checking (server probes the
 *        file) → done | error; Cancel upload puts them back to ready.
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

export function useUploadQueue() {
  const [state, setState] = useState(items);
  useEffect(() => {
    listeners.add(setState);
    setState(items);
    return () => listeners.delete(setState);
  }, []);
  return state;
}

export const isActive = (i) => i.state === 'uploading' || i.state === 'checking';

/**
 * Add picked/dropped files. Returns { added, rejected: [names], video: n }.
 * While a batch is uploading, new files join it (same settings).
 */
export function addFiles(fileList) {
  const files = Array.from(fileList || []);
  const rejected = [];
  const accepted = [];
  for (const f of files) {
    const kind = classifyFile(f);
    if (kind === 'audio' || (kind === 'video' && VIDEO_ACCEPTED)) accepted.push(f);
    else rejected.push(f.name);
  }
  if (accepted.length) {
    // A finished batch's rows make way for the next selection.
    const keep = activeBatch ? items : items.filter((i) => i.state === 'ready' || i.state === 'waiting');
    const fresh = accepted.map((file) => ({
      key: `u${++keySeq}`,
      file,
      state: activeBatch ? 'waiting' : 'ready',
      loaded: 0,
      total: file.size,
      rate: 0,
      error: '',
      taskId: null,
      batch: activeBatch?.id ?? null,
      settings: activeBatch?.settings ?? null,
    }));
    set([...keep, ...fresh]);
    if (activeBatch) pump();
  }
  return { added: accepted.length, rejected };
}

export function removeItem(key) {
  const item = items.find((i) => i.key === key);
  if (!item || isActive(item)) return;
  set(items.filter((i) => i.key !== key));
}

export function clearFinished() {
  set(items.filter((i) => i.state !== 'done' && i.state !== 'error'));
}

/** Upload every picked file with these settings, one after another. */
export function startUploads(settings) {
  if (!items.some((i) => i.state === 'ready')) return;
  activeBatch = { id: ++batchSeq, settings };
  set(
    items
      .filter((i) => i.state !== 'done' && i.state !== 'error')
      .map((i) => (i.state === 'ready' ? { ...i, state: 'waiting', batch: activeBatch.id, settings } : i))
  );
  window.addEventListener('beforeunload', warnOnLeave);
  pump();
}

/** Stop the running upload; it and the waiting ones go back to "ready". */
export function cancelUploads() {
  set(items.map((i) => (i.state === 'waiting' ? { ...i, state: 'ready', batch: null } : i)));
  current?.ctrl.abort();
}

function finishBatch() {
  activeBatch = null;
  window.removeEventListener('beforeunload', warnOnLeave);
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
    if (isCanceled(e)) update(item.key, { state: 'ready', loaded: 0, rate: 0, batch: null });
    else update(item.key, { state: 'error', error: errorDetail(e, 'Upload failed.') });
  } finally {
    current = null;
    pump();
  }
}

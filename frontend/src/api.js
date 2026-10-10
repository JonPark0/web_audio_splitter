import axios from 'axios';

const API_BASE = '/api';

export const RECOVERY_MODELS = [
  { value: 'apollo', label: 'Apollo', hint: 'Fast, CPU-friendly. Best for restoring lossy/compressed sources.' },
  { value: 'audiosr', label: 'AudioSR', hint: 'Full any→48kHz super-resolution. Much slower; GPU recommended.' },
  { value: 'flashsr', label: 'FlashSR', hint: 'Fastest (single-step). Unproven on music specifically, no stated license.' },
];

// `hint`: one line for pickers; `recommended`: listed first, in its own group.
export const SEPARATION_MODELS = [
  { value: 'htdemucs', label: 'htdemucs (Default)', hint: '4 stems (vocals, drums, bass, other) · fast', recommended: true },
  { value: 'htdemucs_ft', label: 'htdemucs_ft (Fine-tuned)', hint: '4 stems · a little cleaner than htdemucs, about 4× slower' },
  { value: 'htdemucs_6s', label: 'htdemucs_6s (6 stems)', hint: '6 stems (adds guitar, piano) · piano is weak' },
  { value: 'hdemucs_mmi', label: 'hdemucs_mmi', hint: '4 stems · Hybrid Demucs v3' },
  { value: 'mdx', label: 'mdx', hint: '4 stems · MDX challenge model' },
  { value: 'mdx_extra', label: 'mdx_extra', hint: '4 stems · MDX trained on extra data' },
  { value: 'mdx_q', label: 'mdx_q (Quantized)', hint: '4 stems · smaller mdx, slightly lower quality' },
  { value: 'mdx_extra_q', label: 'mdx_extra_q (Quantized)', hint: '4 stems · smaller mdx_extra, slightly lower quality' },
  { value: 'SIG', label: 'SIG', hint: '4 stems · Demucs SIG model' },
  {
    value: 'bs_roformer',
    label: 'BS-Roformer (6-stem, higher SDR)',
    hint: '6 stems (vocals, drums, bass, guitar, piano, other) + instrumental · best quality, slower',
    recommended: true,
  },
];

/** True when `err` is an aborted request (AbortController), not a failure. */
export function isCanceled(err) {
  return axios.isCancel(err) || err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';
}

/**
 * A readable message from an API error. FastAPI sends `detail` as a string
 * for HTTPException but as a list of {msg} for validation errors (422) —
 * rendering that list as a React child blanked the whole app.
 */
export function errorDetail(err, fallback = 'Something went wrong') {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail.map((d) => (typeof d === 'string' ? d : d?.msg)).filter(Boolean).join('; ') || fallback;
  }
  return err?.message || fallback;
}

// onProgress({ loaded, total }) reports upload bytes; `signal` (an
// AbortController's) cancels the upload. The server validates the file
// (400 not audio / too long, 413 too large) before queuing the job; the
// size limit is also known up front from getLimits().
export function uploadFile({ file, model, recover, recoveryModel, onProgress, signal }) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('model', model);
  formData.append('recover', String(recover));
  formData.append('recovery_model', recoveryModel);
  return axios.post(`${API_BASE}/upload`, formData, {
    signal,
    onUploadProgress: onProgress ? (e) => onProgress({ loaded: e.loaded, total: e.total }) : undefined,
  });
}

/**
 * The server's limits, { max_upload_mb, max_duration_seconds }, fetched once.
 * Resolves null when the server has no /limits (older backend) — the upload
 * itself still enforces them; any other failure is retried next call.
 */
let limitsRequest = null;
export function getLimits() {
  if (!limitsRequest) {
    limitsRequest = axios.get(`${API_BASE}/limits`).then(
      (res) => (Number.isFinite(res.data?.max_upload_mb) ? res.data : null),
      (e) => {
        if (e.response?.status !== 404) limitsRequest = null;
        return null;
      }
    );
  }
  return limitsRequest;
}

export function youtubeInfo(url) {
  return axios.post(`${API_BASE}/youtube/info`, new URLSearchParams({ url }));
}

// autoSplit: queue the separation as soon as the download finishes (no
// confirm step). /status reports download_percent while downloading.
export function youtubeDownload({ url, model, recover, recoveryModel, autoSplit = false }) {
  return axios.post(
    `${API_BASE}/youtube/download`,
    new URLSearchParams({
      url,
      model,
      recover: String(recover),
      recovery_model: recoveryModel,
      auto_split: String(autoSplit),
    })
  );
}

export function youtubeConfirm(taskId) {
  return axios.post(`${API_BASE}/youtube/confirm/${taskId}`);
}

export function getStatus(taskId) {
  return axios.get(`${API_BASE}/status/${taskId}`);
}

// Task state lives in the backend's memory, so a restart forgets every task
// and /status answers 404 from then on — polling can never recover from that.
export function isTaskGone(err) {
  return err?.response?.status === 404;
}

/**
 * Jobs, newest first: { in_flight, tasks: [...] }. Each task row has
 * task_id, kind, status, name, model, recover, recovery_model, created_at,
 * started_at, finished_at, error, retry_of, queue_position, duration, bpm,
 * key, step, step_index, step_total, current_stem, download_percent.
 * Statuses: downloading, download_failed, downloaded, queued, processing,
 * restoring, completed, failed, cancelled.
 * Page back with { before: lastRow.created_at }; q searches names; status is
 * a comma-separated filter. (A bare number is accepted as the limit.)
 */
export function getTasks(params = 20) {
  const { limit = 20, before, q, status } = typeof params === 'number' ? { limit: params } : params;
  return axios.get(`${API_BASE}/tasks`, { params: { limit, before, q: q || undefined, status } });
}

// Stop a queued or running job → { status: "cancelled" | "cancelling" }
// ("cancelling" = the worker is killing its subprocess; /status turns
// "cancelled" shortly). 409 if it isn't running; YouTube downloads can't be
// cancelled.
export function cancelTask(taskId) {
  return axios.post(`${API_BASE}/tasks/${taskId}/cancel`);
}

// Re-run a finished (or failed) job's source audio with other settings. The
// original job and its stems are kept; the 201 response carries the NEW
// task id: { task_id }.
export function retryTask(taskId, { model, recover, recoveryModel }) {
  return axios.post(`${API_BASE}/tasks/${taskId}/retry`, {
    model,
    recover,
    recovery_model: recoveryModel,
  });
}

// Remove a job's uploaded audio, stems, restored stems and spectrograms.
// Library samples cut from it survive (they're copies). 409 while running.
export function deleteTask(taskId) {
  return axios.delete(`${API_BASE}/tasks/${taskId}`);
}

/**
 * Cut [startSec, endSec) out of one stem into a new library sample.
 * options (all optional): tags [str], snapToZero, reverse, normalize (peak to
 * -1 dBFS), fadeInMs, fadeOutMs, bitDepth (16|24|32 = float), sampleRate
 * (44100|48000), mono. Without format options the source's format is kept.
 */
export function createSample({ taskId, track, variant, startSec, endSec, name, ...options }) {
  return axios.post(`${API_BASE}/samples`, {
    task_id: taskId,
    track,
    variant,
    start_sec: startSec,
    end_sec: endSec,
    name,
    ...sampleOptions(options),
  });
}

/**
 * One sample from several stems summed with per-stem gains ("what I hear"):
 * stems = [{ track, variant, gain }] (gain 0 = left out). Same options as
 * createSample.
 */
export function createMixSample({ taskId, stems, startSec, endSec, name, ...options }) {
  return axios.post(`${API_BASE}/samples/mix`, {
    task_id: taskId,
    stems,
    start_sec: startSec,
    end_sec: endSec,
    name,
    ...sampleOptions(options),
  });
}

function sampleOptions({ tags, snapToZero, reverse, normalize, fadeInMs, fadeOutMs, bitDepth, sampleRate, mono }) {
  const out = {
    tags,
    snap_to_zero: snapToZero,
    reverse,
    normalize,
    fade_in_ms: fadeInMs,
    fade_out_ms: fadeOutMs,
    bit_depth: bitDepth,
    sample_rate: sampleRate,
    mono,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== null));
}

/**
 * A completed job: { tracks, derived_tracks, recovered_tracks, recovered,
 * recovery_model, name, model, recover, bpm, key, duration }.
 * derived_tracks (e.g. "instrumental.wav") are mixes of the other stems —
 * mute them by default or the instruments play twice. bpm/key may be null
 * for a few seconds on old jobs (analysed in the background on first open).
 */
export function getResult(taskId) {
  return axios.get(`${API_BASE}/result/${taskId}`);
}

/**
 * Waveform peaks for a stem: { duration, sample_rate, points_per_second,
 * peaks: number[] (0..1, max |sample| per bucket) }. The mixer draws these
 * instead of downloading and decoding whole WAVs (it streams the audio in
 * short Range-request chunks for playback).
 * resolution: points per second, 10..1000 (100 is plenty at "fit").
 */
export function getPeaks(taskId, trackName, variant = 'original', resolution = 100) {
  return axios.get(`${API_BASE}/peaks/${taskId}/${trackName}`, { params: { variant, resolution } });
}

// Transient times in seconds: { onsets: number[] } — for snapping selections.
export function getOnsets(taskId, trackName, variant = 'original') {
  return axios.get(`${API_BASE}/onsets/${taskId}/${trackName}`, { params: { variant } });
}

// Every stem of a job (one variant) as one zip, streamed.
export function stemsZipUrl(taskId, variant = 'original') {
  return `${API_BASE}/tasks/${taskId}/stems.zip?variant=${variant}`;
}

export function youtubePreviewUrl(taskId) {
  return `${API_BASE}/youtube/preview/${taskId}`;
}

export function trackUrl(taskId, trackName, variant = 'original') {
  return `${API_BASE}/download/${taskId}/${trackName}?variant=${variant}`;
}

export function spectrogramUrl(taskId, trackName, variant = 'original') {
  return `${API_BASE}/spectrogram/${taskId}/${trackName}?variant=${variant}`;
}

import axios from 'axios';
import { getProject } from './arrange/projectsApi';

const API_BASE = '/api';

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// The 24 key strings the backend accepts, majors first.
export const KEYS = [...ROOTS.map((r) => `${r} major`), ...ROOTS.map((r) => `${r} minor`)];

// Backend sort keys ("-x" = descending; samples without a BPM/key go last).
export const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name', label: 'Name A–Z' },
  { value: '-name', label: 'Name Z–A' },
  { value: 'bpm', label: 'BPM ↑' },
  { value: '-bpm', label: 'BPM ↓' },
  { value: 'duration', label: 'Shortest' },
  { value: '-duration', label: 'Longest' },
  { value: 'key', label: 'Key' },
];

export const BPM_MIN = 20;
export const BPM_MAX = 999;

// axios drops undefined params but sends "" as `?q=`, which the backend would
// read as a real (empty) filter - so strip blanks before sending.
function compactParams(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
  );
}

/**
 * Filtered, sorted page of samples → { samples, matched, total }.
 * `tags` (array or comma string) requires all of them; `q` matches name,
 * tags and source stem; limit 0/undefined = everything.
 */
export function listSamples({ q, tags, tag, key, bpmMin, bpmMax, sort, limit, offset, signal } = {}) {
  const tagList = Array.isArray(tags) ? tags.join(',') : tags;
  return axios.get(`${API_BASE}/samples`, {
    signal,
    params: compactParams({ q, tags: tagList, tag, key, bpm_min: bpmMin, bpm_max: bpmMax, sort, limit, offset }),
  });
}

export function listTags() {
  return axios.get(`${API_BASE}/samples/tags`);
}

export function getSample(id) {
  return axios.get(`${API_BASE}/samples/${id}`);
}

// onProgress({ loaded, total }) reports upload bytes; `signal` cancels.
export function importSample({ file, name, tags, onProgress, signal }) {
  const formData = new FormData();
  formData.append('file', file);
  if (name) formData.append('name', name);
  if (tags?.length) formData.append('tags', tags.join(','));
  return axios.post(`${API_BASE}/samples/import`, formData, {
    signal,
    onUploadProgress: onProgress ? (e) => onProgress({ loaded: e.loaded, total: e.total }) : undefined,
  });
}

// `patch` is any of { name, tags, bpm, key }; bpm/key null clears the override
// (and setting the detected value back clears it too).
export function updateSample(id, patch) {
  return axios.patch(`${API_BASE}/samples/${id}`, patch);
}

export function analyzeSample(id) {
  return axios.post(`${API_BASE}/samples/${id}/analyze`);
}

// Re-run detection for these ids (empty = the whole library); overrides are
// kept. → { queued }
export function analyzeSamples(ids = []) {
  return axios.post(`${API_BASE}/samples/analyze`, { ids });
}

// 409 { detail, projects: [{id, name}] } when a project still uses it.
export function deleteSample(id) {
  return axios.delete(`${API_BASE}/samples/${id}`);
}

// The given samples as one zip → Blob.
export async function exportSamples(ids) {
  try {
    const res = await axios.post(`${API_BASE}/samples/export`, { ids }, { responseType: 'blob' });
    return res.data;
  } catch (err) {
    // With responseType blob the error body is a Blob too; decode it so
    // errorMessage() can read `detail`.
    const data = err?.response?.data;
    if (data instanceof Blob) {
      try {
        err.response.data = JSON.parse(await data.text());
      } catch (e) {
        // not JSON - keep the generic message
      }
    }
    throw err;
  }
}

// Waveform overview → { duration, peaks: number[] (0..1) }.
export function getSamplePeaks(id, points = 120, { signal } = {}) {
  return axios.get(`${API_BASE}/samples/${id}/peaks`, { params: { points }, signal });
}

// audio_url is relative to the API root, so it needs the /api prefix here.
export function sampleAudioUrl(sample) {
  return `${API_BASE}${sample.audio_url || `/samples/${sample.id}/audio`}`;
}

/**
 * The sample time-stretched to `bpm` (server-rendered with Rubber Band and
 * cached; the first request per tempo takes a moment). `v` = the sample's
 * own BPM, only a browser cache-buster for when it gets corrected.
 */
export function sampleRenderUrl(sample, { bpm, semitones = 0, cents = 0 }) {
  const params = new URLSearchParams({
    bpm: String(bpm),
    semitones: String(semitones),
    cents: String(cents),
    v: String(sample.bpm ?? ''),
  });
  return `${API_BASE}/samples/${sample.id}/render?${params}`;
}

/**
 * Save a whole project document with optimistic concurrency. Sends every
 * field the GET returned (markers, loop, ... - anything the PUT model knows)
 * plus `base_version`, so nothing the Library doesn't touch gets reset.
 */
function putProject(project) {
  const { samples, id, version, updated_at, created_at, ...doc } = project; // eslint-disable-line no-unused-vars
  return axios.put(`${API_BASE}/projects/${id}`, { ...doc, base_version: version });
}

/**
 * Read-modify-write a project: `edit(project)` returns the new document.
 * On 409 (saved elsewhere meanwhile) it re-applies `edit` to the current
 * document the server sent back, once.
 */
export async function editProject(projectId, edit) {
  let project = (await getProject(projectId)).data;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await putProject(edit(project));
      return res.data;
    } catch (err) {
      const current = err?.response?.status === 409 ? err.response.data?.project : null;
      if (!current || attempt > 0) throw err;
      project = current;
    }
  }
}

// FastAPI sends `detail` as a string for HTTPException but as a list of
// { msg } objects for request validation (422).
export function errorMessage(err, fallback = 'Something went wrong') {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail.map((d) => (typeof d === 'string' ? d : d?.msg)).filter(Boolean).join('; ') || fallback;
  }
  return err?.message || fallback;
}

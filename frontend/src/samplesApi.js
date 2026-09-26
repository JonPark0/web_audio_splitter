import axios from 'axios';

const API_BASE = '/api';

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// The 24 key strings the backend accepts, majors first.
export const KEYS = [...ROOTS.map((r) => `${r} major`), ...ROOTS.map((r) => `${r} minor`)];

export const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name', label: 'Name' },
  { value: 'bpm', label: 'BPM' },
];

// axios drops undefined params but sends "" as `?q=`, which the backend would
// read as a real (empty) filter - so strip blanks before sending.
function compactParams(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
  );
}

export function listSamples({ q, tag, key, bpmMin, bpmMax, sort } = {}) {
  return axios.get(`${API_BASE}/samples`, {
    params: compactParams({ q, tag, key, bpm_min: bpmMin, bpm_max: bpmMax, sort }),
  });
}

export function listTags() {
  return axios.get(`${API_BASE}/samples/tags`);
}

export function getSample(id) {
  return axios.get(`${API_BASE}/samples/${id}`);
}

export function importSample({ file, name, tags }) {
  const formData = new FormData();
  formData.append('file', file);
  if (name) formData.append('name', name);
  if (tags?.length) formData.append('tags', tags.join(','));
  return axios.post(`${API_BASE}/samples/import`, formData);
}

// `patch` is any of { name, tags, bpm, key }; bpm/key null clears the override.
export function updateSample(id, patch) {
  return axios.patch(`${API_BASE}/samples/${id}`, patch);
}

export function analyzeSample(id) {
  return axios.post(`${API_BASE}/samples/${id}/analyze`);
}

export function deleteSample(id) {
  return axios.delete(`${API_BASE}/samples/${id}`);
}

// audio_url is relative to the API root, so it needs the /api prefix here.
export function sampleAudioUrl(sample) {
  return `${API_BASE}${sample.audio_url || `/samples/${sample.id}/audio`}`;
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

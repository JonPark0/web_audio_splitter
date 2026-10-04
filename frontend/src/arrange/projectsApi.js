import axios from 'axios';

const API_BASE = '/api';

/** @returns {Promise<{data: {projects: Array<{id, name, bpm, track_count, clip_count, updated_at}>}}>} */
export function listProjects() {
  return axios.get(`${API_BASE}/projects`);
}

/** Creates an empty project (one empty track). @returns full Project */
export function createProject({ name, bpm } = {}) {
  return axios.post(`${API_BASE}/projects`, { name, bpm });
}

/** @returns full Project (see project.js), with referenced samples embedded */
export function getProject(id) {
  return axios.get(`${API_BASE}/projects/${id}`);
}

/**
 * The PUT body: the whole document (name, bpm, beats_per_bar, loop,
 * markers, tracks with clips). `samples` is server-owned and never sent.
 * `baseVersion` is the version this edit started from; the server refuses
 * the save with 409 `{detail, project}` when someone else saved since.
 */
export function projectBody(project, baseVersion) {
  const { name, bpm, beats_per_bar, loop, markers = [], tracks } = project;
  return {
    name,
    bpm,
    beats_per_bar,
    loop,
    markers: markers.map(({ id, beat, name: n }) => ({ id, beat, name: n || '' })),
    tracks,
    base_version: Number.isInteger(baseVersion) ? baseVersion : null,
  };
}

/**
 * Replaces the whole document in one transaction. Unknown sample ids are
 * rejected with 400; a stale `baseVersion` with 409 (`err.response.data
 * .project` is the server's current document). @returns full Project
 */
export function saveProject(project, baseVersion) {
  return axios.put(`${API_BASE}/projects/${project.id}`, projectBody(project, baseVersion));
}

/**
 * Last-chance save while the page is going away (pagehide / tab hidden):
 * `keepalive` lets the request outlive the page. Browsers cap keepalive
 * bodies at 64 KB, so a bigger project goes as a plain fetch (which may not
 * finish — the local draft covers that). Never throws.
 */
export function saveProjectKeepalive(project, baseVersion) {
  try {
    const body = JSON.stringify(projectBody(project, baseVersion));
    return fetch(`${API_BASE}/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: body.length < 60000,
    }).catch(() => null);
  } catch (e) {
    return Promise.resolve(null);
  }
}

export function deleteProject(id) {
  return axios.delete(`${API_BASE}/projects/${id}`);
}

/**
 * URL of a sample time-stretched to `bpm` and pitch-shifted by `semitones`
 * + `cents` (server-rendered, cached). `sourceBpm` only busts the browser
 * cache when the sample's BPM is corrected in the Library.
 */
export function renderUrl(sampleId, { bpm, semitones = 0, cents = 0, sourceBpm }) {
  const params = new URLSearchParams({
    bpm: String(bpm),
    semitones: String(semitones),
    cents: String(cents),
    v: String(sourceBpm ?? ''),
  });
  return `${API_BASE}/samples/${sampleId}/render?${params}`;
}

export function sampleAudioUrl(sample) {
  return `${API_BASE}${sample.audio_url || `/samples/${sample.id}/audio`}`;
}

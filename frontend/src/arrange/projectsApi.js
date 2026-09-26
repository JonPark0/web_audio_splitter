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
 * Replaces the whole document (name, bpm, beats_per_bar, loop, tracks with
 * clips) in one transaction. `samples` is ignored if sent. Unknown sample
 * ids are rejected with 400. @returns full Project
 */
export function saveProject(project) {
  const { id, name, bpm, beats_per_bar, loop, tracks } = project;
  return axios.put(`${API_BASE}/projects/${id}`, { name, bpm, beats_per_bar, loop, tracks });
}

export function deleteProject(id) {
  return axios.delete(`${API_BASE}/projects/${id}`);
}

/**
 * URL of a sample time-stretched to `bpm` and pitch-shifted by `semitones`
 * (server-rendered, cached). `sourceBpm` only busts the browser cache when
 * the sample's BPM is corrected in the Library.
 */
export function renderUrl(sampleId, { bpm, semitones = 0, sourceBpm }) {
  const params = new URLSearchParams({ bpm: String(bpm), semitones: String(semitones), v: String(sourceBpm ?? '') });
  return `${API_BASE}/samples/${sampleId}/render?${params}`;
}

export function sampleAudioUrl(sample) {
  return `${API_BASE}${sample.audio_url || `/samples/${sample.id}/audio`}`;
}

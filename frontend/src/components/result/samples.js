import axios from 'axios';

// Library calls the result screen needs beyond api.js: the samples already
// cut from this job (waveform markers) and Undo after a save.

export async function listJobSamples(taskId) {
  const res = await axios.get('/api/samples', { params: { sort: 'oldest' } });
  return (res.data.samples || []).filter((s) => s.source?.task_id === taskId);
}

export function deleteSampleById(id) {
  return axios.delete(`/api/samples/${id}`);
}

/** Tracks a sample was cut from: ["vocals.wav"] or, for a mix, every stem in it. */
export function sampleTracks(sample, allTracks) {
  const src = sample.source;
  if (!src?.track) return [];
  if (src.variant === 'mix' || src.track.startsWith('mix:')) {
    const names = src.track.replace(/^mix:\s*/, '').split(',').map((s) => s.trim());
    return allTracks.filter((t) => names.includes(t.replace(/\.wav$/i, '')));
  }
  return [src.track];
}

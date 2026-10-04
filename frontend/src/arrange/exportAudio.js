/**
 * Mixdown / stem export on top of engine.renderOffline (the same voices as
 * live playback, so the file sounds like what you heard).
 *
 *   await exportAudio(engine, project, { scope, stems, normalize, masterGain, onProgress })
 *     scope      'song' (0 .. last clip end) | 'loop' (the loop region)
 *     stems      false: one stereo mix  `<name>[-loop].wav`
 *                true:  one WAV per track (that track soloed), zipped:
 *                       `<name>[-loop]-stems.zip` with `<name>[-loop]-stem-<track>.wav`
 *     normalize  scale to a -1 dBFS peak; stems share ONE gain (the loudest
 *                stem's), so their balance still sums back to the mix
 */
import { projectEndBeat } from './project';
import { encodeWav, encodeWavBytes } from './wav';
import { zipFiles } from './zip';

export const EXPORT_SAMPLE_RATE = 48000;
const NORMALIZE_PEAK = 10 ** (-1 / 20); // -1 dBFS

export function safeFileName(name, fallback = 'mixdown') {
  // eslint-disable-next-line no-control-regex
  const base = (name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim();
  return base || fallback;
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function peakOf(buffer) {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

function scale(buffer, gain) {
  if (gain === 1) return;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= gain;
  }
}

/** The beat range an export covers, or null when there's nothing to render. */
export function exportRange(project, scope) {
  const { loop } = project;
  const useLoop = scope === 'loop' && loop && loop.end_beat > loop.start_beat;
  const fromBeat = useLoop ? loop.start_beat : 0;
  const toBeat = useLoop ? loop.end_beat : projectEndBeat(project);
  return toBeat > fromBeat ? { fromBeat, toBeat, useLoop } : null;
}

export async function exportAudio(engine, project, { scope = 'song', stems = false, normalize = false, masterGain = 1, onProgress } = {}) {
  const range = exportRange(project, scope);
  if (!range) throw new Error('Nothing to export: the project has no clips.');
  const { fromBeat, toBeat, useLoop } = range;
  const base = safeFileName(project.name) + (useLoop ? '-loop' : '');
  const opts = { fromBeat, toBeat, sampleRate: EXPORT_SAMPLE_RATE, masterGain };

  if (!stems) {
    onProgress?.({ done: 0, total: 1 });
    const buffer = await engine.renderOffline(project, opts);
    if (normalize) {
      const peak = peakOf(buffer);
      if (peak > 0) scale(buffer, NORMALIZE_PEAK / peak);
    }
    onProgress?.({ done: 1, total: 1 });
    downloadBlob(encodeWav(buffer, { bitDepth: 24 }), `${base}.wav`);
    return { files: [`${base}.wav`] };
  }

  const tracks = project.tracks.filter((t) => t.clips.length > 0);
  if (!tracks.length) throw new Error('Nothing to export: no track has clips.');
  const rendered = [];
  for (let i = 0; i < tracks.length; i++) {
    onProgress?.({ done: i, total: tracks.length });
    // eslint-disable-next-line no-await-in-loop
    const buffer = await engine.renderOffline(project, { ...opts, soloTrackId: tracks[i].id });
    rendered.push({ track: tracks[i], buffer });
  }
  if (normalize) {
    const peak = Math.max(...rendered.map((r) => peakOf(r.buffer)));
    if (peak > 0) rendered.forEach((r) => scale(r.buffer, NORMALIZE_PEAK / peak));
  }
  const used = new Set();
  const files = rendered.map(({ track, buffer }) => {
    let name = `${base}-stem-${safeFileName(track.name, 'track')}`;
    for (let n = 2; used.has(name); n++) name = `${base}-stem-${safeFileName(track.name, 'track')}-${n}`;
    used.add(name);
    return { name: `${name}.wav`, data: encodeWavBytes(buffer, { bitDepth: 24 }) };
  });
  onProgress?.({ done: tracks.length, total: tracks.length });
  downloadBlob(zipFiles(files), `${base}-stems.zip`);
  return { files: files.map((f) => f.name) };
}

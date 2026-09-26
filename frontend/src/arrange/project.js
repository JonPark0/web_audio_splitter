/**
 * Arrangement data model and timing math, shared by the audio engine and
 * the Arrange UI. This file is the contract between them — change it
 * deliberately.
 *
 * @typedef {Object} ProjectSample   Library sample as embedded in a project.
 * @property {string} id
 * @property {string} name
 * @property {number} duration_sec   Length of the source audio.
 * @property {number|null} bpm       Effective BPM (user override or detected);
 *                                   null means the clip can't be warped.
 * @property {string|null} key
 * @property {string} audio_url      Relative to the API root (prefix /api).
 *
 * @typedef {Object} Clip
 * @property {string} id             Client-generated UUID.
 * @property {string} sample_id
 * @property {number} start_beat     Timeline position (beats from 0).
 * @property {number} offset_sec     Trim start, in SOURCE seconds.
 * @property {number} length_sec     Trimmed length, in SOURCE seconds.
 * @property {boolean} warp          Follow project BPM (time-stretch). Only
 *                                   valid when the sample has a BPM.
 * @property {number} semitones      Pitch shift (integer, 0 = none).
 * @property {number} gain           Linear, 1 = unity.
 *
 * @typedef {Object} Track
 * @property {string} id             Client-generated UUID.
 * @property {string} name
 * @property {number} volume         Linear 0..1.5, 1 = unity.
 * @property {number} pan            -1 (left) .. 1 (right).
 * @property {boolean} muted
 * @property {boolean} soloed
 * @property {Clip[]} clips
 *
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} name
 * @property {number} bpm            Project tempo.
 * @property {number} beats_per_bar
 * @property {{enabled: boolean, start_beat: number, end_beat: number}} loop
 * @property {Track[]} tracks        In display order.
 * @property {Object<string, ProjectSample>} samples  Keyed by sample id; every
 *                                   clip's sample is present (server-embedded).
 *
 * Invariants the model is built around:
 *   - A warped clip keeps its length in BEATS when the project BPM changes
 *     (it's time-stretched); an unwarped clip keeps its length in SECONDS.
 *   - Trim is stored in source seconds, so both fall out of one formula:
 *       rate            = warp ? project.bpm / sample.bpm : 1
 *       timeline seconds = length_sec / rate
 */

export const DEFAULT_BPM = 120;
export const MIN_BPM = 20;
export const MAX_BPM = 999;

export function secondsPerBeat(bpm) {
  return 60 / bpm;
}

export function beatsToSeconds(beats, bpm) {
  return beats * secondsPerBeat(bpm);
}

export function secondsToBeats(seconds, bpm) {
  return seconds / secondsPerBeat(bpm);
}

/** Whether a clip over this sample may be warped. */
export function canWarp(sample) {
  return !!sample && typeof sample.bpm === 'number' && sample.bpm > 0;
}

/** Playback speed factor of a clip relative to its source audio. */
export function clipRate(clip, sample, projectBpm) {
  return clip.warp && canWarp(sample) ? projectBpm / sample.bpm : 1;
}

/** Duration of a clip on the timeline, in seconds. */
export function clipDurationSeconds(clip, sample, projectBpm) {
  return clip.length_sec / clipRate(clip, sample, projectBpm);
}

/** Duration of a clip on the timeline, in beats. */
export function clipDurationBeats(clip, sample, projectBpm) {
  return secondsToBeats(clipDurationSeconds(clip, sample, projectBpm), projectBpm);
}

export function clipEndBeat(clip, sample, projectBpm) {
  return clip.start_beat + clipDurationBeats(clip, sample, projectBpm);
}

/** Last beat any clip reaches (0 for an empty project). */
export function projectEndBeat(project) {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clipEndBeat(clip, project.samples[clip.sample_id], project.bpm));
    }
  }
  return end;
}

/** Audible after mute/solo: any soloed track silences the non-soloed ones. */
export function isTrackAudible(track, tracks) {
  const anySolo = tracks.some((t) => t.soloed);
  return anySolo ? track.soloed : !track.muted;
}

export function newId() {
  return crypto.randomUUID();
}

/** A clip covering the whole sample, warped when the sample has a BPM. */
export function makeClip(sample, startBeat) {
  return {
    id: newId(),
    sample_id: sample.id,
    start_beat: startBeat,
    offset_sec: 0,
    length_sec: sample.duration_sec,
    warp: canWarp(sample),
    semitones: 0,
    gain: 1,
  };
}

export function makeTrack(name) {
  return { id: newId(), name, volume: 1, pan: 0, muted: false, soloed: false, clips: [] };
}

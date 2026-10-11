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
 * @property {number} offset_sec     Trim start, in SOURCE seconds (forward).
 * @property {number} length_sec     Trimmed length, in SOURCE seconds.
 * @property {boolean} warp          Follow project BPM (time-stretch). Only
 *                                   valid when the sample has a BPM.
 * @property {number} semitones      Pitch shift (integer, 0 = none).
 * @property {number} cents          Fine pitch, -100..100 (rendered with semitones).
 * @property {number} gain           Linear, 1 = unity.
 * @property {number|null} loop_beats  When set, the trimmed region repeats back
 *                                   to back to fill this many beats — the clip's
 *                                   timeline length. null = the region plays once.
 * @property {number} fade_in_sec    Linear fade from the clip's timeline start,
 *                                   in timeline seconds.
 * @property {number} fade_out_sec   Linear fade into the clip's timeline end.
 * @property {boolean} reverse       The trimmed region plays backwards. offset /
 *                                   length still describe it in FORWARD source
 *                                   seconds: the timeline start plays source
 *                                   offset+length, the timeline end plays offset.
 *
 * @typedef {Object} Track
 * @property {string} id             Client-generated UUID.
 * @property {string} name
 * @property {number} volume         Linear 0..2, 1 = unity.
 * @property {number} pan            -1 (left) .. 1 (right).
 * @property {boolean} muted
 * @property {boolean} soloed
 * @property {Clip[]} clips
 *
 * @typedef {Object} Marker
 * @property {string} id
 * @property {number} beat
 * @property {string} name
 *
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} name
 * @property {number} bpm            Project tempo.
 * @property {number} beats_per_bar
 * @property {{enabled: boolean, start_beat: number, end_beat: number}} loop
 * @property {Marker[]} markers      Sorted by beat.
 * @property {number} [version]      Server document version (each save +1);
 *                                   sent back as base_version.
 * @property {Track[]} tracks        In display order.
 * @property {Object<string, ProjectSample>} samples  Keyed by sample id; every
 *                                   clip's sample is present (server-embedded).
 *
 * Invariants the model is built around:
 *   - A warped clip keeps its length in BEATS when the project BPM changes
 *     (it's time-stretched); an unwarped clip keeps its length in SECONDS.
 *   - Trim is stored in source seconds, so both fall out of one formula:
 *       rate             = warp ? project.bpm / sample.bpm : 1
 *       region seconds   = length_sec / rate        (one pass, timeline)
 *   - A looped clip's timeline length is loop_beats (beats, at any tempo);
 *     its region repeats every region-beats from start_beat.
 */

export const DEFAULT_BPM = 120;
export const MIN_BPM = 20;
export const MAX_BPM = 999;
export const MIN_CLIP_SEC = 0.02; // shortest trimmed region, source seconds
export const MIN_LOOP_BEATS = 1 / 16;
const EPS = 1e-6;

export const CLIP_DEFAULTS = Object.freeze({
  warp: false,
  semitones: 0,
  cents: 0,
  gain: 1,
  loop_beats: null,
  fade_in_sec: 0,
  fade_out_sec: 0,
  reverse: false,
});

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

/** Source seconds that pass per timeline beat. */
export function sourceSecondsPerBeat(clip, sample, projectBpm) {
  return secondsPerBeat(projectBpm) * clipRate(clip, sample, projectBpm);
}

export function isLooped(clip) {
  return typeof clip.loop_beats === 'number' && clip.loop_beats > 0;
}

/** One pass of the trimmed region on the timeline, in seconds. */
export function clipRegionSeconds(clip, sample, projectBpm) {
  return clip.length_sec / clipRate(clip, sample, projectBpm);
}

/** One pass of the trimmed region on the timeline, in beats. */
export function clipRegionBeats(clip, sample, projectBpm) {
  return secondsToBeats(clipRegionSeconds(clip, sample, projectBpm), projectBpm);
}

/** Duration of a clip on the timeline, in beats (loop_beats when looped). */
export function clipDurationBeats(clip, sample, projectBpm) {
  return isLooped(clip) ? clip.loop_beats : clipRegionBeats(clip, sample, projectBpm);
}

/** Duration of a clip on the timeline, in seconds. */
export function clipDurationSeconds(clip, sample, projectBpm) {
  return beatsToSeconds(clipDurationBeats(clip, sample, projectBpm), projectBpm);
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
  // randomUUID exists only in secure contexts (HTTPS, localhost): opened at
  // http://<LAN address> the browser has getRandomValues but not randomUUID.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Fill in fields an older document (or the old backend) doesn't carry. */
export function normalizeClip(c) {
  return {
    ...CLIP_DEFAULTS,
    ...c,
    loop_beats: isLooped(c) ? c.loop_beats : null,
    fade_in_sec: c.fade_in_sec || 0,
    fade_out_sec: c.fade_out_sec || 0,
    reverse: !!c.reverse,
    cents: c.cents || 0,
    semitones: c.semitones || 0,
    gain: typeof c.gain === 'number' ? c.gain : 1,
  };
}

/** Defaults for anything an older/partial project document might lack. */
export function normalizeProject(p) {
  const loop = p.loop && p.loop.end_beat > p.loop.start_beat ? p.loop : { enabled: false, start_beat: 0, end_beat: 16 };
  return {
    ...p,
    bpm: p.bpm || DEFAULT_BPM,
    beats_per_bar: p.beats_per_bar || 4,
    loop: { enabled: !!loop.enabled, start_beat: loop.start_beat, end_beat: loop.end_beat },
    markers: Array.isArray(p.markers) ? [...p.markers].sort((a, b) => a.beat - b.beat) : [],
    tracks: (p.tracks || []).map((t) => ({ ...t, clips: (t.clips || []).map(normalizeClip) })),
    samples: p.samples || {},
  };
}

/** A clip covering the whole sample, warped when the sample has a BPM. */
export function makeClip(sample, startBeat) {
  return {
    ...CLIP_DEFAULTS,
    id: newId(),
    sample_id: sample.id,
    start_beat: startBeat,
    offset_sec: 0,
    length_sec: sample.duration_sec,
    warp: canWarp(sample),
  };
}

export function makeTrack(name) {
  return { id: newId(), name, volume: 1, pan: 0, muted: false, soloed: false, clips: [] };
}

// ---------------------------------------------------------------------------
// Edits in timeline terms. Every trim / split / overlap fix goes through these
// two, so warp, loop and reverse are handled in exactly one place.

/**
 * Move a clip's timeline START to `newStart`, keeping its end where it is.
 * One-shot: trims (or restores) the region at the edge the timeline start
 * plays — the region start when forward, the region end when reversed.
 * Looped: the clip start moves and loop_beats absorbs it; the region (what
 * repeats) is left alone, so the pattern restarts at the new start.
 * Returns a patch (clamped to the source audio and a minimum length).
 */
export function trimClipStart(clip, sample, bpm, newStart) {
  const end = clipEndBeat(clip, sample, bpm);
  if (isLooped(clip)) {
    const start = Math.min(Math.max(0, newStart), end - MIN_LOOP_BEATS);
    return { start_beat: start, loop_beats: end - start };
  }
  const spbSrc = sourceSecondsPerBeat(clip, sample, bpm);
  const duration = sample?.duration_sec ?? clip.offset_sec + clip.length_sec;
  let dSrc = (Math.max(0, newStart) - clip.start_beat) * spbSrc;
  // How far the edge may move: into the clip until MIN_CLIP_SEC is left, out
  // until the source audio runs out on that side.
  const room = clip.reverse ? duration - clip.offset_sec - clip.length_sec : clip.offset_sec;
  dSrc = Math.min(Math.max(dSrc, -room), clip.length_sec - MIN_CLIP_SEC);
  const startBeat = Math.max(0, clip.start_beat + dSrc / spbSrc);
  return clip.reverse
    ? { start_beat: startBeat, length_sec: clip.length_sec - dSrc }
    : { start_beat: startBeat, offset_sec: Math.max(0, clip.offset_sec + dSrc), length_sec: clip.length_sec - dSrc };
}

/**
 * Move a clip's timeline END to `newEnd`, keeping its start.
 * One-shot: trims (or restores) the region at the edge the timeline end
 * plays — the region end when forward, the region start when reversed.
 * Looped: sets loop_beats.
 */
export function trimClipEnd(clip, sample, bpm, newEnd) {
  if (isLooped(clip)) return { loop_beats: Math.max(MIN_LOOP_BEATS, newEnd - clip.start_beat) };
  const spbSrc = sourceSecondsPerBeat(clip, sample, bpm);
  const duration = sample?.duration_sec ?? clip.offset_sec + clip.length_sec;
  let dSrc = (newEnd - clip.start_beat) * spbSrc - clip.length_sec; // > 0 grows
  const room = clip.reverse ? clip.offset_sec : duration - clip.offset_sec - clip.length_sec;
  dSrc = Math.min(Math.max(dSrc, MIN_CLIP_SEC - clip.length_sec), room);
  return clip.reverse
    ? { offset_sec: Math.max(0, clip.offset_sec - dSrc), length_sec: clip.length_sec + dSrc }
    : { length_sec: clip.length_sec + dSrc };
}

/**
 * Split a clip at `atBeat` (strictly inside it): [left, right] full clips,
 * the right one with `rightId`. Fades stay on the outer edges. null when
 * the beat isn't inside the clip.
 */
export function splitClip(clip, sample, bpm, atBeat, rightId = newId()) {
  const end = clipEndBeat(clip, sample, bpm);
  if (!(atBeat > clip.start_beat + EPS && atBeat < end - EPS)) return null;
  const left = { ...clip, ...trimClipEnd(clip, sample, bpm, atBeat), fade_out_sec: 0 };
  const right = { ...clip, id: rightId, ...trimClipStart(clip, sample, bpm, atBeat), fade_in_sec: 0 };
  return [left, right];
}

/**
 * Ableton-style overlap rule: clips in `winnerIds` win over whatever they
 * now cover on their own track — covered clips are removed, partly covered
 * ones are truncated, and a clip covered in its middle is split in two.
 * Winners are applied in track order, so among themselves the later wins.
 * Pure: returns a new project (or the same one if nothing overlapped).
 */
export function resolveOverlaps(project, winnerIds) {
  const winners = new Set(winnerIds);
  if (!winners.size) return project;
  const { bpm, samples = {} } = project;
  let changed = false;
  const tracks = project.tracks.map((track) => {
    if (!track.clips.some((c) => winners.has(c.id))) return track;
    let clips = track.clips;
    for (const w of track.clips) {
      if (!winners.has(w.id)) continue;
      const cur = clips.find((c) => c.id === w.id);
      if (!cur) continue; // removed by a later winner
      const wS = cur.start_beat;
      const wE = clipEndBeat(cur, samples[cur.sample_id], bpm);
      const next = [];
      for (const o of clips) {
        if (o.id === cur.id) {
          next.push(o);
          continue;
        }
        const s = samples[o.sample_id];
        const oS = o.start_beat;
        const oE = clipEndBeat(o, s, bpm);
        if (oE <= wS + EPS || oS >= wE - EPS) {
          next.push(o);
          continue;
        }
        changed = true;
        if (oS >= wS - EPS && oE <= wE + EPS) continue; // fully covered
        if (oS < wS && oE > wE) {
          next.push({ ...o, ...trimClipEnd(o, s, bpm, wS), fade_out_sec: 0 });
          next.push({ ...o, id: newId(), ...trimClipStart(o, s, bpm, wE), fade_in_sec: 0 });
        } else if (oS < wS) {
          next.push({ ...o, ...trimClipEnd(o, s, bpm, wS) });
        } else {
          next.push({ ...o, ...trimClipStart(o, s, bpm, wE) });
        }
      }
      clips = next;
    }
    return clips === track.clips ? track : { ...track, clips };
  });
  return changed ? { ...project, tracks } : project;
}

/**
 * Overlapping spans per track (for drawing): [{trackIndex, start, end}].
 * Normally empty — edits resolve overlaps — but a tempo change can make
 * unwarped clips grow into their neighbours, and that must stay visible.
 */
export function findOverlaps(project) {
  const out = [];
  const { bpm, samples = {} } = project;
  project.tracks.forEach((track, trackIndex) => {
    const spans = track.clips
      .map((c) => ({ s: c.start_beat, e: clipEndBeat(c, samples[c.sample_id], bpm) }))
      .sort((a, b) => a.s - b.s);
    let reach = -Infinity;
    for (const sp of spans) {
      if (sp.s < reach - EPS) out.push({ trackIndex, start: sp.s, end: Math.min(reach, sp.e) });
      reach = Math.max(reach, sp.e);
    }
  });
  return out;
}

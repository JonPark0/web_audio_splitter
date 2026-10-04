/**
 * Arrangement audio engine (raw Web Audio API, no dependencies).
 *
 * Contract for the Arrange UI — the UI never touches Web Audio directly:
 *
 *   const engine = createEngine();
 *   engine.setProject(project);   // call on EVERY project change (cheap,
 *                                 // idempotent): applies mix changes live,
 *                                 // reschedules only what an edit touched,
 *                                 // prefetches audio/renders
 *   await engine.play(fromBeat);  // first call must come from a user
 *                                 // gesture (browser autoplay policy)
 *   engine.stop();                // pause; playhead stays where it was heard
 *   engine.seek(beat);            // move playhead (keeps playing if playing)
 *   engine.isPlaying();
 *   engine.getPositionBeats();          // scheduler position (logic)
 *   engine.getDisplayPositionBeats();   // heard position (playhead, readout):
 *                                       // minus the output latency
 *   engine.setMetronome(on);
 *   engine.setMasterGain(linear);       // live, default 1
 *   engine.getMeters();           // { master: [peakL, peakR], tracks: {id: peak} }
 *                                 // linear peaks of the latest ~20 ms; poll per frame
 *   await engine.getBuffer(sampleId);  // decoded SOURCE audio (AudioBuffer)
 *                                      // for drawing clip waveforms
 *   const off = engine.on('state', ({ playing, positionBeats, loading, pending }) => {});
 *                                 // pending: clip ids still waiting for their
 *                                 // exact audio (server render or source)
 *   engine.on('error', ({ message }) => {});
 *   await engine.renderOffline(project, { fromBeat, toBeat, sampleRate,
 *                                         masterGain, soloTrackId });
 *                                 // → AudioBuffer (mixdown / stems); the same
 *                                 // voice construction as live playback
 *   engine.dispose();
 *
 * Behaviour:
 *   - Looping follows project.loop (enabled/start_beat/end_beat).
 *   - Without a loop, playback stops by itself after the last clip ends and
 *     the playhead returns to where playback started.
 *   - Timing math comes from project.js (clipRate, clipDurationBeats, …).
 *
 * How it keeps tracks in sync: every clip is started with
 * `AudioBufferSourceNode.start(when, offset)` against the single
 * AudioContext clock. Playback is a chain of "segments" (one per loop pass,
 * or a single open-ended one), each mapping a beat range onto context time;
 * a short lookahead timer schedules the clips (and metronome clicks) that
 * begin inside the next window, so late-loading buffers and loop passes are
 * picked up without scheduling everything up front.
 *
 * Edits while playing: each scheduled voice remembers a signature of the
 * clip fields and segment slice it was planned from. A tempo change retimes
 * everything (old voices hand over to new ones at one context time, from the
 * same musical position). Any other timing edit re-plans and stops only the
 * voices whose signature changed; the lookahead reschedules those, so the
 * rest of the mix never drops out. Clip gain is a live node per voice.
 *
 * One voice = source → envelope (de-click edges + clip fades) → clip gain →
 * track gain → pan → master gain → output. A looped clip (loop_beats) is ONE
 * source with native loopStart/loopEnd over its trimmed region, so loop
 * passes join seamlessly and sample-exactly. Reverse plays a cached reversed
 * copy of whichever buffer is used.
 *
 * @typedef {import('./project').Project} Project
 */
import {
  beatsToSeconds,
  canWarp,
  clipDurationBeats,
  clipDurationSeconds,
  clipRate,
  clipRegionSeconds,
  isLooped,
  isTrackAudible,
  normalizeClip,
  projectEndBeat,
  secondsPerBeat,
} from './project';
import { renderUrl, sampleAudioUrl } from './projectsApi';

const LOOKAHEAD_SEC = 0.25;
const TICK_MS = 25;
const START_LATENCY_SEC = 0.05;
const FADE_SEC = 0.005; // de-click ramp at voice edges
const CLICK_SEC = 0.03;
const METER_FFT = 1024;
// Render `bpm` param for clips that don't follow the project tempo: the
// sample's own BPM (stretch factor 1), or any constant when it has none (the
// server only stretches against a known source BPM). Never the project BPM,
// so tempo changes don't invalidate pitch renders of unwarped clips.
const UNWARPED_RENDER_BPM = 120;

/** Server render needed: warped off the sample's own tempo, or pitch-shifted. */
function needsRender(clip, sample, bpm) {
  return clip.semitones !== 0 || clip.cents !== 0 || Math.abs(clipRate(clip, sample, bpm) - 1) > 1e-4;
}

/**
 * The render a clip needs: URL plus the rate it is stretched by (render
 * seconds = source seconds / rate).
 */
function renderInfo(clip, sample, bpm) {
  const warped = clip.warp && canWarp(sample);
  const target = warped ? bpm : sample.bpm ?? UNWARPED_RENDER_BPM;
  return {
    url: renderUrl(clip.sample_id, { bpm: target, semitones: clip.semitones, cents: clip.cents, sourceBpm: sample.bpm }),
    rate: warped ? bpm / sample.bpm : 1,
    sampleId: clip.sample_id,
    semitones: clip.semitones,
    cents: clip.cents,
  };
}

/** The URL whose decoded audio plays this clip exactly as asked. */
function exactUrl(clip, sample, bpm) {
  return needsRender(clip, sample, bpm) ? renderInfo(clip, sample, bpm).url : sampleAudioUrl(sample);
}

// What changes the *timing* of playback (needs a re-plan) vs only the mix.
function timingSignature(project) {
  return JSON.stringify([
    project.loop,
    project.tracks.map((t) => [
      t.id,
      t.clips.map((c) => [
        c.id, c.sample_id, c.start_beat, c.offset_sec, c.length_sec, c.warp, c.semitones, c.cents,
        c.reverse, c.loop_beats, c.fade_in_sec, c.fade_out_sec,
      ]),
    ]),
    Object.values(project.samples).map((s) => [s.id, s.bpm]),
  ]);
}

/** Missing optional fields filled in (older documents, tests). */
function normalizeForEngine(p) {
  return {
    ...p,
    beats_per_bar: p.beats_per_bar || 4,
    samples: p.samples || {},
    tracks: (p.tracks || []).map((t) => ({ ...t, clips: (t.clips || []).map(normalizeClip) })),
  };
}

// Reversed copies, made once per decoded buffer and dropped with it.
const reversedCache = new WeakMap();
function reversedBuffer(buffer) {
  let rev = reversedCache.get(buffer);
  if (rev) return rev;
  rev = new AudioBuffer({ length: buffer.length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  const n = buffer.length;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = rev.getChannelData(ch);
    for (let i = 0; i < n; i++) dst[i] = src[n - 1 - i];
  }
  reversedCache.set(buffer, rev);
  return rev;
}

/**
 * Gain automation for one voice playing clip-timeline seconds [t0, t1]
 * from context time `when`: the clip fades (linear, over the clip's whole
 * timeline extent D) with a short de-click ramp at both voice edges.
 */
function scheduleEnvelope(param, clip, D, when, t0, t1) {
  let fi = Math.max(0, clip.fade_in_sec || 0);
  let fo = Math.max(0, clip.fade_out_sec || 0);
  if (fi + fo > D && fi + fo > 0) {
    const s = D / (fi + fo);
    fi *= s;
    fo *= s;
  }
  const v = (t) => Math.max(0, Math.min(1, fi > 0 ? t / fi : 1, fo > 0 ? (D - t) / fo : 1));
  const dc = Math.min(FADE_SEC, (t1 - t0) / 2);
  const pts = [[t0 + dc, v(t0 + dc)]];
  for (const bp of [fi, D - fo]) if (bp > t0 + dc + 1e-9 && bp < t1 - dc - 1e-9) pts.push([bp, v(bp)]);
  pts.push([t1 - dc, v(t1 - dc)], [t1, 0]);
  pts.sort((a, b) => a[0] - b[0]);
  param.value = 0;
  param.setValueAtTime(0, when);
  for (const [t, value] of pts) param.linearRampToValueAtTime(value, when + (t - t0));
}

/**
 * Start one clip (or a slice of it) at context time `when`.
 * `intoSec` = how far into the clip's timeline playback begins, `playSec` =
 * how much to play (timeline seconds). `source` = { buffer, playbackRate,
 * k (buffer seconds per source second), detune }, always consistent with
 * the clip rate (k = playbackRate / rate), so the grid holds whichever
 * buffer is used. Returns the voice.
 */
function startVoice(ctx, destination, clip, sample, bpm, source, when, intoSec, playSec) {
  const D = clipDurationSeconds(clip, sample, bpm);
  const passSec = clipRegionSeconds(clip, sample, bpm);
  const looped = isLooped(clip);
  let buffer = source.buffer;
  // The trimmed region in the chosen buffer's own seconds.
  let a = clip.offset_sec * source.k;
  let b = (clip.offset_sec + clip.length_sec) * source.k;
  if (clip.reverse) {
    buffer = reversedBuffer(buffer);
    const T = buffer.duration;
    [a, b] = [T - b, T - a];
  }
  a = Math.min(Math.max(0, a), buffer.duration);
  b = Math.min(Math.max(a, b), buffer.duration);

  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.playbackRate.value = source.playbackRate;
  // A detuned fallback runs off the grid, so never on a looped clip.
  const detune = looped ? 0 : source.detune || 0;
  if (detune) node.detune.value = detune;
  const env = ctx.createGain();
  const clipGain = ctx.createGain();
  clipGain.gain.value = clip.gain;
  node.connect(env).connect(clipGain).connect(destination);

  let offset;
  let end = when + playSec;
  if (looped) {
    node.loop = true;
    node.loopStart = a;
    node.loopEnd = b;
    const phase = passSec > 0 ? intoSec % passSec : 0;
    offset = a + phase * source.playbackRate;
  } else {
    const speed = source.playbackRate * Math.pow(2, detune / 1200);
    offset = a + intoSec * speed;
    // Running faster than the grid would read past the trim: stop at it.
    if (detune) end = Math.min(end, when + Math.max(0, b - offset) / speed);
  }
  scheduleEnvelope(env.gain, clip, D, when, intoSec, intoSec + (end - when));
  // stop() in context time rather than start()'s `duration` argument, whose
  // unit (buffer time vs output time) is easy to get wrong under playbackRate.
  node.start(when, Math.max(0, offset));
  node.stop(end);
  const voice = { node, env, clipGain, gain: clip.gain, ended: false, end };
  node.onended = () => {
    voice.ended = true;
  };
  return voice;
}

/** Fade a voice out from context time `t` and stop it (no-op if done). */
function stopVoiceAt(voice, t) {
  try {
    const g = voice.env.gain;
    if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(t);
    else g.cancelScheduledValues(t);
    g.setTargetAtTime(0, t, FADE_SEC / 3);
    voice.node.stop(t + FADE_SEC * 2);
  } catch (e) {
    // already stopped
  }
}

function scheduleClick(ctx, destination, when, downbeat) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = downbeat ? 1500 : 1000;
  gain.gain.value = 0.0001;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(downbeat ? 0.5 : 0.3, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + CLICK_SEC);
  osc.connect(gain).connect(destination);
  osc.start(when);
  osc.stop(when + CLICK_SEC + 0.01);
  const voice = { node: osc, env: gain, ended: false, when };
  osc.onended = () => {
    voice.ended = true;
  };
  return voice;
}

/** Clips intersecting [fromBeat, toBeat) with how much of each to play. */
function clipsInRange(project, fromBeat, toBeat) {
  const out = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const sample = project.samples[clip.sample_id];
      if (!sample) continue;
      const start = clip.start_beat;
      const end = start + clipDurationBeats(clip, sample, project.bpm);
      const a = Math.max(start, fromBeat);
      const b = Math.min(end, toBeat);
      if (b - a > 1e-6) out.push({ track, clip, sample, fromBeat: a, intoBeats: a - start, lengthBeats: b - a });
    }
  }
  return out;
}

/** Everything that, if it changes, means a scheduled voice is wrong. */
function planSignature(item) {
  const { track, clip: c, sample } = item;
  return JSON.stringify([
    track.id, c.sample_id, c.start_beat, c.offset_sec, c.length_sec, c.warp, c.semitones, c.cents, c.reverse,
    c.loop_beats, c.fade_in_sec, c.fade_out_sec, sample.bpm, item.fromBeat, item.intoBeats, item.lengthBeats,
  ]);
}

function peakOf(analyser, scratch) {
  analyser.getFloatTimeDomainData(scratch);
  let peak = 0;
  for (let i = 0; i < scratch.length; i++) {
    const v = scratch[i] < 0 ? -scratch[i] : scratch[i];
    if (v > peak) peak = v;
  }
  return peak;
}

/** Splitter + two analysers hanging off `node` (pulled automatically). */
function stereoMeter(ctx, node) {
  const split = ctx.createChannelSplitter(2);
  const left = ctx.createAnalyser();
  const right = ctx.createAnalyser();
  left.fftSize = METER_FFT;
  right.fftSize = METER_FFT;
  node.connect(split);
  split.connect(left, 0);
  split.connect(right, 1);
  return { split, left, right };
}

export function createEngine() {
  let ctx = null;
  let master = null;
  let masterMeter = null;
  let clickBus = null;
  let masterGainValue = 1;
  const trackNodes = new Map(); // trackId -> { gain, pan, meter }
  let project = null;
  let timingSig = null;
  let endBeatCache = { project: null, end: 0 };

  const loaded = new Map(); // url -> AudioBuffer
  const inflight = new Map(); // url -> Promise<AudioBuffer>
  const renderMeta = new Map(); // render url -> { rate, sampleId, semitones, cents }
  let wanted = new Set();
  const listeners = { state: new Set(), error: new Set() };
  let meterScratch = null;

  let playing = false;
  let metronome = false;
  let positionBeats = 0; // playhead while stopped
  let playStartBeat = 0;
  // { ctxStart, beatStart, beatEnd, continuous, voices: Map<clipId, voice>,
  //   done: Map<clipId, sig>, clicks: Map<beat, voice>, plan, planKey }
  let segments = [];
  let timer = null;
  let lastPendingKey = '';

  const emit = (type, payload) => listeners[type].forEach((cb) => cb(payload));
  const reportError = (message) => emit('error', { message });

  function computePending() {
    if (!project) return [];
    const out = [];
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        const sample = project.samples[clip.sample_id];
        if (sample && !loaded.has(exactUrl(clip, sample, project.bpm))) out.push(clip.id);
      }
    }
    return out;
  }

  function emitState() {
    const pending = computePending();
    lastPendingKey = pending.join(',');
    emit('state', { playing, positionBeats: getDisplayPositionBeats(), loading: inflight.size, pending });
  }

  function emitIfPendingChanged() {
    if (computePending().join(',') !== lastPendingKey) emitState();
  }

  function ensureContext() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = masterGainValue;
      master.connect(ctx.destination);
      masterMeter = stereoMeter(ctx, master);
      // The metronome bypasses the master gain and meters.
      clickBus = ctx.createGain();
      clickBus.connect(ctx.destination);
      meterScratch = new Float32Array(METER_FFT);
    }
    return ctx;
  }

  function load(url) {
    if (loaded.has(url)) return Promise.resolve(loaded.get(url));
    if (inflight.has(url)) return inflight.get(url);
    const promise = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} fetching audio`);
        return res.arrayBuffer();
      })
      .then((data) => ensureContext().decodeAudioData(data))
      .then((buffer) => {
        loaded.set(url, buffer);
        if (renderMeta.has(url)) {
          evictRenders();
          onExactLoaded(url);
        }
        return buffer;
      })
      .finally(() => {
        inflight.delete(url);
        emitState();
      });
    inflight.set(url, promise);
    emitState();
    return promise;
  }

  // Renders nobody wants go — except an older render that is still standing
  // in for a wanted one that hasn't decoded yet (same sample and pitch).
  function evictRenders() {
    const waiting = [];
    for (const url of wanted) if (renderMeta.has(url) && !loaded.has(url)) waiting.push(renderMeta.get(url));
    for (const url of [...loaded.keys()]) {
      const m = renderMeta.get(url);
      if (!m || wanted.has(url)) continue;
      const standIn = waiting.some((w) => w.sampleId === m.sampleId && w.semitones === m.semitones && w.cents === m.cents);
      if (!standIn) loaded.delete(url);
    }
  }

  // Fetch everything the current project needs.
  function prefetch() {
    const next = new Set();
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        const sample = project.samples[clip.sample_id];
        if (!sample) continue;
        next.add(sampleAudioUrl(sample));
        if (needsRender(clip, sample, project.bpm)) {
          const info = renderInfo(clip, sample, project.bpm);
          if (!renderMeta.has(info.url)) renderMeta.set(info.url, info);
          next.add(info.url);
        }
      }
    }
    wanted = next;
    evictRenders();
    for (const url of wanted) {
      load(url).catch((e) => reportError(`Could not load audio: ${e.message}`));
    }
  }

  /** The most recent decoded render of the same sample and pitch, if any. */
  function standInRender(info) {
    let found = null;
    for (const [url, buffer] of loaded) {
      const m = renderMeta.get(url);
      if (m && url !== info.url && m.sampleId === info.sampleId && m.semitones === info.semitones && m.cents === info.cents) {
        found = { buffer, rate: m.rate };
      }
    }
    return found;
  }

  /**
   * Where a clip's audio comes from right now. Exact: the server render at
   * rate 1 (or the original when no render is needed). Until the render
   * arrives: an older render of the same pitch re-timed to the new rate, or
   * — when there's no pitch shift to keep — the original at playbackRate
   * `rate` (cents via detune). null if nothing playable is decoded yet.
   */
  function pickSource(clip, sample, bpm) {
    const rate = clipRate(clip, sample, bpm);
    const original = loaded.get(sampleAudioUrl(sample));
    if (!needsRender(clip, sample, bpm)) {
      return original ? { buffer: original, playbackRate: rate, k: 1, detune: 0, exact: true, wantUrl: null } : null;
    }
    const info = renderInfo(clip, sample, bpm);
    const rendered = loaded.get(info.url);
    if (rendered) return { buffer: rendered, playbackRate: 1, k: 1 / info.rate, detune: 0, exact: true, wantUrl: info.url };
    const old = standInRender(info);
    if (old) return { buffer: old.buffer, playbackRate: rate / old.rate, k: 1 / old.rate, detune: 0, exact: false, wantUrl: info.url };
    if (clip.semitones === 0 && original) {
      return { buffer: original, playbackRate: rate, k: 1, detune: clip.cents, exact: false, wantUrl: info.url };
    }
    return null;
  }

  // --- mixer ---------------------------------------------------------------
  function syncMix() {
    if (!ctx || !project) return;
    const seen = new Set();
    for (const track of project.tracks) {
      let nodes = trackNodes.get(track.id);
      if (!nodes) {
        const gain = ctx.createGain();
        const pan = ctx.createStereoPanner();
        gain.connect(pan).connect(master);
        nodes = { gain, pan, meter: stereoMeter(ctx, pan) };
        trackNodes.set(track.id, nodes);
      }
      const level = isTrackAudible(track, project.tracks) ? track.volume : 0;
      nodes.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.01);
      nodes.pan.pan.setTargetAtTime(track.pan, ctx.currentTime, 0.01);
      seen.add(track.id);
    }
    for (const [id, nodes] of trackNodes) {
      if (!seen.has(id)) {
        nodes.pan.disconnect();
        trackNodes.delete(id);
      }
    }
  }

  // Clip gain is a live node per voice: no reschedule, no gap.
  function applyClipGains() {
    if (!ctx || !segments.length) return;
    const byId = new Map();
    for (const t of project.tracks) for (const c of t.clips) byId.set(c.id, c);
    const now = ctx.currentTime;
    for (const seg of segments) {
      for (const [id, v] of seg.voices) {
        const c = byId.get(id);
        if (c && c.gain !== v.gain) {
          v.clipGain.gain.setTargetAtTime(c.gain, now, 0.01);
          v.gain = c.gain;
        }
      }
    }
  }

  // --- transport -----------------------------------------------------------
  function loopBounds() {
    const loop = project?.loop;
    return loop?.enabled && loop.end_beat > loop.start_beat ? loop : null;
  }

  function loopKey() {
    const l = loopBounds();
    return l ? `${l.start_beat}:${l.end_beat}` : '';
  }

  function newSegment(ctxStart, beatStart, continuous = false) {
    const loop = loopBounds();
    // Starting at/after the loop end would never loop: that's a wrap.
    const start = loop && beatStart >= loop.end_beat - 1e-9 ? loop.start_beat : beatStart;
    const beatEnd = loop && start < loop.end_beat ? loop.end_beat : Infinity;
    return {
      ctxStart, beatStart: start, beatEnd, continuous,
      voices: new Map(), done: new Map(), clicks: new Map(), plan: null, planKey: null,
    };
  }

  function segmentCtxEnd(seg) {
    return seg.ctxStart + beatsToSeconds(seg.beatEnd - seg.beatStart, project.bpm);
  }

  /** The planned slices of one segment, cached per project + segment end. */
  function planFor(seg) {
    if (seg.plan && seg.planKey === project && seg.planEnd === seg.beatEnd) return seg.plan;
    const plan = new Map();
    for (const item of clipsInRange(project, seg.beatStart, seg.beatEnd)) {
      item.sig = planSignature(item);
      plan.set(item.clip.id, item);
    }
    seg.plan = plan;
    seg.planKey = project;
    seg.planEnd = seg.beatEnd;
    return plan;
  }

  /** Musical position at context time `t` under the current segments. */
  function positionAt(t) {
    if (!segments.length) return positionBeats;
    let seg = null;
    for (const s of segments) if (s.ctxStart <= t) seg = s;
    const spb = secondsPerBeat(project.bpm);
    if (!seg) {
      // Before the first segment starts: a fresh start shows its start beat;
      // a retimed one (tempo change) runs on from where it was.
      const first = segments[0];
      return first.continuous ? Math.max(0, first.beatStart - (first.ctxStart - t) / spb) : first.beatStart;
    }
    return Math.min(seg.beatStart + (t - seg.ctxStart) / spb, seg.beatEnd);
  }

  function outputLatency() {
    return ctx && Number.isFinite(ctx.outputLatency) ? ctx.outputLatency : 0;
  }

  function getPositionBeats() {
    if (!playing || !ctx || !segments.length) return positionBeats;
    return positionAt(ctx.currentTime);
  }

  function getDisplayPositionBeats() {
    if (!playing || !ctx || !segments.length) return positionBeats;
    return positionAt(ctx.currentTime - outputLatency());
  }

  /** Stop a segment's voices (and its clicks from `t` on) at context time `t`. */
  function silenceSegment(seg, t) {
    for (const v of seg.voices.values()) stopVoiceAt(v, t);
    seg.voices.clear();
    for (const [b, c] of seg.clicks) {
      if (c.when >= t - 1e-9) {
        stopVoiceAt(c, t);
        seg.clicks.delete(b);
      }
    }
  }

  function silenceAll(t) {
    for (const seg of segments) {
      for (const v of seg.voices.values()) stopVoiceAt(v, t);
      for (const c of seg.clicks.values()) stopVoiceAt(c, t);
    }
  }

  function tick() {
    if (!playing) return;
    const now = ctx.currentTime;
    const horizon = now + LOOKAHEAD_SEC;
    const bpm = project.bpm;
    const spb = secondsPerBeat(bpm);

    // Queue the next loop pass once the current one ends within the window.
    const last = segments[segments.length - 1];
    if (Number.isFinite(last.beatEnd) && segmentCtxEnd(last) < horizon) {
      segments.push(newSegment(segmentCtxEnd(last), loopBounds()?.start_beat ?? last.beatEnd));
    }
    // Forget passes that have finished — after they've been heard too, so
    // the display position still maps across a wrap.
    while (segments.length > 1 && segmentCtxEnd(segments[0]) < now - outputLatency() - 0.05) segments.shift();

    for (const seg of segments) {
      const winFrom = seg.beatStart + Math.max(0, now - seg.ctxStart) / spb;
      const winTo = Math.min(seg.beatEnd, seg.beatStart + (horizon - seg.ctxStart) / spb);
      if (winTo <= seg.beatStart || winFrom >= seg.beatEnd) continue;

      for (const item of planFor(seg).values()) {
        const id = item.clip.id;
        if (seg.voices.has(id) || seg.done.has(id) || item.fromBeat >= winTo) continue;
        // Starting late (buffer arrived mid-clip, or a reschedule): skip ahead.
        const late = Math.max(0, winFrom - item.fromBeat);
        if (late >= item.lengthBeats) {
          seg.done.set(id, item.sig);
          continue;
        }
        const source = pickSource(item.clip, item.sample, bpm);
        if (!source) continue; // not decoded yet; retried next tick
        const dest = trackNodes.get(item.track.id)?.gain;
        if (!dest) continue;
        const when = seg.ctxStart + (item.fromBeat + late - seg.beatStart) * spb;
        const voice = startVoice(
          ctx, dest, item.clip, item.sample, bpm, source,
          Math.max(when, now), (item.intoBeats + late) * spb, (item.lengthBeats - late) * spb
        );
        voice.sig = item.sig;
        voice.exact = source.exact;
        voice.wantUrl = source.wantUrl;
        seg.voices.set(id, voice);
      }

      if (metronome) {
        for (let b = Math.ceil(winFrom - 1e-9); b < winTo; b += 1) {
          if (seg.clicks.has(b)) continue;
          seg.clicks.set(b, scheduleClick(ctx, clickBus, seg.ctxStart + (b - seg.beatStart) * spb, b % project.beats_per_bar === 0));
        }
      }
    }

    // Without a loop, stop after the last clip (or immediately if empty).
    if (endBeatCache.project !== project) endBeatCache = { project, end: projectEndBeat(project) };
    if (!loopBounds() && getPositionBeats() >= endBeatCache.end) {
      stop();
      positionBeats = playStartBeat;
      emitState();
    }
  }

  function startTimer() {
    clearInterval(timer);
    timer = setInterval(tick, TICK_MS);
  }

  /** Hard (re)start at `fromBeat`: everything playing stops now. */
  function startTransport(fromBeat) {
    if (segments.length) silenceAll(ctx.currentTime);
    syncMix();
    segments = [newSegment(ctx.currentTime + START_LATENCY_SEC, fromBeat)];
    startTimer();
    tick();
  }

  /**
   * Retime everything from context time `T` at musical position `beat`
   * (tempo change): old voices keep playing until T and hand over there, so
   * there's no gap and no jump.
   */
  function retimeTo(T, beat) {
    silenceAll(T);
    segments = [newSegment(T, beat, true)];
    startTimer();
    tick();
  }

  /**
   * Re-plan after a timing edit at an unchanged tempo: fix the loop chain if
   * the loop moved, then stop only voices whose plan changed (or whose clip
   * is gone); tick() reschedules them from the current position.
   */
  function replan(loopChanged) {
    const now = ctx.currentTime;
    let idx = 0;
    segments.forEach((s, i) => {
      if (s.ctxStart <= now) idx = i;
    });
    const cur = segments[idx];
    if (loopChanged) {
      for (const s of segments.slice(idx + 1)) silenceSegment(s, now);
      segments = segments.slice(0, idx + 1);
      const loop = loopBounds();
      const pos = positionAt(now);
      if (loop && pos >= loop.end_beat - 1e-9) {
        // Already past the new loop end: wrap now.
        const T = now + START_LATENCY_SEC;
        const posT = positionAt(T);
        silenceSegment(cur, T);
        cur.beatEnd = Math.max(cur.beatStart, posT);
        for (const [id, item] of planFor(cur)) cur.done.set(id, item.sig);
        segments.push(newSegment(T, loop.start_beat, true));
      } else {
        cur.beatEnd = loop && cur.beatStart < loop.end_beat ? loop.end_beat : Infinity;
      }
    }
    for (const seg of segments) {
      const plan = planFor(seg);
      for (const [id, v] of seg.voices) {
        if (plan.get(id)?.sig !== v.sig) {
          stopVoiceAt(v, now);
          seg.voices.delete(id);
        }
      }
      for (const [id, sig] of seg.done) if (plan.get(id)?.sig !== sig) seg.done.delete(id);
      for (const [b, c] of seg.clicks) {
        if (b >= seg.beatEnd) {
          stopVoiceAt(c, now);
          seg.clicks.delete(b);
        }
      }
    }
    tick();
  }

  // A voice standing in (older render, or the original at `rate`) is swapped
  // for the exact render as soon as that decodes — just that voice.
  function onExactLoaded(url) {
    if (!playing || !ctx) return;
    const now = ctx.currentTime;
    let swapped = false;
    for (const seg of segments) {
      for (const [id, v] of seg.voices) {
        if (!v.exact && !v.ended && v.wantUrl === url) {
          stopVoiceAt(v, now);
          seg.voices.delete(id);
          swapped = true;
        }
      }
    }
    if (swapped) tick();
  }

  async function play(fromBeat = positionBeats) {
    if (!project) return;
    ensureContext();
    if (ctx.state !== 'running') await ctx.resume();
    const loop = loopBounds();
    // Starting past the loop end would never loop; start at the loop instead.
    const start = loop && fromBeat >= loop.end_beat ? loop.start_beat : Math.max(0, fromBeat);
    playStartBeat = start;
    playing = true;
    startTransport(start);
    emitState();
  }

  function stop() {
    if (playing) positionBeats = getDisplayPositionBeats();
    playing = false;
    clearInterval(timer);
    timer = null;
    if (ctx) silenceAll(ctx.currentTime);
    segments = [];
    emitState();
  }

  function seek(beat) {
    const target = Math.max(0, beat);
    if (playing) {
      playStartBeat = target;
      startTransport(target);
    } else {
      positionBeats = target;
    }
    emitState();
  }

  function setProject(next) {
    const prev = project;
    const nextProject = normalizeForEngine(next);
    const tempoChanged = playing && !!ctx && !!prev && prev.bpm !== nextProject.bpm;
    let handover = 0;
    let handoverBeat = 0;
    if (tempoChanged) {
      // Musical position at the handover time, under the OLD tempo/segments.
      handover = ctx.currentTime + START_LATENCY_SEC;
      handoverBeat = positionAt(handover);
    }
    const prevSig = timingSig;
    const prevLoop = prev ? loopKey() : null;
    project = nextProject;
    timingSig = timingSignature(project);
    if (ctx) {
      syncMix();
      applyClipGains();
    }
    prefetch();
    if (playing && ctx && prev) {
      if (tempoChanged) {
        const loop = loopBounds();
        let beat = handoverBeat;
        if (loop && beat >= loop.end_beat) {
          beat = loop.start_beat + ((beat - loop.start_beat) % (loop.end_beat - loop.start_beat));
        }
        retimeTo(handover, Math.max(0, beat));
      } else if (prevSig !== timingSig) {
        replan(prevLoop !== loopKey());
      }
    }
    emitIfPendingChanged();
  }

  async function getBuffer(sampleId) {
    // Doesn't require the sample to be in the current project yet: the UI's
    // child components (clip waveforms) run their effects before the parent
    // hands the engine the project, and the URL only needs the id.
    return load(sampleAudioUrl(project?.samples[sampleId] ?? { id: sampleId }));
  }

  function getMeters() {
    const out = { master: [0, 0], tracks: {} };
    if (!ctx || !masterMeter) {
      if (project) for (const t of project.tracks) out.tracks[t.id] = 0;
      return out;
    }
    out.master = [peakOf(masterMeter.left, meterScratch), peakOf(masterMeter.right, meterScratch)];
    for (const [id, nodes] of trackNodes) {
      out.tracks[id] = Math.max(peakOf(nodes.meter.left, meterScratch), peakOf(nodes.meter.right, meterScratch));
    }
    return out;
  }

  /**
   * Render [fromBeat, toBeat) of `proj` offline — the same voice
   * construction as live playback (loops, fades, reverse, cents, clip
   * gain, de-click), everything scheduled up front, arrangement loop
   * ignored. Waits for all needed audio, including server renders.
   * `soloTrackId`: only that track sounds (at its volume/pan), whatever the
   * mute/solo flags — one stem.
   */
  async function renderOffline(proj, { fromBeat = 0, toBeat, sampleRate = 44100, masterGain = 1, soloTrackId = null } = {}) {
    const p = normalizeForEngine(proj);
    const endBeat = toBeat ?? projectEndBeat(p);
    const seconds = beatsToSeconds(Math.max(endBeat - fromBeat, 0), p.bpm);
    const offline = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * sampleRate)), sampleRate);
    const audible = (track) => (soloTrackId ? track.id === soloTrackId : isTrackAudible(track, p.tracks));
    const items = clipsInRange(p, fromBeat, endBeat).filter((item) => audible(item.track));

    const sources = new Map();
    await Promise.all(
      items.map(async ({ clip, sample }) => {
        const render = needsRender(clip, sample, p.bpm) ? renderInfo(clip, sample, p.bpm) : null;
        // Known as a render, so the eviction rules apply once it's loaded.
        if (render && !renderMeta.has(render.url)) renderMeta.set(render.url, render);
        try {
          const buffer = await load(render ? render.url : sampleAudioUrl(sample));
          const rate = clipRate(clip, sample, p.bpm);
          sources.set(
            clip.id,
            render
              ? { buffer, playbackRate: 1, k: 1 / render.rate, detune: 0 }
              : { buffer, playbackRate: rate, k: 1, detune: 0 }
          );
        } catch (e) {
          // Name the sample: a bare "404 fetching audio" doesn't say which
          // clip broke the whole mixdown.
          throw new Error(`Could not load audio for "${sample.name}" (${e.message})`);
        }
      })
    );

    const out = offline.createGain();
    out.gain.value = masterGain;
    out.connect(offline.destination);
    const nodes = new Map();
    for (const track of p.tracks) {
      if (!audible(track)) continue;
      const gain = offline.createGain();
      const pan = offline.createStereoPanner();
      gain.gain.value = track.volume;
      pan.pan.value = track.pan;
      gain.connect(pan).connect(out);
      nodes.set(track.id, gain);
    }
    const spb = secondsPerBeat(p.bpm);
    for (const item of items) {
      const when = beatsToSeconds(item.fromBeat - fromBeat, p.bpm);
      startVoice(
        offline, nodes.get(item.track.id), item.clip, item.sample, p.bpm, sources.get(item.clip.id),
        when, item.intoBeats * spb, item.lengthBeats * spb
      );
    }
    return offline.startRendering();
  }

  return {
    setProject,
    play,
    stop,
    seek,
    isPlaying: () => playing,
    getPositionBeats,
    getDisplayPositionBeats,
    setMetronome(on) {
      metronome = !!on;
    },
    setMasterGain(gain) {
      masterGainValue = Math.max(0, Number(gain) || 0);
      if (ctx && master) master.gain.setTargetAtTime(masterGainValue, ctx.currentTime, 0.01);
    },
    getMeters,
    getBuffer,
    renderOffline,
    on(type, cb) {
      listeners[type]?.add(cb);
      return () => listeners[type]?.delete(cb);
    },
    dispose() {
      stop();
      listeners.state.clear();
      listeners.error.clear();
      loaded.clear();
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
      trackNodes.clear();
    },
  };
}

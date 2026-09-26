/**
 * Arrangement audio engine (raw Web Audio API, no dependencies).
 *
 * Contract for the Arrange UI — the UI never touches Web Audio directly:
 *
 *   const engine = createEngine();
 *   engine.setProject(project);   // call on EVERY project change (cheap,
 *                                 // idempotent): applies mix changes live,
 *                                 // reschedules if timing changed while
 *                                 // playing, prefetches audio/renders
 *   await engine.play(fromBeat);  // first call must come from a user
 *                                 // gesture (browser autoplay policy)
 *   engine.stop();                // pause; playhead stays where it stopped
 *   engine.seek(beat);            // move playhead (keeps playing if playing)
 *   engine.isPlaying();
 *   engine.getPositionBeats();    // poll from requestAnimationFrame
 *   engine.setMetronome(on);
 *   await engine.getBuffer(sampleId);  // decoded SOURCE audio (AudioBuffer)
 *                                      // for drawing clip waveforms
 *   const off = engine.on('state', ({ playing, positionBeats, loading }) => {});
 *   engine.on('error', ({ message }) => {});
 *   await engine.renderOffline(project, { fromBeat, toBeat, sampleRate });
 *                                 // → AudioBuffer (mixdown / verification)
 *   engine.dispose();
 *
 * Behaviour:
 *   - Looping follows project.loop (enabled/start_beat/end_beat).
 *   - Without a loop, playback stops by itself after the last clip ends and
 *     the playhead returns to where playback started.
 *   - `loading` in the state event = number of audio fetches in flight.
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
 * @typedef {import('./project').Project} Project
 */
import {
  beatsToSeconds,
  canWarp,
  clipDurationBeats,
  clipRate,
  isTrackAudible,
  projectEndBeat,
  secondsPerBeat,
} from './project';
import { renderUrl, sampleAudioUrl } from './projectsApi';

const LOOKAHEAD_SEC = 0.25;
const TICK_MS = 25;
const START_LATENCY_SEC = 0.05;
const FADE_SEC = 0.005; // de-click ramp at clip edges
const CLICK_SEC = 0.03;

/** Server render needed: warped off the sample's own tempo, or pitch-shifted. */
function needsRender(clip, sample, bpm) {
  return clip.semitones !== 0 || Math.abs(clipRate(clip, sample, bpm) - 1) > 1e-4;
}

function renderKey(clip, sample, bpm) {
  return renderUrl(clip.sample_id, {
    bpm: clip.warp && canWarp(sample) ? bpm : sample.bpm ?? bpm,
    semitones: clip.semitones,
    sourceBpm: sample.bpm,
  });
}

// What changes the *timing* of playback (needs a reschedule) vs only the mix.
function timingSignature(project) {
  return JSON.stringify([
    project.bpm,
    project.loop,
    project.tracks.map((t) => [
      t.id,
      t.clips.map((c) => [c.id, c.sample_id, c.start_beat, c.offset_sec, c.length_sec, c.warp, c.semitones]),
    ]),
    Object.values(project.samples).map((s) => [s.id, s.bpm]),
  ]);
}

/**
 * Where a clip's audio comes from right now: the server render at rate 1,
 * or — until that arrives — the original at playbackRate `rate` (tempo
 * follows immediately; pitch shifts with it). Returns null if neither is
 * decoded yet or a pitch shift can't be faked.
 */
function pickSource(clip, sample, bpm, getLoaded) {
  const rate = clipRate(clip, sample, bpm);
  if (needsRender(clip, sample, bpm)) {
    const rendered = getLoaded(renderKey(clip, sample, bpm));
    if (rendered) return { buffer: rendered, playbackRate: 1, rendered: true };
    if (clip.semitones !== 0) return null;
  }
  const original = getLoaded(sampleAudioUrl(sample));
  return original ? { buffer: original, playbackRate: rate, rendered: false } : null;
}

/**
 * Start one clip (or its tail) at context time `when`.
 * `intoBeats` = how far into the clip playback begins; `lengthBeats` = how
 * much of it to play. Returns the nodes so they can be stopped.
 */
function startClip(ctx, destination, clip, sample, bpm, source, when, intoBeats, lengthBeats) {
  const spb = secondsPerBeat(bpm);
  const rate = clipRate(clip, sample, bpm);
  const intoTimeline = intoBeats * spb; // output seconds
  const playSeconds = lengthBeats * spb;

  const node = ctx.createBufferSource();
  node.buffer = source.buffer;
  node.playbackRate.value = source.playbackRate;
  const gain = ctx.createGain();
  node.connect(gain).connect(destination);

  // Offset in the chosen buffer's own seconds. The render is the whole
  // sample already stretched, so its seconds are timeline seconds and the
  // source-seconds trim scales by 1/rate; the original plays at `rate`, so
  // timeline seconds scale by rate instead.
  const offset = source.rendered
    ? clip.offset_sec / rate + intoTimeline
    : clip.offset_sec + intoTimeline * rate;
  const end = when + playSeconds;

  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(clip.gain, when + Math.min(FADE_SEC, playSeconds / 2));
  gain.gain.setValueAtTime(clip.gain, Math.max(when, end - FADE_SEC));
  gain.gain.linearRampToValueAtTime(0, end);
  // stop() in context time rather than start()'s `duration` argument, whose
  // unit (buffer time vs output time) is easy to get wrong under playbackRate.
  node.start(when, Math.max(0, offset));
  node.stop(end);
  return trackVoice(node, gain);
}

function trackVoice(node, gain) {
  const voice = { node, gain, ended: false };
  node.onended = () => {
    voice.ended = true;
  };
  return voice;
}

function scheduleClick(ctx, destination, when, downbeat) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = downbeat ? 1500 : 1000;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(downbeat ? 0.5 : 0.3, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + CLICK_SEC);
  osc.connect(gain).connect(destination);
  osc.start(when);
  osc.stop(when + CLICK_SEC + 0.01);
  return trackVoice(osc, gain);
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

export function createEngine() {
  let ctx = null;
  let master = null;
  const trackNodes = new Map(); // trackId -> { gain, pan }
  let project = null;
  let timingSig = null;

  const loaded = new Map(); // url -> AudioBuffer
  const inflight = new Map(); // url -> Promise<AudioBuffer>
  const listeners = { state: new Set(), error: new Set() };

  let playing = false;
  let metronome = false;
  let positionBeats = 0; // playhead while stopped
  let playStartBeat = 0;
  let segments = []; // { ctxStart, beatStart, beatEnd, scheduled:Set, clicks:Set }
  let voices = []; // scheduled nodes
  let timer = null;

  const emit = (type, payload) => listeners[type].forEach((cb) => cb(payload));
  const emitState = () =>
    emit('state', { playing, positionBeats: getPositionBeats(), loading: inflight.size });
  const reportError = (message) => emit('error', { message });

  function ensureContext() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.connect(ctx.destination);
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

  // Fetch everything the current project needs; drop renders it no longer does.
  function prefetch() {
    const wanted = new Set();
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        const sample = project.samples[clip.sample_id];
        if (!sample) continue;
        wanted.add(sampleAudioUrl(sample));
        if (needsRender(clip, sample, project.bpm)) wanted.add(renderKey(clip, sample, project.bpm));
      }
    }
    for (const url of loaded.keys()) {
      if (url.includes('/render?') && !wanted.has(url)) loaded.delete(url);
    }
    for (const url of wanted) {
      load(url).catch((e) => reportError(`Could not load audio: ${e.message}`));
    }
  }

  // --- mixer ---------------------------------------------------------------
  function syncMix() {
    if (!ctx || !project) return;
    const seen = new Set();
    for (const track of project.tracks) {
      let nodes = trackNodes.get(track.id);
      if (!nodes) {
        nodes = { gain: ctx.createGain(), pan: ctx.createStereoPanner() };
        nodes.gain.connect(nodes.pan).connect(master);
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

  // --- transport -----------------------------------------------------------
  function loopBounds() {
    const loop = project?.loop;
    return loop?.enabled && loop.end_beat > loop.start_beat ? loop : null;
  }

  function newSegment(ctxStart, beatStart) {
    const loop = loopBounds();
    const beatEnd = loop && beatStart < loop.end_beat ? loop.end_beat : Infinity;
    return { ctxStart, beatStart, beatEnd, scheduled: new Set(), clicks: new Set() };
  }

  function segmentCtxEnd(seg) {
    return seg.ctxStart + beatsToSeconds(seg.beatEnd - seg.beatStart, project.bpm);
  }

  function getPositionBeats() {
    if (!playing || !ctx || !segments.length) return positionBeats;
    const now = ctx.currentTime;
    let seg = segments[0];
    for (const s of segments) if (s.ctxStart <= now) seg = s;
    const beat = seg.beatStart + Math.max(0, now - seg.ctxStart) / secondsPerBeat(project.bpm);
    return Math.min(beat, seg.beatEnd);
  }

  function silenceVoices() {
    const now = ctx ? ctx.currentTime : 0;
    for (const v of voices) {
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setTargetAtTime(0, now, FADE_SEC / 3);
        v.node.stop(now + FADE_SEC * 2);
      } catch (e) {
        // already stopped
      }
    }
    voices = [];
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
    // Forget passes that have finished.
    while (segments.length > 1 && segmentCtxEnd(segments[0]) < now) segments.shift();

    for (const seg of segments) {
      const winFrom = seg.beatStart + Math.max(0, now - seg.ctxStart) / spb;
      const winTo = Math.min(seg.beatEnd, seg.beatStart + (horizon - seg.ctxStart) / spb);
      if (winTo <= seg.beatStart) continue;

      for (const item of clipsInRange(project, seg.beatStart, seg.beatEnd)) {
        if (seg.scheduled.has(item.clip.id) || item.fromBeat >= winTo) continue;
        const source = pickSource(item.clip, item.sample, bpm, (url) => loaded.get(url));
        if (!source) continue; // not decoded yet; retried next tick
        // Starting late (buffer arrived mid-clip, or a reschedule): skip ahead.
        const late = Math.max(0, winFrom - item.fromBeat);
        if (late >= item.lengthBeats) {
          seg.scheduled.add(item.clip.id);
          continue;
        }
        const when = seg.ctxStart + (item.fromBeat + late - seg.beatStart) * spb;
        const dest = trackNodes.get(item.track.id)?.gain;
        if (!dest) continue;
        voices.push(
          startClip(ctx, dest, item.clip, item.sample, bpm, source, Math.max(when, now), item.intoBeats + late, item.lengthBeats - late)
        );
        seg.scheduled.add(item.clip.id);
      }

      if (metronome) {
        for (let b = Math.ceil(winFrom - 1e-9); b < winTo; b += 1) {
          if (seg.clicks.has(b)) continue;
          seg.clicks.add(b);
          voices.push(scheduleClick(ctx, master, seg.ctxStart + (b - seg.beatStart) * spb, b % project.beats_per_bar === 0));
        }
      }
    }

    // Drop finished voices so the list doesn't grow unbounded.
    voices = voices.filter((v) => !v.ended);

    // Without a loop, stop after the last clip (or immediately if empty).
    if (!loopBounds() && getPositionBeats() >= projectEndBeat(project)) {
      stop();
      positionBeats = playStartBeat;
      emitState();
    }
  }

  function startTransport(fromBeat) {
    silenceVoices();
    syncMix();
    segments = [newSegment(ctx.currentTime + START_LATENCY_SEC, fromBeat)];
    clearInterval(timer);
    timer = setInterval(tick, TICK_MS);
    tick();
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
    if (playing) positionBeats = getPositionBeats();
    playing = false;
    clearInterval(timer);
    timer = null;
    silenceVoices();
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
    const prevSig = timingSig;
    project = next;
    timingSig = timingSignature(next);
    if (ctx) syncMix();
    prefetch();
    if (playing && prevSig !== null && prevSig !== timingSig) startTransport(getPositionBeats());
  }

  async function getBuffer(sampleId) {
    // Doesn't require the sample to be in the current project yet: the UI's
    // child components (clip waveforms) run their effects before the parent
    // hands the engine the project, and the URL only needs the id.
    return load(sampleAudioUrl(project?.samples[sampleId] ?? { id: sampleId }));
  }

  /**
   * Render [fromBeat, toBeat) of `proj` offline — the same clip scheduling
   * as live playback, without the lookahead (everything scheduled up front,
   * loop ignored). Waits for all needed audio, including server renders.
   */
  async function renderOffline(proj, { fromBeat = 0, toBeat, sampleRate = 44100 } = {}) {
    const endBeat = toBeat ?? projectEndBeat(proj);
    const seconds = beatsToSeconds(Math.max(endBeat - fromBeat, 0), proj.bpm);
    const offline = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * sampleRate)), sampleRate);
    const items = clipsInRange(proj, fromBeat, endBeat);

    const buffers = new Map();
    await Promise.all(
      items.map(async ({ clip, sample }) => {
        const url = needsRender(clip, sample, proj.bpm) ? renderKey(clip, sample, proj.bpm) : sampleAudioUrl(sample);
        buffers.set(clip.id, await load(url));
      })
    );

    const out = offline.createGain();
    out.connect(offline.destination);
    const nodes = new Map();
    for (const track of proj.tracks) {
      const gain = offline.createGain();
      const pan = offline.createStereoPanner();
      gain.gain.value = isTrackAudible(track, proj.tracks) ? track.volume : 0;
      pan.pan.value = track.pan;
      gain.connect(pan).connect(out);
      nodes.set(track.id, gain);
    }
    for (const item of items) {
      const source = {
        buffer: buffers.get(item.clip.id),
        playbackRate: 1,
        rendered: needsRender(item.clip, item.sample, proj.bpm),
      };
      const when = beatsToSeconds(item.fromBeat - fromBeat, proj.bpm);
      startClip(offline, nodes.get(item.track.id), item.clip, item.sample, proj.bpm, source, when, item.intoBeats, item.lengthBeats);
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
    setMetronome(on) {
      metronome = !!on;
    },
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

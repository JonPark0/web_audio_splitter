import { createResampler, fetchFrames, fetchWavHeader } from './wav';

/**
 * Stem playback on ONE AudioContext clock.
 *
 * Why not <audio> elements (or wavesurfer's MediaElement backend): every
 * element streams over its own HTTP/1.1 connection and browsers allow six per
 * host, so with 7+ stems one element is starved and stalls for good ~30 s into
 * playback (measured: readyState stuck at 2, offset growing ~1 s/s). Elements
 * also start and seek independently (10-20 ms offsets).
 *
 * Here each stem variant ("voice") is fetched in 1-second chunks through
 * short-lived Range requests, decoded from PCM in JS (resampled to the context
 * rate with a sinc filter when needed) and scheduled as AudioBufferSourceNodes
 * on a shared timeline. Every stem is sample-aligned by construction, before
 * and after seeks, loops and Original/Recovered switches. Both variants of a
 * stem are scheduled side by side and switched with a gain ramp, so A/B is
 * instant and never drifts. Only the chunks around the playhead are kept.
 *
 * Timeline model: a list of segments { c0, p0, p1 } in context frames — the
 * timeline span [p0, p1) plays from context frame c0. A loop is the same span
 * repeated back to back (gapless).
 */

const CHUNK_SEC = 1;
const AHEAD_SEC = 4; // audible voices
const AHEAD_IDLE_SEC = 2; // muted voices / inactive variants (scheduled at gain 0)
const BEHIND_SEC = 2;
const START_LATENCY = 0.05;
const LATE_MARGIN = 0.03;
const PUMP_MS = 40;
const MAX_FETCHES = 5; // leave one of the browser's 6 connections for the API
const START_DEADLINE_MS = 2500;
const RAMP = 0.008;
const KEEP_LOOP_SEC = 30; // loops up to this long stay fully cached

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default class MixEngine {
  constructor({ duration = 0, sampleRate = 0 } = {}) {
    this.duration = duration;
    this.preferredRate = sampleRate;
    this.ctx = null;
    this.sr = 0;
    this.N = 0;
    this.stems = new Map();
    this.listeners = new Set();
    this.playing = false;
    this.pending = null; // target (s) while a start waits for audio
    this.pos = 0;
    this.segs = [];
    this.segId = 0;
    this.loop = null; // { start, end } seconds, or null
    this.endAt = null; // stop here (range preview) instead of the track end
    this.rewindTo = 0;
    this.solo = null; // preview override: only this stem sounds
    this.live = new Set();
    this.queue = [];
    this.inflight = 0;
    this.gen = 0;
    this.timer = 0;
    this.pumpQueued = false;
    this.destroyed = false;
  }

  // ---- setup ---------------------------------------------------------------

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event) {
    this.listeners.forEach((fn) => fn(event));
  }

  emitState(type = 'state') {
    this.emit({ type, playing: this.playing, pending: this.pending != null });
  }

  addStem(name, urls, { gain = 1, variant = 'original' } = {}) {
    const stem = { name, gain, variant, node: null, voices: {} };
    for (const [v, url] of Object.entries(urls)) {
      if (!url) continue;
      stem.voices[v] = {
        stem,
        variant: v,
        url,
        header: null,
        headerPromise: null,
        chunks: new Map(),
        sched: new Map(), // segId -> Set(k)
        node: null,
        error: null,
        failures: 0,
        resampler: null,
        lengthF: 0,
      };
    }
    this.stems.set(name, stem);
    if (this.ctx) this.createNodes(stem);
  }

  setDuration(sec) {
    if (sec > 0) this.duration = sec;
  }

  setPreferredRate(rate) {
    if (!this.ctx && rate) this.preferredRate = rate;
  }

  /** Read every voice's WAV header (a few KB each) so the first Play is fast. */
  prefetchHeaders() {
    for (const voice of this.voices()) this.header(voice).catch(() => {});
  }

  voices() {
    const out = [];
    this.stems.forEach((s) => Object.values(s.voices).forEach((v) => out.push(v)));
    return out;
  }

  ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    try {
      this.ctx = new Ctor({ latencyHint: 'interactive', ...(this.preferredRate ? { sampleRate: this.preferredRate } : {}) });
    } catch (e) {
      this.ctx = new Ctor();
    }
    this.sr = this.ctx.sampleRate;
    this.N = Math.round(this.sr * CHUNK_SEC);
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.stems.forEach((stem) => this.createNodes(stem));
    this.voices().forEach((v) => v.header && this.prepareVoice(v));
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  createNodes(stem) {
    stem.node = this.ctx.createGain();
    stem.node.gain.value = this.effectiveGain(stem);
    stem.node.connect(this.master);
    for (const voice of Object.values(stem.voices)) {
      voice.node = this.ctx.createGain();
      voice.node.gain.value = voice.variant === stem.variant ? 1 : 0;
      voice.node.connect(stem.node);
    }
  }

  prepareVoice(voice) {
    const h = voice.header;
    voice.resampler = h.rate === this.sr ? null : createResampler(h.rate, this.sr);
    voice.lengthF = Math.floor((h.frames * this.sr) / h.rate);
  }

  destroy() {
    this.destroyed = true;
    this.gen += 1;
    this.stopTimer();
    this.voices().forEach((v) => v.chunks.forEach((e) => e.controller?.abort()));
    this.queue = [];
    this.listeners.clear();
    this.ctx?.close().catch(() => {});
  }

  // ---- mix -------------------------------------------------------------------

  effectiveGain(stem) {
    if (this.solo) return stem.name === this.solo ? stem.gain || 1 : 0;
    return stem.gain;
  }

  isAudible(stem, voice) {
    return this.effectiveGain(stem) !== 0 && voice.variant === stem.variant;
  }

  ramp(param, value) {
    const t = this.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + RAMP);
  }

  applyGains() {
    if (!this.ctx) return;
    this.stems.forEach((stem) => {
      this.ramp(stem.node.gain, this.effectiveGain(stem));
      Object.values(stem.voices).forEach((v) => this.ramp(v.node.gain, v.variant === stem.variant ? 1 : 0));
    });
    this.pumpSoon();
  }

  /** Linear gain (0 = silent). Mute/solo are resolved by the caller. */
  setStemGain(name, gain) {
    const stem = this.stems.get(name);
    if (!stem || stem.gain === gain) return;
    stem.gain = gain;
    this.applyGains();
  }

  setVariant(name, variant) {
    const stem = this.stems.get(name);
    if (!stem || !stem.voices[variant] || stem.variant === variant) return;
    stem.variant = variant;
    this.applyGains();
  }

  setSolo(name) {
    if (this.solo === name) return;
    this.solo = name;
    this.applyGains();
  }

  /** Transport loop region { start, end } (seconds) or null. */
  setLoop(region) {
    const next = region && region.end - region.start >= 0.01 ? { start: region.start, end: region.end } : null;
    const same = (next && this.loop && next.start === this.loop.start && next.end === this.loop.end) || (!next && !this.loop);
    if (same) return;
    this.loop = next;
    if (this.playing) this.replan();
  }

  retry(name) {
    const stem = this.stems.get(name);
    if (!stem) return;
    Object.values(stem.voices).forEach((v) => {
      v.error = null;
      v.failures = 0;
      if (!v.header) v.headerPromise = null;
      this.emit({ type: 'stem', name, variant: v.variant, error: null });
    });
    this.prefetchHeaders();
    this.pumpSoon();
  }

  // ---- loading -------------------------------------------------------------

  header(voice) {
    if (voice.header) return Promise.resolve(voice.header);
    if (!voice.headerPromise) {
      voice.headerPromise = fetchWavHeader(voice.url).then(
        (h) => {
          voice.header = h;
          if (this.sr) this.prepareVoice(voice);
          return h;
        },
        (err) => {
          voice.headerPromise = null;
          this.fail(voice, err);
          throw err;
        }
      );
    }
    return voice.headerPromise;
  }

  fail(voice, err) {
    if (voice.error) return;
    voice.error = err;
    voice.chunks.forEach((e) => e.controller?.abort());
    voice.chunks.clear();
    this.emit({ type: 'stem', name: voice.stem.name, variant: voice.variant, error: err?.message || 'Could not load audio' });
  }

  /** The chunk entry for frames [k·N, (k+1)·N), queued if not loaded yet. */
  chunk(voice, k, priority) {
    let e = voice.chunks.get(k);
    if (e) {
      if (e.state === 'queued') e.priority = Math.min(e.priority, priority);
      return e;
    }
    e = { k, state: 'queued', priority, buffer: null, controller: null };
    e.promise = new Promise((resolve, reject) => {
      e.resolve = resolve;
      e.reject = reject;
    });
    e.promise.catch(() => {});
    voice.chunks.set(k, e);
    this.queue.push({ voice, e });
    this.drain();
    return e;
  }

  drain() {
    while (this.inflight < MAX_FETCHES && this.queue.length) {
      let best = 0;
      for (let i = 1; i < this.queue.length; i += 1) if (this.queue[i].e.priority < this.queue[best].e.priority) best = i;
      const { voice, e } = this.queue.splice(best, 1)[0];
      if (voice.chunks.get(e.k) !== e || voice.error) {
        e.reject(Object.assign(new Error('evicted'), { name: 'AbortError' }));
        continue;
      }
      this.inflight += 1;
      e.state = 'loading';
      e.controller = new AbortController();
      this.loadChunk(voice, e)
        .then(
          (buffer) => {
            e.state = 'ready';
            e.buffer = buffer;
            voice.failures = 0;
            e.resolve(buffer);
            this.pumpSoon();
          },
          (err) => {
            if (voice.chunks.get(e.k) === e) voice.chunks.delete(e.k);
            e.state = 'error';
            e.reject(err);
            if (err?.name !== 'AbortError' && !this.destroyed) {
              voice.failures += 1;
              if (voice.failures >= 2 || err?.status === 404) this.fail(voice, err);
              else this.pumpSoon();
            }
          }
        )
        .finally(() => {
          this.inflight -= 1;
          this.drain();
        });
    }
  }

  async loadChunk(voice, e) {
    const h = await this.header(voice);
    if (!this.sr) throw new Error('no audio context');
    const j0 = e.k * this.N;
    const n = Math.min(this.N, voice.lengthF - j0);
    if (n <= 0) return null;
    let chans;
    if (!voice.resampler) {
      chans = (await fetchFrames(voice.url, h, j0, j0 + n, e.controller.signal)).channels;
    } else {
      const [s0, s1] = voice.resampler.sourceSpan(j0, n);
      const { channels, first } = await fetchFrames(voice.url, h, s0, s1, e.controller.signal);
      chans = channels.map((c) => voice.resampler.run(c, first, j0, n));
    }
    const len = chans[0]?.length || 0;
    if (!len || this.destroyed) return null;
    const buffer = this.ctx.createBuffer(chans.length, len, this.sr);
    chans.forEach((c, i) => buffer.copyToChannel(c, i));
    return buffer;
  }

  // ---- transport -------------------------------------------------------------

  durationF() {
    return Math.round(this.duration * this.sr);
  }

  loopFrames() {
    if (!this.loop || this.endAt != null) return null;
    const a = Math.round(this.loop.start * this.sr);
    const b = Math.min(Math.round(this.loop.end * this.sr), this.durationF());
    return b - a > this.sr * 0.01 ? [a, b] : null;
  }

  planEnd(fromF) {
    const dur = this.durationF();
    if (this.endAt != null) return Math.min(Math.round(this.endAt * this.sr), dur);
    const loop = this.loopFrames();
    if (loop && fromF < loop[1]) return loop[1];
    return dur;
  }

  segEnd(seg) {
    return seg.c0 + (seg.p1 - seg.p0);
  }

  extendLoop(untilC) {
    const loop = this.loopFrames();
    if (!loop || !this.segs.length) return;
    let last = this.segs[this.segs.length - 1];
    if (last.p1 !== loop[1]) return;
    while (this.segEnd(last) < untilC) {
      last = { id: ++this.segId, c0: this.segEnd(last), p0: loop[0], p1: loop[1] };
      this.segs.push(last);
    }
  }

  posAtC(c) {
    const segs = this.segs;
    if (!segs.length) return Math.round(this.pos * this.sr);
    if (c < segs[0].c0) return segs[0].p0;
    for (const s of segs) if (c < this.segEnd(s)) return s.p0 + Math.max(0, c - s.c0);
    return segs[segs.length - 1].p1;
  }

  outputTime() {
    const ctx = this.ctx;
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime > 0 && ts.performanceTime > 0) {
        return Math.min(ctx.currentTime, ts.contextTime + (performance.now() - ts.performanceTime) / 1000);
      }
    }
    return Math.max(0, ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0));
  }

  /** Playhead (s) — what is being heard right now. */
  position() {
    if (this.pending != null) return this.pending;
    if (!this.playing || !this.ctx) return this.pos;
    return Math.min(this.duration, this.posAtC(this.outputTime() * this.sr) / this.sr);
  }

  isActive() {
    return this.playing || this.pending != null;
  }

  /**
   * Start at `from` (s). endSec: stop there and rewind to `rewindTo` (range
   * preview); otherwise play to the end (or loop). solo: preview one stem.
   * Must be called from a user gesture the first time (AudioContext policy).
   */
  async play(from = this.pos, { endSec = null, rewindTo = null, solo = null } = {}) {
    this.ensureContext();
    const gen = ++this.gen;
    this.stopSources();
    this.stopTimer();
    this.segs = [];
    this.playing = false;
    const start = Math.min(Math.max(0, from), Math.max(0, this.duration - 0.001));
    this.pending = start;
    this.pos = start;
    this.endAt = endSec != null && endSec > start ? endSec : null;
    this.rewindTo = rewindTo ?? (this.endAt != null ? start : 0);
    if (this.solo !== solo) {
      this.solo = solo;
      this.applyGains();
    }
    this.emitState();

    const sr = this.sr;
    const N = this.N;
    const fromF = Math.round(start * sr);
    const k = Math.floor(fromF / N);
    const ks = (k + 1) * N - fromF < 0.3 * sr ? [k, k + 1] : [k];
    const waits = [];
    this.voices().forEach((voice) => {
      this.evict(voice, new Set(ks), fromF);
      if (voice.error || !this.isAudible(voice.stem, voice)) return;
      ks.forEach((kk) => waits.push(this.chunk(voice, kk, -1).promise.catch(() => null)));
    });
    await Promise.race([Promise.all(waits), sleep(START_DEADLINE_MS)]);
    if (gen !== this.gen || this.destroyed) return false;

    const c0 = Math.ceil((this.ctx.currentTime + START_LATENCY) * sr);
    this.segs = [{ id: ++this.segId, c0, p0: fromF, p1: this.planEnd(fromF) }];
    this.playing = true;
    this.pending = null;
    this.pump();
    this.timer = setInterval(() => this.pump(), PUMP_MS);
    this.emitState();
    return true;
  }

  pause() {
    if (!this.isActive()) return;
    const p = this.position();
    this.gen += 1;
    this.stopTimer();
    if (this.ctx) this.stopSources();
    this.playing = false;
    this.pending = null;
    this.segs = [];
    this.pos = p;
    this.endAt = null;
    if (this.solo) {
      this.solo = null;
      this.applyGains();
    }
    this.emitState();
  }

  /** Seek by absolute time; keeps playing (sample-aligned restart) if playing. */
  seek(t) {
    const target = Math.min(Math.max(0, t), Math.max(0, this.duration - 0.001));
    if (this.isActive()) return this.play(target);
    this.pos = target;
    this.pumpSoon();
    this.emitState('seek');
    return Promise.resolve(true);
  }

  finish() {
    this.gen += 1;
    this.stopTimer();
    this.stopSources();
    this.playing = false;
    this.segs = [];
    this.pos = this.rewindTo || 0;
    this.endAt = null;
    if (this.solo) {
      this.solo = null;
      this.applyGains();
    }
    this.emitState('ended');
  }

  stopTimer() {
    clearInterval(this.timer);
    this.timer = 0;
  }

  stopSources() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + 0.006);
    g.setValueAtTime(1, t + 0.008);
    this.live.forEach((l) => {
      try {
        l.src.stop(t + 0.007);
      } catch (e) {
        /* already stopped */
      }
    });
    this.live.clear();
    this.voices().forEach((v) => v.sched.clear());
  }

  /** Re-plan from just ahead of now, spliced sample-exactly (loop changed). */
  replan() {
    if (!this.playing) return;
    const sr = this.sr;
    const cut = Math.ceil((this.ctx.currentTime + 0.05) * sr);
    const p = this.posAtC(cut);
    this.live.forEach((l) => {
      try {
        l.src.stop(cut / sr);
      } catch (e) {
        /* already stopped */
      }
    });
    this.voices().forEach((v) => v.sched.clear());
    this.segs = [{ id: ++this.segId, c0: cut, p0: p, p1: Math.max(p, this.planEnd(p)) }];
    this.pump();
  }

  pumpSoon() {
    if (this.pumpQueued) return;
    this.pumpQueued = true;
    queueMicrotask(() => this.pump());
  }

  pump() {
    this.pumpQueued = false;
    if (!this.ctx || this.destroyed) return;
    const sr = this.sr;
    const N = this.N;
    const nowF = this.ctx.currentTime * sr;
    if (this.playing) {
      this.extendLoop(nowF + (AHEAD_SEC + CHUNK_SEC) * sr);
      while (this.segs.length > 1 && this.segEnd(this.segs[0]) < nowF - sr) {
        const old = this.segs.shift();
        this.voices().forEach((v) => v.sched.delete(old.id));
      }
    }
    const posF = this.playing ? this.posAtC(nowF) : Math.round(this.pos * sr);

    for (const voice of this.voices()) {
      if (voice.error) continue;
      const audible = this.isAudible(voice.stem, voice);
      const wanted = new Set();
      const maxK = voice.lengthF ? Math.ceil(voice.lengthF / N) - 1 : Infinity;
      if (this.playing) {
        const horizon = nowF + (audible ? AHEAD_SEC : AHEAD_IDLE_SEC) * sr;
        for (const seg of this.segs) {
          if (this.segEnd(seg) <= nowF || seg.c0 >= horizon) continue;
          const pA = seg.p0 + Math.max(0, nowF - seg.c0);
          const pB = seg.p0 + Math.min(seg.p1 - seg.p0, horizon - seg.c0);
          let sched = voice.sched.get(seg.id);
          if (!sched) {
            sched = new Set();
            voice.sched.set(seg.id, sched);
          }
          for (let k = Math.floor(pA / N); k * N < pB && k <= maxK; k += 1) {
            wanted.add(k);
            if (sched.has(k)) continue;
            const due = (seg.c0 + (Math.max(k * N, seg.p0) - seg.p0) - nowF) / sr;
            const e = this.chunk(voice, k, due + (audible ? 0 : 3));
            if (e.state === 'ready') {
              this.startSource(voice, seg, k, e.buffer, nowF);
              sched.add(k);
            }
          }
        }
      } else if (audible && this.sr) {
        const k = Math.floor(posF / N);
        if (k <= maxK) {
          wanted.add(k);
          this.chunk(voice, k, 1);
        }
      }
      this.evict(voice, wanted, posF);
    }

    // (a little past the end, so the output latency's worth of audio isn't cut)
    if (this.playing && this.segs.length && !this.loopFrames() && nowF >= this.segEnd(this.segs[this.segs.length - 1]) + 0.05 * sr) {
      this.finish();
    }
  }

  startSource(voice, seg, k, buffer, nowF) {
    if (!buffer) return;
    const sr = this.sr;
    const cStart = k * this.N;
    const cEnd = cStart + buffer.length;
    const a = Math.max(cStart, seg.p0);
    const b = Math.min(cEnd, seg.p1);
    if (b <= a) return;
    let when = seg.c0 + (a - seg.p0);
    let off = a - cStart;
    let len = b - a;
    const minWhen = Math.ceil(nowF + LATE_MARGIN * sr);
    if (when < minWhen) {
      // Arrived late: join mid-chunk at the matching offset, still aligned.
      const d = minWhen - when;
      if (d >= len) return;
      when += d;
      off += d;
      len -= d;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(voice.node);
    // Play to the buffer's natural end when possible: frame-exact joins.
    if (b === cEnd) src.start(when / sr, off / sr);
    else src.start(when / sr, off / sr, len / sr);
    const entry = { src, voice, when };
    this.live.add(entry);
    src.onended = () => {
      this.live.delete(entry);
      src.disconnect();
    };
  }

  evict(voice, wanted, posF) {
    const N = this.N;
    if (!N) return;
    const kNow = Math.floor(posF / N);
    const lo = kNow - Math.ceil(BEHIND_SEC / CHUNK_SEC);
    const hi = kNow + Math.ceil(AHEAD_SEC / CHUNK_SEC) + 1;
    const loop = this.loopFrames();
    const keepLoop = loop && loop[1] - loop[0] <= KEEP_LOOP_SEC * this.sr ? [Math.floor(loop[0] / N), Math.floor(loop[1] / N)] : null;
    for (const [k, e] of voice.chunks) {
      if (wanted.has(k) || (k >= lo && k <= hi && e.state === 'ready')) continue;
      if (keepLoop && k >= keepLoop[0] && k <= keepLoop[1] && e.state === 'ready') continue;
      if (k >= lo && k <= hi && e.state !== 'ready' && this.playing) continue;
      e.controller?.abort();
      voice.chunks.delete(k);
    }
  }

  /** Debug/test view of what is cached and scheduled. */
  stats() {
    let chunks = 0;
    let bytes = 0;
    this.voices().forEach((v) =>
      v.chunks.forEach((e) => {
        if (e.buffer) {
          chunks += 1;
          bytes += e.buffer.length * e.buffer.numberOfChannels * 4;
        }
      })
    );
    return { chunks, bytes, live: this.live.size, inflight: this.inflight, queued: this.queue.length, sr: this.sr };
  }
}

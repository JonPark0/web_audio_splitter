/**
 * Shared setup for the cross-screen touch specs (touch*.spec.mjs).
 *
 * `test` adds a worker-scoped `world` (`await world.get()`), seeded once per
 * worker when a test first asks for it:
 *   world.jobs        2 finished htdemucs jobs, listed under 22 failed ones (a
 *                     Split list long enough to scroll on phones and tablets;
 *                     failed jobs write no stems)
 *   world.many        a bs_roformer job (seven rows: the result page scrolls
 *                     on phones) with one saved sample on vocals 6-10 s, so
 *                     a marker tap gives a selection with handles
 *   world.samples     ids of 58 library samples cut from jobs[0] + 2 imports,
 *                     all tagged TAG (a list a fling can't run off on tablets)
 *   world.long, world.short   4 s / 2 s samples for arrangement clips
 * and `project(api, world, opts)` makes a fresh arrangement per test.
 *
 * Gestures go through Chromium's DevTools protocol (support/touch.mjs plus the
 * held drags / flings below); specs guard them with hasCDP(browserName).
 */
import { randomUUID } from 'node:crypto';
import { test as base, expect, hasCDP } from '../../support/fixtures.mjs';
import { apiClient } from '../../support/api.mjs';
import { media } from '../../support/media.mjs';

export { expect, hasCDP };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Tag of the seeded library samples (#/library?tags=touchgest lists only them). */
export const TAG = 'touchgest';

export const test = base.extend({
  world: [
    async ({ app }, use) => {
      const api = apiClient(app.api);
      const seedJobs = async () => {
        const wait = async (ids, want) => {
          for (const id of ids) {
            const s = await api.waitJob(id);
            if (s.status !== want) throw new Error(`seed job ${id}: ${s.status}`);
          }
        };
        app.setSeparationDelay(0);
        try {
          const jobs = [await api.createJob(media('song120.mp3')), await api.createJob(media('song120.mp3'))];
          const many = await api.createJob(media('song120.mp3'), { model: 'bs_roformer' });
          await wait([...jobs, many], 'completed');
          // the rest of a long list: failed jobs write no stems (disk, time)
          app.setSeparationFails(true);
          const filler = [];
          for (let i = 0; i < 22; i += 1) filler.push(await api.createJob(media('song120.mp3')));
          await wait(filler, 'failed');
          return { jobs, many };
        } finally {
          app.setSeparationFails(false);
          app.setSeparationDelay(2);
        }
      };
      const seedSamples = async ({ jobs, many }) => {
        const tracks = ['drums.wav', 'bass.wav', 'vocals.wav', 'other.wav'];
        const samples = [];
        for (let i = 0; i < 58; i += 1) {
          const s = await api.cutSample(jobs[0], { track: tracks[i % 4], start: (i % 8) * 2, end: (i % 8) * 2 + 1.5, name: `Touch ${String(i).padStart(2, '0')}`, tags: [TAG] });
          samples.push(s.id);
        }
        for (const f of ['loop100.wav', 'oneshot.wav']) samples.push((await api.importSample(media(f), { name: `Imported ${f}`, tags: [TAG] })).id);
        const long = (await api.cutSample(jobs[0], { track: 'drums.wav', start: 0, end: 4, name: 'Clip long' })).id;
        const short = (await api.cutSample(jobs[0], { track: 'bass.wav', start: 4, end: 6, name: 'Clip short' })).id;
        await api.cutSample(many, { track: 'vocals.wav', start: 6, end: 10, name: 'Marker' });
        return { jobs, many, samples, long, short };
      };
      const ok = async (url) => (await api.raw(url)).ok;
      // Other specs in this worker may delete jobs or empty the library
      // (result.spec.mjs does before each test): seed again what is gone.
      const refresh = async (w) => {
        const jobsOk = (await ok(`/result/${w.jobs[0]}`)) && (await ok(`/result/${w.jobs[1]}`)) && (await ok(`/result/${w.many}`));
        const { samples } = await api.get(`/samples?tags=${TAG}&limit=100`);
        const samplesOk = jobsOk && samples.length === w.samples.length && (await ok(`/samples/${w.long}`)) && (await ok(`/samples/${w.short}`));
        if (samplesOk) return w;
        return seedSamples(jobsOk ? w : await seedJobs());
      };
      // Seeded eagerly, under this fixture's timeout rather than a test's.
      let world = await seedSamples(await seedJobs());
      await use({
        get: async () => {
          world = await refresh(world);
          return world;
        },
      });
    },
    { scope: 'worker', timeout: 180_000 },
  ],
});

/**
 * A fresh arrangement at 120 BPM: track 1 is back-to-back 8-beat clips over
 * 160 beats (a tap anywhere on it lands on a clip; the timeline is wide
 * enough to fling), track 2 is empty, tracks 3-12 hold a 4-beat clip at beat
 * 0 and another at beat 12 (room for trim handles). `loop` sets the loop.
 */
export async function project(api, w, { loop = { enabled: false, start_beat: 0, end_beat: 16 } } = {}) {
  const p = await api.createProject(`Touch ${Date.now()}`, 120);
  const cur = await api.get(`/projects/${p.id}`);
  const uuid = randomUUID;
  const clip = (sample, beat, len) => ({ id: uuid(), sample_id: sample, start_beat: beat, offset_sec: 0, length_sec: len, warp: false, semitones: 0, gain: 1, loop_beats: null, fade_in_sec: 0, fade_out_sec: 0, reverse: false, cents: 0 });
  const tracks = [];
  for (let t = 0; t < 12; t += 1) {
    let clips = [];
    if (t === 0) clips = Array.from({ length: 20 }, (_, i) => clip(w.long, i * 8, 4));
    else if (t > 1) clips = [clip(w.short, 0, 2), clip(w.short, 12, 2)];
    tracks.push({ id: uuid(), name: `Track ${t + 1}`, volume: 1, pan: 0, muted: false, soloed: false, clips });
  }
  await api.put(`/projects/${p.id}`, { name: cur.name, bpm: 120, beats_per_bar: 4, loop, tracks, markers: [], base_version: cur.version });
  return { id: p.id, tracks };
}

/** Layout the app chose (src/device.js). */
export async function layout(page) {
  return page.evaluate(() => {
    const m = (q) => window.matchMedia(q).matches;
    const coarse = m('(any-pointer: coarse)');
    const short = m('(max-height: 500px)');
    let size = 'tablet';
    if (!m('(min-width: 640px)') || (short && coarse)) size = 'phone';
    else if (m('(min-width: 1024px)') && (!coarse || m('(min-width: 1366px)'))) size = 'desktop';
    return { size, coarse, short };
  });
}

export const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));
export const pageScale = (page) => page.evaluate(() => window.visualViewport.scale);

/** Bring an element to the middle of the screen (instant) and return its box. */
export async function centerOf(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  const b = await locator.boundingBox();
  return { ...b, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}

/**
 * A long-press would get the native menu / callout / selection unless the
 * app cancels it: dispatch a cancelable contextmenu where the finger is and
 * report what the page did with it (Chromium shows no long-press menu in
 * emulation, so this is how the app's own guard is checked).
 */
export async function contextMenuAt(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });
    el.dispatchEvent(ev);
    return { prevented: ev.defaultPrevented, userSelect: getComputedStyle(el).userSelect };
  }, { x, y });
}

/**
 * Held one-finger drags on top of support/touch.mjs: `down` / `to` / `up`
 * keep the finger down between calls (a palm or a touchcancel can come in
 * between).
 */
export function gestures(t) {
  let at = null;
  return {
    async down(p) {
      at = p;
      await t.start([p]);
    },
    async hold(ms, jitter = 0) {
      if (jitter) {
        await sleep(ms / 2);
        await t.move([{ x: at.x + jitter, y: at.y + jitter }]);
        await sleep(ms / 2);
        await t.move([at]);
      } else {
        await sleep(ms);
      }
    },
    async to(p, { ms = 250, steps = 12 } = {}) {
      const from = at;
      for (let i = 1; i <= steps; i += 1) {
        await t.move([{ x: from.x + ((p.x - from.x) * i) / steps, y: from.y + ((p.y - from.y) * i) / steps }]);
        await sleep(ms / steps);
      }
      at = p;
    },
    up: () => t.end([]),
    cancel: () => t.cancel(),
  };
}

const sessions = new WeakMap();
async function cdpOf(page) {
  if (!sessions.has(page)) sessions.set(page, await page.context().newCDPSession(page));
  return sessions.get(page);
}

/**
 * Fast flicks with their own event timestamps (5 moves 12 ms apart):
 * Chromium computes the fling velocity from them, so the flick flings however
 * slow each CDP round trip is under load.
 */
async function flick(page, from, to, { tapAt = null } = {}) {
  const cdp = await cdpOf(page);
  const base = Date.now() / 1000;
  const send = (type, p, ms) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: Math.round(p.x), y: Math.round(p.y), id: 0, radiusX: 4, radiusY: 4, force: 1 }] : [], timestamp: base + ms / 1000 });
  await send('touchStart', from, 0);
  for (let i = 1; i <= 5; i += 1) await send('touchMove', { x: from.x + ((to.x - from.x) * i) / 5, y: from.y + ((to.y - from.y) * i) / 5 }, i * 12);
  await send('touchEnd', null, 66);
  if (tapAt) {
    // the next finger lands 40 ms into the fling: sent straight away, so
    // the round trips can't let the momentum run out first
    await send('touchStart', tapAt, 106);
    await send('touchEnd', null, 166);
  }
}

/**
 * A tap that lands on a running fling. Measures the fling alone first, then
 * flicks again and taps 40 ms in; resolves { natural, stopped } (where the
 * view came to rest each time; `read` gives the scroll position, `reset`
 * scrolls back). The tap stopped the fling when `stopped` is well short of
 * `natural`.
 */
export async function tapIntoFling(page, from, to, tapAt, { read, reset }) {
  await reset();
  await sleep(300);
  await flick(page, from, to);
  await sleep(1500);
  const natural = await read();
  await reset();
  await sleep(300);
  await flick(page, from, to, { tapAt });
  await sleep(1000);
  return { natural, stopped: await read() };
}

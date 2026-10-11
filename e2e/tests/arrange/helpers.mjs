/**
 * Shared setup for the Arrange specs (arrange*.spec.mjs).
 *
 * `test` adds to the support fixtures:
 *   arr   worker-scoped: seeds the samples once per worker (on first use)
 *   smp   the worker's samples, checked before each test that asks for them
 *         (another spec in the same worker may have deleted samples):
 *           drum   4.00 s drum cut,  BPM 120 (8 beats)
 *           bass   4.00 s bass cut,  BPM 120 (8 beats)
 *           loop   loop100.wav, 4.80 s, BPM 100 (8 beats warped)
 *           shot   oneshot.wav, 1.50 s, BPM 160 (4 beats warped at 120)
 *           tone   3.00 s sine, no BPM (can't be warped)
 *         All carry `smp.tag` (also in their names), so the sample browser
 *         can be narrowed to them with its search box.
 *
 * Every test makes its own project (seedProject, unique names), so tests
 * never share documents. Persisted state is checked through the API
 * (expect.poll on GET /projects/<id>), not through fixed waits.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, hasCDP } from '../../support/fixtures.mjs';
import { apiClient } from '../../support/api.mjs';
import { CACHE } from '../../support/app.mjs';
import { media } from '../../support/media.mjs';

export { expect, hasCDP };

export const uid = () => Math.random().toString(36).slice(2, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- media --
const ARR_MEDIA = path.join(CACHE, 'arrange');

function ffmpegOnce(name, args) {
  mkdirSync(ARR_MEDIA, { recursive: true });
  const out = path.join(ARR_MEDIA, name);
  if (!existsSync(out)) {
    const tmp = `${out}.${process.pid}.${uid()}${path.extname(name)}`;
    execFileSync('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', ...args, tmp]);
    renameSync(tmp, out);
  }
  return out;
}

/** A steady 440 Hz sine: no attacks, so the analysis finds no tempo. */
export const toneFile = () => ffmpegOnce('tone440.wav', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ac', '2', '-ar', '44100']);

// --------------------------------------------------------------- seeding --
export async function waitAnalysed(api, ids, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const all = await Promise.all(ids.map((id) => api.get(`/samples/${id}`)));
    if (all.every((s) => !['pending', 'running'].includes(s.analysis_status))) return all;
    if (Date.now() > until) throw new Error('sample analysis did not finish');
    await sleep(300);
  }
}

/**
 * Import the sine as a fresh sample (for tests that change a sample's library
 * BPM). Its name doesn't carry the worker's tag, so filterBrowser still lists
 * exactly the five shared samples.
 */
export async function freshTone(api) {
  const s = await api.importSample(toneFile(), { name: `fresh tone ${uid()}`, tags: ['fresh'] });
  const [done] = await waitAnalysed(api, [s.id]);
  if (done.bpm != null) throw new Error(`the sine got a BPM (${done.bpm})`);
  return done;
}

async function seedSamples(api) {
  const tag = `ar${uid()}`;
  const job = await api.completedJob(media('song120.mp3'));
  const drum = await api.cutSample(job, { track: 'drums.wav', start: 0, end: 4, name: `${tag} drums`, tags: [tag] });
  const bass = await api.cutSample(job, { track: 'bass.wav', start: 4, end: 8, name: `${tag} bass`, tags: [tag] });
  const loop = await api.importSample(media('loop100.wav'), { name: `${tag} loop100`, tags: [tag] });
  const shot = await api.importSample(media('oneshot.wav'), { name: `${tag} oneshot`, tags: [tag] });
  const tone = await api.importSample(toneFile(), { name: `${tag} tone`, tags: [tag] });
  await waitAnalysed(api, [drum, bass, loop, shot, tone].map((s) => s.id));
  // Exact tempi, whatever the analysis guessed: the tests compute beats from them.
  for (const [s, bpm] of [[drum, 120], [bass, 120], [loop, 100], [shot, 160]]) await api.patch(`/samples/${s.id}`, { bpm });
  const byKey = {};
  for (const [k, s] of Object.entries({ drum, bass, loop, shot, tone })) byKey[k] = await api.get(`/samples/${s.id}`);
  if (byKey.tone.bpm != null) throw new Error(`the sine got a BPM (${byKey.tone.bpm})`);
  return { tag, ...byKey };
}

export const test = base.extend({
  arr: [
    async ({ app }, use) => {
      const api = apiClient(app.api);
      let seeded = null;
      await use({
        async samples() {
          if (seeded) {
            try {
              const s = await seeded;
              const ok = await Promise.all(['drum', 'bass', 'loop', 'shot', 'tone'].map((k) => api.raw(`/samples/${s[k].id}`).then((r) => r.ok)));
              if (ok.every(Boolean)) return s;
            } catch {
              // seeding failed last time: try again
            }
          }
          seeded = seedSamples(api);
          return seeded;
        },
      });
    },
    { scope: 'worker' },
  ],
  smp: [async ({ arr }, use) => use(await arr.samples()), { timeout: 120_000 }],
});

// -------------------------------------------------------------- projects --
export const clip = (sample, start, extra = {}) => ({
  id: randomUUID(),
  sample_id: sample.id,
  start_beat: start,
  offset_sec: 0,
  length_sec: sample.duration_sec,
  warp: sample.bpm != null,
  semitones: 0,
  cents: 0,
  gain: 1,
  loop_beats: null,
  fade_in_sec: 0,
  fade_out_sec: 0,
  reverse: false,
  ...extra,
});

export const track = (name, clips = [], extra = {}) => ({ id: randomUUID(), name, volume: 1, pan: 0, muted: false, soloed: false, clips, ...extra });

/** A project with these tracks (unique name), saved through the API. */
export async function seedProject(api, name, tracks = [track('Track 1')], extra = {}) {
  const full = `${name} ${uid()}`;
  const p = await api.createProject(full, extra.bpm || 120);
  return api.put(`/projects/${p.id}`, {
    name: full,
    bpm: extra.bpm || 120,
    beats_per_bar: extra.beats_per_bar || 4,
    loop: extra.loop || { enabled: false, start_beat: 0, end_beat: 16 },
    markers: extra.markers || [],
    tracks,
    base_version: p.version,
  });
}

export const getProject = (api, id) => api.get(`/projects/${id}`);
export const allClips = (p) => p.tracks.flatMap((t, ti) => t.clips.map((c) => ({ ...c, ti, track: t.name })));
/** expect.poll with short intervals (most waits here are an 800 ms autosave debounce). */
export const poll = (fn, opts = {}) => expect.poll(fn, { timeout: 15_000, intervals: [100, 150, 200], ...opts });
/** Poll the saved project until `fn(project)` matches `expected` (autosave is debounced). */
export const pollProject = (api, id, fn, message) => poll(async () => fn(await getProject(api, id)), { message });

// ------------------------------------------------------------- page side --
/** Layout the app chose (src/device.js). */
export async function layout(page) {
  return page.evaluate(() => {
    const m = (q) => window.matchMedia(q).matches;
    const coarse = m('(any-pointer: coarse)');
    const short = m('(max-height: 500px)');
    let size = 'tablet';
    if (!m('(min-width: 640px)') || (short && coarse)) size = 'phone';
    else if (m('(min-width: 1024px)') && (!coarse || m('(min-width: 1366px)'))) size = 'desktop';
    return { size, coarse, short, phone: size === 'phone', tablet: size === 'tablet', desktop: size === 'desktop' };
  });
}

const bodyText = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(() => '');

/** Open a project and wait for its timeline. Returns the layout. */
export async function openProject(page, project) {
  await page.goto(`/#/arrange/${project.id}`);
  // generous: a loaded CI machine can take a while to serve the project
  try {
    await expect(page.locator('[data-timeline]')).toBeVisible({ timeout: 45_000 });
  } catch (e) {
    throw new Error(`${project.name} did not open; the page says: ${await bodyText(page)}\n${e.message}`);
  }
  await expect(picker(page)).toContainText(project.name);
  return layout(page);
}

export const picker = (page) => page.locator('button[title=Projects]');
export const timeline = (page) => page.locator('[data-timeline]');
export const lanes = (page) => page.locator('[data-lanes]');
export const ruler = (page) => page.locator('[data-ruler]');
export const clipEl = (page, id) => page.locator(`[data-clip="${id}"]`);
/** Desktop's docked inspector / project panel under the timeline. */
export const dock = (page) => page.locator('div.h-\\[124px\\]');
/** The phone's fixed bottom transport bar. */
export const bottomBar = (page) => page.locator('div.fixed.inset-x-0.bottom-0.z-40');
export const toolbarEl = (page) => page.locator('div.sticky.top-12').first();
export const projectBpm = (page) => page.getByLabel('Project BPM').locator('visible=true').first();
export const position = (page) => page.locator('[aria-label^="Position"]').locator('visible=true').first();
export const playButton = (page) => page.getByRole('button', { name: /^(Play|Stop) \(Space\)$/ }).locator('visible=true').first();
export const sampleBrowser = (page) => page.locator('section[aria-label="Sample browser"]');
export const sampleRow = (page, name) => sampleBrowser(page).locator('li').filter({ hasText: name }).first();
export const selectedClipIds = (page) => page.locator('[data-clip][aria-pressed=true]').evaluateAll((els) => els.map((e) => e.dataset.clip));

/** Pixels per beat, read off the ruler's bar labels. */
export async function pxPerBeat(page) {
  return page.evaluate(() => {
    const ls = [...document.querySelectorAll('[data-ruler] span.absolute')].filter((s) => /^\d+$/.test(s.textContent));
    const bpb = 4;
    return (parseFloat(ls[1].style.left) - parseFloat(ls[0].style.left)) / (+ls[1].textContent - +ls[0].textContent) / bpb;
  });
}

export const laneHeight = (page) => page.evaluate(() => document.querySelector('[data-lanes] > div[aria-hidden]').getBoundingClientRect().height);

/** Client point of (beat, track row + frac) on the lanes (the lanes' rect includes the scroll). */
export async function lanePoint(page, beat, row, frac = 0.5) {
  const box = await lanes(page).boundingBox();
  const lh = await laneHeight(page);
  const ppb = await pxPerBeat(page);
  return { x: box.x + beat * ppb, y: box.y + (row + frac) * lh };
}

/** Left edge of the visible lanes (right edge of the pinned header column). */
export const visibleLanesLeft = (page) => page.evaluate(() => document.querySelector('[data-timeline] .sticky.left-0.z-20').getBoundingClientRect().right);

export async function setScroll(page, { left, top } = {}) {
  await timeline(page).evaluate(
    (e, s) => {
      if (s.left !== undefined) e.scrollLeft = s.left;
      if (s.top !== undefined) e.scrollTop = s.top;
    },
    { left, top }
  );
}
export const scrollLeft = (page) => timeline(page).evaluate((e) => e.scrollLeft);

/**
 * Undo / Redo from the toolbar, or from More where a narrow toolbar put them
 * (the 1024 px laptop keeps Undo but moves Redo).
 */
export async function undoRedo(page, which, ui = { coarse: false }) {
  const btn = page.getByRole('button', { name: new RegExp(`^${which}`) }).locator('visible=true');
  if (await btn.count()) return press(page, ui, btn.first());
  await press(page, ui, page.getByRole('button', { name: 'More', exact: true }).locator('visible=true').first());
  return press(page, ui, page.getByRole('menuitem', { name: new RegExp(`^${which}`) }));
}

/** Tap on touch layouts, click otherwise. */
export async function press(page, ui, locator) {
  if (ui.coarse) await locator.tap();
  else await locator.click();
}

export async function mouseDrag(page, from, to, { steps = 12, beforeUp } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  if (beforeUp) await beforeUp();
  await page.mouse.up();
}

/** Click a clip's body (mouse), clear of its trim/fade handles. */
export async function clickClip(page, id) {
  const b = await clipEl(page, id).boundingBox();
  await page.mouse.click(b.x + Math.min(b.width / 2, 40), b.y + b.height / 2 + 6);
}

/** Seek by clicking the ruler at `beat` (desktop). */
export async function seekTo(page, beat) {
  const rb = await ruler(page).boundingBox();
  const ppb = await pxPerBeat(page);
  await page.mouse.click(rb.x + beat * ppb + 1, rb.y + rb.height - 5);
}

/** Narrow the sample browser to the worker's samples (its search is debounced). */
export async function filterBrowser(page, smp) {
  await sampleBrowser(page).getByLabel('Search samples').fill(smp.tag);
  await expect(sampleBrowser(page).locator('li')).toHaveCount(5);
}

/** Make the document report itself hidden / visible (pagehide-free tab switch). */
export async function fakeVisibility(page) {
  await page.evaluate(() => {
    window.__vis = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__vis });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__vis === 'hidden' });
  });
  return (state) =>
    page.evaluate((s) => {
      window.__vis = s;
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
}

/**
 * Controls under `selector` whose centre is covered by something else.
 * Only controls fully inside `viewSelector`'s client area (and the screen) count.
 */
export async function coveredControls(page, selector, viewSelector) {
  return page.evaluate(
    ([sel, viewSel]) => {
      // a scroller's client area: its scrollbars don't count as showing a control
      const v = viewSel && document.querySelector(viewSel);
      const vr = v?.getBoundingClientRect();
      const view = v
        ? { left: vr.left + v.clientLeft, top: vr.top + v.clientTop, right: vr.left + v.clientLeft + v.clientWidth, bottom: vr.top + v.clientTop + v.clientHeight }
        : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      const out = [];
      for (const root of document.querySelectorAll(sel)) {
        for (const e of root.querySelectorAll('button,input,select')) {
          const r = e.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          // only controls fully in view (a half-scrolled row is the scroller's business)
          if (r.left < view.left || r.top < view.top || r.right > view.right || r.bottom > view.bottom || r.right > innerWidth || r.bottom > innerHeight) continue;
          const hit = document.elementFromPoint(x, y);
          if (!(hit === e || e.contains(hit))) out.push(`${e.getAttribute('aria-label') || e.textContent.trim()} ← ${hit?.tagName}.${String(hit?.className || '').slice(0, 40)}`);
        }
      }
      return out;
    },
    [selector, viewSelector]
  );
}

/**
 * Shared setup for the Library specs (library*.spec.mjs).
 *
 * `test` adds to the support fixtures:
 *   lib      worker-scoped: lib.job() is one finished split job (song120.mp3)
 *            per worker, created on first use, to cut samples from
 *   paging   a library larger than one page (PAGE_SIZE 100): 100 short cuts
 *            plus four imported chord clips in known keys, all under one tag
 *            (`paging.tag`), analysed. Created once per worker and checked
 *            before every test that asks for it (another spec in the same
 *            worker may have cleared the samples), so tests must not change
 *            these rows (except reversibly).
 *   page     records the audio element the Library plays through
 *            (window.__lastMedia), so tests can read src/paused/time.
 *
 * Tests that change samples make their own with fresh() and filter the list
 * by that sample set's unique tag, so other rows in the worker's database
 * (other tests, other specs) never matter.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test as base, expect, hasCDP } from '../../support/fixtures.mjs';
import { apiClient } from '../../support/api.mjs';
import { CACHE } from '../../support/app.mjs';
import { media } from '../../support/media.mjs';

export { expect, hasCDP, media };

export const PAGE_SIZE = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Short unique lower-case token (tags are stored lower-cased). */
export const uid = () => Math.random().toString(36).slice(2, 8);

// ---------------------------------------------------------------- media --
const LIB_MEDIA = path.join(CACHE, 'library');
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const freq = (pc, oct) => 440 * 2 ** ((12 * (oct + 1) + pc - 69) / 12);

function ffmpegOnce(name, args) {
  mkdirSync(LIB_MEDIA, { recursive: true });
  const out = path.join(LIB_MEDIA, name);
  if (!existsSync(out)) {
    // workers may race for the same file: write aside, then rename
    const tmp = `${out}.${process.pid}.${uid()}${path.extname(name)}`;
    execFileSync('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', ...args, tmp]);
    renameSync(tmp, out);
  }
  return out;
}

/**
 * Two bars of a I-IV-V-I (or i-iv-v-i) progression pulsing on the beat, so
 * the analysis finds both the key and the tempo (librosa gets these right).
 */
export function tonalClip(key, bpm) {
  const [root, mode] = key.split(' ');
  const minor = mode === 'minor';
  const r = NOTES.indexOf(root);
  const chord = (pc) => {
    const third = pc + (minor ? 3 : 4);
    const fifth = pc + 7;
    return [freq(pc % 12, 2), freq(pc % 12, 4), freq(third % 12, 4 + Math.floor(third / 12)), freq(fifth % 12, 4 + Math.floor(fifth / 12))]
      .map((f) => `sin(2*PI*${f.toFixed(2)}*t)`)
      .join('+');
  };
  const beat = 60 / bpm;
  const dur = 8 * beat;
  const seg = dur / 4;
  const [i, iv, v] = [0, 5, 7].map((d) => chord(r + d));
  const expr = `if(lt(t,${seg}),${i},if(lt(t,${2 * seg}),${iv},if(lt(t,${3 * seg}),${v},${i})))`;
  const env = `(0.35+0.65*exp(-6*mod(t,${beat})/${beat}))`;
  const name = `tone_${root.replace('#', 's')}${minor ? 'm' : ''}_${bpm}.wav`;
  return ffmpegOnce(name, ['-f', 'lavfi', '-i', `aevalsrc='0.12*(${expr})*${env}':s=44100:d=${dur.toFixed(3)}`, '-ac', '2']);
}

/** 11 minutes of near-silence (tiny MP3): over the 10-minute import limit. */
export const elevenMinutes = () =>
  ffmpegOnce('eleven-minutes.mp3', ['-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '660', '-c:a', 'libmp3lame', '-b:a', '8k']);

// --------------------------------------------------------------- seeding --
const TRACKS = ['drums.wav', 'bass.wav', 'other.wav', 'vocals.wav'];
const KOR = { 'drums.wav': '드럼', 'bass.wav': '베이스', 'other.wav': '기타', 'vocals.wav': '보컬' };
const ENG = { 'drums.wav': 'Drum', 'bass.wav': 'Bass', 'other.wav': 'Other', 'vocals.wav': 'Vox' };
const STEM_TAG = { 'drums.wav': 'drums', 'bass.wav': 'bass', 'other.wav': 'other', 'vocals.wav': 'vocal' };

/** Run `fn` over items, `limit` at a time (the backend serves requests in a pool). */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

/** Poll until none of these samples is still being analysed. */
export async function waitAnalysed(api, ids, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const all = await Promise.all(ids.map((id) => api.get(`/samples/${id}`)));
    if (all.every((s) => s.analysis_status !== 'pending')) return all;
    if (Date.now() > until) throw new Error('analysis did not finish');
    await sleep(300);
  }
}

/** Every sample carrying `tag` (all pages). */
export async function tagged(api, tag, params = {}) {
  const qs = new URLSearchParams({ tags: tag, limit: '0', ...params });
  return api.get(`/samples?${qs}`);
}

/**
 * Cut samples for one test from the worker's job. `specs`: list of
 * { name, track, start, end, tags }; every one also gets `tag`.
 * Returns the created samples in creation order.
 */
export async function fresh(api, taskId, tag, specs) {
  const made = [];
  // one at a time: creation order (= newest-first order, reversed) is the order asked for
  for (const [i, s] of specs.entries()) {
    const start = s.start ?? (i % 10) * 1.5;
    made.push(
      await api.cutSample(taskId, {
        track: s.track || TRACKS[i % 4],
        start,
        end: s.end ?? start + (s.len ?? 2),
        name: s.name || `s${i}`,
        tags: [tag, ...(s.tags || [])],
      })
    );
  }
  return made;
}

const TONAL = [
  { name: 'Piano Chords C', key: 'C major', bpm: 128, tags: ['keys', 'chords'] },
  { name: 'Synth #1 stab', key: 'C# minor', bpm: 140, tags: ['synth', 'keys'] },
  { name: 'Brass Bb', key: 'A# major', bpm: 96, tags: ['brass'] },
  { name: 'Pad 패드 A minor', key: 'A minor', bpm: 90, tags: ['pad', '패드'] },
];

async function seedPaging(api, taskId) {
  const tag = `pg${uid()}`;
  // the chord clips first: the backend analyses one sample at a time, in order
  for (const t of TONAL) await api.importSample(tonalClip(t.key, t.bpm), { name: t.name, tags: [tag, ...t.tags] });
  const specs = Array.from({ length: 100 }, (_, i) => {
    const track = TRACKS[i % 4];
    const long = i % 10 === 0;
    const len = long ? [1, 2, 4][(i / 10) % 3] : 0.25;
    const start = (i % 20) * 1.0;
    return {
      track,
      start,
      end: start + len,
      name: i % 5 === 0 ? `${KOR[track]} 샘플 ${String(i).padStart(3, '0')}` : `${ENG[track]} cut ${String(i).padStart(3, '0')}`,
      tags: [STEM_TAG[track], long ? 'loop' : 'chop', ...(i % 9 === 0 ? ['lofi'] : [])],
    };
  });
  await pool(specs, 4, (s) => api.cutSample(taskId, { ...s, tags: [tag, ...s.tags] }));
  const { samples } = await tagged(api, tag);
  // sorting/filtering by BPM and key compares the page with the server: no
  // values may still change underneath
  await waitAnalysed(api, samples.map((s) => s.id), 170_000);
  return { tag, count: samples.length };
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (...args) {
        window.__lastMedia = this;
        return play.apply(this, args);
      };
    });
    await use(page);
  },
  lib: [
    async ({ app }, use) => {
      const api = apiClient(app.api);
      let job = null;
      let paging = null;
      await use({
        api,
        async job() {
          const id = job && (await job.catch(() => null));
          if (id && (await api.raw(`/status/${id}`)).ok) return id;
          job = api.completedJob(media('song120.mp3'));
          return job;
        },
        async pagingReady() {
          if (!paging) return false;
          const p = await paging.catch(() => null);
          if (!p) return false;
          const { matched } = await api.get(`/samples?tags=${p.tag}&limit=1`);
          return matched === p.count;
        },
        async paging() {
          if (await this.pagingReady()) return paging;
          paging = (async () => seedPaging(api, await this.job()))();
          return paging;
        },
      });
    },
    { scope: 'worker' },
  ],
  // (Re)seeding takes a while on a busy machine: it gets its own time.
  paging: async ({ lib }, use, testInfo) => {
    if (!(await lib.pagingReady())) testInfo.setTimeout(testInfo.timeout + 180_000);
    await use(await lib.paging());
  },
});

// ------------------------------------------------------------- page side --
/** Layout the app chose (the media queries of src/device.js). */
export async function layout(page) {
  return page.evaluate(() => {
    const m = (q) => window.matchMedia(q).matches;
    const coarse = m('(any-pointer: coarse)');
    const short = m('(max-height: 500px)');
    let size = 'tablet';
    if (!m('(min-width: 640px)') || (short && coarse)) size = 'phone';
    else if (m('(min-width: 1024px)') && (!coarse || m('(min-width: 1366px)'))) size = 'desktop';
    const wide = size === 'desktop' && m('(min-width: 1280px)');
    // a keyboard is likely (the Library's own test for showing key hints)
    const keys = m('(any-pointer: fine)');
    return { size, coarse, short, wide, phone: size === 'phone', keys };
  });
}

/** Library preferences (localStorage), set once per test before the app loads. */
export async function prefs(page, values) {
  await page.addInitScript((v) => {
    if (sessionStorage.getItem('__libPrefs')) return;
    sessionStorage.setItem('__libPrefs', '1');
    for (const [k, val] of Object.entries(v)) localStorage.setItem(k, JSON.stringify(val));
  }, values);
}

/** Open the Library (optionally with a query string) and wait for its list or empty state. */
export async function openLibrary(page, query = '') {
  await page.goto(`/#/library${query ? `?${query}` : ''}`);
  await expect(page.locator('[data-library-list], p:text-is("No samples yet."), p:text-is("No samples match these filters.")').first()).toBeVisible({ timeout: 20_000 });
  return layout(page);
}

export const list = (page) => page.locator('[data-library-list]');
export const rows = (page) => page.locator('[data-library-list] [role=rowgroup] > [role=row]');
export const rowById = (page, id) => page.locator(`[data-library-list] [role=row][data-id="${id}"]`);
export const rowIds = (page) => rows(page).evaluateAll((rs) => rs.map((r) => r.dataset.id));
/** The sticky toolbar (also the desktop/tablet bulk bar). */
export const toolbar = (page) => page.locator('div.sticky.z-20').first();
/** The phone's fixed bottom bar (now playing / selection). */
export const bottomBar = (page) => page.locator('div.fixed.inset-x-0.bottom-0').first();
export const inspector = (page) => page.getByRole('complementary', { name: 'Inspector' });

/** Tap on touch layouts, click otherwise. */
export async function press(locator, ui) {
  if (ui.coarse) await locator.tap();
  else await locator.click();
}

export async function hashQuery(page) {
  return page.evaluate(() => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || '')));
}

/** { src, paused, time, loop, duration } of the element the Library plays through. */
export async function audio(page) {
  return page.evaluate(() => {
    const a = window.__lastMedia;
    return a ? { src: a.getAttribute('src') || '', paused: a.paused, time: a.currentTime, loop: a.loop, duration: a.duration } : null;
  });
}

/** Wait until the preview plays sample `id` (optionally through a render URL). */
export async function expectPlaying(page, id, { render = null } = {}) {
  await expect
    .poll(async () => {
      const a = await audio(page);
      if (!a || a.paused || !a.src.includes(`/samples/${id}/`)) return 'not playing';
      if (render && !a.src.includes(render)) return a.src;
      return 'ok';
    }, { message: `sample ${id} playing` })
    .toBe('ok');
}

export async function expectStopped(page) {
  await expect.poll(async () => (await audio(page))?.paused ?? true, { message: 'preview stopped' }).toBe(true);
}

/**
 * The filter controls: the sheet on touch layouts and folded toolbars,
 * inline on a roomy desktop toolbar. Returns { scope, sheet, close() }.
 */
export async function filterControls(page, ui) {
  if (!ui.phone && (await page.locator('#lib-key').isVisible())) {
    return { scope: page, sheet: false, sort: '#lib-sort', key: '#lib-key', close: async () => {} };
  }
  const opener = ui.phone ? page.getByRole('button', { name: /^Filters and options/ }) : toolbar(page).getByRole('button', { name: /^Filters/ });
  await press(opener, ui);
  const sheet = page.getByRole('dialog', { name: /^Filters/ });
  await expect(sheet).toBeVisible();
  return {
    scope: sheet,
    sheet: true,
    sort: '#sheet-sort',
    key: '#sheet-key',
    close: async () => {
      await press(sheet.getByRole('button', { name: 'Close' }), ui);
      await expect(sheet).toBeHidden();
    },
  };
}

/** Requests the page made whose URL matches `re`, from now on. */
export function track(page, re) {
  const seen = [];
  page.on('request', (r) => {
    if (re.test(r.url())) seen.push(r.url());
  });
  return seen;
}

/** File names inside a zip (central directory; stored or deflated). */
export function zipNames(file) {
  const buf = readFileSync(file);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error('not a zip');
  let count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  // zip64 end record (the backend streams with force_zip64)
  if (count === 0xffff || off === 0xffffffff) {
    const loc = buf.readUInt32LE(eocd - 20) === 0x07064b50 ? eocd - 20 : -1;
    const z64 = Number(buf.readBigUInt64LE(loc + 8));
    count = Number(buf.readBigUInt64LE(z64 + 32));
    off = Number(buf.readBigUInt64LE(z64 + 48));
  }
  const names = [];
  for (let i = 0; i < count; i += 1) {
    const n = buf.readUInt16LE(off + 28);
    const extra = buf.readUInt16LE(off + 30);
    const comment = buf.readUInt16LE(off + 32);
    names.push(buf.toString('utf8', off + 46, off + 46 + n));
    off += 46 + n + extra + comment;
  }
  return names;
}

/** No sideways scroll and no widened layout viewport. */
export async function noHorizontalOverflow(page) {
  const o = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    layout: window.innerWidth - document.documentElement.clientWidth,
  }));
  expect(o.scroll, 'page scrolls sideways').toBeLessThanOrEqual(1);
  expect(o.layout, 'layout viewport widened').toBeLessThanOrEqual(1);
}

/** "<name>_<bpm>bpm_<key>.wav", as the Library names a single download. */
export function downloadName(s) {
  const parts = [(s.name || 'sample').replace(/[\\/:*?"<>|]+/g, '_').trim()];
  if (s.bpm != null) parts.push(`${Math.round(s.bpm * 100) / 100}bpm`);
  if (s.key) parts.push(s.key.replace(' major', 'maj').replace(' minor', 'min').replace(/\s+/g, ''));
  return `${parts.join('_')}.wav`;
}

/** Delete every project in this worker's database (tests that need "no project yet"). */
export async function clearProjects(api) {
  const { projects } = await api.get('/projects');
  for (const p of projects) await api.del(`/projects/${p.id}`);
}

/** A project whose one track uses these samples (so they can't be deleted). */
export async function projectUsing(api, name, samples) {
  const p = await api.createProject(name, 120);
  const tracks = [
    {
      id: randomUUID(),
      name: 'used',
      clips: samples.map((s, i) => ({ id: randomUUID(), sample_id: s.id, start_beat: i * 4, offset_sec: 0, length_sec: s.duration_sec })),
    },
  ];
  return api.put(`/projects/${p.id}`, { name, bpm: 120, tracks });
}

/** A sample's ⋯ actions: the popover menu, or the phone's action sheet. */
export async function openActions(page, ui, name) {
  const row = rows(page).filter({ has: page.getByText(name, { exact: true }) }).first();
  if (ui.phone) {
    await press(row.getByRole('button', { name: `Actions for ${name}` }), ui);
    const sheet = page.getByRole('dialog', { name });
    await expect(sheet).toBeVisible();
    return sheet;
  }
  await press(row.getByRole('button', { name: `More for ${name}` }), ui);
  const menu = page.getByRole('dialog', { name: `Actions for ${name}` });
  await expect(menu).toBeVisible();
  return menu;
}

/**
 * The editor for one sample: the docked inspector (wide desktop; the row
 * gets selected) or the "Edit sample" sheet (⋯ → Edit details…).
 * Returns { scope, docked, close() }.
 */
export async function openInspector(page, ui, sample) {
  if (ui.wide) {
    await rowById(page, sample.id).locator('[role=gridcell]').nth(3).click();
    const scope = inspector(page);
    await expect(scope.getByRole('button', { name: sample.name, exact: true })).toBeVisible();
    return { scope, docked: true, close: async () => {} };
  }
  const actions = await openActions(page, ui, sample.name);
  await press(actions.getByRole('menuitem', { name: /Edit details/ }), ui);
  const scope = page.getByRole('dialog', { name: /^Edit / });
  await expect(scope).toBeVisible();
  return {
    scope,
    docked: false,
    close: async () => {
      if (await scope.isVisible()) await press(scope.getByRole('button', { name: 'Close' }), ui);
      await expect(scope).toBeHidden();
    },
  };
}

/** Toast at the bottom ("Added … to …", "Deleted 3 samples"). */
export const toast = (page, text) => page.getByRole('status').filter({ hasText: text });

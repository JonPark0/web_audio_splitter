/**
 * Shared setup for the result-screen specs (result*.spec.mjs).
 *
 * `test` adds a worker-scoped `seed`: finished jobs created once per worker
 * (lazily, on first use) and reused by every test in it -
 *   seed.recovered()  htdemucs, 4 stems, each with a hand-made "recovered"
 *                     variant (the stem at -6 dB in <stems>/recovered/: the
 *                     recovery models don't run in tests)
 *   seed.partial()    htdemucs_6s, recovered vocals + drums only
 *   seed.roformer()   bs_roformer, 7 stems incl. the derived instrumental
 *
 * The production build has no debug hooks, so everything is read from the
 * page: the time readout, aria state, the overview strip (zoom), the
 * start/end fields (selection), request payloads and the saved files.
 */
import path from 'node:path';
import { test as base, expect, hasCDP } from '../../support/fixtures.mjs';
import { apiClient } from '../../support/api.mjs';
import { media } from '../../support/media.mjs';
import { makeRecovered } from './audio.mjs';

export { expect, hasCDP };

export const test = base.extend({
  seed: [
    async ({ app }, use) => {
      const api = apiClient(app.api);
      const memo = new Map();
      const once = (key, make) => {
        if (!memo.has(key)) memo.set(key, make());
        return memo.get(key);
      };
      const job = async (model, recovered) => {
        const id = await api.completedJob(media('song120.mp3'), { model });
        // song tempo/key are analysed after separation: wait for them
        for (let i = 0; i < 60; i += 1) {
          const r = await api.get(`/result/${id}`);
          if (r.bpm && r.key) break;
          await new Promise((res) => setTimeout(res, 500));
        }
        if (recovered) makeRecovered(path.join(app.mediaDir, 'media', 'separated', model, id), recovered);
        return id;
      };
      await use({
        recovered: () => once('h4', () => job('htdemucs', ['bass.wav', 'drums.wav', 'other.wav', 'vocals.wav'])),
        partial: () => once('h6', () => job('htdemucs_6s', ['drums.wav', 'vocals.wav'])),
        roformer: () => once('bs', () => job('bs_roformer', null)),
      });
    },
    { scope: 'worker', timeout: 120_000 },
  ],
});

/** Layout the app chose (same media queries as src/device.js). */
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

/** Open a finished job's mixer and wait for every waveform. Returns the layout. */
export async function openJob(page, id) {
  await page.goto(`/#/split/job/${id}`);
  await expect(page.locator('[data-ready="true"]')).toBeAttached({ timeout: 30_000 });
  return layout(page);
}

export async function clearSamples(api) {
  const { samples } = await api.get('/samples');
  for (const s of samples) await api.del(`/samples/${s.id}`);
}

export async function lastSample(api, taskId) {
  const { samples } = await api.get(`/samples?task_id=${taskId}&sort=oldest`);
  return samples[samples.length - 1];
}

export function parseTime(text) {
  const m = String(text || '').replace('−', '-').trim().match(/^(-?)(\d+):(\d+)(?:\.(\d+))?$/);
  if (!m) return NaN;
  return (m[1] ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number(`0.${m[4]}`) : 0));
}

/** The playhead readout (transport, or the phone's bottom bar). */
export const readout = (page) => page.locator('span[aria-live="off"]').filter({ visible: true }).first();
export const timeNow = async (page) => parseTime(await readout(page).textContent());

export const playButton = (page) => page.getByRole('button', { name: 'Play (Space)' });
export const pauseButton = (page) => page.getByRole('button', { name: 'Pause (Space)' });

/** Stem duration in seconds (the timeline's length). */
export async function stemDuration(api, id, track = 'bass.wav') {
  return (await api.get(`/peaks/${id}/${track}`)).duration;
}

/** The waveform lane of a stem in the mixer rows (not a spectrogram, not the phone sheet). */
export const lane = (page, track) => page.locator(`[data-ready] [data-lane="${track}"]`).first();

/** Scroll a lane to the middle of the screen (clear of sticky and fixed bars). */
export const centerLane = (page, track) => lane(page, track).evaluate((el) => el.scrollIntoView({ block: 'center' }));

/** Point on a stem's lane at time t (unzoomed timeline of `duration`). */
export async function lanePoint(page, track, t, duration, fy = 0.35) {
  const box = await lane(page, track).boundingBox();
  return { x: box.x + (t / duration) * box.width, y: box.y + box.height * fy, box };
}

/** Click (mouse) or tap (touch) on a stem's lane at time t. */
export async function hitLane(page, track, t, duration, { touch = false, fy } = {}) {
  await centerLane(page, track);
  const p = await lanePoint(page, track, t, duration, fy);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  return p;
}

/** Mouse drag across a lane from time a to b. */
export async function dragLane(page, track, a, b, duration, fy = 0.7) {
  const p0 = await lanePoint(page, track, a, duration, fy);
  const p1 = await lanePoint(page, track, b, duration, fy);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.mouse.move(p1.x, p1.y, { steps: 10 });
  await page.mouse.up();
}

/**
 * Zoom state from the overview strip under the ruler: its thumb is the
 * visible window. { zoomed, frac (visible / duration), start (s) }.
 */
export async function zoomState(page, duration) {
  return page.evaluate((d) => {
    const axis = [...document.querySelectorAll('[data-axis]')].find((a) => a.getBoundingClientRect().width > 0);
    const strip = axis.nextElementSibling;
    const o = strip.getBoundingClientRect();
    const thumb = strip.children[1];
    if (!thumb) return { zoomed: false, frac: 1, start: 0 };
    const r = thumb.getBoundingClientRect();
    const frac = r.width / o.width;
    const room = o.width - r.width;
    return { zoomed: true, frac, start: room > 0 ? ((r.left - o.left) / room) * (d - frac * d) : 0 };
  }, duration);
}

/** The Extract panel or sheet's start/end fields, in seconds. */
export async function selection(page) {
  const s = await page.getByRole('textbox', { name: 'Start (m:ss.mmm)' }).inputValue();
  const e = await page.getByRole('textbox', { name: 'End (m:ss.mmm)' }).inputValue();
  return { start: parseTime(s), end: parseTime(e) };
}

/** Type a time into Start or End and commit with Enter. */
export async function typeTime(page, which, text) {
  const f = page.getByRole('textbox', { name: `${which} (m:ss.mmm)` });
  await f.click();
  await expect(f).toBeFocused();
  await f.press('ControlOrMeta+a');
  await f.pressSequentially(text);
  await f.press('Enter');
}

export async function noHorizontalOverflow(page) {
  const o = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    layout: window.innerWidth - document.documentElement.clientWidth,
  }));
  expect(o.scroll, 'page scrolls sideways').toBeLessThanOrEqual(1);
  expect(o.layout, 'layout viewport widened').toBeLessThanOrEqual(1);
}

/** Interactive elements under `root` whose hit area (incl. a ::before pad) is under 44x44 px. */
export async function smallTargets(page, root) {
  return page.evaluate((sel) => {
    const out = [];
    document.querySelectorAll(sel).forEach((rootEl) =>
      rootEl.querySelectorAll('button, a[href], input:not([type=radio]), select, [role="switch"], label:has(input[type=radio])').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || el.closest('.sr-only')) return;
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden' || st.display === 'none') return;
        let w = r.width;
        let h = r.height;
        const b = getComputedStyle(el, '::before');
        if (b.content && b.content !== 'none' && b.position === 'absolute') {
          w = Math.max(w, parseFloat(b.width) || 0);
          h = Math.max(h, parseFloat(b.height) || 0);
        }
        if (w < 43.5 || h < 43.5) out.push(`${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30)} ${Math.round(w)}x${Math.round(h)}`);
      })
    );
    return out;
  }, root);
}

/** Ink coverage of a lane's canvas (0..1): how much waveform is drawn. */
export async function inkOf(page, track) {
  return lane(page, track).locator('canvas').evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n += 1;
    return n / (d.length / 4);
  });
}

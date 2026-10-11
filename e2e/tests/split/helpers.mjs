/**
 * Shared helpers for the Split specs (split*.spec.mjs): seeding jobs with
 * unique names, the new-split form, job rows on every list tier, file drops,
 * a multi-chunk WAV, and layout probes. Not a spec (no .spec in the name).
 */
import { expect } from '../../support/fixtures.mjs';
import { MEDIA_DIR, media } from '../../support/media.mjs';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export { media };

/** A short unique prefix for the names one test creates (a worker's tests share its database). */
export const uid = () => `t${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`;

const MIME = { wav: 'audio/wav', mp3: 'audio/mpeg', mp4: 'video/mp4', txt: 'text/plain' };

/** A file for page.setInputFiles under another name (so every test's jobs are its own). */
export function asFile(file, name) {
  const ext = path.extname(name).slice(1);
  return { name, mimeType: MIME[ext] || 'application/octet-stream', buffer: readFileSync(file) };
}

/** Seed a job through the API under `name`; resolves with its task id. */
export async function seedJob(api, file, { name, model = 'htdemucs', recover = false, recoveryModel = 'apollo' } = {}) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(file)]), name || path.basename(file));
  form.append('model', model);
  form.append('recover', String(recover));
  form.append('recovery_model', recoveryModel);
  const res = await api.raw('/upload', { method: 'POST', body: form });
  if (!res.ok) throw new Error(`seed ${name}: ${res.status} ${await res.text()}`);
  return (await res.json()).task_id;
}

/** Finished rows without waiting for separations: upload, then cancel. */
export async function seedCancelled(api, names) {
  const ids = [];
  for (const name of names) {
    const id = await seedJob(api, media('oneshot.wav'), { name });
    // right away, before the (2 s) fake separation can finish it
    const res = await api.raw(`/tasks/${id}/cancel`, { method: 'POST' });
    if (!res.ok) throw new Error(`cancel ${name}: ${res.status} ${await res.text()}`);
    ids.push(id);
  }
  for (const id of ids) await api.waitJob(id, ['cancelled']);
  return ids;
}

/** Stop everything this worker still has queued or running (between tests). */
export async function cancelInFlight(api) {
  const until = Date.now() + 30_000;
  for (;;) {
    const { tasks } = await api.get('/tasks?limit=200&status=queued,processing,restoring');
    if (!tasks.length) return;
    for (const t of tasks) await api.raw(`/tasks/${t.task_id}/cancel`, { method: 'POST' });
    if (Date.now() > until) throw new Error(`jobs still in flight: ${tasks.map((t) => t.status)}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

// ---- the new-split form ----
export const splitForm = (page) => page.getByRole('form', { name: 'New split' });
export const fileInput = (page) => splitForm(page).locator('input[type=file]');
export const cta = (page) => splitForm(page).locator('button[type=submit]');
/** The status line (aria-live) under the CTA — the phone's bottom bar. */
export const statusLine = (page) => splitForm(page).locator('[aria-live="polite"]');
export const filesList = (page) => splitForm(page).getByRole('list', { name: 'Files' });
export const fileRow = (page, name) => filesList(page).getByRole('listitem').filter({ hasText: name });
/** Cancel upload ("Cancel upload" inline, "Cancel" in the phone bar). */
export const cancelUpload = (page) => splitForm(page).getByRole('button', { name: /^Cancel( upload)?$/ }).filter({ visible: true });

/** The job id a finished file row links to. */
export async function queuedId(page, name) {
  const href = await fileRow(page, name).getByRole('link', { name: 'Open' }).getAttribute('href');
  return href.split('/job/')[1];
}

// ---- jobs list ----
export const jobsRegion = (page) => page.getByRole('region', { name: 'Jobs' });
export const jobRow = (page, id) => page.locator(`li[data-job-row="${id}"]`);
export const searchBox = (page) => jobsRegion(page).getByRole('searchbox', { name: 'Search jobs' });
export const bulkDeleteGroup = (page) => page.getByRole('group', { name: 'Confirm bulk delete' });

/** True when the list is the two-line (phone-style) tier: no checkboxes until "Select jobs". */
export async function isNarrow(page) {
  await expect(jobsRegion(page).locator('li[data-job-row]').first()).toBeVisible();
  return jobsRegion(page).getByRole('button', { name: 'Select jobs' }).isVisible();
}

/** Search the list for `q` (narrow lists open the field from an icon). */
export async function searchJobs(page, q) {
  const icon = jobsRegion(page).getByRole('button', { name: 'Search jobs' });
  await expect(searchBox(page).or(icon).first()).toBeVisible();
  if (await icon.isVisible()) await icon.click();
  await searchBox(page).fill(q);
  await searchBox(page).press('Enter');
  await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(q)}`));
}

/** A row action button ("Delete", "Retry", "Cancel"); behind "⋯" on narrow lists. */
export async function rowAction(page, id, label) {
  const row = jobRow(page, id);
  const btn = row.getByRole('button', { name: new RegExp(`^${label} `) }).filter({ visible: true });
  const more = row.getByRole('button', { name: /^Actions for / });
  await expect(btn.or(more).first()).toBeVisible();
  if (!(await btn.count())) await more.click();
  await btn.first().click();
}

/** Open a job from its row ("Open"; behind "⋯" on narrow lists). */
export async function openRow(page, id) {
  const row = jobRow(page, id);
  const link = row.getByRole('link', { name: 'Open', exact: true }).filter({ visible: true });
  const more = row.getByRole('button', { name: /^Actions for / });
  await expect(link.or(more).first()).toBeVisible();
  if (!(await link.count())) await more.click();
  await link.first().click();
}

/** Check rows for bulk actions: checkboxes, or "Select jobs" + tapping rows on a narrow list. */
export async function selectRows(page, ids) {
  if (await isNarrow(page)) {
    if (!(await jobsRegion(page).getByRole('button', { name: 'Stop selecting' }).isVisible())) {
      await jobsRegion(page).getByRole('button', { name: 'Select jobs' }).click();
    }
    for (const id of ids) await jobRow(page, id).locator('button[aria-pressed]').click();
  } else {
    for (const id of ids) await jobRow(page, id).getByRole('checkbox').click();
  }
}

/** A bulk-bar button; narrow lists keep Select all / Cancel under "More bulk actions". */
export async function bulkButton(page, name) {
  const btn = jobsRegion(page).getByRole('button', { name, exact: true }).filter({ visible: true });
  const more = jobsRegion(page).getByRole('button', { name: 'More bulk actions' });
  await expect(btn.or(more).first()).toBeVisible();
  if (!(await btn.count())) await more.click();
  return btn.first();
}

// ---- files ----
/** Drop files on the page (DataTransfer + drag events); returns whether the drop wash showed. */
export async function dropFiles(page, files) {
  const payload = files.map(({ file, name }) => ({
    name,
    type: MIME[path.extname(name).slice(1)] || '',
    b64: readFileSync(file).toString('base64'),
  }));
  return page.evaluate(async (payload) => {
    const dt = new DataTransfer();
    for (const f of payload) {
      const bin = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bin], f.name, { type: f.type }));
    }
    const target = document.querySelector('main');
    const fire = (type) => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
      target.dispatchEvent(ev);
      return ev;
    };
    fire('dragenter');
    fire('dragover');
    // The overlay renders on the next commit; under load that can take a
    // few frames, so poll briefly instead of assuming two.
    const shown = () => [...document.querySelectorAll('p')].some((p) => /Drop to add audio files/.test(p.textContent));
    let wash = false;
    for (let i = 0; i < 60 && !wash; i += 1) {
      await new Promise((r) => requestAnimationFrame(r));
      wash = shown();
    }
    const drop = fire('drop');
    return { wash, handled: drop.defaultPrevented };
  }, payload);
}

/**
 * A WAV big enough for three 8 MB chunks (resumable uploads), written once
 * into the generated-media cache. Atomic rename: workers may race.
 */
export function bigWav(mb = 20) {
  const file = path.join(MEDIA_DIR, `split-big-${mb}mb.wav`);
  if (existsSync(file)) return file;
  const rate = 44100;
  const frames = Math.floor((mb * 1024 * 1024) / 4);
  const buf = Buffer.alloc(44 + frames * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + frames * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(6000 * Math.sin((2 * Math.PI * 220 * i) / rate));
    buf.writeInt16LE(v, 44 + i * 4);
    buf.writeInt16LE(v, 46 + i * 4);
  }
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, buf);
  renameSync(tmp, file);
  return file;
}

export const md5 = (file) => createHash('md5').update(readFileSync(file)).digest('hex');

/** "20.0" for a file size, as the UI prints MB. */
export const mbText = (bytes) => (bytes / (1024 * 1024)).toFixed(1);

// ---- layout ----
export async function expectNoHorizontalOverflow(page) {
  const o = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    layout: window.innerWidth - document.documentElement.clientWidth,
  }));
  expect(o.scroll, 'page scrolls sideways').toBeLessThanOrEqual(1);
  expect(o.layout, 'layout viewport widened').toBeLessThanOrEqual(1);
}

/**
 * Visible controls inside `root` whose touch target is under 44 px. A
 * checkbox/radio counts as its label; a link whose ::before is stretched
 * over its row counts as that row. `skip(el)` leaves elements out.
 */
export async function smallTouchTargets(root, { skipStretchless = false } = {}) {
  return root.evaluate((rootEl, skipStretchless) => {
    const out = [];
    for (const el of rootEl.querySelectorAll('a[href], button, select, input:not([type=hidden]):not([type=file])')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('.sr-only')) continue;
      let r = el.getBoundingClientRect();
      if (el.matches('input[type=radio], input[type=checkbox]')) {
        const label = el.closest('label');
        if (!label) continue;
        r = label.getBoundingClientRect();
      } else {
        const before = getComputedStyle(el, '::before');
        if (before.position === 'absolute' && before.content !== 'none') {
          let p = el.parentElement;
          while (p && getComputedStyle(p).position === 'static') p = p.parentElement;
          if (p) r = p.getBoundingClientRect();
        } else if (skipStretchless && el.matches('li[data-job-row] a[title]')) {
          continue; // a single-line row's name link (see the name-link test)
        }
      }
      if (!r.width || !r.height) continue;
      if (r.width < 43.5 || r.height < 43.5) {
        const label = (el.getAttribute('aria-label') || el.textContent || el.type || '').trim().replace(/\s+/g, ' ').slice(0, 30);
        out.push(`${el.tagName.toLowerCase()} "${label}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return [...new Set(out)];
  }, skipStretchless);
}

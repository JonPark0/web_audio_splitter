import { readFileSync } from 'node:fs';
import { touch } from '../support/touch.mjs';
import {
  test,
  expect,
  hasCDP,
  uid,
  fresh,
  tagged,
  waitAnalysed,
  media,
  elevenMinutes,
  openLibrary,
  prefs,
  list,
  rows,
  rowById,
  rowIds,
  toolbar,
  bottomBar,
  press,
  audio,
  expectPlaying,
  expectStopped,
  projectUsing,
  toast,
  zipNames,
} from './library/helpers.mjs';

// Many samples at once: checkboxes and ranges, the phone's Select mode,
// bulk tag / re-analyze / ZIP / delete, and importing files (picker, drag
// and drop, failures, the 10-minute limit). Each test makes its own samples
// and lists only them (?tags=<its tag>), except imports, which watch the
// unfiltered newest-first list.

async function setup(page, api, lib, n) {
  const tag = `b${uid()}`;
  const samples = await fresh(api, await lib.job(), tag, Array.from({ length: n }, (_, i) => ({ name: `Bulk ${tag} ${i}`, len: 1 })));
  // analysed first: a card's "Analyzing…" note doesn't take taps (see library-edit.spec.mjs)
  await waitAnalysed(api, samples.map((s) => s.id));
  const ui = await openLibrary(page, `tags=${tag}`);
  await expect(rows(page)).toHaveCount(n);
  return { tag, samples, ui };
}

const bar = (page, ui) => (ui.phone ? bottomBar(page) : toolbar(page));
const checkedIds = (page) =>
  rows(page).evaluateAll((rs) => rs.filter((r) => r.querySelector('input[type=checkbox]')?.checked).map((r) => r.dataset.id));

/** Check these rows the way the device does it (phone: Select mode, then tap the cards). */
async function check(page, ui, ids) {
  if (ui.phone) {
    if (!(await page.getByRole('button', { name: 'Stop selecting' }).isVisible())) await press(page.getByRole('button', { name: 'Select samples' }), ui);
    for (const id of ids) await press(rowById(page, id).locator('[data-card-body]'), ui);
  } else {
    for (const id of ids) await press(rowById(page, id).locator('input[type=checkbox]'), ui);
  }
  await expect(bar(page, ui)).toContainText(`${ids.length} selected`);
}

/** A bulk action by its label: on the bar, or folded into its ⋯ (a menu, or the phone's sheet). */
async function bulkAction(page, ui, label) {
  const b = bar(page, ui);
  const direct = b.getByRole('button', { name: label, exact: true });
  if (await direct.isVisible()) {
    await press(direct, ui);
    return;
  }
  await press(b.getByRole('button', { name: 'More bulk actions' }), ui);
  await press(page.getByRole('menuitem', { name: new RegExp(`^${label}`) }), ui);
}

test.describe('selection', () => {
  test.beforeEach(async ({ page }) => prefs(page, { 'library:auto': false }));

  test('checkboxes, Shift-click ranges, Ctrl-click, check-all, Ctrl+A and Escape', async ({ page, api, lib }) => {
    const { samples, ui } = await setup(page, api, lib, 8);
    test.skip(ui.phone || ui.coarse, 'mouse and keyboard (desktop)');
    const ids = await rowIds(page);
    const box = (i) => rowById(page, ids[i]).locator('input[type=checkbox]');
    await box(1).click();
    await expect(toolbar(page)).toContainText('1 selected');
    await expect(page.getByRole('searchbox', { name: 'Search samples' })).toHaveCount(0); // the bar replaces the toolbar
    await box(5).click({ modifiers: ['Shift'] });
    await expect.poll(() => checkedIds(page)).toEqual(ids.slice(1, 6));
    await page.locator('h2, [aria-live=polite]').first().click();
    await page.keyboard.press('Escape');
    await expect.poll(() => checkedIds(page)).toEqual([]);

    await rowById(page, ids[0]).locator('[role=gridcell]').nth(3).click({ modifiers: ['Control'] });
    await rowById(page, ids[2]).locator('[role=gridcell]').nth(3).click({ modifiers: ['Control'] });
    await expect.poll(() => checkedIds(page)).toEqual([ids[0], ids[2]]);
    await page.getByRole('button', { name: 'Clear selection' }).click();

    await page.getByRole('checkbox', { name: 'Select all loaded samples' }).check();
    await expect(toolbar(page)).toContainText(`${samples.length} selected`);
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await rowById(page, ids[3]).locator('[role=gridcell]').nth(3).click();
    await page.keyboard.press('Control+a');
    await expect(toolbar(page)).toContainText(`${samples.length} selected`);
  });

  test('touch: the 44 px checkbox cell toggles a row', async ({ page, api, lib }) => {
    const { ui } = await setup(page, api, lib, 3);
    test.skip(ui.phone || !ui.coarse, 'touch rows (tablet)');
    const ids = await rowIds(page);
    for (const id of ids.slice(0, 2)) {
      const cell = rowById(page, id).locator('label').first();
      const b = await cell.boundingBox();
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(43.5);
      await cell.tap();
    }
    await expect(toolbar(page)).toContainText('2 selected');
    await expect.poll(() => checkedIds(page)).toEqual(ids.slice(0, 2));
    await press(toolbar(page).getByRole('button', { name: 'Clear selection' }), ui);
    await expect.poll(() => checkedIds(page)).toEqual([]);
  });

  test('phone: Select mode — tap cards to check them, X leaves, and ▶ stays stoppable', async ({ page, api, lib }) => {
    const { samples, ui } = await setup(page, api, lib, 4);
    test.skip(!ui.phone, 'phone layout');
    const ids = await rowIds(page);
    const nameOf = (id) => samples.find((s) => s.id === id).name;
    await press(page.getByRole('button', { name: 'Select samples' }), ui);
    await expect(bottomBar(page)).toContainText('Tap samples to select');
    const cell = await rowById(page, ids[0]).locator('label').boundingBox();
    expect(Math.min(cell.width, cell.height)).toBeGreaterThanOrEqual(43.5);
    await press(rowById(page, ids[0]).locator('[data-card-body]'), ui);
    await press(rowById(page, ids[2]).locator('[data-card-body]'), ui);
    await expect(bottomBar(page)).toContainText('2 selected');
    await expect.poll(() => checkedIds(page)).toEqual([ids[0], ids[2]]);
    expect((await audio(page))?.paused ?? true, 'tapping while selecting does not play').toBe(true);
    await press(page.getByRole('button', { name: 'Stop selecting' }), ui);
    await expect(rows(page).locator('input[type=checkbox]')).toHaveCount(0);

    // a preview playing when Select starts can still be stopped from the bar
    await press(rowById(page, ids[1]).getByRole('button', { name: /^Play / }), ui);
    await expectPlaying(page, ids[1]);
    await press(page.getByRole('button', { name: 'Select samples' }), ui);
    const stop = bottomBar(page).getByRole('button', { name: `Stop ${nameOf(ids[1])}` });
    await press(stop, ui);
    await expectStopped(page);
    await expect(stop).toHaveCount(0);
  });

  test('phone: a long press on a card starts selecting', async ({ page, api, lib, browserName }) => {
    test.skip(!hasCDP(browserName), 'long press needs CDP touch events');
    const { ui } = await setup(page, api, lib, 3);
    test.skip(!ui.phone, 'phone layout');
    const ids = await rowIds(page);
    const b = await rowById(page, ids[1]).locator('[data-card-body]').boundingBox();
    await (await touch(page)).longPress({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, { holdMs: 1000 }); // the app's threshold is 450 ms
    await expect(bottomBar(page)).toContainText('1 selected');
    await expect.poll(() => checkedIds(page)).toEqual([ids[1]]);
    expect((await audio(page))?.paused ?? true, 'the long press does not play').toBe(true);
  });
});

test.describe('bulk actions', () => {
  test.beforeEach(async ({ page }) => prefs(page, { 'library:auto': false }));

  test('tag: add a comma list to all, remove one; the field keeps focus', async ({ page, api, lib }) => {
    const { samples, ui } = await setup(page, api, lib, 4);
    const picked = samples.slice(0, 3);
    await check(page, ui, picked.map((s) => s.id));
    await bulkAction(page, ui, ui.phone ? 'Tag' : 'Tag…');
    const panel = page.getByRole('dialog', { name: 'Tags for 3 samples' });
    const input = panel.getByRole('combobox', { name: 'Add tags to 3 samples' });
    await expect(input).toBeFocused();
    await page.keyboard.insertText('bulk-x, Bulk Y');
    await page.keyboard.press('Enter');
    const tagsOf = () => Promise.all(picked.map(async (s) => (await api.get(`/samples/${s.id}`)).tags));
    await expect.poll(tagsOf).toEqual(picked.map(() => expect.arrayContaining(['bulk-x', 'bulk y'])));
    await expect(input).toBeFocused();
    expect((await api.get(`/samples/${samples[3].id}`)).tags).not.toContain('bulk-x');
    await press(panel.getByRole('button', { name: 'bulk-x ×' }), ui);
    await expect.poll(async () => (await tagsOf()).every((t) => !t.includes('bulk-x') && t.includes('bulk y'))).toBe(true);
  });

  test('re-analyze the checked samples', async ({ page, api, lib }) => {
    const { tag, samples, ui } = await setup(page, api, lib, 3);
    await check(page, ui, samples.map((s) => s.id));
    await bulkAction(page, ui, 'Re-analyze');
    await expect(toast(page, 'Re-analyzing')).toContainText('Re-analyzing 3 samples — your BPM/key overrides are kept');
    await expect
      .poll(async () => (await tagged(api, tag)).samples.every((s) => s.analysis_status === 'done'), { timeout: 30_000 })
      .toBe(true);
    await expect(page.getByText('Analyzing…')).toHaveCount(0, { timeout: 10_000 });
  });

  test('Download ZIP holds the checked samples under their names', async ({ page, api, lib }, testInfo) => {
    const { samples, ui } = await setup(page, api, lib, 4);
    const picked = [samples[0], samples[2], samples[3]];
    await check(page, ui, picked.map((s) => s.id));
    const [dl] = await Promise.all([page.waitForEvent('download'), bulkAction(page, ui, 'Download ZIP')]);
    expect(dl.suggestedFilename()).toBe('samples-3.zip');
    const file = testInfo.outputPath('samples.zip');
    await dl.saveAs(file);
    expect(zipNames(file).sort()).toEqual(picked.map((s) => `${s.name}.wav`).sort());
  });

  test('delete asks first (focus on Cancel, Enter keeps them), then deletes', async ({ page, api, lib }) => {
    const { samples, ui } = await setup(page, api, lib, 4);
    const picked = samples.slice(1);
    const status = () => Promise.all(picked.map(async (s) => (await api.raw(`/samples/${s.id}`)).status));
    await check(page, ui, picked.map((s) => s.id));
    const b = bar(page, ui);
    await bulkAction(page, ui, 'Delete');
    await expect(b.getByText('Delete 3?')).toBeVisible();
    await expect(b.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(b.getByText('Delete 3?')).toHaveCount(0);
    expect(await status()).toEqual([200, 200, 200]);
    await bulkAction(page, ui, 'Delete');
    await press(b.getByRole('button', { name: 'Confirm' }), ui);
    await expect(toast(page, 'Deleted')).toContainText('Deleted 3 samples');
    expect(await status()).toEqual([404, 404, 404]);
    await expect(rows(page)).toHaveCount(1);
  });

  test('delete keeps samples a project uses, reports them and leaves them checked', async ({ page, api, lib }) => {
    const { samples, ui } = await setup(page, api, lib, 2);
    const project = `Uses ${uid()}`;
    await projectUsing(api, project, [samples[1]]);
    await check(page, ui, samples.map((s) => s.id));
    await bulkAction(page, ui, 'Delete');
    await press(bar(page, ui).getByRole('button', { name: 'Confirm' }), ui);
    const report = page.getByRole('alert').filter({ hasText: 'Deleted 1 of 2' });
    await expect(report).toContainText(project);
    await expect(report).toContainText(samples[1].name);
    expect((await api.raw(`/samples/${samples[0].id}`)).status).toBe(404);
    expect((await api.raw(`/samples/${samples[1].id}`)).status).toBe(200);
    await expect(bar(page, ui)).toContainText('1 selected');
  });
});

// ------------------------------------------------------------------ import --

/** Holds the first import request until release() (the "file in flight"). */
async function holdFirstImport(page) {
  let release;
  const gate = new Promise((r) => (release = r));
  const seen = [];
  await page.route('**/api/samples/import', async (route) => {
    seen.push(route.request());
    if (seen.length === 1) await gate;
    try {
      await route.continue();
    } catch {
      // cancelled by the page meanwhile
    }
  });
  return { release: () => release(), seen };
}

/** A fixture file under a unique name (its default sample name). */
const named = (file, stem) => ({ name: `${stem}${file.slice(file.lastIndexOf('.'))}`, mimeType: file.endsWith('.mp4') ? 'video/mp4' : 'audio/wav', buffer: readFileSync(media(file)) });

async function chooseFiles(page, ui, files) {
  const opener = ui.phone ? page.getByRole('button', { name: 'Import audio files' }) : page.getByRole('button', { name: 'Import', exact: true });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), press(opener, ui)]);
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles(files);
}

const importPanel = (page) => page.getByRole('region', { name: 'Import' });
const byName = async (api, name) => (await api.get(`/samples?q=${encodeURIComponent(name)}&limit=0`)).samples.filter((s) => s.name === name);

test.describe('import', () => {
  test('several files queue with progress; a waiting one can be named; they land on top', async ({ page, api }) => {
    const u = uid();
    const ui = await openLibrary(page);
    const hold = await holdFirstImport(page);
    await chooseFiles(page, ui, [named('loop100.wav', `loop-${u}`), named('oneshot.wav', `shot-${u}`), named('clip.mp4', `video-${u}`)]);
    const panel = importPanel(page);
    await expect(panel.locator('h3')).toHaveText('Importing 1 of 3');
    await expect(panel.getByText('Waiting')).toHaveCount(2);
    await panel.getByRole('textbox', { name: `Name for shot-${u}.wav (optional)` }).fill(`Named 이름 ${u}`);
    hold.release();
    await expect(panel.locator('h3')).toHaveText('Imported 3 of 3', { timeout: 30_000 });
    for (const n of [`loop-${u}`, `Named 이름 ${u}`, `video-${u}`]) expect(await byName(api, n), n).toHaveLength(1);
    // newest first: the three new ones lead the list
    await expect
      .poll(async () => (await rows(page).locator('span[title], [data-card-body]').evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute('title') || e.getAttribute('aria-label').split('. ')[0]))).sort())
      .toEqual([`Named 이름 ${u}`, `loop-${u}`, `video-${u}`].sort());
    await press(panel.getByRole('button', { name: 'Dismiss' }), ui);
    await expect(panel).toHaveCount(0);
  });

  test('batch tags reach every file of the batch, also the one uploading', async ({ page, api }) => {
    test.fail(true, 'the file already uploading keeps the empty tag list it was sent with; setBatchTags only patches finished files (frontend/src/components/library/ImportQueue.jsx:48, :96)');
    const u = uid();
    const ui = await openLibrary(page);
    const hold = await holdFirstImport(page);
    await chooseFiles(page, ui, [named('loop100.wav', `first-${u}`), named('oneshot.wav', `second-${u}`)]);
    const panel = importPanel(page);
    await expect(panel.locator('h3')).toHaveText('Importing 1 of 2');
    const tags = panel.getByRole('combobox');
    await tags.fill(`batch-${u}`);
    await tags.press('Enter');
    hold.release();
    await expect(panel.locator('h3')).toHaveText('Imported 2 of 2', { timeout: 30_000 });
    await expect.poll(async () => (await tagged(api, `batch-${u}`)).samples.map((s) => s.name).sort(), { timeout: 5000 }).toEqual([`first-${u}`, `second-${u}`]);
  });

  test('drag and drop files anywhere on the Library', async ({ page, api }) => {
    const u = uid();
    await openLibrary(page);
    const files = [named('oneshot.wav', `dropped-${u}`), named('loop100.wav', `드롭-${u}`)].map((f) => ({ name: f.name, b64: f.buffer.toString('base64') }));
    const dataTransfer = await page.evaluateHandle((fs) => {
      const dt = new DataTransfer();
      for (const f of fs) {
        const bin = atob(f.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        dt.items.add(new File([bytes], f.name, { type: 'audio/wav' }));
      }
      return dt;
    }, files);
    const target = list(page).or(page.getByText('No samples yet.')).first();
    await target.dispatchEvent('dragenter', { dataTransfer });
    await target.dispatchEvent('dragover', { dataTransfer });
    await expect(page.getByText('Drop audio files to import')).toBeVisible();
    await target.dispatchEvent('drop', { dataTransfer });
    await expect(page.getByText('Drop audio files to import')).toHaveCount(0);
    await expect(importPanel(page).locator('h3')).toHaveText('Imported 2 of 2', { timeout: 30_000 });
    expect(await byName(api, `dropped-${u}`)).toHaveLength(1);
    expect(await byName(api, `드롭-${u}`)).toHaveLength(1);
  });

  test("a file that isn't audio fails with the reason, and Retry sends it again", async ({ page }) => {
    const u = uid();
    const ui = await openLibrary(page);
    const posts = [];
    page.on('request', (r) => r.method() === 'POST' && r.url().includes('/samples/import') && posts.push(r.url()));
    await chooseFiles(page, ui, [{ ...named('not-audio.mp3', `garbage-${u}`), mimeType: 'audio/mpeg' }]);
    const panel = importPanel(page);
    await expect(panel.getByText('Failed')).toBeVisible();
    await expect(panel.getByRole('alert')).toHaveText('Unsupported or unreadable audio file');
    await press(panel.getByRole('button', { name: `Retry garbage-${u}.mp3` }), ui);
    await expect.poll(() => posts.length).toBe(2);
    await expect(panel.getByText('Failed')).toBeVisible();
  });

  test('a file over 10 minutes is refused', async ({ page, api }) => {
    const u = uid();
    const ui = await openLibrary(page);
    await chooseFiles(page, ui, [{ name: `long-${u}.mp3`, mimeType: 'audio/mpeg', buffer: readFileSync(elevenMinutes()) }]);
    const panel = importPanel(page);
    await expect(panel.getByRole('alert')).toHaveText('Samples are limited to 10 minutes; split longer audio on the Split screen', { timeout: 30_000 });
    expect(await byName(api, `long-${u}`)).toHaveLength(0);
  });

  test('a file can be cancelled while it uploads', async ({ page, api }) => {
    const u = uid();
    const ui = await openLibrary(page);
    const hold = await holdFirstImport(page);
    await chooseFiles(page, ui, [named('loop100.wav', `cancel-${u}`)]);
    const panel = importPanel(page);
    await expect(panel.locator('h3')).toHaveText('Importing 1 of 1');
    await press(panel.getByRole('button', { name: `Cancel cancel-${u}.wav` }), ui);
    await expect(panel.getByText('Cancelled')).toBeVisible();
    hold.release();
    await expect(panel.locator('h3')).toHaveText('Imported 0 of 1');
    await page.unrouteAll({ behavior: 'wait' });
    expect(await byName(api, `cancel-${u}`)).toHaveLength(0);
  });
});

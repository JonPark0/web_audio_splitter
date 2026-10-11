import { test, expect } from '../support/fixtures.mjs';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  bulkButton, bulkDeleteGroup, cancelInFlight, isNarrow, jobRow, jobsRegion, media, openRow, rowAction, searchBox, searchJobs,
  seedCancelled, seedJob, selectRows, uid,
} from './split/helpers.mjs';

// The live jobs list on the Split home: status, queue, search, filters,
// Load more, Open / Cancel / Retry / Delete, bulk actions, and the narrow
// (phone) list's select mode. Seeded through the API under unique names.

test.afterEach(async ({ api }) => cancelInFlight(api));

const badge = (page) => page.getByRole('banner').getByRole('link', { name: /jobs? running — show jobs$/ });
const selectedCount = (page) => jobsRegion(page).getByText(/^\d+ selected$/);

test('rows follow a job live: separating, queue positions, the running badge, Cancel with confirm', async ({ page, api, app }) => {
  app.setSeparationDelay(30);
  const u = uid();
  const ids = [];
  for (const x of ['a', 'b', 'c']) ids.push(await seedJob(api, media('oneshot.wav'), { name: `${u}-${x}.wav` }));
  const [a, b, c] = ids; // a runs, b and c wait
  await page.goto('/#/split');
  await expect(jobRow(page, a)).toContainText('Separating');
  await expect(jobRow(page, a).getByRole('progressbar')).toBeVisible();
  await expect(jobRow(page, b)).toContainText('Queued · 1 ahead');
  await expect(jobRow(page, c)).toContainText('Queued · 2 ahead');
  await expect(badge(page)).toHaveText('3 running');
  if (page.viewportSize().width < 640) {
    // on phones the badge takes the wordmark's place
    await expect(page.getByRole('banner').getByRole('link', { name: 'Audio Splitter' })).toBeHidden();
  }
  // a running row offers Cancel, not Delete
  await expect(jobRow(page, a).getByRole('button', { name: new RegExp(`^Delete `) })).toHaveCount(0);

  // the badge brings the jobs list into view and focus
  await badge(page).click();
  await expect(page.getByRole('heading', { name: 'Jobs', exact: true })).toBeFocused();

  // Cancel a queued job: asks first; Keep running keeps it
  await rowAction(page, b, 'Cancel');
  const confirm = jobRow(page, b).getByRole('group', { name: 'Confirm cancel' });
  await expect(confirm).toContainText('Cancel this job? The work done on it so far is lost.');
  await confirm.getByRole('button', { name: 'Keep running' }).click();
  await expect(confirm).toBeHidden();
  expect((await api.get(`/status/${b}`)).status).toBe('queued');
  await rowAction(page, b, 'Cancel');
  await confirm.getByRole('button', { name: 'Cancel job' }).click();
  await expect(jobRow(page, b)).toContainText('Cancelled');
  await expect(jobRow(page, c)).toContainText('Queued · 1 ahead');

  // and the running one
  await rowAction(page, a, 'Cancel');
  await jobRow(page, a).getByRole('group', { name: 'Confirm cancel' }).getByRole('button', { name: 'Cancel job' }).click();
  await expect(jobRow(page, a)).toContainText('Cancelled');
  expect((await api.waitJob(a, ['cancelled'])).status).toBe('cancelled');
  await expect(jobRow(page, c)).toContainText('Separating');
  await expect(badge(page)).toHaveText('1 running');
  await rowAction(page, c, 'Cancel');
  await jobRow(page, c).getByRole('group', { name: 'Confirm cancel' }).getByRole('button', { name: 'Cancel job' }).click();
  await expect(badge(page)).toBeHidden({ timeout: 15_000 });
});

test('the running badge on another section opens the jobs list', async ({ page, api, app }) => {
  app.setSeparationDelay(30);
  await seedJob(api, media('oneshot.wav'), { name: `${uid()}.wav` });
  await page.goto('/#/library');
  await expect(badge(page)).toHaveText('1 running', { timeout: 25_000 });
  await badge(page).click();
  await expect(page).toHaveURL(/#\/split$/);
  await expect(page.getByRole('heading', { name: 'Jobs', exact: true })).toBeFocused();
});

test('search (with ×), status filters, deep link and reload', async ({ page, api, app }) => {
  const u = uid();
  app.setSeparationDelay(0);
  const done = [await seedJob(api, media('oneshot.wav'), { name: `${u}-done-a.wav` }), await seedJob(api, media('oneshot.wav'), { name: `${u}-done-b.wav` })];
  for (const id of done) await api.waitJob(id);
  app.setSeparationFails(true);
  const failed = await seedJob(api, media('oneshot.wav'), { name: `${u}-broken.wav` });
  expect((await api.waitJob(failed)).status).toBe('failed');
  app.setSeparationFails(false);
  await seedCancelled(api, [`${u}-x1.wav`, `${u}-x2.wav`]);

  await page.goto('/#/split');
  await searchJobs(page, u.toUpperCase()); // case-insensitive
  const rows = jobsRegion(page).locator('li[data-job-row]');
  await expect(rows).toHaveCount(5);
  await expect(jobRow(page, failed)).toContainText('Separation failed');

  const filters = jobsRegion(page).getByRole('radiogroup', { name: 'Show jobs' });
  await filters.getByText('Done', { exact: true }).click();
  await expect(page).toHaveURL(/status=done/);
  await expect(rows).toHaveCount(2);
  await filters.getByText('Failed', { exact: true }).click();
  await expect(rows).toHaveCount(3);
  await filters.getByText('Running', { exact: true }).click();
  await expect(jobsRegion(page).getByText('No jobs match.')).toBeVisible();
  await filters.getByText('Done', { exact: true }).click();
  await expect(rows).toHaveCount(2);

  // a reload keeps both; filter changes don't pile up history entries
  await page.reload();
  await expect(rows).toHaveCount(2);
  await expect(filters.getByRole('radio', { name: 'Done' })).toBeChecked();
  await expect(searchBox(page)).toHaveValue(u.toUpperCase());
  const len = await page.evaluate(() => history.length);
  await filters.getByText('All', { exact: true }).click();
  await expect(rows).toHaveCount(5);
  expect(await page.evaluate(() => history.length)).toBe(len);

  await searchBox(page).fill(`${u}-nothing`);
  await expect(jobsRegion(page).getByText('No jobs match.')).toBeVisible();
  await jobsRegion(page).getByRole('button', { name: 'Clear search' }).click();
  await expect(searchBox(page)).toHaveValue('');
  await expect(searchBox(page)).toBeFocused();
  await expect(page).not.toHaveURL(/q=/);

  await page.goto(`/#/split?status=done&q=${u}-done-b`);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(`${u}-done-b.wav`);
});

test('Load more pages the list; Back from a job restores the rows and the scroll position', async ({ page, api }) => {
  const u = uid();
  await seedCancelled(api, Array.from({ length: 33 }, (_, i) => `${u}-${String(i + 1).padStart(2, '0')}.wav`));
  const total = (await api.get('/tasks?limit=200')).tasks.length; // this worker's earlier jobs are listed too
  await page.goto('/#/split');
  const rows = jobsRegion(page).locator('li[data-job-row]');
  await expect(rows).toHaveCount(30);
  await jobsRegion(page).getByRole('button', { name: 'Load more' }).click();
  const loaded = Math.min(total, 60);
  await expect(rows).toHaveCount(loaded);
  await expect(jobsRegion(page).getByRole('button', { name: 'Load more' })).toBeVisible({ visible: total > 60 });

  const row = rows.nth(loaded - 2);
  await row.scrollIntoViewIfNeeded();
  const y0 = await page.evaluate(() => window.scrollY);
  expect(y0).toBeGreaterThan(100);
  const id = await row.getAttribute('data-job-row');
  await row.getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/split/job/${id}`));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect(rows).toHaveCount(loaded);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y0 - 5);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y0)).toBeLessThanOrEqual(5);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/split/job/${id}`));
});

test('a searched list pages with Load more to the end', async ({ page, api }) => {
  const u = uid();
  await seedCancelled(api, Array.from({ length: 33 }, (_, i) => `${u}-${String(i + 1).padStart(2, '0')}.wav`));
  await page.goto(`/#/split?q=${u}`);
  const rows = jobsRegion(page).locator('li[data-job-row]');
  await expect(rows).toHaveCount(30);
  await jobsRegion(page).getByRole('button', { name: 'Load more' }).click();
  await expect(rows).toHaveCount(33);
  await expect(jobsRegion(page).getByRole('button', { name: 'Load more' })).toBeHidden();
  await expect(rows.last()).toContainText(`${u}-01.wav`);
});

test('Open and Retry with another model from a row', async ({ page, api }) => {
  const u = uid();
  const id = await seedJob(api, media('oneshot.wav'), { name: `${u}.wav` });
  await api.waitJob(id);
  await page.goto(`/#/split?q=${u}`);
  await openRow(page, id);
  await expect(page).toHaveURL(new RegExp(`/split/job/${id}`));
  await expect(page.getByRole('heading', { level: 1, name: `${u}.wav` })).toBeVisible();
  await page.goBack();

  await rowAction(page, id, 'Retry');
  const panel = jobRow(page, id).locator('form').filter({ hasText: 'Start retry' });
  await expect(panel.getByLabel('Model')).toHaveValue('htdemucs');
  await expect(panel.getByLabel('Model')).toBeFocused();
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel).toBeHidden();
  await rowAction(page, id, 'Retry');
  await panel.getByLabel('Model').selectOption('htdemucs_6s');
  await panel.getByRole('button', { name: 'Start retry' }).click();
  await expect(jobsRegion(page).getByText('Retry queued — it is at the top of the list.')).toBeVisible();
  const top = jobsRegion(page).locator('li[data-job-row]').first();
  await expect(top).toContainText(`${u}.wav · retry`);
  await expect(top).toContainText('htdemucs_6s');
  const retry = await top.getAttribute('data-job-row');
  const s = await api.waitJob(retry);
  expect([s.status, s.model]).toEqual(['completed', 'htdemucs_6s']);
  expect((await api.get(`/result/${retry}`)).tracks).toHaveLength(6);
});

test('Delete asks first, removes the job and its files, and moves focus to the next row', async ({ page, api, app }) => {
  const u = uid();
  const [below] = await seedCancelled(api, [`${u}-older.wav`]);
  const id = await seedJob(api, media('oneshot.wav'), { name: `${u}-newer.wav` });
  await api.waitJob(id);
  const stems = path.join(app.mediaDir, 'media', 'separated', 'htdemucs', id);
  const uploads = path.join(app.mediaDir, 'media', 'uploads');
  expect(existsSync(stems)).toBe(true);

  await page.goto(`/#/split?q=${u}`);
  await rowAction(page, id, 'Delete');
  const confirm = jobRow(page, id).getByRole('group', { name: 'Confirm delete' });
  await expect(confirm).toContainText('Delete this job and its stems? Library samples cut from it are kept.');
  await confirm.getByRole('button', { name: 'Keep' }).click();
  await expect(confirm).toBeHidden();
  await expect(jobRow(page, id).locator(':focus')).toHaveCount(1); // back on the row's control
  await rowAction(page, id, 'Delete');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(jobRow(page, id)).toHaveCount(0);
  await expect(jobRow(page, below).locator(':focus')).toHaveCount(1);
  expect((await api.raw(`/status/${id}`)).status).toBe(404);
  expect(existsSync(stems), 'stems removed').toBe(false);
  expect(readdirSync(uploads).filter((f) => f.startsWith(id)), 'upload removed').toEqual([]);
});

test('bulk: select rows, Select all, Retry N with another model, Delete N with confirm, Escape', async ({ page, api }) => {
  const u = uid();
  const ids = await seedCancelled(api, [`${u}-1.wav`, `${u}-2.wav`, `${u}-3.wav`, `${u}-4.wav`]);
  await page.goto(`/#/split?q=${u}`);
  await selectRows(page, [ids[0]]);
  await expect(selectedCount(page)).toHaveText('1 selected');
  await (await bulkButton(page, 'Select all 4')).click();
  await expect(selectedCount(page)).toHaveText('4 selected');
  // Escape (focus outside the list) clears the selection
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Escape');
  await expect(selectedCount(page)).toBeHidden();

  await selectRows(page, [ids[0], ids[1]]);
  await expect(selectedCount(page)).toHaveText('2 selected');
  await (await bulkButton(page, 'Retry…')).click();
  const panel = jobsRegion(page).locator('form').filter({ hasText: 'Retry 2 jobs' });
  await panel.getByLabel('Model').selectOption('mdx');
  await panel.getByRole('button', { name: 'Retry 2 jobs' }).click();
  await expect(jobsRegion(page).getByRole('status')).toContainText('Queued 2 retries — at the top of the list.');
  const retries = (await api.get(`/tasks?q=${u}`)).tasks.filter((t) => t.retry_of);
  expect(retries.map((t) => t.model)).toEqual(['mdx', 'mdx']);
  expect(retries.map((t) => t.retry_of).sort()).toEqual([ids[0], ids[1]].sort());
  await jobsRegion(page).getByRole('button', { name: 'Dismiss' }).click();

  await selectRows(page, [ids[2], ids[3]]);
  await expect(selectedCount(page)).toHaveText('2 selected');
  await (await bulkButton(page, 'Delete')).click();
  await expect(bulkDeleteGroup(page)).toContainText('Delete 2 jobs and their stems? Library samples cut from them are kept.');
  await bulkDeleteGroup(page).getByRole('button', { name: 'Keep' }).click();
  await expect(bulkDeleteGroup(page)).toBeHidden();
  await (await bulkButton(page, 'Delete')).click();
  await bulkDeleteGroup(page).getByRole('button', { name: 'Delete' }).click();
  await expect(jobsRegion(page).getByRole('status')).toContainText('Deleted 2 jobs.');
  for (const id of [ids[2], ids[3]]) expect((await api.raw(`/status/${id}`)).status).toBe(404);
  await expect(jobRow(page, ids[2])).toHaveCount(0);
});

test('bulk Cancel stops the queued and running ones; bulk Delete skips running jobs', async ({ page, api, app }) => {
  app.setSeparationDelay(30);
  const u = uid();
  const [done] = await seedCancelled(api, [`${u}-done.wav`]);
  const running = await seedJob(api, media('oneshot.wav'), { name: `${u}-run.wav` });
  const queued = await seedJob(api, media('oneshot.wav'), { name: `${u}-wait.wav` });
  await page.goto(`/#/split?q=${u}`);
  await expect(jobRow(page, running)).toContainText('Separating');
  await selectRows(page, [done, running, queued]);
  await expect(selectedCount(page)).toHaveText('3 selected');
  await expect(jobsRegion(page).getByRole('button', { name: 'Retry 1…' })).toBeVisible();
  await (await bulkButton(page, 'Delete 1')).click();
  await expect(bulkDeleteGroup(page)).toContainText('Delete 1 job and their stems?');
  await expect(bulkDeleteGroup(page)).toContainText('2 running are skipped.');
  await bulkDeleteGroup(page).getByRole('button', { name: 'Keep' }).click();
  await (await bulkButton(page, 'Cancel 2')).click();
  await expect(jobsRegion(page).getByRole('status')).toContainText('Cancelled 2 jobs.');
  await expect(jobRow(page, running)).toContainText('Cancelled', { timeout: 15_000 });
  await expect(jobRow(page, queued)).toContainText('Cancelled');
  expect((await api.waitJob(running, ['cancelled'])).status).toBe('cancelled');
});

test('narrow list: Select mode (tap rows), More → Select all, Stop selecting; ⋯ row menu; search icon', async ({ page, api }) => {
  const u = uid();
  const ids = await seedCancelled(api, [`${u}-1.wav`, `${u}-2.wav`, `${u}-3.wav`]);
  await page.goto('/#/split');
  test.skip(!(await isNarrow(page)), 'single-line lists show checkboxes instead');
  // search opens from an icon and takes focus
  await jobsRegion(page).getByRole('button', { name: 'Search jobs' }).click();
  await expect(searchBox(page)).toBeFocused();
  await searchBox(page).fill(u);
  await expect(page).toHaveURL(new RegExp(`q=${u}`)); // debounced into the URL
  await expect(jobsRegion(page).locator('li[data-job-row]')).toHaveCount(3);

  // ⋯ shows the row's actions
  await jobRow(page, ids[0]).getByRole('button', { name: `Actions for ${u}-1.wav` }).click();
  for (const name of ['Open']) await expect(jobRow(page, ids[0]).getByRole('link', { name })).toBeVisible();
  for (const name of [`Retry ${u}-1.wav`, `Delete ${u}-1.wav`]) await expect(jobRow(page, ids[0]).getByRole('button', { name })).toBeVisible();
  await jobRow(page, ids[0]).getByRole('button', { name: `Actions for ${u}-1.wav` }).click();

  await jobsRegion(page).getByRole('button', { name: 'Select jobs' }).click();
  await expect(selectedCount(page)).toHaveText('0 selected');
  await jobRow(page, ids[1]).getByRole('button', { name: `${u}-2.wav`, exact: true }).click();
  await expect(selectedCount(page)).toHaveText('1 selected');
  await expect(page).toHaveURL(/#\/split\?q=/); // tapping a row checked it, didn't open it
  await jobsRegion(page).getByRole('button', { name: 'More bulk actions' }).click();
  await jobsRegion(page).getByRole('button', { name: 'Select all 3' }).click();
  await expect(selectedCount(page)).toHaveText('3 selected');
  await jobsRegion(page).getByRole('button', { name: 'Stop selecting' }).click();
  await expect(selectedCount(page)).toBeHidden();
  await expect(jobRow(page, ids[1]).getByRole('link').first()).toBeVisible();
});

// ---- known bugs: these assert the right behaviour and are expected to fail until fixed ----

test('shift-click extends the selection from the last box clicked, every time', async ({ page, api, isMobile }) => {
  test.skip(isMobile, 'needs a mouse and keyboard');
  const u = uid();
  await seedCancelled(api, Array.from({ length: 16 }, (_, i) => `${u}-${String(i).padStart(2, '0')}.wav`));
  await page.goto(`/#/split?q=${u}`);
  test.skip(await isNarrow(page), 'checkboxes only on single-line lists');
  const boxes = jobsRegion(page).locator('li[data-job-row]').getByRole('checkbox');
  await expect(boxes).toHaveCount(16);
  const checked = () => boxes.evaluateAll((bs) => bs.map((b, i) => (b.checked ? i : -1)).filter((i) => i >= 0));
  await boxes.nth(0).click();
  await boxes.nth(3).click({ modifiers: ['Shift'] });
  await expect.poll(checked).toEqual([0, 1, 2, 3]);
  await boxes.nth(10).click();
  await boxes.nth(12).click({ modifiers: ['Shift'] });
  await expect.poll(checked, { timeout: 2000 }).toEqual([0, 1, 2, 3, 10, 11, 12]);
  await boxes.nth(15).click({ modifiers: ['Shift'] });
  await expect.poll(checked, { timeout: 2000 }).toEqual([0, 1, 2, 3, 10, 11, 12, 13, 14, 15]);
});

test('Escape clears the selection while a row checkbox has focus', async ({ page, api }) => {
  const u = uid();
  const [id] = await seedCancelled(api, [`${u}.wav`]);
  await page.goto(`/#/split?q=${u}`);
  if (await isNarrow(page)) await jobsRegion(page).getByRole('button', { name: 'Select jobs' }).click();
  const box = jobRow(page, id).getByRole('checkbox');
  await box.focus();
  await page.keyboard.press('Space');
  await expect(selectedCount(page)).toHaveText('1 selected');
  await page.keyboard.press('Escape');
  await expect(selectedCount(page)).toBeHidden({ timeout: 2000 });
});

test('Back from a job keeps the rows Load more added to a searched list', async ({ page, api }) => {
  const u = uid();
  await seedCancelled(api, Array.from({ length: 33 }, (_, i) => `${u}-${String(i + 1).padStart(2, '0')}.wav`));
  await page.goto(`/#/split?q=${u}`);
  const rows = jobsRegion(page).locator('li[data-job-row]');
  await jobsRegion(page).getByRole('button', { name: 'Load more' }).click();
  await expect(rows).toHaveCount(33);
  await rows.nth(31).getByRole('link').first().click();
  await expect(page.getByRole('heading', { level: 1, name: `${u}-02.wav` })).toBeVisible();
  // the job page's own list (beside or below the job) has loaded
  await expect(jobsRegion(page).getByRole('link', { name: `${u}-33.wav` })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`q=${u}`));
  await expect(rows).toHaveCount(33, { timeout: 5000 });
});

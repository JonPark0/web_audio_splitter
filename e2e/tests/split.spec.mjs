import { test, expect } from '../support/fixtures.mjs';
import {
  asFile, cancelInFlight, cta, expectNoHorizontalOverflow, fileInput, isNarrow, jobRow, jobsRegion, media, rowAction,
  seedCancelled, seedJob, smallTouchTargets, splitForm, statusLine, uid,
} from './split/helpers.mjs';

// The Split section around the form and list: header and routing, the job
// page (stages, cancel, failure, Retry), and layout on every device.
// Uploads: split-upload.spec.mjs; the jobs list: split-jobs.spec.mjs.

test.afterEach(async ({ api }) => cancelInFlight(api));

const nav = (page) => page.getByRole('navigation', { name: 'Sections' });
const main = (page) => page.getByRole('main');
const jobHeading = (page, name) => page.getByRole('heading', { level: 1, name });

test.describe('header and routing', () => {
  test('sections with the current one marked; Info/GitHub from 640 px; skip link', async ({ page, browserName }) => {
    await page.goto('/#/split');
    await expect(nav(page).getByRole('link', { name: 'Split', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav(page).getByRole('link', { name: 'Library', exact: true })).not.toHaveAttribute('aria-current', 'page');
    const wide = page.viewportSize().width >= 640;
    for (const [name, href] of [['Info', /web_audio_splitter#readme$/], ['GitHub', /web_audio_splitter$/]]) {
      const link = page.getByRole('banner').getByRole('link', { name, exact: true, includeHidden: true });
      await expect(link).toBeVisible({ visible: wide });
      await expect(link).toHaveAttribute('href', href);
      await expect(link).toHaveAttribute('target', '_blank');
    }
    // the skip link is the first stop and shows when focused (WebKit's Tab skips buttons by default)
    const skip = page.getByRole('button', { name: 'Skip to content' });
    if (browserName === 'webkit') await skip.focus();
    else await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
    const box = await skip.boundingBox();
    expect(box.width).toBeGreaterThan(20);
    expect(box.y).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('Enter');
    await expect(main(page)).toBeFocused();
  });

  test('a section link resumes the last place in it; the active one goes home', async ({ page, api }) => {
    const [id] = await seedCancelled(api, [`${uid()}.wav`]);
    await page.goto(`/#/split/job/${id}`);
    await expect(main(page).getByRole('alert')).toContainText('Cancelled — ');
    await nav(page).getByRole('link', { name: 'Library', exact: true }).click();
    await expect(page).toHaveURL(/#\/library/);
    await expect(nav(page).getByRole('link', { name: 'Library', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav(page).getByRole('link', { name: 'Split', exact: true })).toHaveAttribute('href', `#/split/job/${id}`);
    await nav(page).getByRole('link', { name: 'Split', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/split/job/${id}$`));
    await expect(nav(page).getByRole('link', { name: 'Split', exact: true })).toHaveAttribute('href', '#/split');
    await nav(page).getByRole('link', { name: 'Split', exact: true }).click();
    await expect(page).toHaveURL(/#\/split$/);
    await expect(page).toHaveTitle('Split — Audio Splitter');
    // the wordmark goes to the Split home too (phones hide it while a job runs)
    await page.goto('/#/library');
    await page.getByRole('banner').getByRole('link', { name: 'Audio Splitter' }).click();
    await expect(page).toHaveURL(/#\/split$/);
  });

  test('job pages are deep links titled by their state; reload keeps them; unknown ids say so', async ({ page, api, app }) => {
    const u = uid();
    const done = await seedJob(api, media('oneshot.wav'), { name: `${u}-done.wav` });
    await api.waitJob(done);
    await page.goto(`/#/split/job/${done}`);
    await expect(jobHeading(page, `${u}-done.wav`)).toBeVisible();
    await expect(page).toHaveTitle(`${u}-done — Audio Splitter`);
    await page.reload();
    await expect(jobHeading(page, `${u}-done.wav`)).toBeVisible();

    app.setSeparationDelay(30);
    const running = await seedJob(api, media('song120.wav'), { name: `${u}-run.wav` });
    const queued = await seedJob(api, media('oneshot.wav'), { name: `${u}-wait.wav` });
    await page.goto(`/#/split/job/${queued}`);
    await expect(page).toHaveTitle(`Queued · ${u}-wait — Audio Splitter`);
    await expect(main(page).getByRole('listitem').filter({ hasText: /^01/ })).toContainText('Queued 1 ahead');
    await expect(main(page).getByText('starts after 1 more')).toBeVisible();

    await page.goto(`/#/split/job/${running}`);
    await expect(page).toHaveTitle(new RegExp(`^\\d+% · ${u}-run — Audio Splitter$`));
    const current = main(page).locator('ol li[aria-current="step"]');
    await expect(current).toContainText('Separating');
    await expect(current).toContainText('in progress');
    const elapsed = () => main(page).getByText(/^\d+ s$/).first().textContent().then((t) => parseInt(t, 10));
    const e0 = await elapsed();
    await expect.poll(elapsed, { timeout: 5000 }).toBeGreaterThan(e0);
    await expect(main(page).getByText(/^(about \d+ (s|min.*)|any moment now)$/)).toBeVisible();

    await page.goto('/#/split/job/00000000-0000-0000-0000-000000000000');
    await expect(page.getByRole('heading', { name: 'This job no longer exists' })).toBeVisible();
    await expect(page).toHaveTitle('Job not found — Audio Splitter');
    await page.getByRole('link', { name: 'Go to Jobs' }).click();
    await expect(page).toHaveURL(/#\/split$/);
    await expect(page).toHaveTitle('Split — Audio Splitter');
  });

  test('an unknown route falls back to the Split home', async ({ page }) => {
    await page.goto('/#/nonsense/route');
    await expect(splitForm(page)).toBeVisible();
    await expect(page).toHaveTitle('Split — Audio Splitter');
  });
});

test.describe('job page', () => {
  test('Cancel asks first; the cancelled job offers Retry and Delete (which asks too)', async ({ page, api, app }) => {
    app.setSeparationDelay(30);
    const name = `${uid()}.wav`;
    const id = await seedJob(api, media('oneshot.wav'), { name });
    await api.waitJob(id, ['processing']);
    await page.goto(`/#/split/job/${id}`);
    await main(page).getByRole('button', { name: 'Cancel job' }).click();
    await expect(main(page).getByText('Cancel this job? The work done on it so far is lost.')).toBeVisible();
    await expect(main(page).getByRole('button', { name: 'Cancel job' })).toBeFocused();
    await main(page).getByRole('button', { name: 'Keep running' }).click();
    await expect(main(page).getByText('Cancel this job?')).toBeHidden();
    await main(page).getByRole('button', { name: 'Cancel job' }).click();
    await main(page).getByRole('button', { name: 'Cancel job' }).click();
    await expect(main(page).getByRole('alert')).toHaveText('Cancelled — The job was stopped before it finished.', { timeout: 15_000 });
    await expect(page).toHaveTitle(`Cancelled · ${name.replace('.wav', '')} — Audio Splitter`);
    expect((await api.get(`/status/${id}`)).status).toBe('cancelled');
    await expect(main(page).getByRole('button', { name: 'Retry', exact: true })).toBeVisible();

    await main(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(main(page).getByText('Delete this job and its files? Library samples are kept.')).toBeVisible();
    await main(page).getByRole('button', { name: 'Keep', exact: true }).click();
    await expect(main(page).getByText('Delete this job and its files?')).toBeHidden();
    await main(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await main(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page).toHaveURL(/#\/split$/);
    expect((await api.raw(`/status/${id}`)).status).toBe(404);
  });

  test('a failed job shows why; Retry with another model opens the new job, which finishes', async ({ page, api, app }) => {
    const name = `${uid()}.wav`;
    app.setSeparationFails(true);
    const id = await seedJob(api, media('oneshot.wav'), { name });
    expect((await api.waitJob(id)).status).toBe('failed');
    app.setSeparationFails(false);
    await page.goto(`/#/split/job/${id}`);
    await expect(main(page).getByRole('alert')).toContainText('Failed — Separation failed:');
    await expect(page).toHaveTitle(`Failed · ${name.replace('.wav', '')} — Audio Splitter`);
    // this job is marked in the list beside / below it
    await expect(jobRow(page, id).getByRole('link', { name }).first()).toHaveAttribute('aria-current', 'page');
    await expect(jobRow(page, id)).toContainText('Error — Separation failed');

    await main(page).getByRole('button', { name: 'Retry', exact: true }).click();
    const panel = main(page).locator('form').filter({ hasText: 'Start retry' });
    await expect(panel.getByLabel('Model')).toHaveValue('htdemucs');
    await panel.getByLabel('Model').selectOption('htdemucs_6s');
    await panel.getByRole('button', { name: 'Start retry' }).click();
    await expect(page).not.toHaveURL(new RegExp(id));
    const retry = page.url().split('/job/')[1];
    const s = await api.waitJob(retry);
    expect([s.status, s.model]).toEqual(['completed', 'htdemucs_6s']);
    // the page turns into the stems screen by itself
    await expect(main(page).getByRole('button', { name: 'Mute guitar' })).toBeVisible({ timeout: 15_000 });
    expect((await api.get(`/result/${retry}`)).tracks).toHaveLength(6);
    await main(page).getByRole('link', { name: '← Jobs' }).click();
    await expect(page).toHaveURL(/#\/split$/);
  });

  test('a failed restoration says why in a line, not a traceback', async ({ page, api }) => {
    // the recovery models aren't installed here: the restore subprocess fails
    const id = await seedJob(api, media('oneshot.wav'), { name: `${uid()}.wav`, recover: true });
    const { status, error } = await api.waitJob(id);
    expect(status).toBe('failed');
    expect(error).toMatch(/^Recovery failed/);
    expect(error).not.toContain('Traceback');
    expect(error.length).toBeLessThan(400);
    await page.goto(`/#/split/job/${id}`);
    await expect(main(page).getByRole('alert')).toHaveText(`Failed — ${error}`);
  });

  test('"← Jobs" goes back to the list', async ({ page, api }) => {
    const [id] = await seedCancelled(api, [`${uid()}.wav`]);
    await page.goto(`/#/split/job/${id}`);
    await main(page).getByRole('link', { name: '← Jobs' }).click();
    await expect(page).toHaveURL(/#\/split$/);
    await expect(splitForm(page)).toBeVisible();
  });
});

test.describe('layout', () => {
  test('no sideways scroll on the Split home and job pages; the header stays; touch targets ≥ 44 px', async ({ page, api, app, hasTouch }) => {
    const u = uid();
    const long = `${u} Ultra long name – Ünïcode 한글 파일 이름 and_an_unbroken_token_without_spaces_abcdefghijklmnopqrstuvwxyz0123456789.wav`;
    const done = await seedJob(api, media('oneshot.wav'), { name: `${u}-done.wav` });
    await api.waitJob(done);
    const [cancelled] = await seedCancelled(api, [`${u}-cancelled.wav`]);
    app.setSeparationDelay(30);
    const running = await seedJob(api, media('oneshot.wav'), { name: long });

    await page.goto('/#/split');
    await expect(jobRow(page, running)).toContainText('Separating');
    await expectNoHorizontalOverflow(page);
    if (hasTouch) {
      for (const [where, root] of [['header', page.getByRole('banner')], ['form', splitForm(page)], ['jobs', jobsRegion(page)]]) {
        expect(await smallTouchTargets(root, { skipStretchless: true }), `${where}: controls under 44 px`).toEqual([]);
      }
    }
    // the header stays on top while the page scrolls
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expectNoHorizontalOverflow(page);
    const header = await page.getByRole('banner').boundingBox();
    expect(Math.round(header.y)).toBe(0);
    expect(Math.round(header.height)).toBe(48);

    for (const id of [running, cancelled, done]) {
      await page.goto(`/#/split/job/${id}`);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      if (id === done) await expect(main(page).getByRole('button', { name: 'Mute vocals' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (hasTouch && id !== done) {
        const column = main(page)
          .locator('div', { has: page.getByRole('link', { name: '← Jobs' }) })
          .filter({ has: page.getByRole('button', { name: /^(Cancel job|Retry)$/ }) })
          .last();
        expect(await smallTouchTargets(column), 'job page controls under 44 px').toEqual([]);
      }
    }
  });

  test('phone: the bottom bar holds the CTA and status and never covers the last row', async ({ page, api }) => {
    test.skip(page.viewportSize().width >= 640, 'the CTA is inline from 640 px');
    const u = uid();
    await seedCancelled(api, Array.from({ length: 6 }, (_, i) => `${u}-${i}.wav`));
    await page.goto('/#/split');
    const vh = page.viewportSize().height;
    const box = await cta(page).boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(vh);
    expect(box.y).toBeGreaterThan(vh - 120);
    await fileInput(page).setInputFiles(asFile(media('oneshot.wav'), `${u}-new.wav`));
    await cta(page).click();
    await expect(statusLine(page)).toContainText(`Queued “${u}-new.wav”`);
    // Open sits beside the status, outside its two-line clamp
    const open = splitForm(page).getByRole('link', { name: 'Open' }).filter({ visible: true });
    const openBox = await open.last().boundingBox();
    expect(openBox.y).toBeGreaterThan(vh - 120);
    expect(openBox.height).toBeGreaterThanOrEqual(44);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    // the last row's bottom edge vs the fixed bar's top edge, once scrolled to the end
    const overlap = () =>
      page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        const rows = document.querySelectorAll('li[data-job-row]');
        let bar = document.querySelector('form button[type=submit]');
        while (bar && getComputedStyle(bar).position !== 'fixed') bar = bar.parentElement;
        return rows[rows.length - 1].getBoundingClientRect().bottom - bar.getBoundingClientRect().top;
      });
    await expect.poll(overlap, { message: 'last row under the bottom bar' }).toBeLessThanOrEqual(1);
  });

  test('a short landscape screen keeps the CTA and Cancel within reach while uploading', async ({ page }) => {
    test.skip(page.viewportSize().height > 500, 'landscape phones only');
    let release;
    const held = new Promise((r) => (release = r));
    await page.route('**/api/uploads/*', async (route) => {
      await held;
      await route.continue().catch(() => {});
    });
    await page.goto('/#/split');
    const u = uid();
    await fileInput(page).setInputFiles(['a', 'b', 'c', 'd', 'e'].map((x) => asFile(media('oneshot.wav'), `${u}-${x}.wav`)));
    const vh = page.viewportSize().height;
    const box = await cta(page).boundingBox();
    expect(box.y + box.height, 'CTA below the first screen').toBeLessThanOrEqual(vh);
    await cta(page).click();
    const cancel = splitForm(page).getByRole('button', { name: /^Cancel( upload)?$/ }).filter({ visible: true });
    const cbox = await cancel.boundingBox();
    expect(cbox.y + cbox.height).toBeLessThanOrEqual(vh);
    expect(cbox.height).toBeGreaterThanOrEqual(44);
    await cancel.click();
    release();
    await expect(cta(page)).toHaveText('Split 5 files');
    await expectNoHorizontalOverflow(page);
  });

  test('keyboard focus moving through the list never hides under the sticky toolbar', async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'keyboard walk on desktop profiles');
    const u = uid();
    await seedCancelled(api, Array.from({ length: 14 }, (_, i) => `${u}-${i}.wav`));
    await page.goto(`/#/split?q=${u}`);
    await expect(jobsRegion(page).locator('li[data-job-row]')).toHaveCount(14);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await jobsRegion(page).locator('li[data-job-row]').last().getByRole('link').first().focus();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Shift+Tab');
      const r = await page.evaluate(() => {
        const el = document.activeElement;
        const bar = document.getElementById('jobs-heading').parentElement.getBoundingClientRect();
        return { inRow: !!el.closest('li[data-job-row]'), top: el.getBoundingClientRect().top, bar: bar.bottom, name: el.getAttribute('aria-label') || el.textContent };
      });
      if (!r.inRow) break;
      // a row the toolbar covers is lifted out on the next frame
      await expect
        .poll(() => page.evaluate(() => document.activeElement.getBoundingClientRect().top), { message: `"${r.name}" under the toolbar` })
        .toBeGreaterThanOrEqual(r.bar - 1);
    }
  });
});

// ---- known bugs: these assert the right behaviour and are expected to fail until fixed ----

test('opening a finished job moves focus to its heading', async ({ page, api }) => {
  const name = `${uid()}.wav`;
  const id = await seedJob(api, media('oneshot.wav'), { name });
  await api.waitJob(id);
  // a realistic round trip for /status (on a quick local server it can beat the first frame)
  await page.route('**/api/status/*', async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    await route.continue();
  });
  await page.goto(`/#/split?q=${name}`);
  await jobRow(page, id).getByRole('link').first().click();
  await expect(jobHeading(page, name)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName), { timeout: 3000 }).toMatch(/^H[12]$/);
});

test('leaving a job page for another section titles the page after that section', async ({ page, api }) => {
  const [id] = await seedCancelled(api, [`${uid()}.wav`]);
  await page.goto(`/#/split/job/${id}`);
  await expect(main(page).getByRole('alert')).toContainText('Cancelled — ');
  await nav(page).getByRole('link', { name: 'Library', exact: true }).click();
  // the Library has loaded (its phone layout has no "Library" heading)
  await expect(page.getByRole('searchbox', { name: 'Search samples' })).toBeVisible();
  await expect(page).toHaveTitle('Library — Audio Splitter', { timeout: 2000 });
});

test('deleting the open job from the jobs list leaves its page', async ({ page, api }) => {
  const [id] = await seedCancelled(api, [`${uid()}.wav`]);
  await page.goto(`/#/split/job/${id}`);
  const alert = main(page).getByRole('alert').filter({ hasText: 'Cancelled — ' });
  await expect(alert).toBeVisible();
  await rowAction(page, id, 'Delete');
  await jobRow(page, id).getByRole('group', { name: 'Confirm delete' }).getByRole('button', { name: 'Delete' }).click();
  await expect(jobRow(page, id)).toHaveCount(0);
  await expect(alert).toBeHidden({ timeout: 8000 });
});

test('job names in single-line rows are 44 px touch targets', async ({ page, api, hasTouch }) => {
  test.skip(!hasTouch, 'touch only');
  const name = `${uid()}.wav`;
  const [id] = await seedCancelled(api, [name]);
  await page.goto('/#/split');
  test.skip(await isNarrow(page), 'two-line rows stretch the name link over the whole row');
  const link = jobRow(page, id).getByRole('link', { name, exact: true });
  const box = await link.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
});

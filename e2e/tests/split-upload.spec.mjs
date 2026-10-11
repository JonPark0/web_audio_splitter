import { test, expect } from '../support/fixtures.mjs';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  asFile, bigWav, cancelInFlight, cancelUpload, cta, dropFiles, fileInput, fileRow, filesList, jobRow, mbText, md5,
  media, queuedId, seedJob, splitForm, statusLine, uid,
} from './split/helpers.mjs';

// The Split home's "New split" form: files (pick, drop, several, every
// model, rejections, size limit, resumable chunks, offline, Retry) and the
// YouTube link path (no YouTube in tests: the error paths only).

test.afterEach(async ({ api }) => cancelInFlight(api));

const SEPARATION_MODELS = ['bs_roformer', 'htdemucs', 'htdemucs_ft', 'htdemucs_6s', 'hdemucs_mmi', 'mdx', 'mdx_extra', 'mdx_q', 'mdx_extra_q', 'SIG'];
const uploadedFile = (app, id) => path.join(app.mediaDir, 'media', 'uploads', `${id}.wav`);

test('one file: pick it, Split, it is queued, listed and finishes with four stems', async ({ page, api }) => {
  const name = `${uid()}.mp3`;
  await page.goto('/#/split');
  await expect(statusLine(page)).toHaveText('Add audio files first');
  await expect(cta(page)).toBeDisabled();
  await fileInput(page).setInputFiles(asFile(media('song120.mp3'), name));
  await expect(fileRow(page, name)).toContainText(/\d\.\d MB/);
  await expect(statusLine(page)).toHaveText('1 file ready');
  await expect(cta(page)).toHaveText('Split');
  await cta(page).click();
  await expect(statusLine(page)).toContainText(`Queued “${name}”`);
  const id = await queuedId(page, name);
  await expect(jobRow(page, id)).toContainText(name);
  await expect(jobRow(page, id)).toContainText('Done', { timeout: 30_000 });
  const result = await api.get(`/result/${id}`);
  expect(result.tracks).toEqual(['bass.wav', 'drums.wav', 'other.wav', 'vocals.wav']);
});

test('several files (audio and video) upload in the order picked, one job each', async ({ page, api }) => {
  const u = uid();
  const names = [`${u}-a.mp3`, `${u}-b.mp4`, `${u}-c.wav`];
  await page.goto('/#/split');
  await fileInput(page).setInputFiles([
    asFile(media('song120.mp3'), names[0]),
    asFile(media('clip.mp4'), names[1]),
    asFile(media('loop100.wav'), names[2]),
  ]);
  await expect(filesList(page).getByRole('listitem')).toHaveText(names.map((n) => new RegExp(n)));
  await expect(cta(page)).toHaveText('Split 3 files');
  await cta(page).click();
  await expect(statusLine(page)).toHaveText('3 jobs queued.');
  await expect(filesList(page).getByRole('link', { name: 'Open' })).toHaveCount(3);
  const { tasks } = await api.get(`/tasks?q=${u}`);
  expect(tasks.map((t) => t.name)).toEqual([...names].reverse()); // newest first
  const video = tasks.find((t) => t.name === names[1]).task_id;
  expect((await api.waitJob(video)).status).toBe('completed');
  expect((await api.get(`/result/${video}`)).tracks).toHaveLength(4);
});

test('every separation model can be picked; BS-Roformer and htdemucs_6s give their six stems', async ({ page, api, app }) => {
  test.slow();
  app.setSeparationDelay(0);
  const u = uid();
  await page.goto('/#/split');
  const select = splitForm(page).getByLabel('Model');
  expect(await select.locator('option').evaluateAll((os) => os.map((o) => o.value))).toEqual(SEPARATION_MODELS);
  const ids = {};
  for (const model of SEPARATION_MODELS) {
    const name = `${u}-${model}.wav`;
    await select.selectOption(model);
    await fileInput(page).setInputFiles(asFile(media('oneshot.wav'), name));
    await cta(page).click();
    await expect(statusLine(page)).toContainText(`Queued “${name}”`);
    ids[model] = await queuedId(page, name);
    await expect(jobRow(page, ids[model])).toContainText(model);
  }
  for (const model of SEPARATION_MODELS) {
    const s = await api.waitJob(ids[model]);
    expect(s.status, `${model}: ${s.error}`).toBe('completed');
    const { tracks, derived_tracks: derived } = await api.get(`/result/${ids[model]}`);
    if (model === 'bs_roformer') {
      expect(tracks).toEqual(['bass.wav', 'drums.wav', 'guitar.wav', 'instrumental.wav', 'other.wav', 'piano.wav', 'vocals.wav']);
      expect(derived).toEqual(['instrumental.wav']);
    } else if (model === 'htdemucs_6s') {
      expect(tracks).toEqual(['bass.wav', 'drums.wav', 'guitar.wav', 'other.wav', 'piano.wav', 'vocals.wav']);
    } else {
      expect(tracks, model).toEqual(['bass.wav', 'drums.wav', 'other.wav', 'vocals.wav']);
    }
  }
});

test('Restore On sends the chosen restorer with the job; settings are remembered', async ({ page, api, app }) => {
  app.setSeparationDelay(30); // the recovery models aren't installed: never let it reach them
  const name = `${uid()}.wav`;
  await page.goto('/#/split');
  const form = splitForm(page);
  await form.getByLabel('Model').selectOption('htdemucs_6s');
  await form.getByRole('radiogroup', { name: 'Restore' }).getByText('On').click();
  const restorer = form.getByRole('radiogroup', { name: 'Restorer' });
  await expect(restorer.getByRole('radio', { name: 'Apollo' })).toBeChecked();
  await restorer.getByText('FlashSR').click();
  await fileInput(page).setInputFiles(asFile(media('oneshot.wav'), name));
  await cta(page).click();
  await expect(statusLine(page)).toContainText(`Queued “${name}”`);
  const id = await queuedId(page, name);
  await expect(jobRow(page, id)).toContainText('htdemucs_6s + flashsr');
  const s = await api.get(`/status/${id}`);
  expect([s.model, s.recover, s.recovery_model]).toEqual(['htdemucs_6s', true, 'flashsr']);

  await page.reload();
  await expect(form.getByLabel('Model')).toHaveValue('htdemucs_6s');
  await expect(form.getByRole('radiogroup', { name: 'Restore' }).getByRole('radio', { name: 'On' })).toBeChecked();
  await expect(form.getByRole('radiogroup', { name: 'Restorer' }).getByRole('radio', { name: 'FlashSR' })).toBeChecked();
});

test('upload in progress: byte progress, files added join the batch, leave warning, Cancel upload', async ({ page, api, hasTouch }) => {
  const big = bigWav();
  const total = mbText(statSync(big).size);
  const late = `${uid()}-late.wav`;
  const before = (await api.get('/tasks?q=split-big')).tasks.length;
  const requests = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/uploads')) requests.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  // hold the second chunk so the upload stays in progress
  let puts = 0;
  let release;
  const held = new Promise((r) => (release = r));
  await page.route('**/api/uploads/*', async (route) => {
    if (route.request().method() === 'PUT' && ++puts === 2) await held;
    await route.continue().catch(() => {}); // cancelled meanwhile
  });

  await page.goto('/#/split');
  await fileInput(page).setInputFiles(big);
  await cta(page).click();
  await expect(statusLine(page)).toContainText(new RegExp(`\\d+\\.\\d / ${total} MB( · [\\d.]+ MB/s)? · ${path.basename(big)}`));
  await expect.poll(() => puts).toBe(2);
  await expect(statusLine(page)).toContainText(new RegExp(`(8|9|1\\d)\\.\\d / ${total} MB`));
  const bar = splitForm(page).getByRole('progressbar', { name: `Uploading ${path.basename(big)}` });
  expect(Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  await expect(cta(page)).toHaveText('Uploading...');
  await expect(cta(page)).toBeDisabled();
  await expect(splitForm(page).getByLabel('Model')).toBeDisabled();
  // the phone/tablet hint to keep the screen on, only on touch
  await expect(page.getByText('Keep this screen on until the upload finishes.')).toBeVisible({ visible: !!hasTouch });

  await fileInput(page).setInputFiles(asFile(media('oneshot.wav'), late));
  await expect(fileRow(page, late)).toContainText('Waiting');
  await expect(statusLine(page)).toContainText(/^1\/2 · /);

  const warned = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(warned, 'leaving mid-upload asks first').toBe(true);

  await cancelUpload(page).click();
  release();
  await expect(cta(page)).toHaveText('Split 2 files');
  await expect(cta(page)).toBeEnabled();
  await expect(statusLine(page)).toHaveText('2 files ready');
  await expect(fileRow(page, late).getByRole('button', { name: `Remove ${late}` })).toBeVisible();
  await expect(splitForm(page).getByLabel('Model')).toBeEnabled();
  const uploadId = requests.find((r) => r.startsWith('PUT'))?.split('/').pop();
  await expect.poll(() => requests).toContain(`DELETE /api/uploads/${uploadId}`);
  await expect.poll(async () => (await api.raw(`/uploads/${uploadId}`)).status).toBe(404);
  expect((await api.get('/tasks?q=split-big')).tasks.length, 'no job from a cancelled upload').toBe(before);

  await fileRow(page, late).getByRole('button', { name: `Remove ${late}` }).click();
  await fileRow(page, path.basename(big)).getByRole('button', { name: /^Remove / }).click();
  await expect(filesList(page)).toHaveCount(0);
  await expect(statusLine(page)).toHaveText('Add audio files first');
});

test('resumable upload: an aborted chunk is resent from where the server got to', async ({ page, app }) => {
  const big = bigWav();
  const requests = [];
  let puts = 0;
  await page.route('**/api/uploads/**', async (route) => {
    const r = route.request();
    requests.push(r.method());
    if (r.method() === 'PUT' && ++puts === 2) return route.abort('connectionreset');
    return route.continue();
  });
  await page.goto('/#/split');
  await fileInput(page).setInputFiles(big);
  await cta(page).click();
  await expect(statusLine(page)).toContainText('Queued', { timeout: 40_000 });
  const id = await queuedId(page, path.basename(big));
  expect(requests, 'asked the server where it got to').toContain('GET');
  expect(md5(uploadedFile(app, id)), 'server copy is the file').toBe(md5(big));
});

test('resumable upload: a chunk whose answer was lost is not sent twice', async ({ page, app }) => {
  const big = bigWav();
  const log = [];
  let puts = 0;
  await page.route('**/api/uploads/**', async (route) => {
    const r = route.request();
    if (r.method() === 'PUT' && ++puts === 2) {
      const res = await route.fetch(); // the server gets the chunk...
      log.push(`lost ${res.status()}`);
      return route.abort('connectionreset'); // ...the browser never hears back
    }
    log.push(r.method());
    return route.continue();
  });
  await page.goto('/#/split');
  await fileInput(page).setInputFiles(big);
  await cta(page).click();
  await expect(statusLine(page)).toContainText('Queued', { timeout: 40_000 });
  const id = await queuedId(page, path.basename(big));
  expect(log).toContain('lost 200');
  expect(log.slice(log.indexOf('lost 200') + 1)[0], 'asks the offset before going on').toBe('GET');
  expect(statSync(uploadedFile(app, id)).size).toBe(statSync(big).size);
  expect(md5(uploadedFile(app, id))).toBe(md5(big));
});

test('offline mid-upload: the row pauses with Retry, and the upload resumes once back online', async ({ page, context, app }) => {
  const big = bigWav();
  const name = path.basename(big);
  let puts = 0;
  let release;
  const held = new Promise((r) => (release = r));
  await page.route('**/api/uploads/*', async (route) => {
    if (route.request().method() === 'PUT' && ++puts === 2) {
      await held;
      return route.abort('internetdisconnected');
    }
    return route.continue();
  });
  await page.goto('/#/split');
  await fileInput(page).setInputFiles(big);
  await cta(page).click();
  await expect.poll(() => puts).toBe(2);
  await context.setOffline(true);
  release();
  await expect(statusLine(page)).toContainText(/^Paused · /);
  await expect(fileRow(page, name)).toContainText('Upload paused — ');
  await expect(fileRow(page, name).getByRole('button', { name: `Retry ${name} now` })).toBeVisible();
  await context.setOffline(false);
  // resumes on the browser's "online" event (or the 30 s retry)
  await expect(statusLine(page)).toContainText('Queued', { timeout: 45_000 });
  const id = await queuedId(page, name);
  expect(md5(uploadedFile(app, id))).toBe(md5(big));
});

test('a failed upload row offers Retry, which uploads it again', async ({ page }) => {
  const name = `${uid()}.mp3`;
  // an older server without chunked uploads, and a dropped connection
  await page.route('**/api/uploads', (route) => route.fulfill({ status: 404, json: { detail: 'Not Found' } }));
  await page.route('**/api/upload', (route) => route.abort('connectionreset'));
  await page.goto('/#/split');
  await fileInput(page).setInputFiles(asFile(media('song120.mp3'), name));
  await cta(page).click();
  await expect(fileRow(page, name)).toContainText('Failed — The upload was interrupted.');
  await page.unroute('**/api/upload');
  await fileRow(page, name).getByRole('button', { name: `Retry ${name}` }).click();
  await expect(statusLine(page)).toContainText(`Queued “${name}”`);
});

test('refused files: not audio (skipped), garbage and over 30 minutes (server errors), batch summary', async ({ page, api }) => {
  const u = uid();
  await page.goto('/#/split');
  const notes = { name: `${u}.txt`, mimeType: 'text/plain', buffer: Buffer.from('hello') };
  await fileInput(page).setInputFiles([notes, asFile(media('oneshot.wav'), `${u}-ok.wav`)]);
  await expect(statusLine(page)).toHaveText(`Error — Skipped a file that isn’t audio or video: ${u}.txt`);
  await expect(filesList(page).getByRole('listitem')).toHaveCount(1);
  await fileRow(page, `${u}-ok.wav`).getByRole('button', { name: /^Remove / }).click();

  await fileInput(page).setInputFiles([asFile(media('not-audio.mp3'), `${u}-garbage.mp3`), asFile(media('too-long.mp3'), `${u}-long.mp3`)]);
  await cta(page).click();
  await expect(fileRow(page, `${u}-garbage.mp3`)).toContainText('Failed — Unsupported or unreadable audio file');
  await expect(fileRow(page, `${u}-long.mp3`)).toContainText('Failed — Audio exceeds maximum duration (30 minutes)', { timeout: 30_000 });
  // not retryable: only Remove
  await expect(fileRow(page, `${u}-garbage.mp3`).getByRole('button', { name: /^Retry/ })).toHaveCount(0);
  expect((await api.get(`/tasks?q=${u}`)).tasks).toHaveLength(0);

  for (const n of [`${u}-garbage.mp3`, `${u}-long.mp3`]) await fileRow(page, n).getByRole('button', { name: `Remove ${n}` }).click();
  await fileInput(page).setInputFiles([
    asFile(media('oneshot.wav'), `${u}-1.wav`),
    asFile(media('not-audio.mp3'), `${u}-2.mp3`),
    asFile(media('song120.mp3'), `${u}-3.mp3`),
  ]);
  await cta(page).click();
  await expect(statusLine(page)).toHaveText('2 jobs queued, 1 failed.');
});

test('a file over the server limit (GET /limits) is refused before it is sent', async ({ page }) => {
  const u = uid();
  let sent = false;
  page.on('request', (r) => {
    if (r.url().includes('/api/uploads')) sent = true;
  });
  await page.route('**/api/limits', (route) => route.fulfill({ json: { max_upload_mb: 1, max_duration_seconds: 1800 } }));
  await page.goto('/#/split');
  await fileInput(page).setInputFiles([asFile(media('song120.wav'), `${u}-big.wav`), asFile(media('oneshot.wav'), `${u}-small.wav`)]);
  await expect(statusLine(page)).toHaveText(`Error — Skipped a file over the 1 MB limit: ${u}-big.wav`);
  await expect(filesList(page).getByRole('listitem')).toHaveText([new RegExp(`${u}-small.wav`)]);
  expect(sent).toBe(false);
});

test('files dropped on the Split home join the list; non-audio is reported', async ({ page }) => {
  const u = uid();
  await page.goto('/#/split');
  await expect(splitForm(page)).toBeVisible();
  const r = await dropFiles(page, [
    { file: media('oneshot.wav'), name: `${u}-a.wav` },
    { file: media('clip.mp4'), name: `${u}-b.mp4` },
    { file: media('oneshot.wav'), name: `${u}.txt` },
  ]);
  expect(r).toEqual({ wash: true, handled: true });
  await expect(page.getByText('Drop to add audio files')).toBeHidden();
  await expect(filesList(page).getByRole('listitem')).toHaveText([new RegExp(`${u}-a.wav`), new RegExp(`${u}-b.mp4`)]);
  await expect(statusLine(page)).toHaveText(`Error — Skipped a file that isn’t audio or video: ${u}.txt`);
  await expect(cta(page)).toHaveText('Split 2 files');
});

test('files dropped on a job page open the Split home with them listed', async ({ page, api }) => {
  const u = uid();
  const id = await api.completedJob(media('oneshot.wav'));
  await page.goto(`/#/split/job/${id}`);
  // the finished job's stems screen, not the placeholder it replaces
  await expect(page.locator('[data-lane]').first()).toBeVisible();
  const r = await dropFiles(page, [
    { file: media('song120.mp3'), name: `${u}.mp3` },
    { file: media('oneshot.wav'), name: `${u}.txt` },
  ]);
  expect(r).toEqual({ wash: true, handled: true });
  await expect(page).toHaveURL(/#\/split$/);
  await expect(filesList(page).getByRole('listitem')).toHaveText([new RegExp(`${u}.mp3`)]);
  await expect(statusLine(page)).toHaveText(`Error — Skipped a file that isn’t audio or video: ${u}.txt`);
  await cta(page).click();
  await expect(statusLine(page)).toContainText(`Queued “${u}.mp3”`);
});

test.describe('YouTube link', () => {
  const youtube = (page) => splitForm(page).getByRole('radiogroup', { name: 'Source' }).getByText('YouTube');
  const link = (page) => splitForm(page).getByLabel('Link', { exact: true });

  test('the CTA follows the link and "After download"; a bad link shows the server error', async ({ page, api }) => {
    await page.goto('/#/split');
    await youtube(page).click();
    await expect(cta(page)).toHaveText('Download & split');
    await expect(cta(page)).toBeDisabled();
    const after = splitForm(page).getByRole('radiogroup', { name: 'After download' });
    await after.getByText('Review first').click();
    await expect(cta(page)).toHaveText('Download');
    await after.getByText('Split').click();
    await link(page).fill('   ');
    await expect(cta(page)).toBeDisabled();
    const before = (await api.get('/tasks')).tasks.length;
    await link(page).fill('not a url');
    await cta(page).click();
    await expect(statusLine(page)).toHaveText('Error — Invalid YouTube URL or video unavailable');
    await expect(link(page)).toHaveValue('not a url');
    expect((await api.get('/tasks')).tasks.length, 'no job for a refused link').toBe(before);
    // switching source clears the error; the source is remembered
    await splitForm(page).getByRole('radiogroup', { name: 'Source' }).getByText('File').click();
    await expect(statusLine(page)).toHaveText('Add audio files first');
    await youtube(page).click();
    await page.reload();
    await expect(link(page)).toBeVisible();
  });

  test('Enter (Go) submits; the form is busy while the link is checked', async ({ page }) => {
    await page.route('**/api/youtube/info', async (route) => {
      await new Promise((r) => setTimeout(r, 700));
      await route.continue();
    });
    await page.goto('/#/split');
    await youtube(page).click();
    await expect(link(page)).toHaveAttribute('enterkeyhint', 'go');
    await link(page).fill('https://example.invalid/watch?v=x');
    await link(page).press('Enter');
    await expect(cta(page)).toHaveText('Fetching...');
    await expect(link(page)).toBeDisabled();
    await expect(statusLine(page)).toHaveText('Checking the link...');
    await expect(statusLine(page)).toHaveText('Error — Invalid YouTube URL or video unavailable', { timeout: 30_000 });
    await expect(link(page)).toBeEnabled();
    if (page.viewportSize().width < 640) {
      // phones: the error sits in the bottom bar and the keyboard is put away
      await expect(link(page)).not.toBeFocused();
    }
  });

  test('a download that fails shows on its job page with "Try another link" (no Retry)', async ({ page, api }) => {
    // the link check passes; the download itself then fails on the server
    await page.route('**/api/youtube/info', (route) =>
      route.fulfill({ json: { video_id: 'x', title: 'Test video', thumbnail: '', duration: 30, duration_formatted: '0:30' } })
    );
    await page.goto('/#/split');
    await youtube(page).click();
    await link(page).fill('https://example.invalid/watch?v=nothing');
    await cta(page).click();
    await expect(statusLine(page)).toContainText('Downloading “Test video”');
    await expect(link(page)).toHaveValue('');
    await splitForm(page).getByRole('link', { name: 'Open' }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/#\/split\/job\//);
    const id = page.url().split('/job/')[1];
    await api.waitJob(id, ['download_failed', 'downloaded', 'queued'], 60_000);
    await expect(page.getByRole('alert').filter({ hasText: /^Failed — / })).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveTitle(/^Failed · /);
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Try another link' })).toBeVisible();
    await expect(jobRow(page, id)).toContainText('Download failed');
    await expect(main.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
    await main.getByRole('link', { name: 'Try another link' }).click();
    await expect(page).toHaveURL(/#\/split$/);
  });
});

// ---- known bugs: these assert the right behaviour and are expected to fail until fixed ----

test('the status line reports a file the server refused', async ({ page }) => {
  const u = uid();
  await page.goto('/#/split');
  await fileInput(page).setInputFiles(asFile(media('not-audio.mp3'), `${u}.mp3`));
  await cta(page).click();
  await expect(fileRow(page, `${u}.mp3`)).toContainText('Failed — ');
  // on phones this line is the bottom bar, where the outcome is watched
  await expect(statusLine(page)).toContainText(/fail|unsupported|refused|could not/i, { timeout: 3000 });
});

test('focus stays in the YouTube link field after a refused link', async ({ page, browserName }) => {
  test.skip(page.viewportSize().width < 640, 'phones put the keyboard away on purpose');
  test.skip(browserName === 'firefox', 'unverified: Firefox may keep focus on a disabled field');
  test.fail(true, 'The link field is disabled while checking, so focus drops to <body> and is never put back — frontend/src/components/UploadScreen.jsx:429 (and :211-213)');
  await page.goto('/#/split');
  await splitForm(page).getByRole('radiogroup', { name: 'Source' }).getByText('YouTube').click();
  const link = splitForm(page).getByLabel('Link', { exact: true });
  await link.fill('not a url');
  await link.press('Enter');
  await expect(statusLine(page)).toHaveText('Error — Invalid YouTube URL or video unavailable');
  await expect(link).toBeFocused({ timeout: 2000 });
});

test.describe('file system checks', () => {
  test('a refused upload leaves no partial file on the server', async ({ page, app }) => {
    const u = uid();
    await page.goto('/#/split');
    await fileInput(page).setInputFiles(asFile(media('not-audio.mp3'), `${u}.mp3`));
    await cta(page).click();
    await expect(fileRow(page, `${u}.mp3`)).toContainText('Failed — ');
    const partial = path.join(app.mediaDir, 'media', 'uploads', 'partial');
    if (existsSync(partial)) {
      const open = readdirSync(partial).filter((f) => f.endsWith('.part') || (f.endsWith('.json') && !JSON.parse(readFileSync(path.join(partial, f), 'utf8')).task_id));
      expect(open).toEqual([]);
    }
  });
});

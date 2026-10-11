import { touch } from '../support/touch.mjs';
import { test, expect, hasCDP, layout, scrollY, pageScale, centerOf, contextMenuAt, gestures } from './touch/helpers.mjs';
import { readout, timeNow, noHorizontalOverflow } from './result/helpers.mjs';

// Fingers on the job result screen, beyond what result*.spec.mjs covers
// (pinch, swipes on the lanes, marker taps, handle drags): touch cancel and
// a palm during a selection drag, rotation mid-drag, sliders under a scroll,
// the phone sheets' focus and scroll lock.

test.skip(({ isMobile }) => !isMobile, 'touch layouts');

const cdpOnly = (browserName) => test.skip(!hasCDP(browserName), 'finger gestures through CDP');
const laneOf = (page, track) => page.locator(`[data-ready] [data-lane="${track}"]`).first();
const strip = (page) =>
  page.locator('[data-ready] [data-grab]').first().evaluate((el) => ({ left: Math.round(parseFloat(el.style.left)), width: Math.round(parseFloat(el.style.width)) }));

async function openMany(page, world) {
  const w = await world.get();
  await page.goto(`/#/split/job/${w.many}`);
  await expect(page.locator('[data-ready="true"]')).toBeAttached({ timeout: 30_000 });
  return layout(page);
}

/** Tap the saved sample's marker on vocals: a selection with handles and a grab strip. */
async function selectMarker(page) {
  const m = await centerOf(laneOf(page, 'vocals.wav').locator('[data-marker]').first());
  await page.touchscreen.tap(m.x + 12, m.y + m.height - 8);
  await expect(laneOf(page, 'vocals.wav').locator('[data-handle]')).toHaveCount(2);
  await laneOf(page, 'vocals.wav').evaluate((el) => el.scrollIntoView({ block: 'center' }));
}

async function openExtract(page, L) {
  if (L.size === 'phone') {
    await page.getByRole('button', { name: 'drums: extract, download, spectrogram, level' }).click();
    await page.getByRole('dialog', { name: 'drums' }).getByRole('button', { name: 'Extract a sample' }).click();
    const sheet = page.getByRole('dialog', { name: 'Extract · drums' });
    await expect(sheet).toBeVisible();
    return { scope: sheet, laneEl: sheet.locator('[data-lane]') };
  }
  await page.locator('[data-ready] > div').filter({ has: page.locator('[data-lane="drums.wav"]') }).getByRole('button', { name: 'Extract', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Extract a sample' });
  await expect(panel).toBeVisible();
  return { scope: panel, laneEl: laneOf(page, 'drums.wav') };
}

test('the Start field keeps focus when tapped after Set end, and takes a comma decimal', async ({ page, world }) => {
  const L = await openMany(page, world);
  test.fail(L.size === 'phone', "phone extract sheet: focusing a time field re-renders the mixer, whose new inline onClose re-runs the sheet's focus effect and moves focus to its Close button - result/Sheet.jsx:13-27, Mixer.jsx:732");
  const { scope, laneEl } = await openExtract(page, L);
  const tapLane = async (f) => {
    const b = await centerOf(laneEl);
    await page.touchscreen.tap(b.x + b.width * f, b.y + b.height * 0.3);
  };
  await tapLane(0.3);
  await scope.getByRole('button', { name: 'Set start' }).click();
  await tapLane(0.6);
  await scope.getByRole('button', { name: 'Set end' }).click();
  const start = scope.getByRole('textbox', { name: 'Start (m:ss.mmm)' });
  // clear of the sheet's sticky waveform (landscape phones have ~110 px below it)
  await start.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  const b = await start.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await expect(start).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('0:03,25');
  await page.keyboard.press('Enter');
  await expect(start).toHaveValue('0:03.250');
});

test('touch cancel during a handle drag puts the selection back', async ({ page, world, browserName }) => {
  cdpOnly(browserName);
  test.fail(true, 'pointercancel commits the half-dragged edge instead of restoring it - useLaneGestures.js:204-210');
  await openMany(page, world);
  await selectMarker(page);
  const before = await strip(page);
  const h = await laneOf(page, 'vocals.wav').locator('[data-handle="end"]').boundingBox();
  const g = gestures(await touch(page));
  const y = h.y + h.height - 10;
  await g.down({ x: h.x + h.width / 2, y });
  await g.to({ x: h.x + h.width / 2 + 40, y });
  await expect.poll(() => strip(page).then((s) => s.width)).toBeGreaterThan(before.width + 20);
  await g.cancel();
  await expect.poll(() => strip(page)).toEqual(before);
});

test('a palm on the controls beside the lanes mid-drag neither hijacks the selection move nor zooms the page', async ({ page, world, browserName }) => {
  cdpOnly(browserName);
  await openMany(page, world);
  await selectMarker(page);
  const before = await strip(page);
  const gb = await laneOf(page, 'vocals.wav').locator('[data-grab]').boundingBox();
  const p = { x: gb.x + gb.width / 2, y: gb.y + gb.height / 2 };
  const t = await touch(page);
  const g = gestures(t);
  await g.down(p);
  await g.to({ x: p.x - 30, y: p.y + 2 });
  // a palm lands on the stem's controls (left of the lane on tablets, its
  // header line above it on phones) and slides; a second finger ON the lanes
  // is a pinch by design
  const lb = await laneOf(page, 'vocals.wav').boundingBox();
  const L = await layout(page);
  const palm = L.size === 'phone' ? { x: lb.x + lb.width * 0.3, y: lb.y - 20 } : { x: lb.x - 40, y: lb.y + lb.height * 0.6 };
  const f1 = { id: 0, x: p.x - 30, y: p.y + 2 };
  await t.start([f1, { id: 1, ...palm }]);
  for (let i = 1; i <= 8; i += 1) await t.move([f1, { id: 1, x: palm.x + i * 6, y: palm.y + i * 2 }]);
  await t.end([f1]);
  await t.end([]);
  const after = await strip(page);
  expect(after.width).toBe(before.width);
  expect(Math.abs(after.left - (before.left - 30))).toBeLessThanOrEqual(6);
  expect(await pageScale(page)).toBe(1);
});

test('rotating mid handle-drag ends it cleanly: selection kept, the next tap seeks, no overflow', async ({ page, world, browserName }) => {
  cdpOnly(browserName);
  await openMany(page, world);
  await selectMarker(page);
  const h = await laneOf(page, 'vocals.wav').locator('[data-handle="end"]').boundingBox();
  const g = gestures(await touch(page));
  const y = h.y + h.height - 10;
  await g.down({ x: h.x + h.width / 2, y });
  await g.to({ x: h.x + h.width / 2 + 30, y });
  const home = page.viewportSize();
  await page.setViewportSize({ width: home.height, height: home.width });
  await g.up();
  await expect(laneOf(page, 'vocals.wav').locator('[data-handle]')).toHaveCount(2);
  await noHorizontalOverflow(page);
  const t0 = await timeNow(page);
  const lb = await centerOf(laneOf(page, 'bass.wav'));
  await page.touchscreen.tap(lb.x + lb.width * 0.2, lb.y + 8);
  await expect.poll(() => timeNow(page)).not.toBe(t0);
  await page.setViewportSize(home);
  await noHorizontalOverflow(page);
});

test('long-press on a waveform selects no text and double-taps zoom nothing', async ({ page, world, browserName }) => {
  cdpOnly(browserName);
  await openMany(page, world);
  const lb = await centerOf(laneOf(page, 'other.wav'));
  const p = { x: lb.x + lb.width * 0.4, y: lb.y + 10 };
  expect((await contextMenuAt(page, p.x, p.y)).userSelect).toBe('none');
  const t = await touch(page);
  await t.longPress(p, { holdMs: 800, jitter: 3 });
  expect(await page.evaluate(() => String(window.getSelection()))).toBe('');
  await t.doubleTap(p);
  await page.waitForTimeout(400); // a double-tap zoom animates in
  expect(await pageScale(page)).toBe(1);
  await expect(readout(page)).not.toHaveText('0:00.000');
});

test('phone: a sheet holds the page still - swipes on its veil or panel scroll nothing behind', async ({ page, world, browserName }) => {
  cdpOnly(browserName);
  const L = await openMany(page, world);
  test.skip(L.size !== 'phone', 'phone sheets');
  test.fail(true, 'the result sheets lock nothing (no scroll lock, veil without touch-action: none), unlike the Library ones - result/Sheet.jsx:29-31');
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight), 'page taller than the screen').toBeGreaterThan(20);
  await page.getByRole('button', { name: 'bass: extract, download, spectrogram, level' }).click();
  const sheet = page.getByRole('dialog', { name: 'bass' });
  await expect(sheet).toBeVisible();
  const title = await sheet.getByRole('heading').boundingBox();
  const vw = page.viewportSize().width;
  const t = await touch(page);
  await t.swipe({ x: vw / 2, y: Math.max(30, title.y - 60) }, { x: vw / 2, y: 5 });
  await t.swipe({ x: title.x + 20, y: title.y + 70 }, { x: title.x + 20, y: title.y - 20 });
  await page.waitForTimeout(300); // would have scrolled by now
  expect(await scrollY(page)).toBe(0);
});

test('a vertical swipe that starts on a level fader leaves the level alone', async ({ page, world, browserName }) => {
  cdpOnly(browserName);
  test.fail(true, "Chromium's native range input jumps to the finger on touchstart, so a scroll that starts on a fader sets the level (iOS doesn't) - Fader.jsx:33-46");
  const L = await openMany(page, world);
  let fader;
  if (L.size === 'phone') {
    await page.getByRole('button', { name: 'drums: extract, download, spectrogram, level' }).click();
    fader = page.getByRole('dialog', { name: 'drums' }).getByRole('slider', { name: 'drums level' });
  } else {
    fader = page.locator('[data-ready]').getByRole('slider', { name: 'drums level' });
  }
  const b = await centerOf(fader);
  const v0 = await fader.inputValue();
  await (await touch(page)).swipe({ x: b.x + b.width * 0.2, y: b.cy }, { x: b.x + b.width * 0.2 + 2, y: b.cy - 120 });
  await page.waitForTimeout(200); // input events are synchronous with the touch
  expect(await fader.inputValue()).toBe(v0);
});


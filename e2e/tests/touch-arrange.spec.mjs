import { touch } from '../support/touch.mjs';
import { test, expect, hasCDP, project, centerOf, gestures, tapIntoFling } from './touch/helpers.mjs';

// Fingers on the arrangement, beyond arrange-touch.spec.mjs (placing, long-
// press drags, pinch, trim/loop handles, the pen): taps that stop a fling,
// swipes that start on handles or the ruler, a slider under a scroll, touch
// cancel and rotation during a lifted drag, rapid taps and typed numbers.

test.skip(({ isMobile }) => !isMobile, 'touch layouts');

const cdpOnly = (browserName) => test.skip(!hasCDP(browserName), 'finger gestures through CDP');
const timeline = (page) => page.locator('[data-timeline]');
const position = (page) => page.getByLabel('Position (bar.beat.sixteenth)').filter({ visible: true }).first();
const armedBanner = (page) => page.getByRole('status').filter({ hasText: 'to place' });
const selectedCount = (page) => page.locator('[data-clip][aria-pressed="true"]').count();

async function openProject(page, api, world, opts) {
  const w = await world.get();
  const p = await project(api, w, opts);
  await page.goto(`/#/arrange/${p.id}`);
  await expect(page.locator('[data-clip]').first()).toBeVisible({ timeout: 20_000 });
  return p;
}

/** Lane geometry: lane height, px per beat, and the client point of (beat, track index). */
async function geometry(page) {
  const g = await page.evaluate(() => {
    const clips = [...document.querySelectorAll('[data-clip]')];
    const tops = [...new Set(clips.map((c) => parseFloat(c.style.top)))].sort((a, b) => a - b);
    const first = clips.find((c) => parseFloat(c.style.top) === tops[0]);
    const lanes = document.querySelector('[data-lanes]').getBoundingClientRect();
    const sc = document.querySelector('[data-timeline]').getBoundingClientRect();
    const ruler = document.querySelector('[data-ruler]').getBoundingClientRect();
    return { lane: (tops[1] - tops[0]) / 2, ppb: parseFloat(first.style.width) / 8, lanes: { x: lanes.left, y: lanes.top }, sc: { x: sc.left, y: sc.top, w: sc.width, h: sc.height }, ruler: { y: ruler.top, h: ruler.height } };
  });
  g.at = (beat, track) => ({ x: g.lanes.x + beat * g.ppb, y: g.lanes.y + (track + 0.5) * g.lane });
  return g;
}

const scroll = (page) => timeline(page).evaluate((el) => ({ left: Math.round(el.scrollLeft), top: Math.round(el.scrollTop) }));
const scrollLeft = async (page) => (await scroll(page)).left;

/**
 * A right-to-left flick along track 1, and a finger landing 40 ms into its
 * momentum at `tapAt`. A tap that didn't land on a running fling must not
 * pass as these tests' expected failure: they skip then.
 */
async function tapIntoLanesFling(page, g, tapAt) {
  const y = g.at(0, 0).y;
  const x0 = g.sc.x + g.sc.w - 20;
  const f = await tapIntoFling(page, { x: x0, y }, { x: x0 - g.sc.w * 0.3, y }, tapAt, {
    read: () => scrollLeft(page),
    reset: () => timeline(page).evaluate((el) => (el.scrollLeft = 0)),
  });
  test.skip(!(f.stopped < f.natural - 50), `the tap did not land on a running fling (${f.stopped} vs ${f.natural})`);
}

/** Tap the 4-beat clip at beat 0 of a track (index from 0). */
async function selectClip(page, trackIndex) {
  const g = await geometry(page);
  await (await touch(page)).tap(g.at(1, trackIndex));
  await expect.poll(() => selectedCount(page)).toBe(1);
}

async function openClipSheet(page) {
  await page.getByRole('button', { name: 'Clip', exact: true }).filter({ visible: true }).first().click();
  await expect(page.getByRole('dialog').filter({ has: page.getByRole('slider', { name: 'Clip gain' }) })).toBeVisible();
}

test('a tap that stops a fling selects no clip', async ({ page, api, world, browserName }) => {
  cdpOnly(browserName);
  test.fail(true, 'taps are read from pointerdown/up, which still arrive when the browser drops the click of a fling-stopping tap - Timeline.jsx:586-595');
  await openProject(page, api, world);
  const g = await geometry(page);
  await tapIntoLanesFling(page, g, { x: g.sc.x + g.sc.w * 0.6, y: g.at(0, 0).y }); // track 1 is clips end to end
  expect(await selectedCount(page)).toBe(0);
});

test('with a sample armed, a tap that stops a fling places nothing', async ({ page, api, world, browserName }) => {
  cdpOnly(browserName);
  test.fail(true, 'placement fires on pointerup of the fling-stopping tap (the browser only drops its click) - Timeline.jsx:663-676');
  await openProject(page, api, world);
  await page.getByRole('button', { name: 'Samples', exact: true }).filter({ visible: true }).first().click();
  await page.locator('[role=dialog] li button[title^="Tap, then tap a lane"]').first().click();
  await expect(armedBanner(page)).toBeVisible();
  const g = await geometry(page);
  await tapIntoLanesFling(page, g, { x: g.sc.x + g.sc.w * 0.6, y: g.at(0, 1).y }); // track 2 is empty
  await expect(armedBanner(page), 'still armed: nothing placed').toBeVisible();
});

test('a vertical swipe that starts on a trim handle scrolls the lanes and trims nothing', async ({ page, api, world, browserName }) => {
  cdpOnly(browserName);
  test.fail(true, 'touch trim handles are touch-action: none and take any drag, so the lanes cannot scroll from there - Timeline.jsx:901');
  await openProject(page, api, world);
  await selectClip(page, 2);
  const handle = page.locator('[data-handle="trim"]').first();
  const h = await handle.boundingBox();
  const width0 = await page.locator('[data-clip][aria-pressed="true"]').evaluate((el) => el.style.width);
  const top0 = (await scroll(page)).top;
  await (await touch(page)).swipe({ x: h.x + h.width / 2, y: h.y + h.height * 0.7 }, { x: h.x + h.width / 2 + 2, y: h.y + h.height * 0.7 - 150 });
  await expect.poll(async () => (await scroll(page)).top, { timeout: 3000 }).toBeGreaterThan(top0 + 30);
  expect(await page.locator('[data-clip][aria-pressed="true"]').evaluate((el) => el.style.width)).toBe(width0);
});

test('a vertical swipe that starts on the ruler or a loop handle moves neither the playhead nor the loop', async ({ page, api, world, browserName }) => {
  cdpOnly(browserName);
  test.fail(true, 'the ruler and its loop handles only count sideways travel as a drag (and pan only sideways), so a vertical swipe there is a tap that seeks - arrange/ui/Ruler.jsx:169, :138, touch-action :227/:274');
  await openProject(page, api, world, { loop: { enabled: true, start_beat: 0, end_beat: 8 } });
  const g = await geometry(page);
  const t = await touch(page);
  const p0 = await position(page).textContent();
  const x = g.lanes.x + 5.5 * g.ppb;
  const y = g.ruler.y + g.ruler.h / 2;
  await t.swipe({ x, y }, { x: x + 2, y: y + 150 });
  await page.waitForTimeout(300); // a seek shows at once
  expect(await position(page).textContent(), 'playhead after a swipe on the ruler').toBe(p0);
  const end = page.getByRole('slider', { name: 'Loop end' });
  const h = await end.boundingBox();
  await t.swipe({ x: h.x + h.width / 2, y: h.y + h.height / 2 }, { x: h.x + h.width / 2 + 2, y: h.y + h.height / 2 + 150 });
  await page.waitForTimeout(300);
  await expect(end).toHaveAttribute('aria-valuenow', '8');
  expect(await position(page).textContent(), 'playhead after a swipe on a loop handle').toBe(p0);
});

test('a vertical swipe that starts on the clip gain slider leaves the gain alone', async ({ page, api, world, browserName }) => {
  cdpOnly(browserName);
  await openProject(page, api, world);
  await selectClip(page, 2);
  await openClipSheet(page);
  const gain = page.getByRole('slider', { name: 'Clip gain' });
  const b = await centerOf(gain);
  const v0 = await gain.inputValue();
  await (await touch(page)).swipe({ x: b.x + b.width * 0.2, y: b.cy }, { x: b.x + b.width * 0.2 + 2, y: b.cy - 100 });
  await page.waitForTimeout(200); // input events are synchronous with the touch
  expect(await gain.inputValue()).toBe(v0);
});

test('touch cancel during a lifted clip drag puts the clip back', async ({ page, api, world, browserName }) => {
  cdpOnly(browserName);
  await openProject(page, api, world);
  const g = await geometry(page);
  const p = g.at(1, 2);
  const el = await page.evaluateHandle(({ x, y }) => document.elementFromPoint(x, y).closest('[data-clip]'), p);
  const left0 = await el.evaluate((n) => n.style.left);
  const gs = gestures(await touch(page));
  await gs.down(p);
  await gs.hold(450);
  await gs.to({ x: p.x + 3 * g.ppb, y: p.y });
  await expect.poll(() => el.evaluate((n) => n.style.left)).not.toBe(left0);
  await gs.cancel();
  await expect.poll(() => el.evaluate((n) => n.style.left)).toBe(left0);
});

test('rotating during a lifted clip drag ends it cleanly; the next swipe scrolls', async ({ page, api, world, browserName }) => {
  cdpOnly(browserName);
  await openProject(page, api, world);
  const g = await geometry(page);
  const p = g.at(1, 2);
  const gs = gestures(await touch(page));
  await gs.down(p);
  await gs.hold(450);
  await gs.to({ x: p.x + 2 * g.ppb, y: p.y });
  const home = page.viewportSize();
  await page.setViewportSize({ width: home.height, height: home.width });
  await gs.up();
  await expect(page.locator('[data-clip].opacity-80'), 'no clip left lifted').toHaveCount(0);
  const sc = await timeline(page).boundingBox();
  const y = sc.y + sc.height * 0.6;
  const left0 = await scrollLeft(page);
  await (await touch(page)).swipe({ x: sc.x + sc.width * 0.8, y }, { x: sc.x + sc.width * 0.3, y: y + 3 });
  await expect.poll(() => scrollLeft(page)).toBeGreaterThan(left0 + 40);
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(o, 'page scrolls sideways').toBeLessThanOrEqual(1);
  await page.setViewportSize(home);
});

test('pitch: five rapid taps on + all register; the field takes "-3" and "−2"', async ({ page, api, world, browserName }) => {
  cdpOnly(browserName);
  await openProject(page, api, world);
  await selectClip(page, 2);
  await openClipSheet(page);
  const up = await centerOf(page.getByRole('button', { name: 'Pitch up a semitone' }));
  for (let i = 0; i < 5; i += 1) await page.touchscreen.tap(up.cx, up.cy); // ~as fast as a thumb
  const semis = page.getByRole('textbox', { name: 'Semitones' });
  await expect(semis).toHaveValue('5');
  for (const [typed, want] of [['-3', '-3'], ['−2', '-2']]) {
    const b = await centerOf(semis);
    await page.touchscreen.tap(b.cx, b.cy);
    await expect(semis).toBeFocused();
    expect(parseFloat(await semis.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(typed);
    await page.keyboard.press('Enter');
    await expect(semis).toHaveValue(want);
  }
});

test('the project BPM field: one tap focuses it (16 px), "121,5" commits 121.5', async ({ page, api, world }) => {
  const { id } = await openProject(page, api, world);
  const bpm = page.getByRole('textbox', { name: 'Project BPM' }).filter({ visible: true }).first();
  const b = await centerOf(bpm);
  await page.touchscreen.tap(b.cx, b.cy);
  await expect(bpm).toBeFocused();
  expect(parseFloat(await bpm.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('121,5');
  await page.keyboard.press('Enter');
  await expect(bpm).toHaveValue('121.5');
  await expect.poll(async () => (await api.get(`/projects/${id}`)).bpm, { timeout: 10_000 }).toBe(121.5);
});

test('track names (track settings) are 44 px tap targets', async ({ page, api, world }) => {
  await openProject(page, api, world);
  const b = await page.getByRole('button', { name: 'Track 2', exact: true }).filter({ visible: true }).first().boundingBox();
  expect(b.height, 'Track 2 name height').toBeGreaterThanOrEqual(44);
});

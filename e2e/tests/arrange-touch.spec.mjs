import { touch } from '../support/touch.mjs';
import {
  test,
  expect,
  hasCDP,
  seedProject,
  getProject,
  pollProject,
  poll,
  allClips,
  openProject,
  track,
  clip,
  clipEl,
  lanes,
  ruler,
  timeline,
  bottomBar,
  position,
  sampleBrowser,
  sampleRow,
  selectedClipIds,
  pxPerBeat,
  laneHeight,
  setScroll,
  scrollLeft,
  visibleLanesLeft,
} from './arrange/helpers.mjs';

// Touch and pen on the phone / tablet layouts: placing an armed sample with a
// tap (a swipe scrolls instead), long-press drags, a second finger during a
// drag, pinch zoom, the ruler, loop and trim handles, the selection box, a
// pen, and the phone's clip sheet above the bottom transport.

test.beforeEach(({ isMobile }) => test.skip(!isMobile, 'touch layouts'));

/**
 * Client point for (beat, row) on the lanes after scrolling the timeline so
 * that row is in view (landscape phones show about two lanes). `row` may be
 * fractional; `tracks` (the count) addresses the "new track" row below them.
 */
async function lanePointInView(page, beat, row, { newRow = false } = {}) {
  const lh = await laneHeight(page);
  const y = newRow ? row * lh + 22 : row * lh;
  await timeline(page).evaluate((el, yy) => {
    const top = el.querySelector('[data-lanes]').offsetTop;
    const ruler = el.querySelector('[data-ruler]').offsetHeight;
    const visible = el.clientHeight - ruler;
    if (yy < el.scrollTop + 8 || yy > el.scrollTop + visible - 30) el.scrollTop = Math.max(0, yy + top - ruler - visible / 2);
  }, y);
  const box = await lanes(page).boundingBox();
  const ppb = await pxPerBeat(page);
  return { x: box.x + beat * ppb, y: box.y + y };
}

/** Open the sample browser (sheet or drawer) narrowed to the worker's samples. */
async function openSamples(page, smp) {
  await page.getByRole('button', { name: 'Samples', exact: true }).tap();
  await sampleBrowser(page).getByLabel('Search samples').fill(smp.tag);
  await expect(sampleBrowser(page).locator('li')).toHaveCount(5);
}
const arm = (page, name) => sampleRow(page, name).getByRole('button', { name: new RegExp(`^${name}`) }).tap();

test('arm a sample and tap a lane to place it (also below the last track); Cancel; Add at the playhead', async ({ page, api, smp }) => {
  const p = await seedProject(api, 'Tap to place', [track('T1', [clip(smp.drum, 0)]), track('T2')]);
  await openProject(page, p);
  await openSamples(page, smp);
  await arm(page, smp.bass.name);
  await expect(page.getByText(`Tap a lane to place “${smp.bass.name}”.`)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Samples' })).toHaveCount(0);
  let pt = await lanePointInView(page, 4.5, 1.5);
  await page.touchscreen.tap(pt.x, pt.y);
  await pollProject(api, p.id, (d) => d.tracks[1].clips.map((c) => [c.sample_id, c.start_beat])).toEqual([[smp.bass.id, 4]]);
  await expect(page.getByText(/Tap a lane to place/)).toHaveCount(0);

  await openSamples(page, smp);
  await arm(page, smp.shot.name);
  pt = await lanePointInView(page, 2.2, 2, { newRow: true });
  await page.touchscreen.tap(pt.x, pt.y);
  await pollProject(api, p.id, (d) => d.tracks.map((t) => t.clips.length)).toEqual([1, 1, 1]);

  await openSamples(page, smp);
  await arm(page, smp.loop.name);
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
  pt = await lanePointInView(page, 9, 0.5);
  await page.touchscreen.tap(pt.x, pt.y); // selects T1 now, places nothing
  await setScroll(page, { left: 0 });
  const rb = await ruler(page).boundingBox();
  await page.touchscreen.tap(rb.x + 8 * (await pxPerBeat(page)), rb.y + rb.height - 8);
  await expect(position(page)).toHaveText('3.1.1');
  await openSamples(page, smp);
  await sampleRow(page, smp.loop.name).getByRole('button', { name: 'Add', exact: true }).tap();
  await pollProject(api, p.id, (d) => d.tracks[0].clips.map((c) => [c.sample_id, c.start_beat]).sort((a, b) => a[1] - b[1])).toEqual([
    [smp.drum.id, 0],
    [smp.loop.id, 8],
  ]);
  await expect(page.getByRole('dialog', { name: 'Samples' })).toHaveCount(0);
});

test.describe('gestures', () => {
  test.skip(({ browserName }) => !hasCDP(browserName), 'multi-finger and pen input need CDP');

  test('with a sample armed, a swipe scrolls the lanes and places nothing', async ({ page, api, smp }) => {
    const p = await seedProject(api, 'Armed swipe', [track('T1', [clip(smp.drum, 0)]), track('T2')]);
    await openProject(page, p);
    const t = await touch(page);
    await openSamples(page, smp);
    await arm(page, smp.bass.name);
    const pt = await lanePointInView(page, 6, 1.5);
    const tl = await timeline(page).boundingBox();
    const x0 = Math.min(pt.x + 100, tl.x + tl.width - 30);
    await t.swipe({ x: x0, y: pt.y }, { x: x0 - 200, y: pt.y });
    await poll(() => scrollLeft(page)).toBeGreaterThan(50);
    await page.waitForTimeout(1000);
    expect(allClips(await getProject(api, p.id))).toHaveLength(1);
    await expect(page.getByText(/Tap a lane to place/)).toBeVisible();
  });

  test('long-press drags a clip; a swipe from a clip scrolls; a second finger neither moves the drag nor zooms; pinch zooms', async ({ page, api, smp }) => {
    const x = clip(smp.drum, 0);
    const y = clip(smp.bass, 2);
    const p = await seedProject(api, 'Long press', [track('T1', [x]), track('T2'), track('T3', [y])]);
    await openProject(page, p);
    const t = await touch(page);
    const ppb = await pxPerBeat(page);
    const lh = await laneHeight(page);
    // long-press X and drag it 2 beats right, one track down
    await lanePointInView(page, 1, 0.5);
    let b = await clipEl(page, x.id).boundingBox();
    const from = { x: Math.max(b.x, await visibleLanesLeft(page)) + 30, y: b.y + b.height / 2 };
    await t.longPress(from, { holdMs: 450, to: { x: from.x + 2 * ppb, y: from.y + lh } });
    await pollProject(api, p.id, (d) => allClips(d).find((c) => c.id === x.id)).toMatchObject({ ti: 1, start_beat: 2 });

    // a quick swipe that starts on a clip scrolls the view
    await setScroll(page, { left: 0 });
    await lanePointInView(page, 3, 2.5);
    b = await clipEl(page, y.id).boundingBox();
    await t.swipe({ x: b.x + 120, y: b.y + b.height / 2 }, { x: b.x - 80, y: b.y + b.height / 2 });
    await poll(() => scrollLeft(page)).toBeGreaterThan(50);
    await setScroll(page, { left: 0 });

    // drag Y by 2 beats while a second finger lands and wanders off
    b = await clipEl(page, y.id).boundingBox();
    const f0 = { id: 0, x: b.x + 30, y: b.y + b.height / 2 };
    await t.start([f0]);
    await page.waitForTimeout(450);
    for (let i = 1; i <= 5; i += 1) {
      await t.move([{ ...f0, x: f0.x + (2 * ppb * i) / 5 }]);
      await page.waitForTimeout(30);
    }
    const held = { ...f0, x: f0.x + 2 * ppb };
    const f1 = { id: 1, x: held.x + 40, y: held.y - lh };
    await t.start([held, f1]);
    for (let i = 1; i <= 8; i += 1) {
      await t.move([held, { ...f1, x: f1.x + 25 * i, y: f1.y + 6 * i }]);
      await page.waitForTimeout(30);
    }
    await t.end([held]);
    await t.end([]);
    await pollProject(api, p.id, (d) => allClips(d).find((c) => c.id === y.id)).toMatchObject({ ti: 2, start_beat: 4 });
    expect(await pxPerBeat(page)).toBe(ppb);

    // pinch out doubles the zoom, pinch in brings it back
    const mid = { x: (await visibleLanesLeft(page)) + 120, y: (await lanePointInView(page, 0, 1.5)).y };
    await t.pinch(mid, 80, 160);
    await poll(() => pxPerBeat(page)).toBeCloseTo(ppb * 2, 0);
    await t.pinch(mid, 160, 80);
    await poll(() => pxPerBeat(page)).toBeCloseTo(ppb, 0);
  });

  test('the ruler: a tap seeks, a swipe scrolls (no loop); loop handles drag by touch', async ({ page, api }) => {
    const p = await seedProject(api, 'Ruler touch', [track('T1')], { loop: { enabled: true, start_beat: 4, end_beat: 8 } });
    await openProject(page, p);
    const t = await touch(page);
    const ppb = await pxPerBeat(page);
    const rb = await ruler(page).boundingBox();
    await t.tap({ x: rb.x + 2 * ppb + 2, y: rb.y + rb.height - 8 });
    await expect(position(page)).toHaveText('1.3.1');
    await t.swipe({ x: rb.x + 9.5 * ppb, y: rb.y + rb.height - 8 }, { x: rb.x + 9.5 * ppb - 150, y: rb.y + rb.height - 8 });
    await poll(() => scrollLeft(page)).toBeGreaterThan(50);
    await expect(position(page)).toHaveText('1.3.1');
    expect((await getProject(api, p.id)).loop).toEqual(p.loop);
    await setScroll(page, { left: 0 });

    const end = page.getByRole('slider', { name: 'Loop end' });
    const eb = await end.boundingBox();
    expect(eb.width).toBeGreaterThanOrEqual(44);
    const e0 = { x: eb.x + eb.width / 2, y: eb.y + eb.height / 2 };
    await t.swipe(e0, { x: e0.x - 2 * ppb, y: e0.y }, { ms: 300 });
    await pollProject(api, p.id, (d) => d.loop).toEqual({ enabled: true, start_beat: 4, end_beat: 6 });
  });

  test('a selected clip has trim handles outside its edges; long-press on an empty lane draws a selection box', async ({ page, api, smp }) => {
    const z = clip(smp.shot, 12, { length_sec: 1.5 }); // 4 beats
    const a = clip(smp.drum, 2, { length_sec: 1 }); // 2..4
    const c2 = clip(smp.drum, 5, { length_sec: 0.5 }); // 5..6
    const p = await seedProject(api, 'Trim handles', [track('T1', [a]), track('T2', [c2, z])]);
    await openProject(page, p);
    const t = await touch(page);
    const ppb = await pxPerBeat(page);
    const lh = await laneHeight(page);
    // bring Z's end into the middle of the view, then tap Z to select it
    await setScroll(page, { left: 12 * ppb });
    await lanePointInView(page, 12, 1.5);
    const left = await visibleLanesLeft(page);
    const zb = await clipEl(page, z.id).boundingBox();
    await t.tap({ x: Math.max(zb.x, left) + 20, y: zb.y + zb.height / 2 });
    const handle = page.getByRole('slider', { name: 'Trim clip end' });
    const hb = await handle.boundingBox();
    expect(hb.width).toBeGreaterThanOrEqual(44);
    expect(hb.x, 'handle sits outside the clip edge').toBeGreaterThanOrEqual(zb.x + zb.width - 4);
    const h0 = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
    await t.swipe(h0, { x: h0.x - 1 * ppb, y: h0.y }, { ms: 300 });
    await pollProject(api, p.id, (d) => allClips(d).find((c) => c.id === z.id).length_sec).toBeCloseTo(1.125, 6);

    // a box from an empty spot on T2 (beat 9) up to T1 beat 1 catches the clips at 2..4 and 5..6
    await setScroll(page, { left: 0 });
    const from = await lanePointInView(page, 9, 1.5);
    await t.longPress(from, { holdMs: 450, to: { x: from.x - 8 * ppb, y: from.y - lh } });
    await poll(async () => (await selectedClipIds(page)).sort()).toEqual([a.id, c2.id].sort());
  });

  test('a pen drags a clip at once and draws a loop on the ruler; a finger pans again afterwards', async ({ page, api, smp }) => {
    const x = clip(smp.drum, 0);
    const p = await seedProject(api, 'Pen', [track('T1', [x]), track('T2')]);
    await openProject(page, p);
    const cdp = await page.context().newCDPSession(page);
    const pen = (type, pt, down = false) =>
      cdp.send('Input.dispatchMouseEvent', {
        type,
        x: Math.round(pt.x),
        y: Math.round(pt.y),
        pointerType: 'pen',
        button: type === 'mouseMoved' && !down ? 'none' : 'left',
        buttons: down || type === 'mousePressed' ? 1 : 0,
        clickCount: type === 'mouseMoved' ? 0 : 1,
        force: down || type === 'mousePressed' ? 0.5 : 0,
      });
    const ppb = await pxPerBeat(page);
    const lh = await laneHeight(page);
    const b = await clipEl(page, x.id).boundingBox();
    const from = { x: Math.max(b.x, await visibleLanesLeft(page)) + 30, y: b.y + b.height / 2 };
    await pen('mouseMoved', { x: from.x - 20, y: from.y }); // hovering announces the pen
    await pen('mouseMoved', from);
    await expect(lanes(page)).toHaveCSS('touch-action', 'none');
    await pen('mousePressed', from);
    for (let i = 1; i <= 10; i += 1) await pen('mouseMoved', { x: from.x + (3 * ppb * i) / 10, y: from.y + (lh * i) / 10 }, true);
    await pen('mouseReleased', { x: from.x + 3 * ppb, y: from.y + lh });
    await pollProject(api, p.id, (d) => allClips(d)[0]).toMatchObject({ ti: 1, start_beat: 3 });

    const rb = await ruler(page).boundingBox();
    const r0 = { x: rb.x + 2 * ppb + 2, y: rb.y + 15 };
    await pen('mouseMoved', r0);
    await pen('mousePressed', r0);
    for (let i = 1; i <= 8; i += 1) await pen('mouseMoved', { x: r0.x + (4 * ppb * i) / 8, y: r0.y }, true);
    await pen('mouseReleased', { x: r0.x + 4 * ppb, y: r0.y });
    await pollProject(api, p.id, (d) => d.loop).toEqual({ enabled: true, start_beat: 2, end_beat: 6 });

    const t = await touch(page);
    const pt = await lanePointInView(page, 6, 0.5);
    const tl = await timeline(page).boundingBox();
    const x0 = Math.min(pt.x + 100, tl.x + tl.width - 30);
    await t.swipe({ x: x0, y: pt.y }, { x: x0 - 200, y: pt.y });
    await poll(() => scrollLeft(page)).toBeGreaterThan(50);
    await expect(lanes(page)).toHaveCSS('touch-action', 'pan-x pan-y');
  });
});

test('phone: the clip sheet sits above the bottom bar, Play keeps working; Loop, typed pitch, Undo, Split, Delete', async ({ page, api, smp }) => {
  const x = clip(smp.drum, 0);
  const p = await seedProject(api, 'Clip sheet', [track('T1', [x])]);
  const ui = await openProject(page, p);
  test.skip(!ui.phone, 'phone layout');
  const bar = bottomBar(page);
  await clipEl(page, x.id).tap({ position: { x: 30, y: 30 } });
  await bar.getByRole('button', { name: 'Clip', exact: true }).tap();
  const sheet = page.getByRole('dialog', { name: 'Clip' });
  await expect(sheet).toBeVisible();
  const sb = await sheet.boundingBox();
  const bb = await bar.boundingBox();
  expect(Math.round(sb.y + sb.height)).toBeLessThanOrEqual(Math.round(bb.y) + 1);
  expect(sb.y).toBeGreaterThanOrEqual(0);

  await bar.getByRole('button', { name: 'Play (Space)' }).tap();
  await expect(bar.getByRole('button', { name: 'Stop (Space)' })).toBeVisible();
  await expect(sheet).toBeVisible();
  await bar.getByRole('button', { name: 'Stop (Space)' }).tap();

  await sheet.getByRole('button', { name: 'Loop' }).tap();
  await pollProject(api, p.id, (d) => allClips(d)[0].loop_beats).toBe(8);
  await sheet.getByLabel('Semitones').tap();
  await sheet.getByLabel('Semitones').fill('-5');
  await sheet.getByLabel('Cents').tap(); // moving to the next field commits the first
  await sheet.getByLabel('Cents').fill('-12');
  await sheet.getByLabel('Cents').press('Enter');
  await pollProject(api, p.id, (d) => [allClips(d)[0].semitones, allClips(d)[0].cents]).toEqual([-5, -12]);
  for (let i = 0; i < 3; i += 1) await bar.getByRole('button', { name: 'Undo' }).tap();
  await pollProject(api, p.id, (d) => [allClips(d)[0].loop_beats, allClips(d)[0].semitones, allClips(d)[0].cents]).toEqual([null, 0, 0]);

  // split at the playhead (the sheet covers the ruler on a landscape phone: close it to seek)
  await sheet.getByRole('button', { name: /^Close/ }).tap();
  await setScroll(page, { left: 0 });
  const rb = await ruler(page).boundingBox();
  await page.touchscreen.tap(rb.x + 4 * (await pxPerBeat(page)), rb.y + rb.height - 8);
  await expect(position(page)).toHaveText('2.1.1');
  await bar.getByRole('button', { name: 'Clip', exact: true }).tap();
  await sheet.getByRole('button', { name: 'Split', exact: true }).tap();
  await pollProject(api, p.id, (d) => allClips(d).length).toBe(2);
  const both = page.getByRole('dialog', { name: '2 clips' });
  await expect(both).toBeVisible();
  await both.getByRole('button', { name: 'Delete', exact: true }).tap();
  await pollProject(api, p.id, (d) => allClips(d).length).toBe(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('tablet: a selection adds Clip to the toolbar, which opens the clip sheet', async ({ page, api, smp }) => {
  const x = clip(smp.drum, 0);
  const p = await seedProject(api, 'Tablet clip', [track('T1', [x])]);
  const ui = await openProject(page, p);
  test.skip(!ui.tablet, 'tablet layout');
  await expect(page.getByRole('button', { name: 'Clip', exact: true })).toHaveCount(0);
  await clipEl(page, x.id).tap({ position: { x: 30, y: 30 } });
  await page.getByRole('button', { name: 'Clip', exact: true }).tap();
  const sheet = page.getByRole('dialog', { name: 'Clip' });
  await expect(sheet).toContainText(smp.drum.name);
  const fits = await page.locator('div.sticky.top-12').first().evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits, 'toolbar still fits with Clip in it').toBe(true);
  await sheet.getByRole('button', { name: 'Reverse' }).tap();
  await pollProject(api, p.id, (d) => allClips(d)[0].reverse).toBe(true);
});

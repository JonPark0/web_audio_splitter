import {
  test,
  expect,
  seedProject,
  getProject,
  pollProject,
  poll,
  allClips,
  openProject,
  track,
  clip,
  clipEl,
  ruler,
  timeline,
  dock,
  position,
  playButton,
  pxPerBeat,
  mouseDrag,
  seekTo,
  setScroll,
  scrollLeft,
  press,
  uid,
  visibleLanesLeft,
} from './arrange/helpers.mjs';

// Transport and timeline: play/stop, playhead and Follow, zoom (buttons,
// keys, Ctrl+wheel, Safari's gesture events), the loop region, markers, the
// metronome and edge auto-scroll while dragging. Mouse/keyboard tests run on
// the desktop layout; the marker/loop-handle overlap check on every profile.

const playheadX = (page) =>
  page.evaluate(() => {
    const ph = [...document.querySelectorAll('[data-lanes] > div.pointer-events-none.absolute.left-0')].pop();
    const m = (ph?.style.transform || '').match(/translateX\(([-\d.]+)px\)/);
    return m ? +m[1] : null;
  });

/** The Loop toggle: on the toolbar / bottom bar, or in More once the toolbar ran out of room. */
async function toggleLoop(page, ui) {
  const btn = page.getByRole('button', { name: 'Loop', exact: true }).locator('visible=true');
  if (await btn.count()) return press(page, ui, btn.first());
  await press(page, ui, page.getByRole('button', { name: 'More', exact: true }).locator('visible=true').first());
  return press(page, ui, page.getByRole('menuitem', { name: /Loop/ }));
}

/** Desktop's More menu item, or a toolbar control that may have moved into it. */
async function moreItem(page, name) {
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name }).click();
}

test.describe('desktop', () => {
  test.beforeEach(({ isMobile }) => test.skip(isMobile, 'mouse and keyboard'));

  test('play / stop by button and Space; the playhead moves; Home; a ruler click seeks', async ({ page, api, smp }) => {
    const p = await seedProject(api, 'Play', [track('T1', [clip(smp.drum, 0), clip(smp.drum, 8)])]);
    await openProject(page, p);
    await playButton(page).click();
    await expect(playButton(page)).toHaveAttribute('aria-pressed', 'true');
    await poll(() => playheadX(page)).toBeGreaterThan(20);
    const x1 = await playheadX(page);
    await poll(() => playheadX(page)).toBeGreaterThan(x1 + 10);
    await playButton(page).click();
    await expect(playButton(page)).toHaveAttribute('aria-pressed', 'false');
    const stopped = await position(page).textContent();
    expect(stopped).not.toBe('1.1.1');
    await page.waitForTimeout(400);
    await expect(position(page)).toHaveText(stopped);

    await page.keyboard.press('Home');
    await expect(position(page)).toHaveText('1.1.1');
    await page.keyboard.press('Space');
    await expect(playButton(page)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(playButton(page)).toHaveAttribute('aria-pressed', 'false');

    await seekTo(page, 16);
    await expect(position(page)).toHaveText('5.1.1');
    expect(await playheadX(page)).toBeCloseTo(16 * (await pxPerBeat(page)), 0);
  });

  test('Follow pages the view while playing, stands aside after a user scroll, and can be switched off', async ({ page, api, smp }) => {
    const p = await seedProject(api, 'Follow', [track('T1', [0, 8, 16, 24, 32, 40, 48, 56].map((s) => clip(smp.drum, s)))]);
    await openProject(page, p);
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('='); // 128 px per beat
    await page.keyboard.press('Space');
    await poll(() => scrollLeft(page), { timeout: 15_000 }).toBeGreaterThan(300);
    // the user scrolls back to the start: Follow waits while the playhead is out of view…
    await setScroll(page, { left: 0 });
    await page.waitForTimeout(1200);
    expect(await scrollLeft(page)).toBe(0);
    // …and brings it back after a few seconds
    await poll(() => scrollLeft(page), { timeout: 8000 }).toBeGreaterThan(300);
    await page.keyboard.press('Space');

    await moreItem(page, /Follow playhead/);
    await page.keyboard.press('Home');
    await setScroll(page, { left: 0 });
    await page.keyboard.press('Space');
    await page.waitForTimeout(4500);
    expect(await scrollLeft(page)).toBe(0);
    await page.keyboard.press('Space');
  });

  test('zoom: − / + / Fit, the + and − keys, Ctrl+wheel around the pointer, Safari gesture events', async ({ page, api, smp }) => {
    const p = await seedProject(api, 'Zoom', [track('T1', [clip(smp.drum, 0), clip(smp.drum, 56)])]);
    await openProject(page, p);
    const zoomOut = page.getByRole('button', { name: 'Zoom out (−)' });
    const zoomIn = page.getByRole('button', { name: 'Zoom in (+)' });
    const fit = page.getByRole('button', { name: 'Fit', exact: true });
    // narrower desktops move the zoom buttons into More
    const zoomOnBar = await zoomIn.isVisible();
    const z0 = await pxPerBeat(page);
    if (zoomOnBar) {
      await zoomOut.click();
      await poll(() => pxPerBeat(page)).toBeLessThan(z0);
      await zoomIn.click();
      await poll(() => pxPerBeat(page)).toBe(z0);
    }
    await page.keyboard.press('=');
    await poll(() => pxPerBeat(page)).toBeGreaterThan(z0);
    await page.keyboard.press('-');
    await poll(() => pxPerBeat(page)).toBe(z0);
    if (zoomOnBar) await fit.click();
    else await moreItem(page, 'Zoom to fit');
    const view = await timeline(page).evaluate((e) => e.clientWidth - e.querySelector('.sticky.left-0.z-20').offsetWidth);
    await poll(() => pxPerBeat(page)).toBeCloseTo((view - 16) / 64, 1); // the song is 64 beats

    // Ctrl+wheel keeps the beat under the pointer where it is
    await page.keyboard.press('=');
    await page.keyboard.press('=');
    const z1 = await pxPerBeat(page);
    const tb = await timeline(page).boundingBox();
    const left = await visibleLanesLeft(page);
    const px = Math.min(left + 300, tb.x + tb.width - 40);
    const beatAt = async (z) => ((await scrollLeft(page)) + px - left) / z;
    const b0 = await beatAt(z1);
    await page.mouse.move(px, tb.y + 150);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await poll(() => pxPerBeat(page)).toBeGreaterThan(z1 * 1.3);
    const z2 = await pxPerBeat(page);
    expect(Math.abs((await beatAt(z2)) - b0)).toBeLessThan(0.3);

    // Safari: a trackpad pinch arrives as gesturestart / gesturechange
    await timeline(page).evaluate((e) => {
      const ev = (type, scale) => {
        const g = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(g, 'scale', { value: scale });
        Object.defineProperty(g, 'clientX', { value: e.getBoundingClientRect().left + 400 });
        return g;
      };
      e.dispatchEvent(ev('gesturestart', 1));
      e.dispatchEvent(ev('gesturechange', 1.5));
      e.dispatchEvent(ev('gesturechange', 0.5));
      e.dispatchEvent(ev('gestureend', 0.5));
    });
    await poll(() => pxPerBeat(page)).toBeCloseTo(z2 * 0.5, 1);
  });

  test('loop region: drag on the ruler, drag its handles, L and the Loop button, typed end; playback stays inside', async ({ page, api, smp }) => {
    const p = await seedProject(api, 'Loop region', [track('T1', [clip(smp.drum, 0), clip(smp.drum, 8), clip(smp.drum, 16)])]);
    await openProject(page, p);
    const ppb = await pxPerBeat(page);
    const rb = await ruler(page).boundingBox();
    await mouseDrag(page, { x: rb.x + 4 * ppb + 2, y: rb.y + 14 }, { x: rb.x + 12 * ppb + 2, y: rb.y + 14 });
    await pollProject(api, p.id, (d) => d.loop).toEqual({ enabled: true, start_beat: 4, end_beat: 12 });
    const handle = async (name) => {
      const b = await page.getByRole('slider', { name }).boundingBox();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    let h = await handle('Loop end');
    await mouseDrag(page, h, { x: rb.x + 16 * ppb, y: h.y });
    h = await handle('Loop start');
    await mouseDrag(page, h, { x: rb.x + 8 * ppb, y: h.y });
    await pollProject(api, p.id, (d) => d.loop).toEqual({ enabled: true, start_beat: 8, end_beat: 16 });

    await seekTo(page, 14);
    await page.keyboard.press('Space');
    const bars = new Set();
    for (let i = 0; i < 14; i += 1) {
      await page.waitForTimeout(350);
      bars.add(Number((await position(page).textContent()).split('.')[0]));
    }
    await page.keyboard.press('Space');
    expect([...bars].sort()).toEqual([3, 4]); // wrapped from bar 4 back to bar 3, never past it

    await page.keyboard.press('l');
    await pollProject(api, p.id, (d) => d.loop.enabled).toBe(false);
    await toggleLoop(page, { coarse: false });
    await pollProject(api, p.id, (d) => d.loop.enabled).toBe(true);
    await dock(page).getByLabel('Loop end (bar.beat)').fill('6,1');
    await dock(page).getByLabel('Loop end (bar.beat)').press('Enter');
    await pollProject(api, p.id, (d) => d.loop.end_beat).toBe(20);
  });

  test('markers: add at the playhead (More menu, dock), click jumps, double-click renames, delete', async ({ page, api }) => {
    const p = await seedProject(api, 'Markers', [track('T1')]);
    await openProject(page, p);
    await seekTo(page, 2);
    await moreItem(page, 'Add marker at playhead');
    await seekTo(page, 12);
    await dock(page).getByRole('button', { name: 'Add at playhead' }).click();
    await pollProject(api, p.id, (d) => d.markers.map((m) => [m.name, m.beat])).toEqual([
      ['Marker 1', 2],
      ['Marker 2', 12],
    ]);
    await page.keyboard.press('Home');
    const flag = page.locator('[data-marker] button').first();
    await flag.click({ position: { x: 4, y: 6 } });
    await expect(position(page)).toHaveText('1.3.1');
    await flag.dblclick({ position: { x: 4, y: 6 } });
    await page.getByLabel('Marker name').fill('Verse');
    await page.getByLabel('Marker name').press('Enter');
    await pollProject(api, p.id, (d) => d.markers[0].name).toBe('Verse');
    await dock(page).getByRole('button', { name: 'Delete marker Marker 2' }).click();
    await pollProject(api, p.id, (d) => d.markers.map((m) => m.name)).toEqual(['Verse']);
  });

  test('a marker can be dragged along the ruler', async ({ page, api }) => {
    test.fail(true, 'F1: markers cannot be moved: the flag stops pointerdown and only has click/double-click (frontend/src/arrange/ui/Ruler.jsx:26, :13-60); no beat field in ProjectPanel either');
    const p = await seedProject(api, 'Marker drag', [track('T1')], { markers: [{ id: crypto.randomUUID(), beat: 2, name: 'Intro' }] });
    await openProject(page, p);
    const ppb = await pxPerBeat(page);
    const b = await page.locator('[data-marker] button').first().boundingBox();
    await mouseDrag(page, { x: b.x + 4, y: b.y + 6 }, { x: b.x + 4 + 4 * ppb, y: b.y + 6 });
    await poll(async () => (await getProject(api, p.id)).markers[0].beat, { timeout: 3000 }).toBe(6);
  });

  test('the metronome schedules clicks only while Click is on', async ({ page, api, smp }) => {
    const p = await seedProject(api, 'Metronome', [track('T1', [clip(smp.drum, 0)])]);
    await openProject(page, p);
    await page.evaluate(() => {
      const P = (window.BaseAudioContext || window.AudioContext).prototype;
      const orig = P.createOscillator;
      window.__osc = 0;
      P.createOscillator = function (...a) {
        window.__osc += 1;
        return orig.apply(this, a);
      };
    });
    const run = async () => {
      await page.keyboard.press('Home');
      await page.keyboard.press('Space');
      await page.waitForTimeout(1200);
      await page.keyboard.press('Space');
      return page.evaluate(() => window.__osc);
    };
    expect(await run()).toBe(0);
    const click = page.getByRole('button', { name: 'Click', exact: true });
    if (await click.isVisible()) {
      await click.click();
      await expect(click).toHaveAttribute('aria-pressed', 'true');
    } else await moreItem(page, /Click \(metronome\)/);
    expect(await run()).toBeGreaterThanOrEqual(2);
  });

  test('dragging a clip against the right edge scrolls the view and the clip follows the content', async ({ page, api, smp }) => {
    const c = clip(smp.drum, 4);
    const p = await seedProject(api, 'Edge scroll', [track('T1', [c])]);
    await openProject(page, p);
    const b = await clipEl(page, c.id).boundingBox();
    const tb = await timeline(page).boundingBox();
    await page.mouse.move(b.x + 20, b.y + 30);
    await page.mouse.down();
    await page.mouse.move(b.x + 40, b.y + 30, { steps: 3 });
    await page.mouse.move(tb.x + tb.width - 8, b.y + 30, { steps: 10 });
    await poll(() => scrollLeft(page), { timeout: 5000 }).toBeGreaterThan(200);
    const sl = await scrollLeft(page);
    await page.mouse.up();
    const ppb = await pxPerBeat(page);
    await pollProject(api, p.id, (d) => allClips(d)[0].start_beat).toBeGreaterThan(4 + sl / ppb - 4);
  });
});

test('a marker flag next to a loop edge stays clickable (not under the loop handle)', async ({ page, api }) => {
  test.fail(true, 'F2: the loop handles (z-20, 12 px; 44 px on touch) cover marker flags (z-10) near a loop edge (frontend/src/arrange/ui/Ruler.jsx:273 vs :26)');
  const p = await seedProject(api, `Marker overlap ${uid()}`, [track('T1')], {
    markers: [{ id: crypto.randomUUID(), beat: 3, name: 'Chorus A' }],
    loop: { enabled: true, start_beat: 4, end_beat: 8 },
  });
  await openProject(page, p);
  const flag = page.locator('[data-marker] button span').first();
  const r = await flag.boundingBox();
  const covered = await page.evaluate(({ x0, x1, y }) => {
    const hits = [];
    for (let x = x0 + 1; x < x1 - 1; x += 2) {
      const h = document.elementFromPoint(x, y);
      if (!h?.closest('[data-marker]')) hits.push(Math.round(x - x0));
    }
    return hits;
  }, { x0: r.x, x1: r.x + r.width, y: r.y + r.height / 2 });
  expect(covered, 'x offsets of the flag that something else covers').toEqual([]);
});

test('markers and the loop work on touch layouts too: add at the playhead from the project sheet', async ({ page, api, isMobile }) => {
  test.skip(!isMobile, 'touch layouts');
  const p = await seedProject(api, 'Touch markers', [track('T1')]);
  const ui = await openProject(page, p);
  const rb = await ruler(page).boundingBox();
  await page.touchscreen.tap(rb.x + 2 * (await pxPerBeat(page)) + 1, rb.y + rb.height - 8);
  await expect(position(page)).toHaveText('1.3.1');
  await press(page, ui, page.getByRole('button', { name: 'More', exact: true }).locator('visible=true').first());
  await press(page, ui, page.getByRole('menuitem', { name: 'Add marker at playhead' }));
  await pollProject(api, p.id, (d) => d.markers.map((m) => m.beat)).toEqual([2]);
  await toggleLoop(page, ui);
  await pollProject(api, p.id, (d) => d.loop.enabled).toBe(true);
  expect((await getProject(api, p.id)).loop).toMatchObject({ start_beat: 0, end_beat: 16 });
});

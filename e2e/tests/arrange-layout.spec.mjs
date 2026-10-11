import {
  test,
  expect,
  seedProject,
  openProject,
  track,
  clip,
  press,
  toolbarEl,
  bottomBar,
  timeline,
  coveredControls,
} from './arrange/helpers.mjs';

// Arrange layout on every device profile: the one-line toolbar folds items
// into More instead of overflowing, nothing scrolls sideways, header controls
// aren't covered, touch targets are finger-sized, and on phones the sheets
// open above the fixed bottom transport.

async function openLong(page, api, smp) {
  const p = await seedProject(api, 'A rather long project name to squeeze the toolbar', [
    track('Drums with a rather long track name', [clip(smp.drum, 0)]),
    track('Bass', [clip(smp.bass, 8)]),
    track('Keys'),
  ]);
  return { p, ui: await openProject(page, p) };
}

test('the toolbar fits (extra items fold into More) and the page never scrolls sideways', async ({ page, api, smp }) => {
  const { ui } = await openLong(page, api, smp);
  const bar = await toolbarEl(page).evaluate((el) => ({
    overflow: el.scrollWidth - el.clientWidth,
    right: Math.max(...[...el.querySelectorAll('button,input,select')].filter((x) => x.getBoundingClientRect().width).map((x) => x.getBoundingClientRect().right)),
    vw: innerWidth,
  }));
  expect(bar.overflow, 'toolbar overflows').toBeLessThanOrEqual(1);
  expect(bar.right).toBeLessThanOrEqual(bar.vw);
  const page2 = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, layout: innerWidth - document.documentElement.clientWidth }));
  expect(page2.scroll, 'page scrolls sideways').toBeLessThanOrEqual(1);
  expect(page2.layout, 'layout viewport widened').toBeLessThanOrEqual(1);

  // whatever didn't fit is in More (Project settings is always there)
  await press(page, ui, page.getByRole('button', { name: 'More', exact: true }).locator('visible=true').first());
  await expect(page.getByRole('menuitem', { name: 'Project settings…' })).toBeVisible();
  if (!(await toolbarEl(page).getByLabel('Snap').count())) {
    const more = page.getByRole('menu').or(page.getByRole('dialog', { name: 'More' }));
    await expect(more.getByLabel('Snap'), 'Snap moved into More').toBeVisible();
  }
});

test('track header controls are not covered by anything', async ({ page, api, smp }) => {
  await openLong(page, api, smp);
  const covered = await coveredControls(page, '[data-timeline] .sticky.left-0.z-20', '[data-timeline]');
  expect(covered).toEqual([]);
  // the timeline sits between the toolbar and the bottom of the screen (or the phone's bottom bar)
  const tl = await timeline(page).boundingBox();
  const tb = await toolbarEl(page).boundingBox();
  expect(tl.y).toBeGreaterThanOrEqual(tb.y + tb.height - 1);
  const bb = (await bottomBar(page).count()) ? await bottomBar(page).boundingBox() : null;
  expect(tl.y + tl.height).toBeLessThanOrEqual((bb ? bb.y : (await page.evaluate(() => innerHeight))) + 1);
  expect(tl.height).toBeGreaterThanOrEqual(120);
});

test('touch: toolbar, bottom bar and header controls are at least 44 px tall', async ({ page, api, smp, isMobile }) => {
  test.skip(!isMobile, 'touch layouts');
  await openLong(page, api, smp);
  const small = await page.evaluate(() => {
    const sel = [
      'div.sticky.top-12 button',
      'div.sticky.top-12 input',
      'div.sticky.top-12 select',
      'div.fixed.bottom-0 button',
      'div.fixed.bottom-0 input',
      '[data-timeline] .sticky.left-0.z-20 button:not([title="Track settings"])', // track names: see arrange-tracks (F4)
    ].join(',');
    return [...document.querySelectorAll(sel)]
      .filter((e) => e.getBoundingClientRect().width > 0 && e.getAttribute('aria-label') !== 'No clipping')
      .map((e) => ({ name: e.getAttribute('aria-label') || e.textContent.trim(), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) }))
      .filter((x) => x.h < 44 || x.w < 32);
  });
  expect(small).toEqual([]);
});

test('phone: More and Samples open as sheets above the bottom bar, which stays usable', async ({ page, api, smp }) => {
  const { ui } = await openLong(page, api, smp);
  test.skip(!ui.phone, 'phone layout');
  const bar = bottomBar(page);
  const bb = await bar.boundingBox();
  for (const [name, open] of [
    ['More', () => bar.getByRole('button', { name: 'More' }).tap()],
    ['Samples', () => page.getByRole('button', { name: 'Samples', exact: true }).tap()],
  ]) {
    await open();
    const sheet = page.getByRole('dialog', { name });
    await expect(sheet).toBeVisible();
    const sb = await sheet.boundingBox();
    expect(Math.round(sb.y + sb.height), `${name} sheet bottom`).toBeLessThanOrEqual(Math.round(bb.y) + 1);
    expect(sb.y, `${name} sheet top`).toBeGreaterThanOrEqual(0);
    // Play stays reachable under the sheet
    const play = await bar.getByRole('button', { name: 'Play (Space)' }).boundingBox();
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), { x: play.x + play.width / 2, y: play.y + play.height / 2 });
    expect(hit).toBe('Play (Space)');
    await sheet.getByRole('button', { name: `Close ${name}` }).tap();
    await expect(sheet).toHaveCount(0);
  }
});

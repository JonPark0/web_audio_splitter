import { touch } from '../support/touch.mjs';
import { test, expect, hasCDP, layout, scrollY, pageScale, centerOf, contextMenuAt, gestures, tapIntoFling, TAG } from './touch/helpers.mjs';

// Finger behaviour across screens, Split home and Library (result screen:
// touch-result.spec.mjs, arrangement: touch-arrange.spec.mjs): a swipe scrolls
// and triggers nothing, a tap that stops a fling triggers nothing, taps are
// single and land on the right target, long-press selects, sheets hold the
// page still, the page itself can still be pinch-zoomed but never by a
// double-tap on a control, and text fields don't make iOS zoom.
//
// Gestures need Chromium's DevTools protocol; the tests that only tap
// (page.touchscreen) or measure also run on the WebKit touch projects.

test.skip(({ isMobile }) => !isMobile, 'touch layouts');

const cdpOnly = (browserName) => test.skip(!hasCDP(browserName), 'finger gestures through CDP');
const jobRow = (page, i) => page.locator('[data-job-row]').nth(i);
const narrowRows = async (page) => (await page.locator('[data-job-row] button[aria-label^="Actions for"]').count()) > 0;

async function openSplit(page, world) {
  await world.get();
  await page.goto('/#/split');
  await expect.poll(() => page.locator('[data-job-row]').count()).toBeGreaterThanOrEqual(25);
}

/** Effective hit size around an element's centre (what elementFromPoint gives back), capped at 60 px. */
async function hitSize(locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const own = (x, y) => {
      const h = document.elementFromPoint(x, y);
      return !!h && (h === el || el.contains(h));
    };
    const reach = (dx, dy) => {
      let n = 0;
      for (let i = 1; i <= 30 && own(cx + dx * i, cy + dy * i); i += 1) n = i;
      return n;
    };
    return { w: reach(-1, 0) + reach(1, 0) + 1, h: reach(0, -1) + reach(0, 1) + 1 };
  });
}

test.describe('split', () => {
  test('a vertical swipe over the jobs scrolls the page and opens nothing', async ({ page, world, browserName }) => {
    cdpOnly(browserName);
    await openSplit(page, world);
    const vp = page.viewportSize();
    const row = await centerOf(jobRow(page, 3));
    const y0 = await scrollY(page);
    await (await touch(page)).swipe({ x: vp.width * 0.4, y: row.cy + 40 }, { x: vp.width * 0.4 + 3, y: row.cy - 160 });
    await expect.poll(() => scrollY(page)).toBeGreaterThan(y0 + 60);
    await expect(page).toHaveURL(/#\/split$/);
  });

  test('a tap that stops a fling opens nothing; a plain tap on a job opens it', async ({ page, world, browserName }) => {
    cdpOnly(browserName);
    await openSplit(page, world);
    const vp = page.viewportSize();
    const d = Math.min(200, vp.height * 0.2);
    const f = await tapIntoFling(page, { x: vp.width * 0.45, y: vp.height * 0.7 }, { x: vp.width * 0.45, y: vp.height * 0.7 - d }, { x: vp.width * 0.45, y: vp.height * 0.5 }, {
      read: () => scrollY(page),
      reset: () => page.evaluate(() => window.scrollTo(0, 0)),
    });
    expect(f.stopped, `the tap stopped the fling (alone it ran to ${f.natural})`).toBeLessThan(f.natural - 50);
    await expect(page).toHaveURL(/#\/split$/);

    const link = jobRow(page, 2).locator('a[href*="/split/job/"]').first();
    const href = await link.getAttribute('href');
    const b = await centerOf(link);
    await page.touchscreen.tap(b.x + Math.min(30, b.width / 2), b.cy);
    await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  });

  test('⋯ tapped 8 px off-centre towards the row above opens its own row; a second tap closes it', async ({ page, world }) => {
    await openSplit(page, world);
    test.skip(!(await narrowRows(page)), 'two-line rows with ⋯ (narrow lists)');
    const more = (i) => jobRow(page, i).getByRole('button', { name: /^Actions for/ });
    const b = await centerOf(more(3));
    await page.touchscreen.tap(b.cx, b.cy - 8);
    await expect(more(3)).toHaveAttribute('aria-expanded', 'true');
    await expect(more(2)).toHaveAttribute('aria-expanded', 'false');
    await page.touchscreen.tap(b.cx, b.cy - 8);
    await expect(more(3)).toHaveAttribute('aria-expanded', 'false');
    await expect(page).toHaveURL(/#\/split$/);
  });

  test('rapid taps on the status filter (about 8 a second) all register', async ({ page, world }) => {
    await openSplit(page, world);
    const group = page.getByRole('radiogroup', { name: 'Show jobs' });
    const words = [];
    for (const label of ['Running', 'Done', 'Failed', 'All']) words.push(await centerOf(group.locator('label').filter({ hasText: label })));
    await page.evaluate(() => {
      window.__hashes = [];
      window.addEventListener('hashchange', () => window.__hashes.push(location.hash.replace(/^#\/split\??/, '') || 'all'));
    });
    for (const w of words) await page.touchscreen.tap(w.cx, w.cy);
    await expect.poll(() => page.evaluate(() => window.__hashes)).toEqual(['status=running', 'status=done', 'status=failed', 'all']);
  });

  test('double-tap on controls never zooms the page; a pinch on the list still does', async ({ page, world, browserName }) => {
    cdpOnly(browserName);
    await openSplit(page, world);
    const t = await touch(page);
    const narrow = await narrowRows(page);
    const ctl = narrow ? jobRow(page, 1).getByRole('button', { name: /^Actions for/ }) : page.getByRole('radiogroup', { name: 'Show jobs' }).locator('label').filter({ hasText: 'Done' });
    const b = await centerOf(ctl);
    await t.doubleTap({ x: b.cx, y: b.cy });
    await page.waitForTimeout(400); // a double-tap zoom animates in
    expect(await pageScale(page)).toBe(1);
    // page zoom isn't disabled globally (accessibility)
    const vp = page.viewportSize();
    await t.pinch({ x: vp.width / 2, y: vp.height / 2 }, 100, 260);
    await expect.poll(() => pageScale(page)).toBeGreaterThan(1.2);
  });

  test('job names are 44 px tap targets on one-line rows too', async ({ page, world }) => {
    await openSplit(page, world);
    const link = jobRow(page, 2).locator('a[href*="/split/job/"]').first();
    await centerOf(link); // on screen: a landscape phone's rows start below the first screen
    const s = await hitSize(link);
    expect(s.h, 'name link hit height').toBeGreaterThanOrEqual(44);
  });

  test.skip('the search field stays clear of the fixed Split bar with the keyboard up', () => {
    // Only fails when the keyboard resizes the layout viewport (old Android
    // "resizes-content"), and only on short phones (iPhone SE/13, not Pixel 7):
    // with today's default visual-viewport keyboards the fixed bar sits behind
    // the keyboard. Not deterministic across the projects - left out.
  });
});

test.describe('library', () => {
  async function openLibrary(page, world) {
    await world.get();
    await page.addInitScript(() => localStorage.setItem('library:auto', 'true'));
    await page.goto(`/#/library?tags=${TAG}`);
    await expect(page.locator('[role=row][data-id]')).toHaveCount(60);
    return { phone: (await page.locator('[data-card-body]').count()) > 0 };
  }
  const audioRequests = (page) => {
    const seen = [];
    page.on('request', (r) => /\/samples\/[^/]+\/(audio|render)/.test(r.url()) && seen.push(r.url()));
    return seen;
  };
  const playing = (page) => page.locator('[role=row][data-id] button[aria-pressed="true"]');

  test('a vertical swipe over the samples scrolls; nothing is auditioned, selected or checked', async ({ page, world, browserName }) => {
    cdpOnly(browserName);
    await openLibrary(page, world);
    const audio = audioRequests(page);
    const vp = page.viewportSize();
    await (await touch(page)).swipe({ x: vp.width * 0.45, y: vp.height * 0.75 }, { x: vp.width * 0.45 + 3, y: vp.height * 0.3 });
    await expect.poll(() => scrollY(page)).toBeGreaterThan(80);
    await expect(page.locator('[role=row][data-id][aria-selected="true"]')).toHaveCount(0);
    await expect(page.locator('[role=row][data-id] input[type=checkbox]:checked')).toHaveCount(0);
    await expect(playing(page)).toHaveCount(0);
    expect(audio).toEqual([]);
  });

  test('a tap that stops a fling auditions and selects nothing', async ({ page, world, browserName }) => {
    cdpOnly(browserName);
    await openLibrary(page, world);
    const audio = audioRequests(page);
    const vp = page.viewportSize();
    const d = Math.min(200, vp.height * 0.2);
    const f = await tapIntoFling(page, { x: vp.width * 0.45, y: vp.height * 0.7 }, { x: vp.width * 0.45, y: vp.height * 0.7 - d }, { x: vp.width * 0.45, y: vp.height * 0.5 }, {
      read: () => scrollY(page),
      reset: () => page.evaluate(() => window.scrollTo(0, 0)),
    });
    expect(f.stopped, `the tap stopped the fling (alone it ran to ${f.natural})`).toBeLessThan(f.natural - 50);
    await expect(page.locator('[role=row][data-id][aria-selected="true"]')).toHaveCount(0);
    expect(audio).toEqual([]);
  });

  test('phone: long-press with a jittery finger selects the card while still held; no audition, no menu, no text selection', async ({ page, world, browserName }) => {
    cdpOnly(browserName);
    const { phone } = await openLibrary(page, world);
    test.skip(!phone, 'cards (phone layouts)');
    const audio = audioRequests(page);
    const card = page.locator('[role=row][data-id]').nth(3);
    const b = await centerOf(card.locator('[data-card-body]'));
    const p = { x: b.x + 60, y: b.cy };
    expect(await contextMenuAt(page, p.x, p.y), 'native long-press menu cancelled').toMatchObject({ prevented: true, userSelect: 'none' });
    const g = gestures(await touch(page));
    await g.down(p);
    await g.hold(600, 4);
    await expect(card.locator('input[type=checkbox]'), 'selection mode while the finger is down').toBeChecked();
    await g.up();
    await expect(page.locator('[role=row][data-id] input[type=checkbox]:checked')).toHaveCount(1);
    expect(await page.evaluate(() => String(window.getSelection()))).toBe('');
    expect(audio).toEqual([]);
    // a tap on another card now checks it
    const b2 = await centerOf(page.locator('[role=row][data-id]').nth(5).locator('[data-card-body]'));
    await page.touchscreen.tap(b2.x + 60, b2.cy);
    await expect(page.locator('[role=row][data-id] input[type=checkbox]:checked')).toHaveCount(2);
  });

  test('phone: the ⋯ sheet holds the page still (swipes on its veil) and a veil tap closes it', async ({ page, world, browserName }) => {
    cdpOnly(browserName);
    const { phone } = await openLibrary(page, world);
    test.skip(!phone, 'phone action sheet');
    await page.evaluate(() => window.scrollTo(0, 200));
    const more = await centerOf(page.locator('[role=row][data-id]').nth(6).getByRole('button', { name: /^Actions for/ }));
    await page.touchscreen.tap(more.cx, more.cy);
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    const y0 = await scrollY(page);
    const top = (await sheet.boundingBox()).y;
    const vw = page.viewportSize().width;
    const t = await touch(page);
    await t.swipe({ x: vw / 2, y: Math.max(40, top - 40) }, { x: vw / 2, y: 10 });
    await t.swipe({ x: vw / 2, y: 60 }, { x: vw / 2, y: Math.max(80, top - 20) });
    await page.waitForTimeout(300); // would have scrolled by now
    expect(await scrollY(page)).toBe(y0);
    await page.touchscreen.tap(vw / 2, Math.max(30, top - 30));
    await expect(sheet).toHaveCount(0);
  });

  test('tap tempo: six taps set the tempo they were tapped at', async ({ page, world, browserName }) => {
    cdpOnly(browserName);
    const { phone } = await openLibrary(page, world);
    const row = page.locator('[role=row][data-id]').nth(1);
    if (phone) {
      const m = await centerOf(row.getByRole('button', { name: /^Actions for/ }));
      await page.touchscreen.tap(m.cx, m.cy);
    } else {
      const m = await centerOf(row.getByRole('button', { name: /^More for/ }));
      await page.touchscreen.tap(m.cx, m.cy);
    }
    await page.getByRole('menuitem', { name: /Edit details/ }).click();
    const sheet = page.getByRole('dialog', { name: /^Edit / });
    const tap = await centerOf(sheet.getByRole('button', { name: /^Tap/ }));
    // the app times a tap when its pointerdown handler runs: read the clock
    // in the same dispatch (a capture listener), not the event's timeStamp
    await page.evaluate(() => {
      window.__downs = [];
      document.addEventListener('pointerdown', () => window.__downs.push(performance.now()), true);
    });
    const t = await touch(page);
    const t0 = Date.now();
    for (let i = 0; i < 6; i += 1) {
      await t.tap({ x: tap.cx, y: tap.cy }, { holdMs: 50 });
      await page.waitForTimeout(Math.max(0, t0 + (i + 1) * 500 - Date.now()));
    }
    const downs = await page.evaluate(() => window.__downs);
    expect(downs).toHaveLength(6);
    const tapped = 60000 / ((downs[5] - downs[0]) / 5);
    const field = sheet.locator('input[id^="bpm-"]');
    await expect.poll(async () => Math.abs(parseFloat(await field.inputValue()) - tapped), { timeout: 5000 }).toBeLessThan(1);
  });
});

test.describe('text entry', () => {
  test('fields are at least 16 px on touch, so iOS never zooms in on focus', async ({ page, world }) => {
    const w = await world.get();
    const small = [];
    const check = async (where) => {
      const found = await page.evaluate(() =>
        [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), select, textarea')]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => ({ name: el.getAttribute('aria-label') || el.id || el.name || el.type, fs: parseFloat(getComputedStyle(el).fontSize) }))
      );
      expect(found.length, `${where}: fields found`).toBeGreaterThan(0);
      small.push(...found.filter((f) => f.fs < 16).map((f) => `${where}: ${f.name} ${f.fs}px`));
    };
    await page.goto('/#/split');
    await expect(page.locator('[data-job-row]').first()).toBeVisible();
    await check('split');
    await page.goto('/#/library');
    await expect(page.locator('[role=row][data-id]').first()).toBeVisible();
    await check('library');
    await page.goto(`/#/split/job/${w.jobs[1]}`);
    await expect(page.locator('[data-ready="true"]')).toBeAttached({ timeout: 30_000 });
    const L = await layout(page);
    if (L.size === 'phone') {
      await page.getByRole('button', { name: 'drums: extract, download, spectrogram, level' }).click();
      await page.getByRole('dialog', { name: 'drums' }).getByRole('button', { name: 'Extract a sample' }).click();
    } else {
      await page.locator('[data-ready] > div').filter({ has: page.locator('[data-lane="drums.wav"]') }).getByRole('button', { name: 'Extract', exact: true }).click();
    }
    await expect(page.getByRole('textbox', { name: 'Sample name' })).toBeVisible();
    await check('extract');
    expect(small).toEqual([]);
  });
});

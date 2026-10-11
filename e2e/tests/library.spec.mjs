import {
  test,
  expect,
  PAGE_SIZE,
  uid,
  tagged,
  pool,
  openLibrary,
  prefs,
  rows,
  rowById,
  rowIds,
  toolbar,
  bottomBar,
  press,
  hashQuery,
  filterControls,
  noHorizontalOverflow,
} from './library/helpers.mjs';

// The Library list (#/library): paging, sorting, search and filters kept in
// the URL, select-all-matched, and layout on every device profile. Editing,
// audition, download and Arrange: library-edit.spec.mjs. Selection, bulk
// actions and import: library-bulk.spec.mjs.
//
// Every test here reads the worker's `paging` set (104 samples under one
// tag, more than one page) and filters the list by that tag, so other rows
// in the database never count.

/** The "N of M" count: the toolbar heading, or the phone's filter strip. */
async function expectCount(page, ui, matched, total) {
  if (ui.phone) await expect(page.getByText(/^\d+ of \d+$/)).toHaveText(`${matched} of ${total}`);
  else await expect(page.locator('h2').first()).toContainText(`${matched} of ${total}`);
}

/** The value a sort orders by (for comparing the UI's order with the server's). */
const SORT_VALUE = {
  newest: (s) => s.created_at,
  oldest: (s) => s.created_at,
  name: (s) => s.name,
  '-name': (s) => s.name,
  bpm: (s) => s.bpm,
  '-bpm': (s) => s.bpm,
  duration: (s) => s.duration_sec,
  '-duration': (s) => s.duration_sec,
  key: (s) => `${s.key}|${s.name}`,
};

async function expectOrder(page, api, tag, sort) {
  const ref = await api.get(`/samples?tags=${tag}&sort=${sort}&limit=${PAGE_SIZE}`);
  const byId = new Map((await tagged(api, tag)).samples.map((s) => [s.id, s]));
  const value = SORT_VALUE[sort];
  await expect
    .poll(async () => (await rowIds(page)).map((id) => value(byId.get(id))), { message: `rows in ${sort} order` })
    .toEqual(ref.samples.map(value));
}

test.describe('list', () => {
  test('first page, counts, thumbnails, then Load more', async ({ page, api, paging }) => {
    const ui = await openLibrary(page, `tags=${paging.tag}`);
    const { total } = await api.get('/samples?limit=1');
    await expect(rows(page)).toHaveCount(PAGE_SIZE);
    await expectCount(page, ui, paging.count, total);
    if (!ui.phone) {
      // waveform thumbnails drawn from the peaks endpoint
      await expect.poll(() => page.locator('[data-library-list] [role=row] svg path').count()).toBeGreaterThan(5);
    }
    const more = page.getByRole('button', { name: `Load more (${paging.count - PAGE_SIZE} left)` });
    // clicked where it is: scrolling to it would let the infinite scroll load first
    await more.evaluate((b) => b.click());
    await expect(rows(page)).toHaveCount(paging.count);
    await expect(page.getByText(`${paging.count} samples`, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Load more/ })).toHaveCount(0);
  });

  test('infinite scroll loads the next page', async ({ page, paging }) => {
    await openLibrary(page, `tags=${paging.tag}`);
    await expect(rows(page)).toHaveCount(PAGE_SIZE);
    await expect
      .poll(async () => {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        return rows(page).count();
      })
      .toBe(paging.count);
  });

  test('every sort option orders the rows like the server', async ({ page, api, paging }) => {
    const ui = await openLibrary(page, `tags=${paging.tag}`);
    const f = await filterControls(page, ui);
    for (const sort of ['name', '-name', 'bpm', '-bpm', 'duration', '-duration', 'key', 'oldest', 'newest']) {
      await f.scope.locator(f.sort).selectOption(sort);
      await expect.poll(async () => (await hashQuery(page)).sort).toBe(sort === 'newest' ? undefined : sort);
      await expectOrder(page, api, paging.tag, sort);
    }
    await f.close();
  });

  test('column headers sort both ways and say so', async ({ page, api, paging }) => {
    const ui = await openLibrary(page, `tags=${paging.tag}`);
    test.skip(ui.phone, 'phone cards have no column header');
    const header = (name) => page.getByRole('columnheader').getByRole('button', { name: new RegExp(`^${name}`) });
    const steps = [
      ['Name', 'name', 'ascending'],
      ['Name', '-name', 'descending'],
      ['BPM', 'bpm', 'ascending'],
      ['BPM', '-bpm', 'descending'],
      ...(ui.size === 'desktop' ? [['Length', 'duration', 'ascending']] : []), // no Length column on tablets
      ['Key', 'key', 'ascending'],
    ];
    for (const [name, sort, dir] of steps) {
      await press(header(name), ui);
      await expect.poll(async () => (await hashQuery(page)).sort).toBe(sort);
      const cell = page.getByRole('columnheader').filter({ has: page.getByRole('button', { name: new RegExp(`^${name}`) }) });
      await expect(cell).toHaveAttribute('aria-sort', dir);
      await expectOrder(page, api, paging.tag, sort);
    }
  });
});

test.describe('search and filters', () => {
  test('search matches name, tag and source stem, in Korean too; Escape clears it', async ({ page, api, paging }) => {
    const ui = await openLibrary(page, `tags=${paging.tag}`);
    const { total } = await api.get('/samples?limit=1');
    const search = page.getByRole('searchbox', { name: 'Search samples' });
    for (const q of ['Bass', '샘플', 'lofi', 'vocals', '패드']) {
      const ref = await tagged(api, paging.tag, { q });
      expect(ref.matched, `seed has matches for "${q}"`).toBeGreaterThan(0);
      await search.fill(q);
      await expect.poll(async () => (await hashQuery(page)).q).toBe(q);
      await expect.poll(async () => (await rowIds(page)).sort()).toEqual(ref.samples.map((s) => s.id).sort());
      await expectCount(page, ui, ref.matched, total);
    }
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect.poll(async () => (await hashQuery(page)).q).toBeUndefined();
  });

  test('tag filter: every chosen tag must match', async ({ page, api, paging }) => {
    const ui = await openLibrary(page, `tags=${paging.tag}`);
    let scope;
    let close;
    const tagButton = page.locator('button[title="Filter by tags"], button[title^="Tags:"]');
    if (!ui.phone && (await tagButton.isVisible())) {
      await press(tagButton, ui);
      scope = page.getByRole('dialog', { name: 'Filter by tags' });
      close = async () => {
        await page.keyboard.press('Escape');
        await expect(scope).toBeHidden();
      };
    } else {
      const f = await filterControls(page, ui);
      scope = f.scope;
      close = f.close;
    }
    const box = (name) => scope.getByRole('checkbox', { name: new RegExp(`^${name} ?\\d*$`) });
    await expect(box(paging.tag)).toBeChecked();
    await press(box('loop'), ui);
    await expect.poll(async () => (await hashQuery(page)).tags).toBe(`${paging.tag},loop`);
    await press(box('drums'), ui);
    await expect.poll(async () => (await hashQuery(page)).tags).toBe(`${paging.tag},loop,drums`);
    await close();
    const ref = await tagged(api, `${paging.tag},loop,drums`);
    expect(ref.matched).toBeGreaterThan(0);
    await expect.poll(async () => (await rowIds(page)).sort()).toEqual(ref.samples.map((s) => s.id).sort());
  });

  test('key filter, with Camelot key names', async ({ page, paging }) => {
    const ui = await openLibrary(page, `tags=${paging.tag}`);
    const f = await filterControls(page, ui);
    await f.scope.locator(f.key).selectOption('C# minor');
    await expect.poll(async () => (await hashQuery(page)).key).toBe('C# minor');
    if (f.sheet) await f.close();
    // detected from the chord clip (no override)
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Synth #1 stab');
    await expect(rows(page).first()).toContainText('C# min');

    if (ui.phone) {
      const g = await filterControls(page, ui);
      await press(g.scope.getByRole('button', { name: 'C maj', exact: true }), ui);
      await expect(g.scope.locator(g.key).locator('option:checked')).toHaveText('12A · C# min');
      await g.close();
    } else {
      await press(page.getByRole('button', { name: 'More library actions' }), ui);
      await press(page.getByRole('menuitem', { name: /Key names: plain/ }), ui);
      const g = await filterControls(page, ui);
      await expect(g.scope.locator(g.key).locator('option:checked')).toHaveText('12A · C# min');
      if (g.sheet) await g.close();
    }
    await expect(rows(page).first()).toContainText('12A · C# min');
  });

  test('BPM range takes a decimal comma', async ({ page, api, paging }) => {
    const ui = await openLibrary(page, `tags=${paging.tag}`);
    const f = await filterControls(page, ui);
    const min = f.scope.getByRole('textbox', { name: 'BPM min' });
    const max = f.scope.getByRole('textbox', { name: 'BPM max' });
    await min.fill('95,5');
    await min.press('Enter');
    await max.fill('130');
    await max.press('Enter');
    await expect.poll(async () => hashQuery(page)).toMatchObject({ bpm_min: '95.5', bpm_max: '130' });
    await expect(min).toHaveValue('95.5');
    await f.close();
    const ref = await tagged(api, paging.tag, { bpm_min: '95.5', bpm_max: '130' });
    const names = ref.samples.map((s) => s.name);
    expect(names).toContain('Brass Bb'); // 96
    expect(names).toContain('Piano Chords C'); // 128
    expect(names).not.toContain('Pad 패드 A minor'); // 90
    expect(names).not.toContain('Synth #1 stab'); // 140
    await expect
      .poll(async () => (await rowIds(page)).sort())
      .toEqual(ref.samples.slice(0, PAGE_SIZE).map((s) => s.id).sort());
  });

  test('filters live in the URL: reload and Back keep them, Clear empties them', async ({ page, api, paging }) => {
    const ui = await openLibrary(page, `tags=${paging.tag}&sort=name`);
    await page.getByRole('searchbox', { name: 'Search samples' }).fill('샘플');
    await expect.poll(async () => (await hashQuery(page)).q).toBe('샘플');
    const hash = await page.evaluate(() => location.hash);
    const ref = await tagged(api, paging.tag, { q: '샘플', sort: 'name' });
    const names = ref.samples.map((s) => s.id);

    await page.reload();
    await expect(page.getByRole('searchbox', { name: 'Search samples' })).toHaveValue('샘플');
    await expect.poll(() => rowIds(page)).toEqual(names);

    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Split', exact: true }).click();
    await expect(page).toHaveURL(/#\/split/);
    await page.goBack();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(hash);
    await expect.poll(() => rowIds(page)).toEqual(names);

    await press(page.getByRole('button', { name: 'Clear', exact: true }), ui);
    // filters go, the sort stays
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/library?sort=name');
    await expect(page.getByRole('searchbox', { name: 'Search samples' })).toHaveValue('');
  });

  test('no match: an empty state that clears the filters', async ({ page, paging }) => {
    const ui = await openLibrary(page, `tags=${paging.tag}&q=zz${uid()}`);
    await expect(page.getByText('No samples match these filters.')).toBeVisible();
    await press(page.getByRole('button', { name: 'Clear filters' }), ui);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/library');
    await expect(rows(page).first()).toBeVisible();
  });
});

test('select all matched (beyond the loaded page), tag them all, then untag', async ({ page, api, paging }) => {
  const ui = await openLibrary(page, `tags=${paging.tag}`);
  const extra = `all${uid()}`;
  const count = async () => (await tagged(api, `${paging.tag},${extra}`)).matched;
  let tagScope;
  if (ui.phone) {
    await press(page.getByRole('button', { name: 'Select samples' }), ui);
    await press(bottomBar(page).getByRole('button', { name: 'More bulk actions' }), ui);
    await press(page.getByRole('menuitem', { name: `Select all ${paging.count} matched` }), ui);
    await expect(bottomBar(page)).toContainText(`${paging.count} selected`);
    await press(bottomBar(page).getByRole('button', { name: 'Tag', exact: true }), ui);
    tagScope = page.getByRole('dialog', { name: `Tags for ${paging.count} samples` });
  } else {
    await press(page.getByRole('checkbox', { name: 'Select all loaded samples' }), ui);
    await expect(toolbar(page)).toContainText(`${PAGE_SIZE} selected`);
    await press(toolbar(page).getByRole('button', { name: `Select all ${paging.count}` }), ui);
    await expect(toolbar(page)).toContainText(`${paging.count} selected`);
    await press(toolbar(page).getByRole('button', { name: 'Tag…' }), ui);
    tagScope = page.getByRole('dialog', { name: `Tags for ${paging.count} samples` });
  }
  const input = tagScope.getByRole('combobox', { name: `Add tags to ${paging.count} samples` });
  await input.fill(extra);
  await input.press('Enter');
  await expect.poll(count, { timeout: 30_000, message: 'every matched sample tagged' }).toBe(paging.count);
  await press(tagScope.getByRole('button', { name: `${extra} ×` }), ui);
  await expect.poll(count, { timeout: 30_000, message: 'tag removed from all' }).toBe(0);
});

test.describe('layout', () => {
  test('no sideways scroll; the toolbar never clips its controls', async ({ page, paging }) => {
    for (const query of [`tags=${paging.tag}`, `tags=${paging.tag},loop&q=a&key=A+minor&bpm_min=100.5&bpm_max=130&sort=-duration`]) {
      const ui = await openLibrary(page, query);
      await noHorizontalOverflow(page);
      const vw = page.viewportSize().width;
      const controls = ui.phone
        ? [page.getByRole('button', { name: /^Filters and options/ }), page.getByRole('button', { name: 'Select samples' }), page.getByRole('button', { name: 'Import audio files' })]
        : [page.getByRole('button', { name: 'Import', exact: true }), page.getByRole('button', { name: 'More library actions' })];
      for (const c of controls) {
        const b = await c.boundingBox();
        expect(b, 'control rendered').not.toBeNull();
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, 'control inside the viewport').toBeLessThanOrEqual(vw + 0.5);
      }
    }
  });

  test('the bulk bar fits too', async ({ page, paging }) => {
    const ui = await openLibrary(page, `tags=${paging.tag}`);
    const vw = page.viewportSize().width;
    if (ui.phone) await press(page.getByRole('button', { name: 'Select samples' }), ui);
    for (const i of [0, 1, 2]) await press(rows(page).nth(i).locator('label').first(), ui);
    const bar = ui.phone ? bottomBar(page) : toolbar(page);
    await expect(bar).toContainText('3 selected');
    await noHorizontalOverflow(page);
    for (const b of await bar.getByRole('button').all()) {
      const box = await b.boundingBox();
      if (!box) continue;
      expect(box.x + box.width, `${await b.getAttribute('aria-label') || await b.textContent()} inside`).toBeLessThanOrEqual(vw + 0.5);
    }
  });

  test('touch targets are at least 44 px', async ({ page, paging }) => {
    const ui = await openLibrary(page, `tags=${paging.tag}`);
    test.skip(!ui.coarse, 'mouse layouts use compact targets');
    const small = await page.evaluate(() => {
      const out = [];
      const check = (el, what) => {
        const r = el.getBoundingClientRect();
        if (r.width && (r.width < 43.5 || r.height < 43.5)) out.push(`${what} ${Math.round(r.width)}x${Math.round(r.height)}`);
      };
      for (const row of [...document.querySelectorAll('[data-library-list] [role=rowgroup] > [role=row]')].slice(0, 3)) {
        row.querySelectorAll('button[aria-label^="Play"], button[aria-label^="More for"], button[aria-label^="Actions for"]').forEach((b) => check(b, b.getAttribute('aria-label').split(' ')[0]));
        const label = row.querySelector('label');
        if (label) check(label, 'checkbox cell');
      }
      document.querySelector('div.sticky.z-20').querySelectorAll('button, input, select').forEach((el) => {
        if (el.getClientRects().length) check(el, `toolbar "${el.getAttribute('aria-label') || el.textContent.trim()}"`);
      });
      document.querySelectorAll('[role=columnheader] button, [role=columnheader] label').forEach((el) => check(el, `header "${el.textContent.trim() || 'checkbox'}"`));
      return out;
    });
    expect(small).toEqual([]);
  });

  test('menus and sheets open inside the viewport', async ({ page, paging }) => {
    const ui = await openLibrary(page, `tags=${paging.tag}`);
    const vp = page.viewportSize();
    const inside = async (loc) => {
      const b = await loc.boundingBox();
      expect(b.y).toBeGreaterThanOrEqual(-0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 1);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 1);
    };
    // the lowest fully visible row's actions
    const idx = await page.evaluate(() => {
      let k = 0;
      document.querySelectorAll('[data-library-list] [role=rowgroup] > [role=row]').forEach((r, i) => {
        if (r.getBoundingClientRect().bottom <= window.innerHeight - 70) k = i;
      });
      return k;
    });
    const row = rows(page).nth(idx);
    if (ui.phone) {
      await press(row.getByRole('button', { name: /^Actions for/ }), ui);
      const sheet = page.getByRole('dialog').last();
      await inside(sheet);
      const last = sheet.getByRole('menuitem').last();
      await last.scrollIntoViewIfNeeded();
      await inside(last);
      await page.keyboard.press('Escape');
      const f = await filterControls(page, ui);
      await inside(f.scope);
      const reanalyze = f.scope.getByRole('button', { name: /Re-analyze all/ });
      await reanalyze.scrollIntoViewIfNeeded();
      await inside(reanalyze);
      await f.close();
    } else {
      await press(row.getByRole('button', { name: /^More for/ }), ui);
      await inside(page.getByRole('dialog', { name: /^Actions for/ }));
      await page.keyboard.press('Escape');
    }
  });

  test('↓ keeps the selected row clear of the sticky bars', async ({ page, paging }) => {
    await prefs(page, { 'library:auto': false });
    const ui = await openLibrary(page, `tags=${paging.tag}`);
    test.skip(ui.phone || ui.coarse, 'keyboard browsing (desktop)');
    await rows(page).nth(0).locator('[role=gridcell]').nth(3).click();
    for (let i = 0; i < 30; i += 1) await page.keyboard.press('ArrowDown');
    const selected = page.locator('[data-library-list] [role=row][aria-selected=true]');
    await expect(selected).toHaveAttribute('data-id', (await rowIds(page))[30]);
    await expect(selected).toBeFocused();
    const header = await page.locator('[data-library-list] > [role=row]').boundingBox();
    const box = await selected.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height + 1);
  });
});

// ---------------------------------------------------------------------------
// Known bugs: each test asserts the correct behaviour and is marked to fail.

test.describe('known bugs', () => {
  test('ties in length page and order the same at any page size', async ({ page, api, lib }) => {
    test.setTimeout(120_000);
    const tag = `tie${uid()}`;
    const job = await lib.job();
    // 120 samples, all 0.25 s: more than one page of ties
    const made = await pool(Array.from({ length: 120 }, (_, i) => i), 4, (i) =>
      api.cutSample(job, { track: ['drums.wav', 'bass.wav', 'other.wav'][i % 3], start: (i % 30) * 0.5, end: (i % 30) * 0.5 + 0.25, name: `Tie ${i}`, tags: [tag] })
    );
    try {
      await openLibrary(page, `tags=${tag}&sort=duration`);
      await expect
        .poll(async () => {
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          return rows(page).count();
        })
        .toBe(made.length);
      expect(new Set(await rowIds(page)).size, 'every sample listed once').toBe(made.length);
      // the list's pages (100), its refresh/restore (more) and "Select all" (all)
      // must agree on one order, or rows move, repeat or go missing between them
      const ids = async (limit) => (await api.get(`/samples?tags=${tag}&sort=duration&limit=${limit}`)).samples.slice(0, 10).map((s) => s.id);
      const [ten, hundred, all] = [await ids(10), await ids(100), await ids(0)];
      expect(ten, 'first rows with limit=10 vs limit=100').toEqual(hundred);
      expect(hundred, 'first rows with limit=100 vs everything').toEqual(all);
    } finally {
      await pool(made, 4, (s) => api.del(`/samples/${s.id}`));
    }
  });

  test('↑ keeps the selected row clear of the sticky bars', async ({ page, paging, browserName }) => {
    test.skip(browserName !== 'chromium', 'scrollIntoView(nearest) with scroll-margin only verified on Chromium');
    await prefs(page, { 'library:auto': false });
    const ui = await openLibrary(page, `tags=${paging.tag}`);
    test.skip(ui.phone || ui.coarse, 'keyboard browsing (desktop)');
    await rows(page).nth(0).locator('[role=gridcell]').nth(3).click();
    for (let i = 0; i < 30; i += 1) await page.keyboard.press('ArrowDown');
    const selected = page.locator('[data-library-list] [role=row][aria-selected=true]');
    const header = page.locator('[data-library-list] > [role=row]');
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('ArrowUp');
      // the row is focused and scrolled in the next frame, not by the time press() returns
      await expect(selected).toBeFocused();
      const [h, s] = [await header.boundingBox(), await selected.boundingBox()];
      expect(s.y, `after ↑ ×${i + 1} the selected row starts below the sticky header`).toBeGreaterThanOrEqual(h.y + h.height - 1);
    }
  });

  test('coming back through the header tab restores the list scroll', async ({ page, paging }) => {
    await prefs(page, { 'library:auto': false });
    const ui = await openLibrary(page, `tags=${paging.tag}`);
    const target = rows(page).nth(60);
    await target.scrollIntoViewIfNeeded();
    const id = await target.getAttribute('data-id');
    await press(ui.phone ? target.locator('[data-card-body]') : target.locator('[role=gridcell]').nth(3), ui);
    await expect(rowById(page, id)).toHaveAttribute('aria-selected', 'true');
    const y = await page.evaluate(() => window.scrollY);
    expect(y).toBeGreaterThan(500);
    const nav = page.getByRole('navigation', { name: 'Sections' });
    // click the tab where it is: locator.click() first scrolls the sticky
    // header's link "into view", which moves the page before it is left
    const split = await nav.getByRole('link', { name: 'Split', exact: true }).boundingBox();
    await page.mouse.click(split.x + split.width / 2, split.y + split.height / 2);
    await expect(page).toHaveURL(/#\/split/);
    await nav.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(rowById(page, id)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 3000 }).toBeGreaterThan(y - 40);
  });

  test('a touch-sized select keeps its chevron level with its text', async ({ page, paging }) => {
    const ui = await openLibrary(page, `tags=${paging.tag}`);
    test.skip(!ui.coarse, 'only touch layouts grow selects to 44 px');
    const f = await filterControls(page, ui);
    const select = f.scope.locator(f.sort);
    const m = await select.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const size = parseFloat(cs.backgroundSize.split(' ')[1] || cs.backgroundSize) || 16;
      // a length, or a percentage of the free height of the background's origin box
      const [pt, pb] = cs.backgroundOrigin === 'content-box' ? [parseFloat(cs.paddingTop), parseFloat(cs.paddingBottom)] : [0, 0];
      const y = cs.backgroundPositionY;
      const top = parseFloat(cs.borderTopWidth) + pt + (y.endsWith('%') ? (parseFloat(y) / 100) * (el.clientHeight - pt - pb - size) : parseFloat(y) || 0);
      return { height: r.height, chevronCentre: top + size / 2 };
    });
    test.skip(m.height < 43.5, 'touch sizing not applied in this engine');
    expect(Math.abs(m.chevronCentre - m.height / 2), 'chevron centre vs text centre (px)').toBeLessThanOrEqual(4);
  });
});

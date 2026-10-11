import {
  test,
  expect,
  uid,
  fresh,
  waitAnalysed,
  media,
  openLibrary,
  prefs,
  rows,
  rowById,
  rowIds,
  bottomBar,
  press,
  audio,
  expectPlaying,
  expectStopped,
  filterControls,
  openActions,
  openInspector,
  clearProjects,
  downloadName,
  toast,
  track,
} from './library/helpers.mjs';

// One sample at a time in the Library: audition (▶, keyboard, waveform
// seek, Sync), editing in the docked inspector or the Edit sheet (name,
// tags, BPM, key, re-analyze, delete), single WAV download, Add to Arrange
// and Open in Split. Each test cuts its own samples and lists only them
// (?tags=<its tag>).

/**
 * Fresh samples for this test, listed alone. `patch` (BPM/key overrides) is
 * applied before the list loads: the page only re-reads samples that are
 * still being analysed. Returns { tag, samples, ui }.
 */
async function setup(page, api, lib, specs, { patch = null } = {}) {
  const tag = `t${uid()}`;
  let samples = await fresh(api, await lib.job(), tag, specs);
  // analysed first, so nothing on the page changes underneath the test
  // (and a card's "Analyzing…" note, which swallows taps, is gone)
  await waitAnalysed(api, samples.map((s) => s.id));
  if (patch) samples = await Promise.all(samples.map((s) => api.patch(`/samples/${s.id}`, patch)));
  const ui = await openLibrary(page, `tags=${tag}`);
  await expect(rows(page)).toHaveCount(samples.length);
  return { tag, samples, ui };
}

const nav = (page) => page.getByRole('navigation', { name: 'Sections' });

test.describe('audition', () => {
  test('▶ plays a sample and stops it', async ({ page, api, lib }) => {
    const { samples, ui } = await setup(page, api, lib, [{ name: 'Play me', len: 4 }, { name: 'Other one', len: 4 }]);
    const [s] = samples;
    const row = rowById(page, s.id);
    await press(row.getByRole('button', { name: `Play ${s.name}` }), ui);
    await expectPlaying(page, s.id);
    await expect(row.getByRole('button', { name: `Stop ${s.name}` })).toHaveAttribute('aria-pressed', 'true');
    await press(row.getByRole('button', { name: `Stop ${s.name}` }), ui);
    await expectStopped(page);
    await expect(row.getByRole('button', { name: `Play ${s.name}` })).toHaveAttribute('aria-pressed', 'false');
  });

  test('keyboard: click auditions, Space toggles, ↓/↑ follow with Auto, L loops (Hangul layout too)', async ({ page, api, lib }) => {
    await prefs(page, { 'library:auto': true, 'library:loop': false });
    const { samples, ui } = await setup(page, api, lib, [0, 1, 2, 3].map((i) => ({ name: `Key ${i}`, len: 4 })));
    test.skip(ui.phone || ui.coarse, 'keyboard browsing (desktop)');
    const ids = await rowIds(page);
    await rowById(page, ids[1]).locator('[role=gridcell]').nth(3).click();
    await expect(rowById(page, ids[1])).toHaveAttribute('aria-selected', 'true');
    await expectPlaying(page, ids[1]);
    await page.keyboard.press('Space');
    await expectStopped(page);
    await page.keyboard.press('Space');
    await expectPlaying(page, ids[1]);
    await page.keyboard.press('ArrowDown');
    await expect(rowById(page, ids[2])).toHaveAttribute('aria-selected', 'true');
    await expect(rowById(page, ids[2])).toBeFocused();
    await expectPlaying(page, ids[2]);
    await page.keyboard.press('ArrowUp');
    await expectPlaying(page, ids[1]);

    // Auto and Loop are toolbar words on a wide screen, ⋯ entries otherwise
    const loopWord = page.getByRole('button', { name: 'Loop', exact: true });
    const loopOn = async (on) => {
      await expect.poll(async () => (await audio(page)).loop).toBe(on);
      if (ui.wide) await expect(loopWord).toHaveAttribute('aria-pressed', String(on));
    };
    await page.keyboard.press('l');
    await loopOn(true);
    // a Hangul layout sends 'ㅣ' for the L key
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ㅣ', code: 'KeyL', bubbles: true })));
    await loopOn(false);

    // Auto off: arrows only select
    await page.keyboard.press('Escape');
    await expectStopped(page);
    if (ui.wide) {
      await page.getByRole('button', { name: 'Auto', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Auto', exact: true })).toHaveAttribute('aria-pressed', 'false');
    } else {
      await page.getByRole('button', { name: 'More library actions' }).click();
      await page.getByRole('menuitem', { name: 'Auto-play on select: on' }).click();
    }
    await rowById(page, ids[0]).locator('[role=gridcell]').nth(3).click();
    await page.keyboard.press('ArrowDown');
    await expect(rowById(page, ids[1])).toHaveAttribute('aria-selected', 'true');
    await expectStopped(page);
    expect(samples).toHaveLength(4);
  });

  test('clicking the waveform starts at that point, and seeks while playing', async ({ page, api, lib, browserName }) => {
    const { samples, ui } = await setup(page, api, lib, [{ name: 'Eight seconds', track: 'vocals.wav', start: 2, len: 8 }]);
    test.skip(ui.phone, 'phone cards have no waveform (see the now-playing bar test)');
    const [s] = samples;
    const wave = rowById(page, s.id).locator('[role=gridcell]').nth(2).locator('div').first();
    await expect(wave.locator('svg path').first()).toBeAttached();
    const box = await wave.boundingBox();
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
    await expectPlaying(page, s.id);
    if (browserName === 'chromium') {
      await expect.poll(async () => (await audio(page)).time).toBeGreaterThan(5.5);
      await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
      await expect.poll(async () => (await audio(page)).time).toBeLessThan(4);
    }
  });

  test('Sync without a project: a typed tempo, committed on Enter or blur, renders once', async ({ page, api, lib }) => {
    await clearProjects(api); // with a project, Sync follows its tempo instead
    // a known tempo (no wait for analysis)
    const { samples, ui } = await setup(page, api, lib, [{ name: 'Sync me', track: 'bass.wav', len: 4 }], { patch: { bpm: 120 } });
    const [s] = samples;
    await expect(rowById(page, s.id)).toContainText('120');
    await press(rowById(page, s.id).getByRole('button', { name: `Play ${s.name}` }), ui);
    await expectPlaying(page, s.id);

    const f = ui.phone ? await filterControls(page, ui) : { scope: page, close: async () => {} };
    await press(f.scope.getByRole('button', { name: 'Sync', exact: true }), ui);
    await expectPlaying(page, s.id, { render: '/render?bpm=120&' });
    const field = f.scope.getByRole('textbox', { name: 'Preview tempo (BPM)' });
    await expect(field).toHaveValue('120');

    const renders = track(page, /\/render\?/);
    const tempos = () => [...new Set(renders.map((u) => new URL(u).searchParams.get('bpm')))];
    await field.fill('');
    await field.pressSequentially('92,5', { delay: 60 });
    await expect(field).toHaveValue('92,5');
    expect(tempos(), 'no render while typing').toEqual([]);
    await field.press('Enter');
    await expectPlaying(page, s.id, { render: '/render?bpm=92.5&' });
    await expect(field).toHaveValue('92.5');
    expect(tempos()).toEqual(['92.5']);

    renders.length = 0;
    await field.fill('100');
    await field.blur();
    await expectPlaying(page, s.id, { render: '/render?bpm=100&' });
    expect(tempos()).toEqual(['100']);

    await field.fill('77');
    await field.press('Escape');
    await expect(field).toHaveValue('100');
    await f.close();
  });

  test('phone: the now-playing bar seeks, loops, syncs and stops', async ({ page, api, lib }) => {
    await prefs(page, { 'library:auto': true, 'library:loop': false, 'library:sync': false });
    const { samples, ui } = await setup(page, api, lib, [{ name: 'Bar sample', track: 'vocals.wav', start: 2, len: 8 }], { patch: { bpm: 120 } });
    test.skip(!ui.phone, 'phone layout');
    const [s] = samples;
    await press(rowById(page, s.id).locator('[data-card-body]'), ui);
    await expectPlaying(page, s.id);
    const bar = bottomBar(page);
    await expect(bar).toContainText(s.name);
    for (const b of await bar.getByRole('button').all()) {
      const box = await b.boundingBox();
      expect(Math.min(box.width, box.height), 'bar targets ≥ 44 px').toBeGreaterThanOrEqual(43.5);
    }
    const wave = bar.locator('div.relative.cursor-pointer').first();
    const wb = await wave.boundingBox();
    await page.touchscreen.tap(wb.x + wb.width * 0.5, wb.y + wb.height / 2);
    await expect.poll(async () => (await audio(page)).time).toBeGreaterThan(3);
    await press(bar.getByRole('button', { name: 'Loop' }), ui);
    await expect.poll(async () => (await audio(page)).loop).toBe(true);
    await press(bar.getByRole('button', { name: /^Sync/ }), ui);
    await expectPlaying(page, s.id, { render: '/render?' });
    await press(bar.getByRole('button', { name: `Stop ${s.name}` }), ui);
    await expectStopped(page);
    await expect(bar.getByRole('button', { name: `Stop ${s.name}` })).toHaveCount(0);
  });

  test('leaving the Library stops the preview', async ({ page, api, lib }) => {
    const { samples, ui } = await setup(page, api, lib, [{ name: 'Leave me', len: 4 }]);
    await press(rowById(page, samples[0].id).getByRole('button', { name: /^Play / }), ui);
    await expectPlaying(page, samples[0].id);
    await nav(page).getByRole('link', { name: 'Split', exact: true }).click();
    await expect(page).toHaveURL(/#\/split/);
    await expectStopped(page);
  });
});

test.describe('editing', () => {
  test.beforeEach(async ({ page }) => prefs(page, { 'library:auto': false }));

  test('rename: Enter, double-click, ⋯ → Rename and the inspector; Escape cancels; blank is ignored', async ({ page, api, lib }) => {
    const { samples, ui } = await setup(page, api, lib, [{ name: 'Old name' }]);
    const [s] = samples;
    const name = async () => (await api.get(`/samples/${s.id}`)).name;
    const inline = rowById(page, s.id).getByRole('textbox', { name: 'Sample name' });

    if (ui.size === 'desktop' && !ui.coarse) {
      await rowById(page, s.id).locator('[role=gridcell]').nth(3).click();
      await page.keyboard.press('Enter');
      await expect(inline).toBeFocused();
      await page.keyboard.type('Renamed by Enter');
      await page.keyboard.press('Enter');
      await expect.poll(name).toBe('Renamed by Enter');

      await rowById(page, s.id).locator('[role=gridcell]').nth(3).dblclick();
      if (ui.wide) {
        await expect(inline).toBeFocused();
        await page.keyboard.type('not saved');
        await page.keyboard.press('Escape');
        await expect(inline).toHaveCount(0);
      } else {
        // not docked: a double-click opens the editor sheet
        const sheet = page.getByRole('dialog', { name: /^Edit / });
        await expect(sheet).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
      }
      expect(await name()).toBe('Renamed by Enter');
    }

    if (!ui.phone) {
      const current = await name();
      const menu = await openActions(page, ui, current);
      await press(menu.getByRole('menuitem', { name: /^Rename/ }), ui);
      await expect(inline).toBeFocused();
      await inline.fill('베이스 리네임 #2');
      await inline.press('Enter');
      await expect.poll(name).toBe('베이스 리네임 #2');
    }

    const now = { ...s, name: await name() };
    const ed = await openInspector(page, ui, now);
    await press(ed.scope.getByRole('button', { name: now.name, exact: true }), ui);
    const field = ed.scope.getByRole('textbox', { name: 'Sample name' });
    await field.fill('Via inspector');
    await field.press('Enter');
    await expect.poll(name).toBe('Via inspector');
    await press(ed.scope.getByRole('button', { name: 'Via inspector', exact: true }), ui);
    await field.fill('   ');
    await field.press('Enter');
    await expect(ed.scope.getByRole('button', { name: 'Via inspector', exact: true })).toBeVisible();
    expect(await name()).toBe('Via inspector');
    await ed.close();
  });

  test('tags: Enter and comma add and keep focus, × removes, Escape drops a draft, blur keeps one', async ({ page, api, lib }) => {
    const { samples, ui } = await setup(page, api, lib, [{ name: 'Tag me', tags: ['base'] }]);
    const [s] = samples;
    const tags = async () => (await api.get(`/samples/${s.id}`)).tags;
    const ed = await openInspector(page, ui, s);
    const field = ed.scope.locator(`input[aria-label="Add tag to ${s.name}"]`);
    await press(field, ui);
    await page.keyboard.type('alpha');
    await page.keyboard.press('Enter');
    await expect(field).toBeFocused();
    await page.keyboard.type('beta,');
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('');
    await page.keyboard.insertText('Gamma One,  delta');
    await page.keyboard.press('Enter');
    await expect.poll(tags).toEqual(expect.arrayContaining(['alpha', 'beta', 'gamma one', 'delta']));
    await expect(field).toBeFocused();

    await press(ed.scope.getByRole('button', { name: 'Remove tag alpha' }), ui);
    await expect.poll(tags).not.toContain('alpha');

    // Backspace in the empty field is the field's, not "delete this sample"
    await press(field, ui);
    await page.keyboard.press('Backspace');
    await expect(page.getByText('Delete?', { exact: true })).toHaveCount(0);

    await page.keyboard.type('dropme');
    await page.keyboard.press('Escape');
    await expect(field).toHaveValue('');
    await page.keyboard.type('blurtag');
    await field.blur();
    await expect.poll(tags).toContain('blurtag');
    expect(await tags()).not.toContain('dropme');
    expect((await api.get(`/samples/${s.id}`)).id).toBe(s.id);
    await ed.close();
  });

  test('BPM: ×2, ÷2, typed with a decimal comma, out of range ignored, Reset', async ({ page, api, lib }) => {
    const { samples, ui } = await setup(page, api, lib, [{ name: 'Tempo', track: 'bass.wav', start: 2, len: 4 }]);
    const [s] = samples;
    const [done] = await waitAnalysed(api, [s.id]);
    expect(done.bpm_detected, 'tempo detected').toBeTruthy();
    const detected = done.bpm_detected;
    const bpm = async () => (await api.get(`/samples/${s.id}`)).bpm;
    const ed = await openInspector(page, ui, s);
    await press(ed.scope.getByRole('button', { name: 'Double BPM' }), ui);
    await expect.poll(bpm).toBeCloseTo(detected * 2, 1);
    await press(ed.scope.getByRole('button', { name: 'Halve BPM' }), ui);
    await expect.poll(bpm).toBeCloseTo(detected, 1);
    const field = ed.scope.locator(`#bpm-${s.id}`);
    await field.fill('92,5');
    await field.press('Enter');
    await expect.poll(bpm).toBe(92.5);
    await expect(field).toHaveValue('92.5');
    if (!ui.phone && ui.wide) await expect(rowById(page, s.id)).toContainText('92.5');
    await field.fill('5000');
    await field.press('Enter');
    await expect(field).toHaveValue('92.5');
    expect(await bpm()).toBe(92.5);
    await expect(ed.scope.getByText(/^detected /)).toBeVisible();
    await press(ed.scope.getByRole('button', { name: 'Reset' }).first(), ui);
    await expect.poll(async () => (await api.get(`/samples/${s.id}`)).bpm_overridden).toBe(false);
    expect(await bpm()).toBe(detected);
    await ed.close();
  });

  test('tap tempo saves what was tapped; a fit-to-bars suggestion applies', async ({ page, api, lib }) => {
    const { samples, ui } = await setup(page, api, lib, [{ name: 'Tapped', track: 'other.wav', start: 2, len: 4 }], { patch: { bpm: 200 } });
    const [s] = samples;
    const bpm = async () => (await api.get(`/samples/${s.id}`)).bpm;
    const ed = await openInspector(page, ui, s);
    await expect(ed.scope.locator(`#bpm-${s.id}`)).toHaveValue('200');
    const tap = ed.scope.locator('button[title^="Tap along"]');
    const box = await tap.boundingBox();
    for (let i = 0; i < 5; i += 1) {
      if (ui.coarse) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      if (i < 4) await page.waitForTimeout(500); // the beat being tapped: 120 BPM
    }
    await expect(tap).toHaveText(/^Tap \d/);
    await expect.poll(bpm, { timeout: 6000, message: 'tapped tempo saved 2 s after the last tap' }).not.toBe(200);
    // 120 BPM tapped; slack for the time each tap takes to arrive on a busy machine
    expect(await bpm()).toBeGreaterThan(90);
    expect(await bpm()).toBeLessThan(130);

    const suggestion = ed.scope.getByRole('button', { name: /^Set [\d.]+ BPM \(\d+ bars?\)$/ }).first();
    const want = Number(/Set ([\d.]+) BPM/.exec(await suggestion.getAttribute('aria-label'))[1]);
    await press(suggestion, ui);
    await expect.poll(bpm).toBe(want);
    await ed.close();
  });

  test('key override and Reset; Re-analyze keeps the override', async ({ page, api, lib }) => {
    const { samples, ui } = await setup(page, api, lib, [{ name: 'Keyed', track: 'other.wav', start: 2, len: 4 }]);
    const [s] = samples;
    const [done] = await waitAnalysed(api, [s.id]);
    const other = done.key_detected === 'D minor' ? 'F major' : 'D minor';
    const get = () => api.get(`/samples/${s.id}`);
    const ed = await openInspector(page, ui, s);
    await ed.scope.locator(`#key-${s.id}`).selectOption(other);
    await expect.poll(async () => (await get()).key).toBe(other);
    expect((await get()).key_overridden).toBe(true);
    await press(ed.scope.getByRole('button', { name: 'Reset' }).last(), ui);
    await expect.poll(async () => (await get()).key_overridden).toBe(false);
    expect((await get()).key).toBe(done.key_detected);

    await ed.scope.locator(`#key-${s.id}`).selectOption(other);
    await expect.poll(async () => (await get()).key).toBe(other);
    await press(ed.scope.getByRole('button', { name: 'Re-analyze' }), ui);
    await expect.poll(async () => (await get()).analysis_status, { timeout: 30_000 }).toBe('done');
    expect((await get()).key).toBe(other);
    await expect(ed.scope.getByText('Analyzing…')).toHaveCount(0, { timeout: 10_000 });
    await ed.close();
  });

  test('Del asks first: focus on Cancel, Space/Enter keep the sample, Confirm deletes', async ({ page, api, lib }) => {
    const { samples, ui } = await setup(page, api, lib, [{ name: 'Keep A' }, { name: 'Delete B' }, { name: 'Keep C' }]);
    test.skip(ui.phone || ui.coarse, 'keyboard (desktop)');
    const victim = samples[1];
    const row = rowById(page, victim.id);
    const exists = async () => (await api.raw(`/samples/${victim.id}`)).status;
    const ids = await rowIds(page);
    await row.locator('[role=gridcell]').nth(3).click();

    await page.keyboard.press('Delete');
    await expect(row.getByText('Delete?')).toBeVisible();
    // the docked inspector asks too; either way focus is on a Cancel
    const focused = page.locator(':focus');
    await expect(focused).toHaveText('Cancel');
    await page.keyboard.press('Space');
    await expect(row.getByText('Delete?')).toHaveCount(0);
    expect(await exists()).toBe(200);

    await row.locator('[role=gridcell]').nth(3).click();
    await page.keyboard.press('Delete');
    await expect(focused).toHaveText('Cancel');
    await page.keyboard.press('Enter');
    await expect(row.getByText('Delete?')).toHaveCount(0);
    expect(await exists()).toBe(200);

    await row.locator('[role=gridcell]').nth(3).click();
    await page.keyboard.press('Backspace');
    await expect(row.getByText('Delete?')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(row.getByText('Delete?')).toHaveCount(0);

    await page.keyboard.press('Delete');
    await row.getByRole('button', { name: 'Confirm' }).click();
    await expect(row).toHaveCount(0);
    expect(await exists()).toBe(404);
    // the selection moves on to the neighbour
    const next = ids[ids.indexOf(victim.id) + 1];
    await expect(rowById(page, next)).toHaveAttribute('aria-selected', 'true');
  });

  test('delete from the inspector or the phone sheets', async ({ page, api, lib }) => {
    const { samples, ui } = await setup(page, api, lib, [{ name: 'Survivor' }, { name: 'Goner' }]);
    const victim = samples[1];
    const exists = async () => (await api.raw(`/samples/${victim.id}`)).status;
    if (ui.phone) {
      for (const choice of ['Cancel', 'Delete']) {
        const sheet = await openActions(page, ui, victim.name);
        await press(sheet.getByRole('menuitem', { name: /^Delete/ }), ui);
        const confirm = page.getByRole('dialog', { name: `Delete “${victim.name}”?` });
        await expect(confirm).toBeVisible();
        await press(confirm.getByRole('menuitem', { name: new RegExp(`^${choice}`) }), ui);
        await expect(confirm).toBeHidden();
      }
    } else {
      const ed = await openInspector(page, ui, victim);
      await press(ed.scope.getByRole('button', { name: 'Delete', exact: true }), ui);
      await expect(ed.scope.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await press(ed.scope.getByRole('button', { name: 'Cancel' }), ui);
      expect(await exists()).toBe(200);
      await press(ed.scope.getByRole('button', { name: 'Delete', exact: true }), ui);
      await press(ed.scope.getByRole('button', { name: 'Confirm' }), ui);
      if (!ed.docked) await expect(ed.scope).toBeHidden();
    }
    await expect.poll(exists).toBe(404);
    await expect(rows(page)).toHaveCount(1);
  });
});

test.describe('known bugs', () => {
  test('tapping a card on its "Analyzing…" note plays it like the rest of the card', async ({ page, api, lib }) => {
    test.fail(true, 'the note sits in a pointer-events-auto wrapper (kept for the failed state\'s Re-analyze button), so it swallows taps and long presses meant for the card (frontend/src/components/library/SampleCard.jsx:100)');
    await prefs(page, { 'library:auto': true });
    const tag = `t${uid()}`;
    const [s] = await fresh(api, await lib.job(), tag, [{ name: 'Busy', len: 4 }]);
    // keep it "analysing" for the page, however quickly the server finishes
    await page.route(/\/api\/samples(\?|\/[0-9a-f-]+$)/, async (route) => {
      try {
        if (route.request().method() !== 'GET') return await route.continue();
        const res = await route.fetch();
        const body = await res.json();
        const pending = (x) => ({ ...x, analysis_status: 'pending' });
        await route.fulfill({ response: res, json: body.samples ? { ...body, samples: body.samples.map(pending) } : pending(body) });
      } catch {
        // the page closed mid-poll
      }
    });
    const ui = await openLibrary(page, `tags=${tag}`);
    test.skip(!ui.phone, 'phone cards (rows keep the note out of the click target)');
    const note = rowById(page, s.id).getByText('Analyzing…');
    await expect(note).toBeVisible();
    await page.touchscreen.tap(...(await note.boundingBox().then((b) => [b.x + b.width / 2, b.y + b.height / 2])));
    await expectPlaying(page, s.id);
  });
});

test.describe('download and Arrange', () => {
  test.beforeEach(async ({ page }) => prefs(page, { 'library:auto': false }));

  test('Download WAV: a plain link saved as <name>_<bpm>bpm_<key>.wav (# kept), once per double click', async ({ page, api, lib }) => {
    const u = uid();
    const { samples, ui } = await setup(page, api, lib, [{ name: `Synth #1 stab ${u}` }, { name: `Twice ${u}` }], { patch: { bpm: 140, key: 'C# minor' } });
    const [s, t] = samples;
    await expect(rowById(page, s.id)).toContainText('C# min');

    const menu = await openActions(page, ui, s.name);
    const item = menu.getByRole('menuitem', { name: /Download WAV/ });
    await expect(item).toHaveAttribute('href', `/api/samples/${s.id}/audio`);
    await expect(item).toHaveAttribute('download', `Synth #1 stab ${u}_140bpm_C#min.wav`);
    const [dl] = await Promise.all([page.waitForEvent('download'), press(item, ui)]);
    expect(dl.suggestedFilename()).toBe(`Synth #1 stab ${u}_140bpm_C#min.wav`);
    expect(dl.suggestedFilename()).toBe(downloadName(await api.get(`/samples/${s.id}`)));

    const downloads = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));
    const ed = await openInspector(page, ui, t);
    await ed.scope.getByRole('link', { name: 'Download' }).dblclick();
    await expect.poll(() => downloads.length).toBe(1);
    await page.waitForTimeout(1000); // a second save would arrive right behind the first
    expect(downloads).toEqual([`Twice ${u}_140bpm_C#min.wav`]);
    await ed.close();
  });

  test('Add to Arrange: a new project first, then the last one; Open goes there; a used sample stays', async ({ page, api, lib }) => {
    await clearProjects(api);
    const u = uid();
    const { samples, ui } = await setup(page, api, lib, [{ name: `First ${u}` }, { name: `Second ${u}` }]);
    const [a, b] = samples;

    let menu = await openActions(page, ui, a.name);
    await press(menu.getByRole('menuitem', { name: /Add to Arrange/ }), ui);
    await expect(toast(page, 'Added')).toContainText(`Added “${a.name}” to Library picks (new project) at bar 1`);
    const [picks] = (await api.get('/projects')).projects;
    expect(picks.name).toBe('Library picks');
    const doc = await api.get(`/projects/${picks.id}`);
    expect(doc.tracks.flatMap((t) => t.clips).map((c) => c.sample_id)).toEqual([a.id]);

    const qa = await api.createProject(`QA ${u}`, 100);
    await page.evaluate((id) => localStorage.setItem('arrange:lastProject', id), qa.id);
    await page.reload();
    await expect(rows(page)).toHaveCount(2);
    if (!ui.phone) await expect(page.getByRole('button', { name: 'Sync 100', exact: true })).toBeVisible();
    menu = await openActions(page, ui, b.name);
    await expect(menu.getByRole('menuitem', { name: /Add to Arrange/ })).toContainText(`QA ${u}`);
    await press(menu.getByRole('menuitem', { name: /Add to Arrange/ }), ui);
    const t = toast(page, 'Added');
    await expect(t).toContainText(`Added “${b.name}” to QA ${u} at bar 1`);
    const qaDoc = await api.get(`/projects/${qa.id}`);
    expect(qaDoc.tracks.flatMap((tr) => tr.clips).map((c) => c.sample_id)).toEqual([b.id]);

    // the first sample is in "Library picks" now: deleting it is refused, with a way there
    const again = await openActions(page, ui, a.name);
    await press(again.getByRole('menuitem', { name: /^Delete/ }), ui);
    if (ui.phone) {
      await press(page.getByRole('dialog', { name: `Delete “${a.name}”?` }).getByRole('menuitem', { name: /^Delete/ }), ui);
    } else {
      await press(rowById(page, a.id).getByRole('button', { name: 'Confirm' }), ui);
    }
    const err = rowById(page, a.id).getByRole('alert');
    await expect(err).toContainText('Used in');
    await expect(err).toContainText('Library picks');
    await expect(err.getByRole('link', { name: 'Open' })).toHaveAttribute('href', `#/arrange/${picks.id}`);
    expect((await api.raw(`/samples/${a.id}`)).status).toBe(200);

    await press(t.getByRole('link', { name: 'Open' }), ui);
    await expect(page).toHaveURL(new RegExp(`#/arrange/${qa.id}$`));
  });

  test('Open in Split goes to the job a sample was cut from; imported samples have none', async ({ page, api, lib }) => {
    const u = uid();
    const tag = `t${u}`;
    const [cut] = await fresh(api, await lib.job(), tag, [{ name: `Cut ${u}` }]);
    const imported = await api.importSample(media('oneshot.wav'), { name: `Imported ${u}`, tags: [tag] });
    const ui = await openLibrary(page, `tags=${tag}`);
    let menu = await openActions(page, ui, imported.name);
    await expect(menu.getByRole('menuitem', { name: /Download WAV/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Open in Split' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    menu = await openActions(page, ui, cut.name);
    await press(menu.getByRole('menuitem', { name: 'Open in Split' }), ui);
    await expect(page).toHaveURL(new RegExp(`#/split/job/${cut.source.task_id}$`));
  });
});

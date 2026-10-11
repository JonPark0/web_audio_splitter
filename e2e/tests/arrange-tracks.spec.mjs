import {
  test,
  expect,
  hasCDP,
  seedProject,
  pollProject,
  openProject,
  press,
  track,
  clip,
  clipEl,
  playButton,
  poll,
  undoRedo,
} from './arrange/helpers.mjs';

// Track headers: add, rename, reorder, mute/solo, volume/pan (+ reset),
// delete, lane heights and meters. Desktop headers with a mouse; the phone
// and tablet header (name over 44 px M/S, the name opens the track sheet);
// the desktop header on a touch screen (1366 px iPad Pro) where a name only
// renames once its track is selected.

const names = (p) => p.tracks.map((t) => t.name).join(',');

test.describe('desktop headers', () => {
  test.beforeEach(({ isMobile }) => test.skip(isMobile, 'mouse header'));

  test('add, rename (name or ⋯ menu), reorder (grip or menu), mute / solo', async ({ page, api, smp }) => {
    const p = await seedProject(api, 'Headers', [track('Alpha', [clip(smp.drum, 0)]), track('Beta'), track('Gamma')]);
    await openProject(page, p);
    await page.getByRole('button', { name: 'Add track' }).click();
    await pollProject(api, p.id, names).toBe('Alpha,Beta,Gamma,Track 4');

    await page.getByRole('button', { name: 'Beta', exact: true }).click();
    await page.getByLabel('Track name').fill('Bravo');
    await page.getByLabel('Track name').press('Enter');
    await page.getByRole('button', { name: 'Gamma options' }).click();
    await page.getByRole('menuitem', { name: 'Rename…' }).click();
    await page.getByLabel('Track name').fill('Golf');
    await page.getByLabel('Track name').press('Enter');
    await pollProject(api, p.id, names).toBe('Alpha,Bravo,Golf,Track 4');

    // drag Golf's grip up two lanes
    const grip = await page.locator('[title="Drag to reorder"]').nth(2).boundingBox();
    const lane = grip.height + 1;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 - (2 * lane * i) / 10);
    await page.mouse.up();
    await pollProject(api, p.id, names).toBe('Golf,Alpha,Bravo,Track 4');
    await page.getByRole('button', { name: 'Golf options' }).click();
    await page.getByRole('menuitem', { name: 'Move down' }).click();
    await pollProject(api, p.id, names).toBe('Alpha,Golf,Bravo,Track 4');

    await page.getByRole('button', { name: 'Mute Alpha' }).click();
    await page.getByRole('button', { name: 'Solo Golf' }).click();
    await expect(page.getByRole('button', { name: 'Mute Alpha' })).toHaveAttribute('aria-pressed', 'true');
    await pollProject(api, p.id, (d) => [d.tracks[0].muted, d.tracks[1].soloed]).toEqual([true, true]);
    // a soloed track elsewhere dims Alpha's clips
    await expect(clipEl(page, p.tracks[0].clips[0].id)).toHaveClass(/opacity-55/);
  });

  test('volume and pan: a fader drag is one undo step; tap the readout or double-click to reset', async ({ page, api }) => {
    const p = await seedProject(api, 'Faders', [track('Alpha')]);
    await openProject(page, p);
    const vol = page.getByRole('slider', { name: 'Alpha volume' });
    const vb = await vol.boundingBox();
    await page.mouse.move(vb.x + vb.width * 0.5, vb.y + vb.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(vb.x + vb.width * (0.5 - i * 0.04), vb.y + vb.height / 2);
    await page.mouse.up();
    await pollProject(api, p.id, (d) => d.tracks[0].volume < 0.1).toBe(true);
    await expect(page.getByRole('button', { name: 'Reset Alpha volume to 0 dB' })).not.toHaveText('0.0 dB');
    await undoRedo(page, 'Undo'); // the whole scrub
    await pollProject(api, p.id, (d) => d.tracks[0].volume).toBe(1);
    await undoRedo(page, 'Redo');
    await pollProject(api, p.id, (d) => d.tracks[0].volume < 0.1).toBe(true);
    await page.getByRole('button', { name: 'Reset Alpha volume to 0 dB' }).click();
    await pollProject(api, p.id, (d) => d.tracks[0].volume).toBe(1);
    await vol.click({ position: { x: 4, y: vb.height / 2 } });
    await pollProject(api, p.id, (d) => d.tracks[0].volume < 0.5).toBe(true);
    await vol.dblclick();
    await pollProject(api, p.id, (d) => d.tracks[0].volume).toBe(1);

    const pan = page.getByRole('slider', { name: 'Alpha pan' });
    await pan.focus();
    for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight');
    await pollProject(api, p.id, (d) => d.tracks[0].pan).toBeCloseTo(0.1, 5);
    await expect(page.getByRole('button', { name: 'Centre Alpha pan' })).toHaveText('R10');
    await page.getByRole('button', { name: 'Centre Alpha pan' }).click();
    await pollProject(api, p.id, (d) => d.tracks[0].pan).toBe(0);
  });

  test('delete: an empty track at once, one with clips after Confirm (Cancel keeps it)', async ({ page, api, smp }) => {
    const p = await seedProject(api, 'Delete tracks', [track('Alpha', [clip(smp.drum, 0)]), track('Empty')]);
    await openProject(page, p);
    await page.getByRole('button', { name: 'Empty options' }).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await pollProject(api, p.id, names).toBe('Alpha');
    await page.getByRole('button', { name: 'Alpha options' }).click();
    await page.getByRole('menuitem', { name: 'Delete (1 clip)…' }).click();
    await expect(page.getByText('Delete track?')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('Delete track?')).toHaveCount(0);
    await page.getByRole('button', { name: 'Alpha options' }).click();
    await page.getByRole('menuitem', { name: 'Delete (1 clip)…' }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await pollProject(api, p.id, (d) => d.tracks.length).toBe(0);
  });

  test('lane heights small / medium / large, remembered per project', async ({ page, api }) => {
    const p = await seedProject(api, 'Lanes', [track('Alpha'), track('Beta')]);
    await openProject(page, p);
    const rowHeight = () => page.locator('[title="Drag to reorder"]').first().evaluate((el) => el.parentElement.getBoundingClientRect().height);
    for (const [label, h] of [['small', 40], ['large', 88], ['medium', 64], ['large', 88]]) {
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: new RegExp(`Lanes: ${label}`) }).click();
      await poll(rowHeight).toBe(h);
    }
    await page.reload();
    await poll(rowHeight).toBe(88);
  });

  const level = (page, label) =>
    page.evaluate((l) => {
      const bar = document.querySelector(`[role=meter][aria-label="${l}"] > span > span`);
      const m = (bar?.style.transform || '').match(/scale[XY]\(([\d.e-]+)\)/);
      return m ? +m[1] : 0;
    }, label);

  test('track and master meters move while playing', async ({ page, api, smp, browserName }) => {
    test.skip(browserName !== 'chromium', 'headless audio output is only dependable in Chromium');
    const p = await seedProject(api, 'Meters', [track('Alpha', [clip(smp.loop, 0)])]);
    await openProject(page, p);
    await playButton(page).click();
    await poll(() => level(page, 'Alpha level')).toBeGreaterThan(0.1);
    await poll(() => level(page, 'Master level')).toBeGreaterThan(0.1);
    await playButton(page).click();
  });

  test('meters fall back to zero after Stop', async ({ page, api, smp, browserName }) => {
    test.skip(browserName !== 'chromium', 'headless audio output is only dependable in Chromium');
    const p = await seedProject(api, 'Meters stop', [track('Alpha', [clip(smp.loop, 0)])]);
    await openProject(page, p);
    await playButton(page).click();
    await poll(() => level(page, 'Master level')).toBeGreaterThan(0.1);
    await playButton(page).click();
    await poll(() => level(page, 'Master level'), { timeout: 3000 }).toBe(0);
    await poll(() => level(page, 'Alpha level'), { timeout: 1000 }).toBe(0);
  });
});

test.describe('phone and tablet headers', () => {
  test.beforeEach(({ isMobile }) => test.skip(!isMobile, 'touch layouts'));

  test('44 px mute / solo; the name opens the track sheet: rename, move, volume + reset, delete', async ({ page, api, smp }) => {
    const p = await seedProject(api, 'Track sheet', [track('Alpha', [clip(smp.drum, 0)]), track('Beta'), track('Gamma')]);
    const ui = await openProject(page, p);
    test.skip(ui.desktop, 'desktop header on this viewport');
    const ms = await page.locator('[aria-label^="Mute "],[aria-label^="Solo "]').evaluateAll((els) => els.map((e) => [e.getBoundingClientRect().width, e.getBoundingClientRect().height]));
    for (const [w, h] of ms) expect(Math.min(w, h)).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: 'Mute Beta' }).tap();
    await page.getByRole('button', { name: 'Solo Gamma' }).tap();
    await pollProject(api, p.id, (d) => [d.tracks[1].muted, d.tracks[2].soloed]).toEqual([true, true]);

    await page.getByRole('button', { name: 'Beta', exact: true }).tap();
    const sheet = page.getByRole('dialog', { name: 'Beta' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Beta', exact: true }).tap();
    await page.getByLabel('Track name').fill('Bravo');
    await page.getByLabel('Track name').press('Enter');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Move down' }).tap();
    await pollProject(api, p.id, names).toBe('Alpha,Gamma,Bravo');
    const vol = dialog.getByRole('slider', { name: /volume$/ });
    const vb = await vol.boundingBox();
    await page.touchscreen.tap(vb.x + vb.width * 0.2, vb.y + vb.height / 2);
    await pollProject(api, p.id, (d) => d.tracks[2].volume < 0.5).toBe(true);
    await dialog.getByRole('button', { name: /^Reset .* volume/ }).tap();
    await pollProject(api, p.id, (d) => d.tracks[2].volume).toBe(1);
    await dialog.getByRole('button', { name: /^Close/ }).tap();
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'Alpha', exact: true }).tap();
    await dialog.getByRole('button', { name: 'Delete track' }).tap();
    await expect(dialog.getByText('Delete with 1 clips?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm' }).tap();
    await pollProject(api, p.id, names).toBe('Gamma,Bravo');
    await expect(dialog).toHaveCount(0);
  });

  test('the track name (the way into the track sheet) is a 44 px touch target', async ({ page, api }) => {
    const p = await seedProject(api, 'Name target', [track('Alpha'), track('Beta')]);
    const ui = await openProject(page, p);
    test.skip(ui.desktop, 'desktop header on this viewport');
    for (const name of ['Alpha', 'Beta']) {
      const b = await page.getByRole('button', { name, exact: true }).boundingBox();
      expect(b.height, `${name} name height`).toBeGreaterThanOrEqual(44);
    }
  });
});

// The desktop chrome on a touch screen (iPad Pro 12.9" landscape): the only
// profile with that combination, so it runs under the Chromium tablet project.
test.describe('desktop header on a touch screen (1366 px)', () => {
  // decided from the project's own options, before a context is made (isMobile: no Firefox)
  test.skip(({ browserName, userAgent }) => !hasCDP(browserName) || !/SM-T837/.test(userAgent || ''), 'tablet-chromium only');
  test.use({ viewport: { width: 1366, height: 1024 }, isMobile: true, hasTouch: true });

  test('a name renames only once its track is selected (else ⋯ → Rename); header targets are 44 px', async ({ page, api }) => {
    const p = await seedProject(api, 'Touch desktop', [track('Alpha'), track('Beta')]);
    const ui = await openProject(page, p);
    expect(ui.desktop && ui.coarse).toBe(true);
    await page.getByRole('button', { name: 'Beta', exact: true }).tap();
    await expect(page.getByLabel('Track name')).toHaveCount(0); // first tap only selects
    await page.getByRole('button', { name: 'Beta', exact: true }).tap();
    await page.getByLabel('Track name').fill('Bravo');
    await page.getByLabel('Track name').press('Enter');
    await page.getByRole('button', { name: 'Alpha options' }).tap();
    await page.getByRole('menuitem', { name: 'Rename…' }).tap();
    await page.getByLabel('Track name').fill('Apple');
    await page.getByLabel('Track name').press('Enter');
    await pollProject(api, p.id, names).toBe('Apple,Bravo');
    const sizes = await page.locator('[aria-label^="Mute "],[aria-label^="Solo "],[aria-label$=" options"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of sizes) expect(h).toBeGreaterThanOrEqual(44);
  });

  test('the master clip indicator is a 44 px touch target', async ({ page, api }) => {
    const p = await seedProject(api, 'Clip light');
    await openProject(page, p);
    const b = await page.getByRole('button', { name: 'No clipping' }).boundingBox();
    expect(b.height).toBeGreaterThanOrEqual(44);
  });
});

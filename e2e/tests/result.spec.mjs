import { readFileSync } from 'node:fs';
import { touch } from '../support/touch.mjs';
import { zipNames } from './result/audio.mjs';
import {
  test,
  expect,
  hasCDP,
  openJob,
  readout,
  timeNow,
  playButton,
  pauseButton,
  stemDuration,
  lane,
  hitLane,
  dragLane,
  zoomState,
  noHorizontalOverflow,
  smallTargets,
  inkOf,
  clearSamples,
  centerLane,
} from './result/helpers.mjs';

// The job result screen (#/split/job/<id>): stem mixer, transport, zoom and
// layout on every device profile. Extracting samples: result-extract.spec.mjs.

const rowOf = (page, track) => page.locator('[data-ready] > div').filter({ has: page.locator(`[data-lane="${track}"]`) });
const near = (v, target, tol) => Math.abs(v - target) <= tol;
/** The "All" Original/Recovered switch (its radios carry no model name). */
const allGroup = (scope) => scope.getByRole('radiogroup').filter({ has: scope.getByRole('radio', { name: 'Recovered', exact: true }) });

// Samples saved by other tests in this worker would put markers on the lanes.
test.beforeEach(async ({ api }) => clearSamples(api));

/** Open the phone ⋯ "Playback" sheet (loop, snap, variants, ruler). */
async function playbackSheet(page) {
  await page.getByRole('button', { name: 'Loop, snap, variants, downloads' }).click();
  return page.getByRole('dialog', { name: 'Playback' });
}
/** A row's ⋯ sheet (phone and tablet): extract, download, spectrogram, version, level. */
async function rowSheet(page, stem) {
  await page.getByRole('button', { name: `${stem}: extract, download, spectrogram, level` }).click();
  return page.getByRole('dialog', { name: stem });
}

test.describe('load', () => {
  test('job line, waveforms from peaks, stems in order, derived stem muted', async ({ page, seed, api }) => {
    const id = await seed.roformer();
    const res = await api.get(`/result/${id}`);
    await openJob(page, id);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('song120.mp3');
    const details = [res.model, `${res.tracks.length} stems`, '0:24', `${Math.round(res.bpm * 10) / 10} BPM`, res.key].join(' · ');
    await expect(page.getByText(details, { exact: true }).filter({ visible: true })).toBeVisible();

    const order = await page.locator('[data-ready] [data-lane]').evaluateAll((ls) => ls.map((l) => l.dataset.lane));
    expect(order).toEqual(res.tracks);
    for (const t of res.tracks) await expect.poll(() => inkOf(page, t), { message: `${t} waveform drawn` }).toBeGreaterThan(0.05);

    // BS-Roformer's instrumental repeats the other stems: it starts muted
    expect(res.derived_tracks).toEqual(['instrumental.wav']);
    await expect(page.getByRole('button', { name: 'Mute instrumental' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Mute bass' })).toHaveAttribute('aria-pressed', 'false');
    await expect(lane(page, 'instrumental.wav').locator('canvas')).toHaveCSS('opacity', '0.3');
    await expect(lane(page, 'bass.wav').locator('canvas')).toHaveCSS('opacity', '1');
    await expect(page.getByText('derived', { exact: true })).toBeVisible();
  });

  test('ruler: bars at the song tempo by default, time on request', async ({ page, seed }) => {
    const L = await openJob(page, await seed.recovered());
    const ruler = page.locator('[data-axis] canvas').filter({ visible: true }).first();
    const before = await ruler.evaluate((c) => c.toDataURL());
    if (L.size === 'phone') {
      const sheet = await playbackSheet(page);
      await expect(sheet.locator('input[name="rs-ruler-sheet"]:checked')).toHaveValue('bars');
      await sheet.getByText('Time', { exact: true }).click();
      await expect(sheet.locator('input[name="rs-ruler-sheet"]:checked')).toHaveValue('time');
      await sheet.getByRole('button', { name: 'Close' }).click();
    } else {
      await expect(page.locator('input[name="rs-ruler"]:checked')).toHaveValue('bars');
      await page.getByRole('radiogroup').filter({ hasText: 'Bars' }).getByText('Time', { exact: true }).click();
      await expect(page.locator('input[name="rs-ruler"]:checked')).toHaveValue('time');
    }
    await expect.poll(() => ruler.evaluate((c) => c.toDataURL())).not.toBe(before);
  });

  test('the "derived" tag is shown in full', async ({ page, seed, browserName }) => {
    test.skip(browserName !== 'chromium', 'truncation measured with Chromium font metrics');
    const L = await openJob(page, await seed.roformer());
    const tag = page.getByText('derived', { exact: true });
    const { sw, cw } = await tag.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(sw, 'text wider than its box (ellipsis)').toBeLessThanOrEqual(cw);
  });
});

test.describe('transport', () => {
  test('Play runs the time readout, Pause freezes it', async ({ page, seed }) => {
    await openJob(page, await seed.recovered());
    await expect(readout(page)).toHaveText('0:00.000');
    await playButton(page).click();
    await expect(pauseButton(page)).toBeVisible();
    await expect.poll(() => timeNow(page), { timeout: 15_000 }).toBeGreaterThan(0.5);
    await pauseButton(page).click();
    await expect(playButton(page)).toBeVisible();
    const t = await timeNow(page);
    await page.waitForTimeout(400); // it must not move
    expect(await timeNow(page)).toBe(t);
  });

  test('Space plays and pauses, also right after clicking a fader, Mute or O|R', async ({ page, seed, isMobile }) => {
    test.skip(isMobile, 'keyboard');
    await openJob(page, await seed.recovered());
    const spacePlays = async () => {
      const t0 = await timeNow(page);
      await page.keyboard.press('Space');
      await expect(pauseButton(page)).toBeVisible();
      await expect.poll(() => timeNow(page), { timeout: 15_000 }).toBeGreaterThan(t0 + 0.2);
      await page.keyboard.press('Space');
      await expect(playButton(page)).toBeVisible();
    };
    await spacePlays();
    const fader = page.getByRole('slider', { name: 'bass level' });
    await fader.click();
    const level = await fader.inputValue();
    await spacePlays();
    await expect(fader).toHaveValue(level);
    const mute = page.getByRole('button', { name: 'Mute drums' });
    await mute.click();
    await spacePlays();
    await expect(mute, 'Space must not click the focused toggle again').toHaveAttribute('aria-pressed', 'true');
    const rec = rowOf(page, 'vocals.wav').getByRole('radio', { name: 'Recovered (apollo)' });
    await rec.click();
    await spacePlays();
    await expect(rec).toHaveAttribute('aria-checked', 'true');
  });

  test('a click or tap on a lane or the ruler seeks; playback continues across seeks', async ({ page, seed, api, isMobile }) => {
    const id = await seed.recovered();
    await openJob(page, id);
    const d = await stemDuration(api, id);
    const tapOrClick = async (x, y) => (isMobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
    await hitLane(page, 'vocals.wav', 12, d, { touch: isMobile });
    await expect.poll(async () => Math.abs((await timeNow(page)) - 12)).toBeLessThan(0.1);
    const ruler = page.locator('[data-axis]').filter({ visible: true }).first();
    const rb = await ruler.boundingBox();
    await tapOrClick(rb.x + rb.width * 0.25, rb.y + rb.height / 2);
    await expect.poll(async () => Math.abs((await timeNow(page)) - d * 0.25)).toBeLessThan(0.1);

    await playButton(page).click();
    await expect.poll(() => timeNow(page), { timeout: 15_000 }).toBeGreaterThan(d * 0.25 + 0.2);
    await hitLane(page, 'vocals.wav', 18, d, { touch: isMobile });
    await expect.poll(() => timeNow(page), { timeout: 15_000 }).toBeGreaterThan(18.2);
    expect(await timeNow(page)).toBeLessThan(21);
    await expect(pauseButton(page)).toBeVisible();
    await tapOrClick(rb.x + rb.width * 0.1, rb.y + rb.height / 2);
    await expect.poll(async () => near(await timeNow(page), d * 0.1 + 0.6, 0.6), { timeout: 15_000 }).toBe(true);
    await expect(pauseButton(page)).toBeVisible();
    await pauseButton(page).click();
  });

  test('at the end playback stops and rewinds; Loop repeats the song', async ({ page, seed, api, isMobile }) => {
    const id = await seed.recovered();
    const L = await openJob(page, id);
    const d = await stemDuration(api, id);
    await hitLane(page, 'bass.wav', d - 0.4, d, { touch: isMobile });
    await expect.poll(() => timeNow(page)).toBeGreaterThan(d - 0.6);
    await playButton(page).click();
    await expect(playButton(page)).toBeVisible({ timeout: 15_000 });
    await expect(readout(page)).toHaveText('0:00.000');

    if (L.size === 'phone') {
      const sheet = await playbackSheet(page);
      await sheet.getByRole('button', { name: 'Loop the song' }).click();
      await expect(sheet.getByRole('button', { name: 'Loop the song' })).toHaveAttribute('aria-pressed', 'true');
      await sheet.getByRole('button', { name: 'Close' }).click();
    } else {
      const loop = page.getByRole('button', { name: 'Loop', exact: true });
      await loop.click();
      await expect(loop).toHaveAttribute('aria-pressed', 'true');
    }
    await hitLane(page, 'bass.wav', d - 0.6, d, { touch: isMobile });
    await expect.poll(() => timeNow(page)).toBeGreaterThan(d - 0.8);
    await playButton(page).click();
    await expect.poll(() => timeNow(page), { timeout: 15_000, intervals: [100] }).toBeLessThan(1.5);
    await expect(pauseButton(page), 'still playing after the wrap').toBeVisible();
    await pauseButton(page).click();
    if (!isMobile) {
      await page.keyboard.press('l');
      await expect(page.getByRole('button', { name: 'Loop', exact: true })).toHaveAttribute('aria-pressed', 'false');
    }
  });
});

test.describe('stem controls', () => {
  test('fader: drag, 0 dB detent, −∞, reset by the readout or a double-click, ←/→ in 0.5 dB', async ({ page, seed, isMobile }) => {
    test.skip(isMobile, 'mouse and keyboard (touch: see the ⋯ sheet test)');
    await openJob(page, await seed.recovered());
    const fader = page.getByRole('slider', { name: 'vocals level' });
    const value = page.getByRole('button', { name: 'Reset vocals level to 0 dB' });
    const box = await fader.boundingBox();
    const y = box.y + box.height / 2;
    // Calibrate x → dB with two clicks far from the detent (thumb insets differ per engine).
    const clickAt = async (fx) => {
      await page.mouse.click(box.x + box.width * fx, y);
      return Number(await fader.inputValue());
    };
    const v1 = await clickAt(0.2);
    const v2 = await clickAt(0.6);
    expect(v2).toBeGreaterThan(v1);
    const xFor = (db) => box.x + box.width * (0.2 + ((db - v1) / (v2 - v1)) * 0.4);
    const drag = async (from, to) => {
      await page.mouse.move(from, y);
      await page.mouse.down();
      await page.mouse.move(to, y, { steps: 8 });
      await page.mouse.up();
    };
    await drag(xFor(-20), xFor(0.45));
    await expect(value, 'snaps to the 0 dB detent').toHaveText('0.0');
    await drag(xFor(0), xFor(3));
    expect(Math.abs(Number(await fader.inputValue()) - 3)).toBeLessThanOrEqual(1);
    await drag(xFor(0), box.x - 30);
    await expect(value).toHaveText('−∞');
    await value.click();
    await expect(value).toHaveText('0.0');
    await clickAt(0.3);
    await expect(value).not.toHaveText('0.0');
    await fader.dblclick();
    await expect(value).toHaveText('0.0');
    // keyboard: steps of 0.5 dB that leave 0 dB (no detent)
    await page.keyboard.press('Shift'); // keyboard focus, not a pointer one
    await fader.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(value).toHaveText('−0.5');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(value).toHaveText('+0.5');
  });

  test('Mute and Solo decide which stems are heard', async ({ page, seed }) => {
    await openJob(page, await seed.recovered());
    const dimmed = async (expected) => {
      for (const [t, dim] of Object.entries(expected)) await expect(lane(page, `${t}.wav`).locator('canvas')).toHaveCSS('opacity', dim ? '0.3' : '1');
    };
    const btn = (kind, t) => page.getByRole('button', { name: `${kind} ${t}` });
    await btn('Mute', 'bass').click();
    await expect(btn('Mute', 'bass')).toHaveAttribute('aria-pressed', 'true');
    await dimmed({ bass: true, drums: false, other: false, vocals: false });
    await btn('Mute', 'bass').click();
    await btn('Solo', 'drums').click();
    await dimmed({ bass: true, drums: false, other: true, vocals: true });
    await btn('Solo', 'vocals').click();
    await dimmed({ bass: true, drums: false, other: true, vocals: false });
    await btn('Solo', 'drums').click();
    await btn('Solo', 'vocals').click();
    await dimmed({ bass: false, drums: false, other: false, vocals: false });
  });

  test('Original / Recovered per stem and for all stems', async ({ page, seed }) => {
    const L = await openJob(page, await seed.recovered());
    for (const t of ['drums.wav', 'bass.wav']) await expect.poll(() => inkOf(page, t)).toBeGreaterThan(0.02);
    // drums vs bass: a ratio, since the shared scale follows the loudest stem shown
    const ratio = async () => (await inkOf(page, 'drums.wav')) / (await inkOf(page, 'bass.wav'));
    const r0 = await ratio();
    // drums → recovered (-6 dB copy: a smaller waveform on the shared scale)
    if (L.size === 'desktop') {
      await rowOf(page, 'drums.wav').getByRole('radio', { name: 'Recovered (apollo)' }).click();
      await expect(rowOf(page, 'drums.wav').getByRole('link', { name: 'Download' })).toHaveAttribute('href', /variant=recovered/);
    } else if (L.size === 'tablet') {
      const sw = rowOf(page, 'drums.wav').getByRole('switch', { name: 'Recovered version (apollo)' });
      await sw.click();
      await expect(sw).toHaveAttribute('aria-checked', 'true');
    } else {
      const sheet = await rowSheet(page, 'drums');
      await sheet.getByRole('radio', { name: 'Recovered (apollo)' }).click();
      await expect(sheet.getByRole('link', { name: 'Download (recovered)' })).toBeVisible();
      await sheet.getByRole('button', { name: 'Close' }).click();
      await expect(rowOf(page, 'drums.wav').getByText('R', { exact: true })).toBeVisible();
    }
    await expect.poll(ratio, { message: 'drums drawn from the quieter recovered peaks' }).toBeLessThan(r0 * 0.85);

    // All → Recovered, then back to Original
    const all = async (label) => {
      if (L.size === 'desktop') return allGroup(page).getByRole('radio', { name: label, exact: true }).click();
      const sheet = L.size === 'phone' ? await playbackSheet(page) : (await page.getByRole('button', { name: 'More' }).click(), page.getByRole('dialog', { name: 'Playback' }));
      await sheet.getByRole('radio', { name: label, exact: true }).click();
      await expect(sheet.getByRole('radio', { name: label, exact: true })).toHaveAttribute('aria-checked', 'true');
      await sheet.getByRole('button', { name: 'Close' }).click();
    };
    // every stem shows its variant: desktop radios, tablet switches, phone O/R letters
    const shown = (v) =>
      L.size === 'desktop'
        ? page.locator('[data-ready]').getByRole('radio', { name: v === 'recovered' ? 'Recovered (apollo)' : 'Original', checked: true })
        : L.size === 'tablet'
          ? page.getByRole('switch', { name: 'Recovered version (apollo)', checked: v === 'recovered' })
          : page.locator('[data-ready]').getByText(v === 'recovered' ? 'R' : 'O', { exact: true });
    await all('Recovered');
    await expect(shown('recovered')).toHaveCount(4);
    if (L.size === 'desktop') {
      await rowOf(page, 'drums.wav').getByRole('radio', { name: 'Original' }).click();
      await expect(allGroup(page).getByRole('radio', { checked: true }), 'mixed: neither').toHaveCount(0);
    }
    await all('Original');
    await expect(shown('original')).toHaveCount(4);
    await expect.poll(ratio).toBeGreaterThan(r0 * 0.97);
  });

  test('a partly recovered job offers O|R only where a recovered stem exists', async ({ page, seed, isMobile }) => {
    test.skip(isMobile, 'row layout with inline O|R');
    await openJob(page, await seed.partial());
    for (const t of ['drums', 'vocals']) await expect(rowOf(page, `${t}.wav`).getByRole('radio')).toHaveCount(2);
    for (const t of ['bass', 'guitar', 'other', 'piano']) {
      await expect(rowOf(page, `${t}.wav`).getByRole('radio')).toHaveCount(0);
      await expect(rowOf(page, `${t}.wav`).getByTitle('No recovered version of this stem')).toHaveText('Original');
    }
  });

  test('spectrogram opens under its lane, follows O|R, and a click or tap on it seeks', async ({ page, seed, api, isMobile }) => {
    const id = await seed.recovered();
    const L = await openJob(page, id);
    const d = await stemDuration(api, id);
    const toggle = async () => {
      if (L.size === 'desktop') return rowOf(page, 'bass.wav').getByRole('button', { name: 'Spectrum' }).click();
      const sheet = await rowSheet(page, 'bass');
      await sheet.getByRole('button', { name: 'Spectrogram' }).click();
      await sheet.getByRole('button', { name: 'Close' }).click();
    };
    await toggle();
    const spec = page.getByRole('img', { name: /^bass spectrogram \(original\)/ });
    await expect.poll(() => spec.locator('img').evaluate((i) => i.naturalWidth > 0 && i.style.visibility === 'visible'), { timeout: 30_000 }).toBe(true);
    const sb = await spec.boundingBox();
    const lb = await lane(page, 'bass.wav').boundingBox();
    expect(Math.abs(sb.x - lb.x)).toBeLessThan(1);
    expect(Math.abs(sb.width - lb.width)).toBeLessThan(1);
    if (isMobile) await page.touchscreen.tap(sb.x + sb.width * 0.6, sb.y + sb.height / 2);
    else await page.mouse.click(sb.x + sb.width * 0.6, sb.y + sb.height / 2);
    await expect.poll(async () => Math.abs((await timeNow(page)) - d * 0.6)).toBeLessThan(0.1);
    if (L.size === 'desktop') {
      await rowOf(page, 'bass.wav').getByRole('radio', { name: 'Recovered (apollo)' }).click();
      await expect(page.getByRole('img', { name: /^bass spectrogram \(recovered\)/ }).locator('img')).toHaveAttribute('src', /variant=recovered/);
    }
    await toggle();
    await expect(page.getByRole('img', { name: /^bass spectrogram/ })).toHaveCount(0);
  });
});

test.describe('downloads', () => {
  test('each stem and all stems, original and recovered, named after the song', async ({ page, seed, isMobile }) => {
    test.skip(isMobile, 'desktop rows (touch: next test)');
    await openJob(page, await seed.recovered());
    const row = rowOf(page, 'bass.wav');
    const get = async (action) => {
      const [dl] = await Promise.all([page.waitForEvent('download'), action()]);
      return dl;
    };
    expect((await get(() => row.getByRole('link', { name: 'Download' }).click())).suggestedFilename()).toBe('song120-bass.wav');
    await row.getByRole('radio', { name: 'Recovered (apollo)' }).click();
    expect((await get(() => row.getByRole('link', { name: 'Download' }).click())).suggestedFilename()).toBe('song120-bass-recovered.wav');

    const allBtn = page.getByRole('button', { name: 'Download all stems' });
    await allBtn.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    for (const [item, zip, suffix] of [
      ['Original stems (zip)', 'song120-stems.zip', ''],
      ['Recovered stems (zip)', 'song120-stems-recovered.zip', '-recovered'],
    ]) {
      await allBtn.click();
      const dl = await get(() => page.getByRole('menuitem', { name: item }).click());
      expect(dl.suggestedFilename()).toBe(zip);
      expect(zipNames(readFileSync(await dl.path()))).toEqual(['bass', 'drums', 'other', 'vocals'].map((s) => `song120-${s}${suffix}.wav`));
    }
  });

  test('touch: ⋯ → Download (variant) and Download all', async ({ page, seed, isMobile }) => {
    test.skip(!isMobile, 'touch layouts');
    await openJob(page, await seed.recovered());
    const sheet = await rowSheet(page, 'drums');
    await sheet.getByRole('radio', { name: 'Recovered (apollo)' }).click();
    const [dl] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('link', { name: 'Download (recovered)' }).click()]);
    expect(dl.suggestedFilename()).toBe('song120-drums-recovered.wav');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Download all stems' }).click();
    const [zip] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Recovered stems (zip)' }).click()]);
    expect(zip.suggestedFilename()).toBe('song120-stems-recovered.zip');
  });

  test('a job without recovered stems: Download all is one zip link', async ({ page, seed, isMobile }) => {
    test.skip(isMobile, 'same control on touch');
    await openJob(page, await seed.roformer());
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download all stems (zip)' }).click()]);
    expect(dl.suggestedFilename()).toBe('song120-stems.zip');
    expect(zipNames(readFileSync(await dl.path()))).toHaveLength(7);
  });
});

test.describe('zoom', () => {
  test('− / + / Fit zoom the shared timeline', async ({ page, seed, api, isMobile }) => {
    const id = await seed.recovered();
    await openJob(page, id);
    const d = await stemDuration(api, id);
    const zin = page.getByRole('button', { name: /^Zoom in/ });
    const zout = page.getByRole('button', { name: /^Zoom out/ });
    const fit = page.getByRole('button', { name: 'Fit', exact: true });
    await expect(zout).toBeDisabled();
    await expect(fit).toBeDisabled();
    await zin.click();
    await expect.poll(async () => (await zoomState(page, d)).frac).toBeCloseTo(1 / 1.6, 1);
    await zin.click();
    await expect.poll(async () => (await zoomState(page, d)).frac).toBeCloseTo(1 / 2.56, 1);
    await zout.click();
    await expect.poll(async () => (await zoomState(page, d)).frac).toBeCloseTo(1 / 1.6, 1);
    await fit.click();
    await expect.poll(async () => (await zoomState(page, d)).zoomed).toBe(false);
    await expect(fit).toBeDisabled();
    if (!isMobile) {
      await page.keyboard.press('+');
      await expect(zout).toBeEnabled();
      await page.keyboard.press('-');
      await expect(zout).toBeDisabled();
    }
  });

  test('Ctrl/⌘ + wheel over lanes, ruler, labels and spectrogram zooms the timeline (not the page)', async ({ page, seed, api, isMobile }) => {
    test.skip(isMobile, 'wheel');
    const id = await seed.recovered();
    await openJob(page, id);
    const d = await stemDuration(api, id);
    await rowOf(page, 'bass.wav').getByRole('button', { name: 'Spectrum' }).click();
    await expect(page.getByRole('img', { name: /^bass spectrogram/ })).toBeVisible();
    await page.evaluate(() => {
      window.__wheels = [];
      window.addEventListener('wheel', (e) => window.__wheels.push(e.defaultPrevented), { passive: true });
    });
    const laneBox = await lane(page, 'drums.wav').boundingBox();
    const at = (t) => laneBox.x + (t / d) * laneBox.width;
    const areas = {
      lane: async () => ({ x: at(7.2), y: laneBox.y + 20, t: 7.2 }),
      ruler: async () => {
        const r = await page.locator('[data-axis]').first().boundingBox();
        return { x: at(12), y: r.y + r.height / 2, t: 12 };
      },
      labels: async () => {
        const n = await rowOf(page, 'other.wav').getByTitle('other', { exact: true }).boundingBox();
        return { x: n.x + 5, y: n.y + 5, t: null };
      },
      spectrogram: async () => {
        const s = await page.getByRole('img', { name: /^bass spectrogram/ }).boundingBox();
        return { x: at(16), y: s.y + s.height / 2, t: 16 };
      },
    };
    for (const [name, where] of Object.entries(areas)) {
      const p = await where();
      await page.mouse.move(p.x, p.y);
      await page.keyboard.down('ControlOrMeta');
      await page.mouse.wheel(0, -300);
      await page.keyboard.up('ControlOrMeta');
      await expect.poll(async () => (await zoomState(page, d)).zoomed, { message: `${name} zooms` }).toBe(true);
      const z = await zoomState(page, d);
      // the time under the pointer stays under it
      if (p.t != null) expect(Math.abs(z.start - p.t * (1 - z.frac)), `${name}: anchored at the pointer`).toBeLessThan(0.3);
      await page.keyboard.down('ControlOrMeta');
      await page.mouse.wheel(0, 3000);
      await page.keyboard.up('ControlOrMeta');
      await expect.poll(async () => (await zoomState(page, d)).zoomed, { message: `${name}: back to fit` }).toBe(false);
    }
    const page_ = await page.evaluate(() => ({ prevented: window.__wheels.filter(Boolean).length, all: window.__wheels.length, scale: window.visualViewport?.scale ?? 1 }));
    expect(page_.scale).toBe(1);
    expect(page_.all).toBeGreaterThanOrEqual(8);
    expect(page_.prevented, 'every Ctrl+wheel was taken from the browser').toBe(page_.all);
  });

  test('Shift/horizontal wheel, ruler drag and the overview strip pan; a vertical wheel does not', async ({ page, seed, api, isMobile }) => {
    test.skip(isMobile, 'wheel and mouse');
    const id = await seed.recovered();
    await openJob(page, id);
    const d = await stemDuration(api, id);
    for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: /^Zoom in/ }).click();
    const start = async () => (await zoomState(page, d)).start;
    const s0 = await start();
    const lb = await lane(page, 'drums.wav').boundingBox();
    await page.mouse.move(lb.x + 200, lb.y + 20);
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 200);
    await page.keyboard.up('Shift');
    await expect.poll(start).toBeGreaterThan(s0 + 0.3);
    const s1 = await start();
    await page.mouse.wheel(150, 0);
    await expect.poll(start).toBeGreaterThan(s1 + 0.3);
    const s2 = await start();
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(200); // a pan would be synchronous
    expect(await start()).toBeCloseTo(s2, 2);
    const rb = await page.locator('[data-axis]').first().boundingBox();
    await page.mouse.move(rb.x + 400, rb.y + rb.height / 2);
    await page.mouse.down();
    await page.mouse.move(rb.x + 250, rb.y + rb.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(start).toBeGreaterThan(s2 + 0.5);
    const strip = page.locator('[data-axis]').first().locator('xpath=following-sibling::div[1]');
    const ob = await strip.boundingBox();
    await page.mouse.click(ob.x + ob.width * 0.95, ob.y + ob.height / 2);
    await expect.poll(start).toBeGreaterThan(d * 0.5);
  });

  test('Z and "Selection" zoom to the selection; the view follows the playhead', async ({ page, seed, api, isMobile }) => {
    test.skip(isMobile, 'mouse selection and keys');
    const id = await seed.recovered();
    await openJob(page, id);
    const d = await stemDuration(api, id);
    await hitLane(page, 'bass.wav', 11.5, d); // playhead for later
    await dragLane(page, 'bass.wav', 9.6, 12, d);
    await page.keyboard.press('z');
    const pad = 2.4 * 0.08;
    await expect.poll(async () => Math.abs((await zoomState(page, d)).start - (9.6 - pad))).toBeLessThan(0.15);
    expect((await zoomState(page, d)).frac).toBeCloseTo((2.4 + 2 * pad) / d, 2);
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await page.getByRole('button', { name: 'Selection', exact: true }).click();
    await expect.poll(async () => Math.abs((await zoomState(page, d)).start - (9.6 - pad))).toBeLessThan(0.15);
    // playing zoomed in: the playhead stays on screen
    await playButton(page).click();
    await expect.poll(() => timeNow(page), { timeout: 15_000 }).toBeGreaterThan(13.5);
    const z = await zoomState(page, d);
    const t = await timeNow(page);
    expect(t).toBeGreaterThanOrEqual(z.start - 0.2);
    expect(t).toBeLessThanOrEqual(z.start + z.frac * d + 0.2);
    await pauseButton(page).click();
  });

  test('Z and L follow the key position with a Hangul layout', async ({ page, seed, api, isMobile, browserName }) => {
    test.skip(isMobile || !hasCDP(browserName), 'raw key events through CDP');
    const id = await seed.recovered();
    await openJob(page, id);
    const d = await stemDuration(api, id);
    await dragLane(page, 'bass.wav', 9.6, 12, d);
    const cdp = await page.context().newCDPSession(page);
    const press = async (key, code, vk) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text: key });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
    };
    await press('ㅋ', 'KeyZ', 90);
    await expect.poll(async () => (await zoomState(page, d)).zoomed).toBe(true);
    await press('ㅣ', 'KeyL', 76);
    await expect(page.getByRole('button', { name: 'Loop', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('touch: pinch zooms the waveforms (not the page), a sideways swipe pans, pinching in fits', async ({ page, seed, api, isMobile, browserName }) => {
    test.skip(!isMobile || !hasCDP(browserName), 'multi-touch through CDP');
    const id = await seed.recovered();
    await openJob(page, id);
    const d = await stemDuration(api, id);
    const t = await touch(page);
    await centerLane(page, 'drums.wav');
    const lb = await lane(page, 'drums.wav').boundingBox();
    const c = { x: lb.x + lb.width / 2, y: lb.y + lb.height / 2 };
    await t.pinch(c, 60, 240);
    await expect.poll(async () => (await zoomState(page, d)).frac).toBeLessThan(0.4);
    expect(await page.evaluate(() => window.visualViewport.scale)).toBe(1);
    const s0 = (await zoomState(page, d)).start;
    await t.swipe({ x: lb.x + lb.width * 0.7, y: c.y }, { x: lb.x + lb.width * 0.3, y: c.y + 2 });
    await expect.poll(async () => (await zoomState(page, d)).start).toBeGreaterThan(s0 + 0.2);
    await t.pinch(c, 260, 40);
    await expect.poll(async () => (await zoomState(page, d)).zoomed).toBe(false);
  });

  test('touch: a vertical swipe on the lanes scrolls the page (no seek)', async ({ page, seed, isMobile, browserName }) => {
    test.skip(!isMobile || !hasCDP(browserName), 'finger drag through CDP');
    const L = await openJob(page, await seed.roformer());
    test.skip(L.size !== 'phone', 'the 7 stems fit a tablet screen');
    const lb = await lane(page, 'drums.wav').boundingBox();
    const t = await touch(page);
    await t.swipe({ x: lb.x + lb.width / 2, y: lb.y + lb.height / 2 + 60 }, { x: lb.x + lb.width / 2 + 2, y: lb.y + lb.height / 2 - 120 });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(30);
    await expect(readout(page)).toHaveText('0:00.000');
  });

  test('touch: a pinch on the ruler zooms the timeline', async ({ page, seed, api, isMobile, browserName }) => {
    test.skip(!isMobile || !hasCDP(browserName), 'multi-touch through CDP');
    const id = await seed.recovered();
    await openJob(page, id);
    const d = await stemDuration(api, id);
    const rb = await page.locator('[data-axis]').filter({ visible: true }).first().boundingBox();
    await (await touch(page)).pinch({ x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 }, 60, 240);
    await expect.poll(async () => (await zoomState(page, d)).zoomed, { timeout: 3000 }).toBe(true);
  });
});

test.describe('layout', () => {
  test('no sideways overflow; nothing hidden under the bottom bar; the ruler stays on screen', async ({ page, seed }) => {
    for (const job of [await seed.roformer(), await seed.recovered()]) {
      await openJob(page, job);
      await noHorizontalOverflow(page);
      const vw = page.viewportSize().width;
      const lanes = await page.locator('[data-ready] [data-lane]').evaluateAll((ls) => ls.map((l) => l.getBoundingClientRect()).map((r) => [r.left, r.right]));
      for (const [l, r] of lanes) expect(l >= 0 && r <= vw + 0.5, `lane ${l}-${r} inside ${vw}`).toBe(true);
    }
    await openJob(page, await seed.roformer());
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = await page.locator('[data-ready] [data-lane]').last().boundingBox();
    const barTop = await page.evaluate(() => document.querySelector('.rs-bottom-bar.fixed')?.getBoundingClientRect().top ?? window.innerHeight);
    expect(last.y + last.height, 'last lane above the bottom bar').toBeLessThanOrEqual(barTop + 0.5);
    const ruler = await page.locator('[data-axis]').filter({ visible: true }).first().boundingBox();
    const header = await page.evaluate(() => document.querySelector('header')?.getBoundingClientRect().bottom ?? 0);
    expect(ruler.y, 'ruler below the app header').toBeGreaterThanOrEqual(header - 0.5);
    expect(ruler.y + ruler.height).toBeLessThanOrEqual(page.viewportSize().height);
  });

  test('touch targets are at least 44 px and do not overlap', async ({ page, seed, isMobile }) => {
    test.skip(!isMobile, 'touch screens');
    await openJob(page, await seed.recovered());
    expect(await smallTargets(page, 'main')).toEqual([]);
    const overlaps = await page.evaluate(() => {
      const els = [...document.querySelectorAll('[data-ready] button, [data-ready] input[type=range]')].filter((e) => e.getBoundingClientRect().width);
      const box = (e) => {
        const r = e.getBoundingClientRect();
        const b = getComputedStyle(e, '::before');
        if (b.content === 'none' || b.position !== 'absolute') return r;
        const w = Math.max(r.width, parseFloat(b.width) || 0);
        const h = Math.max(r.height, parseFloat(b.height) || 0);
        return { left: r.left + r.width / 2 - w / 2, right: r.left + r.width / 2 + w / 2, top: r.top + r.height / 2 - h / 2, bottom: r.top + r.height / 2 + h / 2 };
      };
      const out = [];
      for (let i = 0; i < els.length; i += 1) {
        for (let j = i + 1; j < els.length; j += 1) {
          const a = box(els[i]);
          const b = box(els[j]);
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) out.push(`${els[i].getAttribute('aria-label')} × ${els[j].getAttribute('aria-label')}`);
        }
      }
      return out;
    });
    expect(overlaps).toEqual([]);
  });

  test('the docked Extract panel takes at most half the screen and leaves waveforms visible', async ({ page, seed }) => {
    const L = await openJob(page, await seed.roformer());
    test.skip(L.size === 'phone', 'phones get a full-screen sheet');
    await rowOf(page, 'vocals.wav').getByRole('button', { name: 'Extract', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Extract a sample' });
    await expect(panel).toBeVisible();
    const vh = page.viewportSize().height;
    const pb = await panel.boundingBox();
    const stickyBottom = await page.evaluate(() => document.querySelector('[data-axis]').closest('.sticky').getBoundingClientRect().bottom);
    expect(pb.height).toBeLessThanOrEqual(vh * 0.5 + 1);
    expect(pb.y - stickyBottom, 'waveform room above the panel').toBeGreaterThanOrEqual(72);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(async () => {
      const last = await page.locator('[data-ready] [data-lane]').last().boundingBox();
      return last.y + last.height - (await panel.boundingBox()).y;
    }, { message: 'last lane can be scrolled above the panel' }).toBeLessThanOrEqual(0.5);
    await noHorizontalOverflow(page);
    if (L.coarse) expect(await smallTargets(page, '[aria-label="Extract a sample"]')).toEqual([]);
  });
});

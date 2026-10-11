import { touch } from '../support/touch.mjs';
import { readWav, peak, maxDiff } from './result/audio.mjs';
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
  centerLane,
  hitLane,
  dragLane,
  zoomState,
  selection,
  typeTime,
  clearSamples,
  lastSample,
  smallTargets,
} from './result/helpers.mjs';

// Extracting samples on the result screen: selecting (mouse, fields, keys,
// snap, touch Set start/end and handles), previewing, saving stems and mixes
// (checked through the API and the saved WAV), Undo, markers, and the
// panel/sheet on every device. The mixer itself: result.spec.mjs.

const rowOf = (page, track) => page.locator('[data-ready] > div').filter({ has: page.locator(`[data-lane="${track}"]`) });
const panelOf = (page) => page.getByRole('region', { name: 'Extract a sample' });
const snapSelect = (page) => page.locator('label').filter({ hasText: 'Snap' }).locator('select');
const nameField = (page) => page.getByRole('textbox', { name: 'Sample name' });
const tagsField = (page) => page.getByRole('textbox', { name: 'Tags (comma separated)' });
const saved = (scope, name) => scope.getByText(`Saved “${name}”`);
const close = (a, b, tol) => Math.abs(a - b) <= tol;

async function wavOf(api, url) {
  const res = await api.raw(url);
  expect(res.ok, `${url} → ${res.status}`).toBe(true);
  return readWav(Buffer.from(await res.arrayBuffer()));
}
const sampleCount = async (api, id) => (await api.get(`/samples?task_id=${id}`)).samples.length;

test.beforeEach(async ({ api }) => clearSamples(api));

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'mouse and keyboard (touch: below)');

  /** The htdemucs job with recovered stems, Extract open on vocals. */
  async function setup(page, seed, api) {
    const id = await seed.recovered();
    await openJob(page, id);
    const d = await stemDuration(api, id);
    const res = await api.get(`/result/${id}`);
    await rowOf(page, 'vocals.wav').getByRole('button', { name: 'Extract', exact: true }).click();
    await expect(panelOf(page)).toBeVisible();
    return { id, d, bpm: res.bpm, beat: 60 / res.bpm, panel: panelOf(page) };
  }

  test('drag across a waveform selects exactly; a drag on another stem retargets Extract', async ({ page, seed, api }) => {
    const { d, panel } = await setup(page, seed, api);
    await expect(rowOf(page, 'vocals.wav').getByRole('button', { name: 'Extract', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('select').first()).toHaveValue('vocals.wav');
    await expect(panel).toContainText('Drag across a waveform');
    await dragLane(page, 'vocals.wav', 6, 8.4, d);
    const s = await selection(page);
    expect(close(s.start, 6, 0.003) && close(s.end, 8.4, 0.003), JSON.stringify(s)).toBe(true);
    await expect(panel).toContainText('2.400 s');
    await expect(lane(page, 'vocals.wav').locator('[data-handle]')).toHaveCount(2);
    await dragLane(page, 'drums.wav', 6, 8.4, d);
    await expect(panel.locator('select').first()).toHaveValue('drums.wav');
  });

  test('start/end fields: select-all on focus, comma decimals, Enter commits, bad input ignored', async ({ page, seed, api }) => {
    const { d } = await setup(page, seed, api);
    await dragLane(page, 'vocals.wav', 6, 8.4, d);
    const start = page.getByRole('textbox', { name: 'Start (m:ss.mmm)' });
    await start.click();
    expect(await start.evaluate((el) => el.selectionStart === 0 && el.selectionEnd === el.value.length)).toBe(true);
    await start.pressSequentially('0:05,5');
    await start.press('Enter');
    await expect(start).toHaveValue('0:05.500');
    await typeTime(page, 'End', '7,25');
    expect(await selection(page)).toEqual({ start: 5.5, end: 7.25 });
    await typeTime(page, 'Start', 'abc');
    await expect(start).toHaveValue('0:05.500');
    // a start past the end moves the whole selection (length kept)
    await typeTime(page, 'Start', '10');
    expect(await selection(page)).toEqual({ start: 10, end: 11.75 });
  });

  test('nudge keys: 1 ms, Shift 10 ms, Alt 1 beat; [ and ] pick the edge; a clicked fader hands them back', async ({ page, seed, api }) => {
    const { d, beat } = await setup(page, seed, api);
    await dragLane(page, 'vocals.wav', 6, 8.4, d);
    await typeTime(page, 'Start', '6'); // the start edge is now active
    const url = page.url();
    const step = async (key, edge, delta) => {
      const before = (await selection(page))[edge];
      await page.keyboard.press(key);
      await expect.poll(async () => (await selection(page))[edge] - before, { message: key }).toBeCloseTo(delta, 3);
    };
    await step('ArrowRight', 'start', 0.001);
    await step('Shift+ArrowRight', 'start', 0.01);
    await step('Alt+ArrowRight', 'start', beat);
    await step('Alt+ArrowLeft', 'start', -beat);
    expect(page.url(), 'Alt+← must not navigate back').toBe(url);
    await page.keyboard.press(']');
    await step('ArrowLeft', 'end', -0.001);
    await page.keyboard.press('[');
    await step('ArrowLeft', 'start', -0.001);
    // after clicking a fader, the arrows still move the selection, not the fader
    const fader = page.getByRole('slider', { name: 'bass level' });
    await fader.click();
    const level = await fader.inputValue();
    await step('ArrowRight', 'start', 0.001);
    await expect(fader).toHaveValue(level);
    // a selection under 50 ms can't be saved
    await typeTime(page, 'Start', '12');
    await typeTime(page, 'End', '12.03');
    await expect(panelOf(page)).toContainText('Minimum 50 ms');
    await expect(panelOf(page).getByRole('button', { name: 'Save sample' })).toBeDisabled();
  });

  test('snap: beat length while dragging, transients from the onsets', async ({ page, seed, api }) => {
    const { id, d, beat } = await setup(page, seed, api);
    await snapSelect(page).selectOption('beat');
    await dragLane(page, 'vocals.wav', 4.8, 7.1, d);
    const b = await selection(page);
    expect(b.start).toBeCloseTo(4.8, 2);
    const beats = (b.end - b.start) / beat;
    expect(Math.abs(beats - Math.round(beats)), `${beats} beats`).toBeLessThan(0.01);

    const onsetsLoaded = page.waitForResponse((r) => r.url().includes(`/onsets/${id}/vocals.wav`));
    await snapSelect(page).selectOption('transient');
    await onsetsLoaded;
    const { onsets } = await api.get(`/onsets/${id}/vocals.wav?variant=original`);
    expect(onsets.length).toBeGreaterThan(3);
    const box = await lane(page, 'vocals.wav').boundingBox();
    const pps = box.width / d;
    const nearest = (x) => onsets.reduce((a, o) => (Math.abs(o - x) < Math.abs(a - x) ? o : a), onsets[0]);
    await dragLane(page, 'vocals.wav', 12, 14.3, d);
    const t = await selection(page);
    const want = Math.abs(nearest(14.3) - 14.3) <= 12 / pps ? nearest(14.3) : 14.3;
    expect(Math.abs(t.end - want), `end ${t.end}, nearest onset ${nearest(14.3)}`).toBeLessThan(0.003);
    expect(t.start).toBeCloseTo(12, 2);
  });

  test('Loop repeats the selection; Play selection plays it once on its stem and returns to its start', async ({ page, seed, api }) => {
    const { d, panel } = await setup(page, seed, api);
    await dragLane(page, 'vocals.wav', 3, 5, d);
    await typeTime(page, 'Start', '4');
    await typeTime(page, 'End', '5');
    await panel.getByRole('button', { name: 'Loop', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Loop', exact: true }).first(), 'the transport Loop too').toHaveAttribute('aria-pressed', 'true');
    await hitLane(page, 'vocals.wav', 4.2, d, { fy: 0.5 });
    await expect.poll(() => timeNow(page)).toBeGreaterThan(4.1);
    await playButton(page).click();
    await expect(pauseButton(page)).toBeVisible();
    let prev = await timeNow(page);
    let wrapped = false;
    const until = Date.now() + 8000;
    while (!wrapped && Date.now() < until) {
      await page.waitForTimeout(100); // sampling the readout
      const t = await timeNow(page);
      expect(t, 'inside the loop').toBeGreaterThanOrEqual(3.99);
      expect(t, 'inside the loop').toBeLessThanOrEqual(5.02);
      if (t < prev - 0.3) wrapped = true;
      prev = t;
    }
    expect(wrapped, 'wrapped back to the loop start').toBe(true);
    await pauseButton(page).click();
    await panel.getByRole('button', { name: 'Loop', exact: true }).click();

    await panel.getByRole('button', { name: 'Play selection' }).click();
    await expect(panel.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Play selection' })).toBeVisible({ timeout: 15_000 });
    await expect(readout(page)).toHaveText('0:04.000');
    await expect(playButton(page)).toBeVisible();
  });

  test('Save sample: cut sample-exactly with the suggested name and tags; then a duplicate is refused', async ({ page, seed, api }) => {
    const { id, d, panel } = await setup(page, seed, api);
    await dragLane(page, 'vocals.wav', 5, 9, d);
    await typeTime(page, 'Start', '6');
    await typeTime(page, 'End', '8');
    await expect(nameField(page)).toHaveValue('vocals 0:06.0');
    await expect(tagsField(page)).toHaveValue('vocals');
    await panel.getByRole('button', { name: 'Save sample' }).click();
    await expect(saved(panel, 'vocals 0:06.0')).toBeVisible();
    const s = await lastSample(api, id);
    expect(s).toMatchObject({ name: 'vocals 0:06.0', tags: ['vocals'], sample_rate: 44100, channels: 2 });
    expect(s.source).toMatchObject({ task_id: id, track: 'vocals.wav', variant: 'original', start_sec: 6, end_sec: 8 });
    expect(s.duration_sec).toBeCloseTo(2, 6);
    const wav = await wavOf(api, `/samples/${s.id}/audio`);
    const stem = await wavOf(api, `/download/${id}/vocals.wav?variant=original`);
    expect(wav).toMatchObject({ format: 'pcm', bits: 16, channels: 2, sampleRate: 44100, frames: 88200 });
    // identical to the stem between the 3 ms default fades
    expect(maxDiff(wav, stem, 441, 88200 - 441, 6 * 44100)).toBeLessThan(1e-4);
    expect(Math.abs(wav.channelData[0][0])).toBeLessThan(0.01);

    const again = panel.getByRole('button', { name: 'Saved' });
    await expect(again).toBeDisabled();
    await nameField(page).press('Enter');
    await page.waitForTimeout(500); // a second save would be under way by now
    await expect(lane(page, 'vocals.wav').locator('[data-marker]')).toHaveCount(1);
    expect(await api.get(`/samples?task_id=${id}`).then((r) => r.samples.length)).toBe(1);
    await nameField(page).fill('vocals take 2');
    await expect(panel.getByRole('button', { name: 'Save sample' })).toBeEnabled();
  });

  test('name and tags: Enter saves once (not while an IME is composing); the name stays', async ({ page, seed, api }) => {
    const { id, d, panel } = await setup(page, seed, api);
    await dragLane(page, 'vocals.wav', 6, 8, d);
    await nameField(page).fill('보컬 테스트');
    await tagsField(page).fill('vox, lead , ');
    // the Enter that confirms a Hangul syllable
    await nameField(page).evaluate((el) =>
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }))
    );
    await nameField(page).focus();
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter'); // auto-repeat
    await page.keyboard.up('Enter');
    await page.keyboard.press('Enter');
    await expect(saved(panel, '보컬 테스트')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Saved' })).toBeDisabled();
    const { samples } = await api.get(`/samples?task_id=${id}`);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ name: '보컬 테스트', tags: ['vox', 'lead'] });
    await expect(nameField(page)).toHaveValue('보컬 테스트');
  });

  test('processing and format: reverse, normalize, fades, mono, 24-bit, 48 kHz, 32-bit float, zero-crossing snap', async ({ page, seed, api }) => {
    const { id, d, panel } = await setup(page, seed, api);
    await dragLane(page, 'vocals.wav', 5, 9, d);
    await typeTime(page, 'Start', '6');
    await typeTime(page, 'End', '8');
    const stem = await wavOf(api, `/download/${id}/vocals.wav?variant=original`);
    const save = async (name) => {
      await nameField(page).fill(name);
      await panel.getByRole('button', { name: 'Save sample' }).click();
      await expect(saved(panel, name)).toBeVisible({ timeout: 20_000 });
      const s = await lastSample(api, id);
      return { s, wav: await wavOf(api, `/samples/${s.id}/audio`) };
    };

    await panel.getByLabel('Fade in (ms)').fill('50');
    await panel.getByLabel('Fade out (ms)').fill('50');
    await panel.getByRole('button', { name: 'Normalize' }).click();
    await panel.getByRole('button', { name: 'Reverse' }).click();
    let { wav } = await save('reversed');
    expect(peak(wav), 'normalized to −1 dBFS (fades may only lower it)').toBeLessThanOrEqual(0.8913 + 1e-4);
    expect(Math.abs(wav.channelData[0][0]), 'fade in').toBeLessThan(0.002);
    expect(Math.abs(wav.channelData[0][wav.frames - 1]), 'fade out').toBeLessThan(0.002);
    // reversed and scaled: sample[i] = g · stem[end - 1 - i]
    const at = 6 * 44100;
    let segPeak = 0;
    for (let c = 0; c < 2; c += 1) for (let i = 0; i < 88200; i += 1) segPeak = Math.max(segPeak, Math.abs(stem.channelData[c][at + i]));
    const g = 10 ** (-1 / 20) / segPeak;
    let err = 0;
    for (let i = 4410; i < 88200 - 4410; i += 7) err = Math.max(err, Math.abs(wav.channelData[0][i] - g * stem.channelData[0][at + 88199 - i]));
    expect(err, 'reversed, scaled to a −1 dBFS peak').toBeLessThan(2e-4);

    await panel.getByRole('button', { name: 'Normalize' }).click();
    await panel.getByRole('button', { name: 'Reverse' }).click();
    await panel.getByRole('button', { name: 'Mono' }).click();
    await panel.getByLabel('Bit depth').selectOption('24');
    await panel.getByLabel('Sample rate').selectOption('48000');
    let s;
    ({ s, wav } = await save('mono 24 48k'));
    expect(s).toMatchObject({ sample_rate: 48000, channels: 1 });
    expect(wav).toMatchObject({ format: 'pcm', bits: 24, channels: 1, sampleRate: 48000 });
    expect(Math.abs(wav.frames - 96000)).toBeLessThanOrEqual(2);

    await panel.getByRole('button', { name: 'Mono' }).click();
    await panel.getByLabel('Bit depth').selectOption('32');
    await panel.getByLabel('Sample rate').selectOption('');
    ({ wav } = await save('float'));
    expect(wav).toMatchObject({ format: 'float', bits: 32, channels: 2, sampleRate: 44100 });

    await panel.getByLabel('Bit depth').selectOption('');
    await panel.getByLabel('Fade in (ms)').fill('0');
    await panel.getByLabel('Fade out (ms)').fill('0');
    await snapSelect(page).selectOption('zero');
    await typeTime(page, 'Start', '6.0037');
    ({ s, wav } = await save('zero crossing'));
    // the start moved (≤ 10 ms) to a sign change of the stem's mono sum
    const f = Math.round(s.source.start_sec * 44100);
    expect(Math.abs(f - Math.round(6.0037 * 44100))).toBeLessThanOrEqual(441);
    const mono = (i) => stem.channelData[0][i] + stem.channelData[1][i];
    expect(Math.sign(mono(f - 1)) !== Math.sign(mono(f)) || mono(f) === 0, `frame ${f} is a zero crossing`).toBe(true);
    expect(wav.frames).toBe(Math.round(s.source.end_sec * 44100) - f);
  });

  test("Save keeps the stem's Recovered choice", async ({ page, seed, api }) => {
    const { id, d, panel } = await setup(page, seed, api);
    await rowOf(page, 'vocals.wav').getByRole('radio', { name: 'Recovered (apollo)' }).click();
    await expect(panel.locator('select').first().locator('option:checked')).toHaveText(/vocals \(recovered\)/i);
    await dragLane(page, 'vocals.wav', 5, 9, d);
    await typeTime(page, 'Start', '6');
    await typeTime(page, 'End', '8');
    await nameField(page).fill('recovered vox');
    await panel.getByRole('button', { name: 'Save sample' }).click();
    await expect(saved(panel, 'recovered vox')).toBeVisible();
    const s = await lastSample(api, id);
    expect(s.source.variant).toBe('recovered');
    const wav = await wavOf(api, `/samples/${s.id}/audio`);
    const rec = await wavOf(api, `/download/${id}/vocals.wav?variant=recovered`);
    expect(maxDiff(wav, rec, 441, 88200 - 441, 6 * 44100)).toBeLessThan(1e-4);
  });

  test('Save mix sums the stems you hear at their levels (mute, fader, solo)', async ({ page, seed, api }) => {
    const { id, d, panel } = await setup(page, seed, api);
    await page.getByRole('button', { name: 'Mute bass' }).click();
    const drums = page.getByRole('slider', { name: 'drums level' });
    await page.keyboard.press('Shift'); // keyboard focus: the arrows go to the fader
    await drums.focus();
    for (let i = 0; i < 12; i += 1) await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('button', { name: 'Reset drums level to 0 dB' })).toHaveText('−6.0');
    await dragLane(page, 'vocals.wav', 5, 9, d);
    await typeTime(page, 'Start', '6');
    await typeTime(page, 'End', '8');
    await nameField(page).fill('mix one');
    const req = page.waitForRequest((r) => r.url().endsWith('/samples/mix'));
    await panel.getByRole('button', { name: 'Save mix' }).click();
    const body = (await req).postDataJSON();
    await expect(saved(panel, 'mix one')).toBeVisible({ timeout: 20_000 });
    const gains = Object.fromEntries(body.stems.map((x) => [x.track, x.gain]));
    expect(gains['bass.wav']).toBe(0);
    expect(gains['drums.wav']).toBeCloseTo(0.5012, 4);
    expect(gains['other.wav']).toBe(1);
    expect(gains['vocals.wav']).toBe(1);
    const s = await lastSample(api, id);
    expect(s.source).toMatchObject({ variant: 'mix', track: 'mix: drums, other, vocals' });
    const wav = await wavOf(api, `/samples/${s.id}/audio`);
    const stems = {};
    for (const t of ['drums', 'other', 'vocals']) stems[t] = await wavOf(api, `/download/${id}/${t}.wav`);
    let err = 0;
    const at = 6 * 44100;
    for (let i = 441; i < 88200 - 441; i += 3) {
      const want = gains['drums.wav'] * stems.drums.channelData[0][at + i] + stems.other.channelData[0][at + i] + stems.vocals.channelData[0][at + i];
      err = Math.max(err, Math.abs(wav.channelData[0][i] - want));
    }
    expect(err, 'mix = Σ gain·stem').toBeLessThan(1e-4);
    await expect(lane(page, 'bass.wav').locator('[data-marker]'), 'no marker on the muted stem').toHaveCount(0);
    await expect(lane(page, 'other.wav').locator('[data-marker]')).toHaveCount(1);

    await page.getByRole('button', { name: 'Solo other' }).click();
    await nameField(page).fill('mix solo');
    await panel.getByRole('button', { name: 'Save mix' }).click();
    await expect(saved(panel, 'mix solo')).toBeVisible({ timeout: 20_000 });
    expect((await lastSample(api, id)).source.track).toBe('mix: other');
  });

  test('every stem muted: Save mix reports the server error', async ({ page, seed, api }) => {
    const { d, panel } = await setup(page, seed, api);
    await dragLane(page, 'vocals.wav', 6, 8, d);
    for (const t of ['bass', 'drums', 'other', 'vocals']) await page.getByRole('button', { name: `Mute ${t}` }).click();
    await panel.getByRole('button', { name: 'Save mix' }).click();
    await expect(panel.getByRole('alert')).toContainText(/silent/i);
  });

  test('Undo removes the sample and its markers; Open in Library shows it', async ({ page, seed, api }) => {
    const { id, d, panel } = await setup(page, seed, api);
    await dragLane(page, 'vocals.wav', 6, 8, d);
    await nameField(page).fill('undo me');
    await panel.getByRole('button', { name: 'Save sample' }).click();
    await expect(saved(panel, 'undo me')).toBeVisible();
    const s = await lastSample(api, id);
    await expect(lane(page, 'vocals.wav').locator('[data-marker]')).toHaveCount(1);
    await panel.getByRole('button', { name: 'Undo' }).click();
    await expect(panel.getByText('Removed “undo me”.')).toBeVisible();
    expect((await api.raw(`/samples/${s.id}`)).status).toBe(404);
    await expect(lane(page, 'vocals.wav').locator('[data-marker]')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Save sample' }), 'the same cut can be saved again').toBeEnabled();

    await nameField(page).fill('library link');
    await panel.getByRole('button', { name: 'Save sample' }).click();
    await expect(saved(panel, 'library link')).toBeVisible();
    await panel.getByRole('link', { name: 'Open in Library' }).click();
    await expect(page).toHaveURL(/#\/library\?q=library(%20|\+| )link/);
    await expect(page.getByText('library link').first()).toBeVisible();
  });

  test('markers of saved samples: on their lanes, a click selects the sample', async ({ page, seed, api }) => {
    const id = await seed.recovered();
    await api.cutSample(id, { track: 'vocals.wav', start: 6, end: 8, name: 'seeded' });
    await openJob(page, id);
    const marker = lane(page, 'vocals.wav').locator('[data-marker]');
    await expect(marker).toHaveCount(1);
    await expect(lane(page, 'drums.wav').locator('[data-marker]')).toHaveCount(0);
    await marker.click();
    await rowOf(page, 'vocals.wav').getByRole('button', { name: 'Extract', exact: true }).click();
    expect(await selection(page)).toEqual({ start: 6, end: 8 });
  });

  test('Set start / Set end at the playhead; Esc closes the menu, then the panel, then the selection', async ({ page, seed, api }) => {
    const { d, panel, bpm } = await setup(page, seed, api);
    const ruler = await page.locator('[data-axis]').first().boundingBox();
    await page.mouse.click(ruler.x + (10 / d) * ruler.width, ruler.y + ruler.height / 2);
    await panel.getByRole('button', { name: 'Set start' }).click();
    let s = await selection(page);
    expect(s.start).toBeCloseTo(10, 1);
    expect(s.end - s.start, '4 beats by default').toBeCloseTo(240 / bpm, 2);
    await page.mouse.click(ruler.x + (13 / d) * ruler.width, ruler.y + ruler.height / 2);
    await panel.getByRole('button', { name: 'Set end' }).click();
    s = await selection(page);
    expect(s.end).toBeCloseTo(13, 1);

    await page.getByRole('button', { name: 'Download all stems' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(panel, 'Esc closed only the menu').toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(lane(page, 'vocals.wav').locator('[data-handle]')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-ready] [data-handle]')).toHaveCount(0);

    const extract = rowOf(page, 'vocals.wav').getByRole('button', { name: 'Extract', exact: true });
    await extract.click();
    await panelOf(page).getByRole('button', { name: 'Close' }).click();
    await expect(panelOf(page)).toHaveCount(0);
    await extract.click();
    await extract.click();
    await expect(panelOf(page), 'Extract toggles').toHaveCount(0);
  });

  test('From "Mix of audible stems" leaves one Save mix button', async ({ page, seed, api }) => {
    const { panel } = await setup(page, seed, api);
    await panel.locator('select').first().selectOption('mix');
    await expect(panel.getByRole('button', { name: 'Save mix' })).toHaveCount(1);
    await expect(panel.getByRole('button', { name: 'Save sample' })).toHaveCount(0);
  });

  test('Esc in a start/end field restores the previous value', async ({ page, seed, api }) => {
    const { d } = await setup(page, seed, api);
    await dragLane(page, 'vocals.wav', 6, 8.4, d);
    const start = page.getByRole('textbox', { name: 'Start (m:ss.mmm)' });
    await start.click();
    await start.pressSequentially('3');
    await start.press('Escape');
    await expect(start).toHaveValue('0:06.000', { timeout: 2000 });
  });

  test('after Save mix, changing what you hear allows saving that mix', async ({ page, seed, api }) => {
    test.fail(true, 'the duplicate-save key ignores the stems\' mute/solo/level/variant - ExtractPanel.jsx:185 (keyFor), 308');
    const { d, panel } = await setup(page, seed, api);
    await dragLane(page, 'vocals.wav', 6, 8, d);
    await panel.getByRole('button', { name: 'Save mix' }).click();
    await expect(panel.getByText(/^Saved “/)).toBeVisible();
    await page.getByRole('button', { name: 'Mute drums' }).click();
    await expect(panel.getByRole('button', { name: 'Save mix' })).toBeEnabled({ timeout: 2000 });
  });
});

test.describe('touch', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch layouts');

  /** Open Extract on vocals: the sheet (phone) or the docked panel (tablet). */
  async function openExtract(page, L) {
    if (L.size === 'phone') {
      await page.getByRole('button', { name: 'vocals: extract, download, spectrogram, level' }).click();
      await page.getByRole('dialog', { name: 'vocals' }).getByRole('button', { name: 'Extract a sample' }).click();
      const sheet = page.getByRole('dialog', { name: 'Extract · vocals' });
      await expect(sheet).toBeVisible();
      return { scope: sheet, laneEl: sheet.locator('[data-lane]') };
    }
    await rowOf(page, 'vocals.wav').getByRole('button', { name: 'Extract', exact: true }).click();
    await expect(panelOf(page)).toBeVisible();
    return { scope: panelOf(page), laneEl: lane(page, 'vocals.wav') };
  }
  async function tapLane(page, laneEl, t, d, fy = 0.35) {
    await laneEl.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const b = await laneEl.boundingBox();
    await page.touchscreen.tap(b.x + (t / d) * b.width, b.y + b.height * fy);
  }

  test('Set start / Set end at a tapped playhead, ± steppers with 10 ms / 100 ms / beat steps', async ({ page, seed, api }) => {
    const id = await seed.recovered();
    const L = await openJob(page, id);
    const d = await stemDuration(api, id);
    const bpm = (await api.get(`/result/${id}`)).bpm;
    const { scope, laneEl } = await openExtract(page, L);
    await expect(scope).toContainText('Tap a waveform');
    await tapLane(page, laneEl, 6, d);
    await scope.getByRole('button', { name: 'Set start' }).click();
    let s = await selection(page);
    expect(s.start).toBeCloseTo(6, 1);
    expect(s.end - s.start).toBeCloseTo(240 / bpm, 2);
    await tapLane(page, laneEl, 9.6, d);
    await scope.getByRole('button', { name: 'Set end' }).click();
    const s0 = await selection(page);
    expect(s0.end).toBeCloseTo(9.6, 1);
    expect(s0.start).toBe(s.start);

    if (L.size === 'phone') {
      // the sheet has a Step choice; the docked panel steps 10 ms
      await scope.getByRole('button', { name: 'Start later' }).click();
      await expect.poll(async () => (await selection(page)).start - s0.start).toBeCloseTo(0.01, 4);
      await scope.getByText('100 ms', { exact: true }).click();
      await scope.getByRole('button', { name: 'End earlier' }).click();
      await expect.poll(async () => (await selection(page)).end - s0.end).toBeCloseTo(-0.1, 4);
      await scope.getByText('Beat', { exact: true }).click();
      await scope.getByRole('button', { name: 'End later' }).click();
      await expect.poll(async () => (await selection(page)).end - s0.end).toBeCloseTo(-0.1 + 60 / bpm, 3);
    } else {
      await scope.getByRole('button', { name: 'Start later' }).click();
      await expect.poll(async () => (await selection(page)).start - s0.start).toBeCloseTo(0.01, 4);
      await scope.getByRole('button', { name: 'End earlier' }).click();
      await expect.poll(async () => (await selection(page)).end - s0.end).toBeCloseTo(-0.01, 4);
    }
    // a tap on a handle moves the playhead, not the edge
    const before = await selection(page);
    const h = await laneEl.locator('[data-handle="start"]').boundingBox();
    await page.touchscreen.tap(h.x + h.width / 2, h.y + h.height / 2);
    expect(await selection(page)).toEqual(before);
  });

  test('preview, loop, save and Save mix from the touch panel; Close keeps the selection', async ({ page, seed, api }) => {
    const id = await seed.recovered();
    const L = await openJob(page, id);
    const d = await stemDuration(api, id);
    const { scope, laneEl } = await openExtract(page, L);
    await tapLane(page, laneEl, 6, d);
    await scope.getByRole('button', { name: 'Set start' }).click();
    await scope.getByRole('button', { name: 'Play selection' }).click();
    await expect(scope.getByRole('button', { name: 'Stop' })).toBeVisible();
    await scope.getByRole('button', { name: 'Stop' }).click();
    await expect(scope.getByRole('button', { name: 'Play selection' })).toBeVisible();
    const loop = scope.getByRole('button', { name: 'Loop', exact: true });
    await loop.click();
    await expect(loop).toHaveAttribute('aria-pressed', 'true');
    await loop.click();
    await nameField(page).fill('touch cut');
    await tagsField(page).fill('touch, kept');
    await scope.getByRole('button', { name: 'Save sample' }).click();
    await expect(saved(scope, 'touch cut')).toBeVisible();
    const s = await lastSample(api, id);
    expect(s).toMatchObject({ name: 'touch cut', tags: ['touch', 'kept'] });
    expect(s.source.start_sec).toBeCloseTo((await selection(page)).start, 2);
    await nameField(page).fill('touch mix');
    await scope.getByRole('button', { name: 'Save mix' }).click();
    await expect(saved(scope, 'touch mix')).toBeVisible({ timeout: 20_000 });
    expect((await lastSample(api, id)).source.track).toBe('mix: bass, drums, other, vocals');
    if (L.size === 'phone') {
      await scope.getByRole('button', { name: 'Close' }).click();
      await expect(scope).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Play (Space)' }), 'the bottom bar is back').toBeVisible();
    } else {
      await scope.getByRole('button', { name: 'Close' }).click();
      await expect(scope).toHaveCount(0);
    }
    await expect(lane(page, 'vocals.wav').locator('[data-handle]')).toHaveCount(2);
    if (L.size === 'phone') expect(await smallTargets(page, 'main')).toEqual([]);
  });

  test('state survives a phone ↔ tablet resize (name, tags, options, selection, Saved/Undo)', async ({ page, seed, api }) => {
    const id = await seed.recovered();
    const L = await openJob(page, id);
    const d = await stemDuration(api, id);
    const { scope, laneEl } = await openExtract(page, L);
    await tapLane(page, laneEl, 6, d);
    await scope.getByRole('button', { name: 'Set start' }).click();
    await nameField(page).fill('resize me');
    await tagsField(page).fill('kept, tags');
    await scope.getByRole('button', { name: 'Normalize' }).click();
    await scope.getByLabel('Bit depth').selectOption('24');
    const sel0 = await selection(page);
    const home = page.viewportSize();
    const other = L.size === 'phone' ? { width: 820, height: 1180 } : { width: 390, height: 844 };
    const expectState = async () => {
      await expect(nameField(page)).toHaveValue('resize me');
      await expect(tagsField(page)).toHaveValue('kept, tags');
      await expect(page.getByRole('button', { name: 'Normalize' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByLabel('Bit depth')).toHaveValue('24');
      expect(await selection(page)).toEqual(sel0);
    };
    await page.setViewportSize(other);
    await expect(L.size === 'phone' ? panelOf(page) : page.getByRole('dialog', { name: 'Extract · vocals' })).toBeVisible();
    await expectState();
    await page.getByRole('button', { name: 'Save sample' }).click();
    await expect(page.getByText('Saved “resize me”')).toBeVisible();
    await page.setViewportSize(home);
    await expect(L.size === 'phone' ? page.getByRole('dialog', { name: 'Extract · vocals' }) : panelOf(page)).toBeVisible();
    await expectState();
    await expect(page.getByText('Saved “resize me”')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Saved' }), 'duplicate guard kept').toBeDisabled();
  });

  test('markers are tappable and select their sample', async ({ page, seed, api }) => {
    const id = await seed.recovered();
    await api.cutSample(id, { track: 'vocals.wav', start: 6, end: 8, name: 'seeded' });
    await openJob(page, id);
    await centerLane(page, 'vocals.wav');
    const m = await lane(page, 'vocals.wav').locator('[data-marker]').boundingBox();
    expect(m.width).toBeGreaterThanOrEqual(44);
    expect(m.height).toBeGreaterThanOrEqual(44);
    await page.touchscreen.tap(m.x + 10, m.y + m.height - 8);
    await expect(lane(page, 'vocals.wav').locator('[data-handle]')).toHaveCount(2);
  });

  test('finger drags move the selection handles', async ({ page, seed, api, browserName }) => {
    test.skip(!hasCDP(browserName), 'finger drags through CDP');
    const id = await seed.recovered();
    const L = await openJob(page, id);
    const d = await stemDuration(api, id);
    const { scope, laneEl } = await openExtract(page, L);
    await tapLane(page, laneEl, 6, d);
    await scope.getByRole('button', { name: 'Set start' }).click();
    await tapLane(page, laneEl, 9, d);
    await scope.getByRole('button', { name: 'Set end' }).click();
    const t = await touch(page);
    const s0 = await selection(page);
    await laneEl.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const b = await laneEl.boundingBox();
    const xOf = (sec) => b.x + (sec / d) * b.width;
    const y = b.y + b.height * 0.7;
    await t.swipe({ x: xOf(s0.end) + 3, y }, { x: xOf(s0.end) + 50, y: y + 1 });
    await expect.poll(async () => (await selection(page)).end).toBeGreaterThan(s0.end + (35 / b.width) * d);
    await t.swipe({ x: xOf(s0.start) - 3, y }, { x: xOf(s0.start) - 40, y: y + 1 });
    await expect.poll(async () => (await selection(page)).start).toBeLessThan(s0.start - (25 / b.width) * d);
    // a sideways finger drag on an unzoomed lane doesn't start a new selection
    const s1 = await selection(page);
    await t.swipe({ x: xOf(15), y }, { x: xOf(19), y: y + 1 });
    expect(await selection(page)).toEqual(s1);
  });

  test('phone sheet: zoom with +, Selection and a pinch on its waveform', async ({ page, seed, api, browserName }) => {
    test.skip(!hasCDP(browserName), 'multi-touch through CDP');
    const id = await seed.recovered();
    const L = await openJob(page, id);
    test.skip(L.size !== 'phone', 'the phone sheet');
    const d = await stemDuration(api, id);
    const { scope, laneEl } = await openExtract(page, L);
    await tapLane(page, laneEl, 6, d);
    await scope.getByRole('button', { name: 'Set start' }).click();
    const s = await selection(page);
    await scope.getByRole('button', { name: 'Zoom in' }).click();
    await expect(scope.getByRole('button', { name: 'Fit' })).toBeEnabled();
    await scope.getByRole('button', { name: 'Selection', exact: true }).click();
    await expect.poll(async () => (await zoomState(page, d)).start).toBeCloseTo(s.start - (s.end - s.start) * 0.08, 1);
    await scope.getByRole('button', { name: 'Fit' }).click();
    const b = await laneEl.boundingBox();
    await (await touch(page)).pinch({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, 50, 200);
    await expect.poll(async () => (await zoomState(page, d)).frac).toBeLessThan(0.5);
  });

  test('phone landscape sheet: a field scrolled into view is not hidden under the sticky waveform', async ({ page, seed, api }) => {
    const id = await seed.recovered();
    const L = await openJob(page, id);
    test.skip(!(L.size === 'phone' && L.short), 'landscape phones');
    test.fail(true, 'sticky header + viewer take ~200 of ~360 px and the sheet has no scroll-padding: focused fields land under it - Mixer.jsx:548, Sheet.jsx:36');
    const d = await stemDuration(api, id);
    const { scope, laneEl } = await openExtract(page, L);
    await tapLane(page, laneEl, 6, d);
    await scope.getByRole('button', { name: 'Set start' }).click();
    for (const field of ['Start (m:ss.mmm)', 'Sample name']) {
      const covered = await scope.getByRole('textbox', { name: field }).evaluate((el) => {
        const scroller = el.closest('[role=dialog] > div');
        scroller.scrollTop = scroller.scrollHeight; // from the bottom, as when going back to an earlier field
        el.scrollIntoView({ block: 'nearest' });
        const r = el.getBoundingClientRect();
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) !== el;
      });
      expect(covered, `${field} covered by the sticky waveform`).toBe(false);
    }
  });

  test('phone: a tap on a lane over a saved sample still moves the playhead', async ({ page, seed, api }) => {
    const id = await seed.recovered();
    await api.cutSample(id, { track: 'bass.wav', start: 10, end: 12, name: 'in the way' });
    const L = await openJob(page, id);
    test.skip(L.size !== 'phone', '56 px phone lanes');
    test.fail(true, "touch marker targets are 44 px tall on 56 px lanes, so a tap there selects the sample instead of seeking - Lane.jsx:154, TrackRow.jsx:77");
    const d = await stemDuration(api, id);
    await hitLane(page, 'bass.wav', 10.5, d, { touch: true, fy: 0.5 });
    await expect.poll(async () => Math.abs((await timeNow(page)) - 10.5), { timeout: 3000 }).toBeLessThan(0.1);
  });
});


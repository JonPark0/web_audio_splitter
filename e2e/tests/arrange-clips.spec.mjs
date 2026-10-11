import {
  test,
  expect,
  seedProject,
  getProject,
  pollProject,
  allClips,
  openProject,
  track,
  clip,
  clipEl,
  lanes,
  dock,
  projectBpm,
  pxPerBeat,
  laneHeight,
  mouseDrag,
  clickClip,
  seekTo,
  position,
  playButton,
  filterBrowser,
  sampleRow,
  selectedClipIds,
  freshTone,
  poll,
  undoRedo,
} from './arrange/helpers.mjs';

// Clip editing with a mouse and keyboard (desktop layout): placing samples
// from the browser, move/snap/trim, clip loop, fades, reverse, gain, pitch,
// warp and BPM sync, the sample's library BPM tools, clipboard, split,
// selection, overlaps, undo/redo and the keyboard shortcuts.

test.beforeEach(({ isMobile }) => test.skip(isMobile, 'mouse and keyboard editing (desktop layout)'));

const clipOf = async (api, pid, id) => allClips(await getProject(api, pid)).find((c) => c.id === id);
const pending = (page, id) => clipEl(page, id).getAttribute('aria-label').then((l) => /rendering/.test(l));

/** Grab a clip's body (clear of trim and fade handles) and drag it by (dx, dy) px. */
async function dragClip(page, id, dx, dy = 0, opts) {
  const b = await clipEl(page, id).boundingBox();
  const from = { x: b.x + Math.min(30, b.width / 2), y: b.y + b.height / 2 + 6 };
  await mouseDrag(page, from, { x: from.x + dx, y: from.y + dy }, opts);
}

/** Drag a clip's left ('start') or right ('end') edge by dx px. */
async function dragEdge(page, id, edge, dx, opts) {
  const b = await clipEl(page, id).boundingBox();
  const x = edge === 'end' ? b.x + b.width - 3 : b.x + 3;
  await mouseDrag(page, { x, y: b.y + b.height / 2 }, { x: x + dx, y: b.y + b.height / 2 }, opts);
}

test('drag a sample from the browser onto a lane; below the last track makes a new one', async ({ page, api, smp }) => {
  const p = await seedProject(api, 'Drop', [track('T1'), track('T2'), track('T3')]);
  await openProject(page, p);
  await filterBrowser(page, smp);
  const ppb = await pxPerBeat(page);
  const lh = await laneHeight(page);
  await sampleRow(page, smp.drum.name).dragTo(lanes(page), { targetPosition: { x: 4.3 * ppb, y: lh / 2 } });
  await pollProject(api, p.id, (d) => allClips(d).map((c) => [c.ti, c.start_beat, c.warp, c.length_sec])).toEqual([[0, 4, true, 4]]);
  await expect(dock(page)).toContainText(smp.drum.name); // the new clip is selected
  await sampleRow(page, smp.shot.name).dragTo(lanes(page), { targetPosition: { x: 2 * ppb + 3, y: 3 * lh + 20 } });
  await pollProject(api, p.id, (d) => d.tracks.map((t) => t.clips.map((c) => c.start_beat))).toEqual([[4], [], [], [2]]);
});

test('opened over plain http (a LAN address: no crypto.randomUUID), dropped samples still land', async ({ page, api, smp }) => {
  // Browsers expose randomUUID only in secure contexts; the test server's 127.0.0.1 counts as one.
  await page.addInitScript(() => Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined, configurable: true }));
  const p = await seedProject(api, 'Plain http', [track('T1')]);
  await openProject(page, p);
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
  await filterBrowser(page, smp);
  const ppb = await pxPerBeat(page);
  const lh = await laneHeight(page);
  await sampleRow(page, smp.drum.name).dragTo(lanes(page), { targetPosition: { x: 4.3 * ppb, y: lh / 2 } });
  await sampleRow(page, smp.shot.name).dragTo(lanes(page), { targetPosition: { x: 2 * ppb + 3, y: lh + 20 } }); // and a new track
  await pollProject(api, p.id, (d) => d.tracks.map((t) => t.clips.map((c) => c.start_beat))).toEqual([[4], [2]]);
  const d = await getProject(api, p.id);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  for (const id of [d.tracks[1].id, ...allClips(d).map((c) => c.id)]) expect(id).toMatch(uuid);
});

test('move a clip with snapping (1 beat, off, 1 bar) and onto the track below', async ({ page, api, smp }) => {
  const c = clip(smp.drum, 4);
  const p = await seedProject(api, 'Move', [track('T1', [c]), track('T2')]);
  await openProject(page, p);
  const ppb = await pxPerBeat(page);
  const lh = await laneHeight(page);
  await dragClip(page, c.id, 2.4 * ppb);
  await pollProject(api, p.id, (d) => allClips(d)[0].start_beat).toBe(6);
  await page.getByLabel('Snap').selectOption('off');
  await dragClip(page, c.id, 1.25 * ppb);
  await pollProject(api, p.id, (d) => allClips(d)[0].start_beat).toBeCloseTo(7.25, 1);
  await page.getByLabel('Snap').selectOption('bar');
  await dragClip(page, c.id, 0.5 * ppb);
  await pollProject(api, p.id, (d) => allClips(d)[0].start_beat).toBe(8);
  await page.getByLabel('Snap').selectOption('1');
  await dragClip(page, c.id, 0, lh);
  await pollProject(api, p.id, (d) => [allClips(d)[0].ti, allClips(d)[0].start_beat]).toEqual([1, 8]);
});

test('trim both edges (snapped), and a trim back out stops at the start of the audio', async ({ page, api, smp }) => {
  const c = clip(smp.drum, 8);
  const p = await seedProject(api, 'Trim', [track('T1', [c])]);
  await openProject(page, p);
  const ppb = await pxPerBeat(page);
  await dragEdge(page, c.id, 'end', -2 * ppb);
  await pollProject(api, p.id, (d) => allClips(d)[0].length_sec).toBeCloseTo(3, 6);
  await dragEdge(page, c.id, 'start', 1 * ppb);
  await pollProject(api, p.id, (d) => [allClips(d)[0].start_beat, allClips(d)[0].offset_sec, allClips(d)[0].length_sec]).toEqual([9, 0.5, 2.5]);
  await dragEdge(page, c.id, 'start', -3 * ppb);
  await pollProject(api, p.id, (d) => [allClips(d)[0].start_beat, allClips(d)[0].offset_sec, allClips(d)[0].length_sec]).toEqual([8, 0, 3]);
});

test('clip loop: Loop on, drag the right edge to repeat, typed length, Loop off', async ({ page, api, smp }) => {
  const c = clip(smp.drum, 0);
  const p = await seedProject(api, 'Clip loop', [track('T1', [c])]);
  await openProject(page, p);
  const ppb = await pxPerBeat(page);
  await clickClip(page, c.id);
  await dock(page).getByRole('button', { name: 'Loop' }).click();
  await pollProject(api, p.id, (d) => allClips(d)[0].loop_beats).toBe(8);
  await dragEdge(page, c.id, 'end', 8 * ppb);
  await pollProject(api, p.id, (d) => allClips(d)[0].loop_beats).toBe(16);
  await poll(async () => Math.round((await clipEl(page, c.id).boundingBox()).width)).toBe(Math.round(16 * ppb));
  await expect(clipEl(page, c.id)).toContainText('loop');
  await dock(page).getByLabel('Loop length (beats)').fill('12');
  await dock(page).getByLabel('Loop length (beats)').press('Enter');
  await pollProject(api, p.id, (d) => allClips(d)[0].loop_beats).toBe(12);
  await dock(page).getByRole('button', { name: 'Loop' }).click();
  await pollProject(api, p.id, (d) => allClips(d)[0].loop_beats).toBe(null);
});

test('fades by handle and in ms, reverse, and the clip gain fader with its reset', async ({ page, api, smp }) => {
  const c = clip(smp.drum, 0);
  const p = await seedProject(api, 'Fades', [track('T1', [c])]);
  await openProject(page, p);
  const ppb = await pxPerBeat(page);
  await clickClip(page, c.id);
  const fade = await clipEl(page, c.id).locator('[title="Fade in"]').boundingBox();
  await mouseDrag(page, { x: fade.x + 4, y: fade.y + 4 }, { x: fade.x + 4 + ppb, y: fade.y + 4 });
  await pollProject(api, p.id, (d) => allClips(d)[0].fade_in_sec).toBeCloseTo(0.5, 1);
  await dock(page).getByLabel('Fade out (ms)').fill('250');
  await dock(page).getByLabel('Fade out (ms)').press('Enter');
  await pollProject(api, p.id, (d) => allClips(d)[0].fade_out_sec).toBe(0.25);
  await expect(clipEl(page, c.id).locator('svg polyline')).toHaveCount(2);

  await dock(page).getByRole('button', { name: 'Reverse' }).click();
  await pollProject(api, p.id, (d) => allClips(d)[0].reverse).toBe(true);
  await expect(clipEl(page, c.id)).toContainText('rev');

  const gain = dock(page).getByRole('slider', { name: 'Clip gain' });
  // Arrows belong to a slider with keyboard focus (after a click they nudge
  // the clip). Firefox counts a script focus as keyboard focus only after a
  // keyboard focus move, so Tab once first.
  await page.keyboard.press('Tab');
  await gain.focus();
  await expect(gain).toBeFocused();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowLeft');
  await pollProject(api, p.id, (d) => allClips(d)[0].gain).toBeCloseTo(10 ** (-3 / 20), 3);
  await expect(dock(page).getByRole('button', { name: 'Reset clip gain to 0 dB' })).toHaveText('−3.0 dB');
  await dock(page).getByRole('button', { name: 'Reset clip gain to 0 dB' }).click();
  await pollProject(api, p.id, (d) => allClips(d)[0].gain).toBe(1);
});

test('pitch: + a semitone, typed −3 / "−7" / −25 cents, clamped; rendered on the server', async ({ page, api, smp }) => {
  const c = clip(smp.drum, 0);
  const p = await seedProject(api, 'Pitch', [track('T1', [c])]);
  const renders = [];
  page.on('request', (r) => r.url().includes('/render?') && renders.push(decodeURIComponent(r.url())));
  await openProject(page, p);
  await clickClip(page, c.id);
  const d = dock(page);
  await d.getByRole('button', { name: 'Pitch up a semitone' }).click();
  await pollProject(api, p.id, (x) => allClips(x)[0].semitones).toBe(1);
  await d.getByLabel('Semitones').fill('-3');
  await d.getByLabel('Semitones').press('Enter');
  await pollProject(api, p.id, (x) => allClips(x)[0].semitones).toBe(-3);
  await d.getByLabel('Semitones').fill('−7'); // U+2212, as a phone keyboard may type it
  await d.getByLabel('Semitones').press('Enter');
  await d.getByLabel('Cents').fill('-25');
  await d.getByLabel('Cents').press('Enter');
  await pollProject(api, p.id, (x) => [allClips(x)[0].semitones, allClips(x)[0].cents]).toEqual([-7, -25]);
  await poll(() => renders.some((u) => /semitones=-7&cents=-25/.test(u))).toBe(true);
  await poll(() => pending(page, c.id), { timeout: 20_000 }).toBe(false);
  await expect(clipEl(page, c.id)).toContainText('−7 st −25 ct');
  await d.getByLabel('Semitones').fill('40');
  await d.getByLabel('Semitones').press('Enter');
  await d.getByLabel('Cents').fill('-250');
  await d.getByLabel('Cents').press('Enter');
  await pollProject(api, p.id, (x) => [allClips(x)[0].semitones, allClips(x)[0].cents]).toEqual([24, -100]);
});

test('warp: a 100 BPM loop follows the project tempo, re-rendered when it changes; Warp off plays it at its own speed', async ({ page, api, smp }) => {
  const c = clip(smp.loop, 0);
  const p = await seedProject(api, 'Warp', [track('T1', [c])]);
  const renders = [];
  page.on('request', (r) => r.url().includes('/render?') && renders.push(decodeURIComponent(r.url())));
  await openProject(page, p);
  const ppb = await pxPerBeat(page);
  const width = async () => Math.round((await clipEl(page, c.id).boundingBox()).width);
  await poll(width).toBe(Math.round(8 * ppb)); // 2 bars at any tempo
  await poll(() => renders.some((u) => u.includes(`${smp.loop.id}/render?bpm=120&`))).toBe(true);
  await poll(() => pending(page, c.id), { timeout: 20_000 }).toBe(false);

  await projectBpm(page).fill('90');
  await projectBpm(page).press('Enter');
  await poll(() => renders.some((u) => /render\?bpm=90&/.test(u))).toBe(true);
  await poll(() => pending(page, c.id), { timeout: 20_000 }).toBe(false);
  expect(await width()).toBe(Math.round(8 * ppb));

  await clickClip(page, c.id);
  await expect(dock(page)).toContainText('×0.900');
  await dock(page).getByRole('button', { name: 'Warp' }).click();
  await pollProject(api, p.id, (d) => allClips(d)[0].warp).toBe(false);
  await poll(width).toBe(Math.round(7.2 * ppb)); // 4.8 s at 90 BPM
  await expect(dock(page)).toContainText('Original speed');
});

test("a sample without a BPM can't warp until its library BPM is set: typed, ×2, ÷2, Tap, Fit", async ({ page, api, smp }) => {
  const tone = await freshTone(api);
  const c = clip(tone, 0);
  const p = await seedProject(api, 'Sample BPM', [track('T1', [c])]);
  await openProject(page, p);
  const ppb = await pxPerBeat(page);
  await clickClip(page, c.id);
  const d = dock(page);
  await expect(d.getByRole('button', { name: 'Warp' })).toBeDisabled();
  await expect(d.getByText('No sample BPM')).toBeVisible();
  const libBpm = async () => (await api.get(`/samples/${tone.id}`)).bpm;

  await d.getByLabel('Sample BPM').fill('120');
  await d.getByLabel('Sample BPM').press('Enter');
  await poll(libBpm).toBe(120);
  await expect(d.getByRole('button', { name: 'Warp' })).toBeEnabled();
  await d.getByRole('button', { name: '×2' }).click();
  await poll(libBpm).toBe(240);
  await d.getByRole('button', { name: '÷2' }).click();
  await poll(libBpm).toBe(120);
  await d.getByRole('button', { name: '÷2' }).click();
  await poll(libBpm).toBe(60);

  // five taps exactly 500 ms apart: the tap clock (performance.now) is stepped by hand,
  // so a loaded machine's timer jitter can't skew the tempo
  await d.getByRole('button', { name: 'Tap', exact: true }).evaluate((btn) => {
    const real = performance.now.bind(performance);
    let t = real();
    performance.now = () => t;
    for (let i = 0; i < 5; i += 1) {
      btn.click();
      t += 500;
    }
    performance.now = real;
  });
  const set = d.getByRole('button', { name: /^Set / });
  await expect(set).toHaveText('Set 120');
  await set.click();
  await poll(libBpm).toBe(120);

  // Fit 2 bars: the 3 s region becomes 8 beats (160 BPM) and the clip warps
  await d.getByRole('button', { name: '2', exact: true }).click();
  await poll(libBpm).toBe(160);
  await pollProject(api, p.id, (x) => allClips(x)[0].warp).toBe(true);
  await poll(async () => Math.round((await clipEl(page, c.id).boundingBox()).width)).toBe(Math.round(8 * ppb));
});

test('copy / paste at the playhead, Ctrl+D, cut, and a multi-track paste keeps the track offsets', async ({ page, api, smp }) => {
  const a = clip(smp.drum, 0);
  const b = clip(smp.shot, 4);
  const p = await seedProject(api, 'Clipboard', [track('T1', [a]), track('T2', [b]), track('T3')]);
  await openProject(page, p);
  const starts = async (sid) => allClips(await getProject(api, p.id)).filter((c) => c.sample_id === sid).map((c) => [c.ti, c.start_beat]).sort((x, y) => x[1] - y[1]);
  await clickClip(page, a.id);
  await page.keyboard.press('Control+c');
  await seekTo(page, 12);
  await expect(position(page)).toHaveText('4.1.1');
  await page.keyboard.press('Control+v');
  await poll(() => starts(a.sample_id)).toEqual([[0, 0], [0, 12]]);
  await page.keyboard.press('Control+d'); // the pasted copy is selected
  await poll(() => starts(a.sample_id)).toEqual([[0, 0], [0, 12], [0, 20]]);

  await clickClip(page, b.id);
  await page.keyboard.press('Control+x');
  await poll(() => starts(b.sample_id)).toEqual([]);
  await seekTo(page, 8);
  await page.keyboard.press('Control+v');
  await poll(() => starts(b.sample_id)).toEqual([[1, 8]]);

  // both tracks at once, pasted from the first track: T1 stays T1, T2 stays T2
  await clickClip(page, a.id);
  const bNow = allClips(await getProject(api, p.id)).find((c) => c.sample_id === b.sample_id);
  await clipEl(page, bNow.id).click({ modifiers: ['Shift'], position: { x: 20, y: 30 } });
  await page.keyboard.press('Control+c');
  const lb = await lanes(page).boundingBox();
  const ppb = await pxPerBeat(page);
  await page.mouse.click(lb.x + 10 * ppb, lb.y + 8); // empty spot on T1: selects that track
  await seekTo(page, 14);
  await page.keyboard.press('Control+v');
  // copied: the T1 clip at 0 and the T2 clip at 8 -> T1 at 14, T2 at 22
  await pollProject(api, p.id, (d) => {
    const cs = allClips(d);
    return [cs.some((c) => c.sample_id === a.sample_id && c.ti === 0 && c.start_beat === 14), cs.some((c) => c.sample_id === b.sample_id && c.ti === 1 && c.start_beat === 22)];
  }).toEqual([true, true]);
});

test('inspector Duplicate / Next bar, split at the playhead (S), Delete, select all, rubber band', async ({ page, api, smp }) => {
  const a = clip(smp.drum, 1, { length_sec: 1 }); // beats 1..3
  const w = clip(smp.bass, 8);
  const p = await seedProject(api, 'Edit', [track('T1', [a]), track('T2', [w])]);
  await openProject(page, p);
  const aStarts = async () => allClips(await getProject(api, p.id)).filter((c) => c.sample_id === a.sample_id).map((c) => c.start_beat).sort((x, y) => x - y);
  await clickClip(page, a.id);
  await dock(page).getByRole('button', { name: 'Duplicate', exact: true }).click();
  await poll(aStarts).toEqual([1, 3]);
  await clickClip(page, a.id);
  await dock(page).getByRole('button', { name: 'Next bar' }).click();
  await poll(aStarts).toEqual([1, 3, 5]);

  await seekTo(page, 10);
  await clickClip(page, w.id);
  await page.keyboard.press('s');
  await pollProject(api, p.id, (d) => d.tracks[1].clips.map((c) => [c.start_beat, c.offset_sec, c.length_sec]).sort((x, y) => x[0] - y[0])).toEqual([
    [8, 0, 1],
    [10, 1, 3],
  ]);
  await poll(() => selectedClipIds(page).then((s) => s.length)).toBe(2);
  await page.keyboard.press('Escape');
  const right = (await getProject(api, p.id)).tracks[1].clips.find((c) => c.start_beat === 10);
  await clickClip(page, right.id);
  await page.keyboard.press('Delete');
  await pollProject(api, p.id, (d) => d.tracks[1].clips.map((c) => c.start_beat)).toEqual([8]);

  await page.keyboard.press('Control+a');
  await expect(dock(page)).toContainText('4 clips selected');
  await page.keyboard.press('Escape');
  await poll(() => selectedClipIds(page)).toEqual([]);

  // a box from an empty spot on T1 (beat 9.5) back down to T2 beat 6 catches the clip at 5..7 and the bass at 8..10
  const lb = await lanes(page).boundingBox();
  const ppb = await pxPerBeat(page);
  const lh = await laneHeight(page);
  await mouseDrag(page, { x: lb.x + 9.5 * ppb, y: lb.y + 6 }, { x: lb.x + 6 * ppb, y: lb.y + lh + lh / 2 });
  // every clip here plays at its own speed (120 BPM samples): 2 beats per second of source
  const want = allClips(await getProject(api, p.id))
    .filter((c) => c.ti <= 1 && c.start_beat < 9.5 && c.start_beat + c.length_sec * 2 > 6)
    .map((c) => c.id)
    .sort();
  expect(want).toHaveLength(2);
  await poll(async () => (await selectedClipIds(page)).sort()).toEqual(want);
});

test('a moved clip truncates or splits what it covers; undo / redo by buttons and keys', async ({ page, api, smp }) => {
  const left = clip(smp.drum, 0, { length_sec: 1 }); // 0..2
  const mover = clip(smp.bass, 12); // 12..20
  const shot = clip(smp.shot, 14, { length_sec: 0.75 }); // T3 14..16 (2 beats)
  const wide = clip(smp.bass, 4); // T2 4..12
  const p = await seedProject(api, 'Overlap', [track('T1', [left, mover]), track('T2', [wide]), track('T3', [shot])]);
  await openProject(page, p);
  const ppb = await pxPerBeat(page);
  const lh = await laneHeight(page);
  const state = async () => {
    const cs = allClips(await getProject(api, p.id));
    return { mover: cs.find((c) => c.id === mover.id).start_beat, left: cs.find((c) => c.id === left.id)?.length_sec };
  };
  await dragClip(page, mover.id, -11 * ppb); // to beat 1: the clip at 0..2 is cut to 0..1
  await poll(state).toEqual({ mover: 1, left: 0.5 });
  await expect(page.locator('[data-clip][aria-label*="overlaps"]')).toHaveCount(0);

  await undoRedo(page, 'Undo');
  await poll(state).toEqual({ mover: 12, left: 1 });
  await undoRedo(page, 'Redo');
  await poll(state).toEqual({ mover: 1, left: 0.5 });
  await page.keyboard.press('Control+z');
  await poll(state).toEqual({ mover: 12, left: 1 });
  await page.keyboard.press('Control+Shift+Z');
  await poll(state).toEqual({ mover: 1, left: 0.5 });
  await page.keyboard.press('Control+z');
  await poll(state).toEqual({ mover: 12, left: 1 });
  await page.keyboard.press('Control+y');
  await poll(state).toEqual({ mover: 1, left: 0.5 });

  // the 2-beat one-shot dropped into the middle of T2's 4..12 clip splits it
  const sb = await clipEl(page, shot.id).boundingBox();
  await mouseDrag(page, { x: sb.x + 10, y: sb.y + sb.height / 2 + 6 }, { x: sb.x + 10 - 7 * ppb, y: sb.y + sb.height / 2 + 6 - lh });
  await pollProject(api, p.id, (d) => d.tracks[1].clips.map((c) => [c.start_beat, c.offset_sec, c.length_sec]).sort((x, y) => x[0] - y[0])).toEqual([
    [4, 0, 1.5],
    [7, 0, 0.75],
    [9, 2.5, 1.5],
  ]);
});

test('shortcuts still work after clicking a fader or the Snap select; Hangul-layout keys', async ({ page, api, smp }) => {
  const c = clip(smp.drum, 0);
  const p = await seedProject(api, 'Shortcuts', [track('T1', [c]), track('T2')]);
  await openProject(page, p);
  const count = async () => (await getProject(api, p.id)).tracks[0].clips.length;
  const vol = page.getByRole('slider', { name: 'T2 volume' });
  const vb = await vol.boundingBox();
  const onThumb = { x: vb.x + vb.width * (60 / 66), y: vb.y + vb.height / 2 }; // 0 dB
  await page.mouse.click(onThumb.x, onThumb.y);
  await expect(vol).toBeFocused();
  await page.keyboard.press('Space');
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'false');

  await seekTo(page, 2);
  await clickClip(page, c.id);
  await page.mouse.click(onThumb.x, onThumb.y);
  await page.keyboard.press('s');
  await poll(count).toBe(2);
  await page.keyboard.press('Control+z');
  await poll(count).toBe(1);

  const snap = page.getByLabel('Snap');
  await clickClip(page, c.id);
  await snap.focus();
  await snap.selectOption('0.5');
  await expect(snap).toBeFocused();
  await page.keyboard.press('s');
  await poll(count).toBe(2);
  await expect(snap).toHaveValue('0.5'); // the letter didn't change the select
  await page.keyboard.press('Control+z');
  await poll(count).toBe(1);

  // Hangul 2-set layout: 'ㄴ' is the S key, 'ㅋ' the Z key
  await clickClip(page, c.id);
  const key = (k, code, ctrlKey = false) =>
    page.evaluate(([k2, c2, ctrl]) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k2, code: c2, ctrlKey: ctrl, bubbles: true, cancelable: true })), [k, code, ctrlKey]);
  await key('ㄴ', 'KeyS');
  await poll(count).toBe(2);
  await key('ㅋ', 'KeyZ', true);
  await poll(count).toBe(1);
  await clickClip(page, c.id);
  await key('Process', 'KeyS'); // an IME mid-composition reports 'Process'
  await poll(count).toBe(2);
});

test('keyboard: Tab reaches a clip, Alt+arrows walk the clips, Enter opens the inspector, Escape returns; arrows nudge', async ({ page, api, smp }) => {
  const a = clip(smp.drum, 0);
  const b = clip(smp.drum, 8);
  const c = clip(smp.shot, 2);
  const p = await seedProject(api, 'Keyboard', [track('T1', [a, b]), track('T2', [c]), track('T3')]);
  await openProject(page, p);
  const focusedClip = () => page.evaluate(() => document.activeElement?.dataset?.clip || null);
  await projectBpm(page).focus();
  for (let i = 0; i < 60 && !(await focusedClip()); i += 1) await page.keyboard.press('Tab');
  expect(await focusedClip(), 'Tab reaches the first clip').toBe(a.id);
  await poll(() => selectedClipIds(page)).toEqual([a.id]);
  await page.keyboard.press('Alt+ArrowRight');
  await poll(focusedClip).toBe(b.id);
  await poll(() => selectedClipIds(page)).toEqual([b.id]);
  await page.keyboard.press('Alt+ArrowLeft');
  await poll(focusedClip).toBe(a.id);
  await page.keyboard.press('Alt+ArrowDown');
  await poll(focusedClip).toBe(c.id);
  await page.keyboard.press('Enter');
  await poll(() => page.evaluate(() => !!document.activeElement?.closest('.h-\\[124px\\]'))).toBe(true);
  await page.keyboard.press('Escape');
  await poll(focusedClip).toBe(c.id);
  await poll(() => selectedClipIds(page)).toEqual([]);

  await clickClip(page, b.id);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ArrowDown');
  await pollProject(api, p.id, (d) => allClips(d).find((x) => x.id === b.id)).toMatchObject({ ti: 1, start_beat: 13 });
});

test('Escape cancels a move and a trim mid-drag', async ({ page, api, smp }) => {
  const c = clip(smp.drum, 4);
  const p = await seedProject(api, 'Escape', [track('T1', [c]), track('T2')]);
  await openProject(page, p);
  const ppb = await pxPerBeat(page);
  const lh = await laneHeight(page);
  const before = await clipEl(page, c.id).boundingBox();
  await dragClip(page, c.id, 4 * ppb, lh, { beforeUp: () => page.keyboard.press('Escape') });
  await dragEdge(page, c.id, 'end', -3 * ppb, { beforeUp: () => page.keyboard.press('Escape') });
  await page.waitForTimeout(1200); // past the save debounce
  expect(await clipEl(page, c.id).boundingBox()).toEqual(before);
  expect(await clipOf(api, p.id, c.id)).toMatchObject({ ti: 0, start_beat: 4, length_sec: 4 });
  expect((await getProject(api, p.id)).version).toBe(p.version);
});

test('a multi-selection: pitch and reverse for all of them at once', async ({ page, api, smp }) => {
  const p = await seedProject(api, 'Bulk', [track('T1', [clip(smp.drum, 0), clip(smp.drum, 8)]), track('T2', [clip(smp.shot, 2)])]);
  await openProject(page, p);
  const lh = await laneHeight(page);
  await lanes(page).click({ position: { x: 12 * (await pxPerBeat(page)), y: lh * 1.5 } }); // empty spot on T2
  await page.keyboard.press('Control+a');
  await expect(dock(page)).toContainText('3 clips selected');
  await dock(page).getByRole('button', { name: 'Pitch up a semitone' }).click();
  await dock(page).getByRole('button', { name: 'Reverse' }).click();
  await pollProject(api, p.id, (d) => allClips(d).map((c) => [c.semitones, c.reverse])).toEqual([[1, true], [1, true], [1, true]]);
  await page.keyboard.press('Control+z');
  await pollProject(api, p.id, (d) => allClips(d).map((c) => c.reverse)).toEqual([false, false, false]);
});

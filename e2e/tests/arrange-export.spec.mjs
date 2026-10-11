import { test, expect, seedProject, openProject, track, clip, press } from './arrange/helpers.mjs';
import { wavInfo, zipEntries } from './arrange/audio.mjs';

// Export (toolbar → Export): the whole song, the loop region, or one WAV per
// track in a ZIP; 24-bit / 48 kHz; Normalise. The files are read back in
// Node: format, channels, length and that they aren't silent. Every profile.

const RATE = 48000;
const F7 = 'F7: on a landscape phone the Export popover (toolbar, z-20 stacking context) runs under the fixed bottom bar (z-40), which covers "Export WAV" (frontend/src/arrange/ui/Toolbar.jsx:259-263, ArrangeScreen.jsx:1164 vs :1377)';
/** Landscape phones can't reach the Export button at all (F7): covered by its own test below. */
const skipF7 = (ui) => test.skip(ui.phone && ui.short, F7);

/** The downloaded file, read into memory (test-results may be cleared by a concurrent run). */
async function downloaded(download) {
  const chunks = [];
  for await (const c of await download.createReadStream()) chunks.push(c);
  return Buffer.concat(chunks);
}

async function exportAs(page, ui, { range, files, level }) {
  await press(page, ui, page.getByRole('button', { name: 'Export', exact: true }).locator('visible=true').first());
  const dlg = page.getByRole('dialog', { name: 'Export' });
  for (const word of [range, files, level]) await press(page, ui, dlg.getByRole('button', { name: word, exact: true }));
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), press(page, ui, dlg.getByRole('button', { name: /^Export (WAV|stems)$/ }))]);
  return { name: download.suggestedFilename(), file: await downloaded(download) };
}

test('song, loop region and stems: 24-bit / 48 kHz WAVs of the right length (stems zipped); Normalise peaks at −1 dBFS', async ({ page, api, smp }) => {
  // two 8-beat clips (4 s at 120 BPM); the loop region is beats 2..6 (2 s)
  const p = await seedProject(api, 'Export', [track('Drums', [clip(smp.drum, 0)]), track('Loop/100', [clip(smp.loop, 0)])], {
    loop: { enabled: true, start_beat: 2, end_beat: 6 },
  });
  const ui = await openProject(page, p);
  skipF7(ui);

  const song = await exportAs(page, ui, { range: 'Song', files: 'Mix', level: 'As mixed' });
  expect(song.name).toBe(`${p.name}.wav`);
  const s = wavInfo(song.file);
  expect(s).toMatchObject({ tag: 1, channels: 2, sampleRate: RATE, bits: 24, frames: 4 * RATE });
  expect(s.rms).toBeGreaterThan(0.01);

  const loop = await exportAs(page, ui, { range: 'Loop', files: 'Mix', level: 'As mixed' });
  expect(loop.name).toBe(`${p.name}-loop.wav`);
  const l = wavInfo(loop.file);
  expect(l).toMatchObject({ channels: 2, sampleRate: RATE, bits: 24, frames: 2 * RATE });
  expect(l.rms).toBeGreaterThan(0.01);

  const stems = await exportAs(page, ui, { range: 'Song', files: 'Stems', level: 'As mixed' });
  expect(stems.name).toBe(`${p.name}-stems.zip`);
  const entries = zipEntries(stems.file);
  expect(entries.map((e) => e.name).sort()).toEqual([`${p.name}-stem-Drums.wav`, `${p.name}-stem-Loop_100.wav`]);
  for (const e of entries) {
    const w = wavInfo(e.data);
    expect(w, e.name).toMatchObject({ channels: 2, sampleRate: RATE, bits: 24, frames: 4 * RATE });
    expect(w.rms, e.name).toBeGreaterThan(0.001);
  }

  const norm = await exportAs(page, ui, { range: 'Song', files: 'Mix', level: 'Normalise' });
  expect(wavInfo(norm.file).peak).toBeCloseTo(10 ** (-1 / 20), 2);
});

test('exporting a project without clips says there is nothing to export', async ({ page, api }) => {
  const p = await seedProject(api, 'Export empty', [track('T1')]);
  const ui = await openProject(page, p);
  skipF7(ui);
  await press(page, ui, page.getByRole('button', { name: 'Export', exact: true }).locator('visible=true').first());
  const dlg = page.getByRole('dialog', { name: 'Export' });
  await press(page, ui, dlg.getByRole('button', { name: 'Song', exact: true }));
  await press(page, ui, dlg.getByRole('button', { name: 'Export WAV' }));
  await expect(page.getByRole('alert')).toContainText('Nothing to export: the project has no clips.');
});

test('with no loop region set, the Loop range is disabled and says why', async ({ page, api, smp }) => {
  test.fail(true, 'F3: every project stores a 0–16 loop (backend/projects.py:58-67), and hasLoop ignores loop.enabled (frontend/src/arrange/ui/Toolbar.jsx:237), so Loop is never disabled and exports bars 1–4 (silence for an empty project)');
  const p = await seedProject(api, 'Export no loop', [track('T1', [clip(smp.drum, 0)])]);
  const ui = await openProject(page, p);
  await press(page, ui, page.getByRole('button', { name: 'Export', exact: true }).locator('visible=true').first());
  const dlg = page.getByRole('dialog', { name: 'Export' });
  await expect(dlg.getByRole('button', { name: 'Loop', exact: true })).toBeDisabled({ timeout: 2000 });
  await expect(dlg.getByText('Loop needs a loop region')).toBeVisible({ timeout: 1000 });
});

test('every control of the Export popover can be reached (nothing covers it)', async ({ page, api, smp }) => {
  const p = await seedProject(api, 'Export reach', [track('T1', [clip(smp.drum, 0)])]);
  const ui = await openProject(page, p);
  test.fail(ui.phone && ui.short, F7);
  await press(page, ui, page.getByRole('button', { name: 'Export', exact: true }).locator('visible=true').first());
  const dlg = page.getByRole('dialog', { name: 'Export' });
  await expect(dlg).toBeVisible();
  const covered = await dlg.locator('button').evaluateAll((els) =>
    els
      .map((e) => {
        const r = e.getBoundingClientRect();
        const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return h === e || e.contains(h) ? null : `${e.textContent.trim()} ← ${h?.tagName}.${String(h?.className || '').slice(0, 30)}`;
      })
      .filter(Boolean)
  );
  expect(covered).toEqual([]);
});

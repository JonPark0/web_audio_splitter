import {
  test,
  expect,
  seedProject,
  getProject,
  pollProject,
  openProject,
  picker,
  projectBpm,
  press,
  dock,
  fakeVisibility,
  track,
  uid,
  poll,
} from './arrange/helpers.mjs';

// Arrange projects (#/arrange/<id>): the picker (new, rename, switch,
// delete, a long list), tempo and time signature, and autosave - debounced
// PUTs with version checks, retry after a failure, the conflict notice when
// another tab saved first, the local draft that outlives a closed tab, and
// the flush when the page comes back. Runs on every device profile.

const menuItem = (page, name) => page.getByRole('menuitem', { name });

/** Pick a picker action (or project) by name. */
async function pick(page, ui, name) {
  await press(page, ui, picker(page));
  await press(page, ui, menuItem(page, name));
}

/** The time-signature select: the desktop dock, else Project settings in More. */
async function beatsPerBar(page, ui) {
  if (ui.desktop) return dock(page).getByLabel('Beats per bar');
  await press(page, ui, page.getByRole('button', { name: 'More', exact: true }).locator('visible=true').first());
  await press(page, ui, menuItem(page, 'Project settings…'));
  return page.getByRole('dialog', { name: 'Project' }).getByLabel('Beats per bar');
}

const saveState = (page, text) => page.locator('[role=status]').filter({ hasText: text }).locator('visible=true').first();

test('create, rename, switch and delete projects from the picker', async ({ page, api }) => {
  const first = await seedProject(api, 'Picker start');
  const ui = await openProject(page, first);

  await pick(page, ui, 'New project');
  await expect(page).not.toHaveURL(new RegExp(first.id));
  const newId = page.url().split('/arrange/')[1];
  expect((await getProject(api, newId)).tracks).toHaveLength(1);

  const name = `Renamed ${uid()}`;
  await pick(page, ui, 'Rename…');
  await page.getByLabel('Project name').fill(name);
  await page.getByLabel('Project name').press('Enter');
  await expect(picker(page)).toContainText(name);
  await pollProject(api, newId, (p) => p.name).toBe(name);

  // Escape leaves the name alone
  await pick(page, ui, 'Rename…');
  await page.getByLabel('Project name').fill('Not this');
  await page.getByLabel('Project name').press('Escape');
  await expect(picker(page)).toContainText(name);

  // switch back to the first one through the list
  await pick(page, ui, new RegExp(first.name));
  await expect(page).toHaveURL(new RegExp(first.id));
  await expect(picker(page)).toContainText(first.name);

  // delete: Cancel keeps it, Confirm removes it and opens another project
  await pick(page, ui, 'Delete…');
  await expect(page.getByText(`Delete “${first.name}”?`)).toBeVisible();
  await press(page, ui, page.getByRole('button', { name: 'Cancel', exact: true }));
  expect((await api.raw(`/projects/${first.id}`)).status).toBe(200);
  await pick(page, ui, 'Delete…');
  await press(page, ui, page.getByRole('button', { name: 'Confirm', exact: true }));
  await expect(page).not.toHaveURL(new RegExp(first.id));
  await poll(async () => (await api.raw(`/projects/${first.id}`)).status).toBe(404);
  await expect(page.locator('[data-timeline]')).toBeVisible();
});

test('the picker scrolls a long project list and keeps its actions in reach', async ({ page, api }) => {
  const batch = uid();
  for (let i = 0; i < 40; i += 1) await api.createProject(`Bulk ${batch} ${String(i).padStart(2, '0')}`, 100 + i);
  const p = await seedProject(api, 'Many projects');
  const ui = await openProject(page, p);
  await press(page, ui, picker(page));
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /Bulk .* 39/ })).toBeAttached();
  const box = await menu.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { scroll: el.scrollHeight - el.clientHeight, top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight };
  });
  expect(box.scroll, 'the list scrolls inside the menu').toBeGreaterThan(0);
  expect(box.bottom).toBeLessThanOrEqual(box.vh);
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(box.vw);
  await expect(menu.getByRole('menuitem').first()).toHaveText('New project');
  await expect(menu.getByRole('menuitem', { name: 'Rename…' })).toBeInViewport();
  await expect(menu.getByRole('menuitem', { name: 'Delete…' })).toBeInViewport();
  // the oldest project sits at the far end of the list
  const target = menu.getByRole('menuitem', { name: new RegExp(`Bulk ${batch} 00`) });
  await target.scrollIntoViewIfNeeded();
  await press(page, ui, target);
  await expect(picker(page)).toContainText(`Bulk ${batch} 00`);
});

test('tempo takes a decimal comma, rejects junk, clamps and reverts on Escape; time signature saves', async ({ page, api }) => {
  const p = await seedProject(api, 'Tempo');
  const ui = await openProject(page, p);
  const bpm = projectBpm(page);
  await bpm.fill('98,5');
  await bpm.press('Enter');
  await expect(bpm).toHaveValue('98.5');
  await pollProject(api, p.id, (d) => d.bpm).toBe(98.5);

  await bpm.fill('abc');
  await bpm.press('Enter');
  await expect(bpm).toHaveValue('98.5');
  await bpm.fill('5');
  await bpm.press('Enter');
  await expect(bpm).toHaveValue('20');
  await pollProject(api, p.id, (d) => d.bpm).toBe(20);
  await bpm.fill('133');
  await bpm.press('Escape');
  await expect(bpm).toHaveValue('20');

  const sig = await beatsPerBar(page, ui);
  await sig.selectOption('3');
  await pollProject(api, p.id, (d) => d.beats_per_bar).toBe(3);
  expect((await getProject(api, p.id)).bpm).toBe(20);
});

test('edits autosave and are there after a reload', async ({ page, api }) => {
  const p = await seedProject(api, 'Autosave');
  const ui = await openProject(page, p);
  await press(page, ui, page.getByRole('button', { name: 'Add track' }));
  await projectBpm(page).fill('101');
  await projectBpm(page).press('Enter');
  await pollProject(api, p.id, (d) => [d.tracks.length, d.bpm]).toEqual([2, 101]);
  await page.reload();
  await expect(page.locator('[data-timeline]')).toContainText('2 tracks');
  await expect(projectBpm(page)).toHaveValue('101');
});

test('a failed save says Not saved, offers Retry and retries by itself', async ({ page, api }) => {
  const p = await seedProject(api, 'Retry');
  const ui = await openProject(page, p);
  let failures = 1;
  await page.route(`**/api/projects/${p.id}`, (route) =>
    route.request().method() === 'PUT' && failures-- > 0 ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' }) : route.continue()
  );
  await press(page, ui, page.getByRole('button', { name: 'Add track' }));
  await expect(saveState(page, 'Not saved')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' }).locator('visible=true').first()).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not save' })).toContainText('Retrying automatically');
  await pollProject(api, p.id, (d) => d.tracks.length).toBe(2);
  await page.unroute(`**/api/projects/${p.id}`);

  // a save that keeps failing until the user presses Retry
  await page.route(`**/api/projects/${p.id}`, (route) => (route.request().method() === 'PUT' ? route.fulfill({ status: 503, body: 'down' }) : route.continue()));
  await press(page, ui, page.getByRole('button', { name: 'Add track' }));
  await expect(saveState(page, 'Not saved')).toBeVisible();
  await page.unroute(`**/api/projects/${p.id}`);
  await press(page, ui, page.getByRole('button', { name: 'Retry' }).locator('visible=true').first());
  await pollProject(api, p.id, (d) => d.tracks.length).toBe(3);
});

test('a save from another tab is never overwritten silently: Keep mine / Reload', async ({ page, api }) => {
  const p = await seedProject(api, 'Two tabs');
  const ui = await openProject(page, p);
  const other = await page.context().newPage();
  await openProject(other, p);
  await projectBpm(other).fill('111');
  await projectBpm(other).press('Enter');
  await pollProject(api, p.id, (d) => d.bpm).toBe(111);

  await projectBpm(page).fill('99');
  await projectBpm(page).press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'Changed in another tab or window.' })).toBeVisible();
  expect((await getProject(api, p.id)).bpm).toBe(111);
  await press(page, ui, page.getByRole('button', { name: 'Keep mine' }));
  await pollProject(api, p.id, (d) => d.bpm).toBe(99);

  // the other tab is stale now: its next edit conflicts; Reload takes the saved copy
  await projectBpm(other).fill('77');
  await projectBpm(other).press('Enter');
  await other.getByRole('button', { name: 'Reload' }).click();
  await expect(projectBpm(other)).toHaveValue('99');
  await other.close();
  expect((await getProject(api, p.id)).bpm).toBe(99);
});

test('closing the tab right after an edit still saves it (keepalive flush)', async ({ page, api, browserName }) => {
  // pagehide + fetch keepalive on Page.close is only dependable in Chromium's automation
  test.skip(browserName !== 'chromium', 'Chromium-only: keepalive flush on page close');
  const p = await seedProject(api, 'Keepalive');
  await openProject(page, p);
  await projectBpm(page).fill('133');
  await projectBpm(page).press('Enter');
  await page.close({ runBeforeUnload: false }); // inside the 800 ms save debounce
  await pollProject(api, p.id, (d) => d.bpm).toBe(133);
});

test('edits from a tab that died offline come back as a local draft: Restore (undoable) / Discard', async ({ page, api, browserName }) => {
  test.skip(browserName !== 'chromium', 'needs CDP Page.crash');
  const p = await seedProject(api, 'Draft');
  await openProject(page, p);
  const ctx = page.context();

  const crashWithEdit = async (bpm) => {
    const tab = await ctx.newPage();
    await openProject(tab, p);
    await tab.route(`**/api/projects/${p.id}`, (route) => (route.request().method() === 'PUT' ? route.abort() : route.continue()));
    await projectBpm(tab).fill(String(bpm));
    await projectBpm(tab).press('Enter');
    await poll(() => tab.evaluate((id) => !!localStorage.getItem(`arrange:draft:${id}`), p.id)).toBe(true);
    const cdp = await ctx.newCDPSession(tab);
    await Promise.race([cdp.send('Page.crash').catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
    await Promise.race([tab.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  };

  await crashWithEdit(140);
  expect((await getProject(api, p.id)).bpm).toBe(120);
  await page.reload();
  const offer = page.getByRole('status').filter({ hasText: 'Unsaved changes from' });
  await expect(offer).toContainText('are on this device');
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(projectBpm(page)).toHaveValue('140');
  await pollProject(api, p.id, (d) => d.bpm).toBe(140);
  await page.locator('[data-timeline]').click({ position: { x: 5, y: 5 } }); // focus out of the field
  await page.keyboard.press('Control+z');
  await pollProject(api, p.id, (d) => d.bpm).toBe(120);

  await crashWithEdit(150);
  await page.reload();
  await expect(offer).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).click();
  await page.reload();
  await expect(page.locator('[data-timeline]')).toBeVisible();
  await expect(offer).toHaveCount(0);
  expect((await getProject(api, p.id)).bpm).toBe(120);
});

test('an edit that could not be saved while the tab was hidden is saved when it comes back', async ({ page, api, browserName }) => {
  const p = await seedProject(api, 'Visibility');
  await openProject(page, p);
  const setVisibility = await fakeVisibility(page);
  await page.route(`**/api/projects/${p.id}`, (route) => (route.request().method() === 'PUT' ? route.abort() : route.continue()));
  await projectBpm(page).fill('141');
  await projectBpm(page).press('Enter');
  await setVisibility('hidden'); // flushes with a keepalive PUT, which fails
  await page.waitForTimeout(300);
  await page.unroute(`**/api/projects/${p.id}`);
  await page.waitForTimeout(1500); // no debounce or retry timer is left to save it
  // (route interception of keepalive requests is reliable in Chromium only)
  if (browserName === 'chromium') expect((await getProject(api, p.id)).bpm).toBe(120);
  await setVisibility('visible');
  await pollProject(api, p.id, (d) => d.bpm).toBe(141);
});

test('an unknown project id and a delete with an edit pending', async ({ page, api }) => {
  const p = await seedProject(api, 'Pending delete');
  await page.goto('/#/arrange/00000000-0000-0000-0000-000000000000');
  await expect(page.getByRole('alert')).toContainText('That project no longer exists.');
  await expect(page).not.toHaveURL(/00000000-0000/);

  const ui = await openProject(page, p);
  const after = [];
  page.on('request', (r) => {
    if (r.url().includes(p.id) && ['PUT', 'DELETE'].includes(r.method())) after.push(r.method());
  });
  await press(page, ui, page.getByRole('button', { name: 'Add track' }));
  await pick(page, ui, 'Delete…');
  await press(page, ui, page.getByRole('button', { name: 'Confirm', exact: true }));
  await poll(async () => (await api.raw(`/projects/${p.id}`)).status).toBe(404);
  await page.waitForTimeout(1200); // past the save debounce
  // (a save may go out before the delete on a slow run; none may follow it)
  expect(after.slice(after.indexOf('DELETE')), 'no save after the delete').toEqual(['DELETE']);
  await expect(page.getByRole('alert').filter({ hasText: 'Could not save' })).toHaveCount(0);
});

test('a project deleted elsewhere: the edit reports a permanent error, without retrying', async ({ page, api }) => {
  const p = await seedProject(api, 'Deleted elsewhere');
  const ui = await openProject(page, p);
  await api.del(`/projects/${p.id}`);
  await press(page, ui, page.getByRole('button', { name: 'Add track' }));
  await expect(saveState(page, 'Not saved')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not save' })).toContainText('Project not found');
  await page.waitForTimeout(1500);
  await expect(saveState(page, 'Not saved')).not.toContainText('retry in');
});

test('the permanent save error reads as a sentence', async ({ page, api }) => {
  test.fail(true, 'F5: "…: Project not found. your edits are kept on this device." – lower-case after the full stop (frontend/src/arrange/ui/useProjectState.js:404)');
  const p = await seedProject(api, 'Error text');
  const ui = await openProject(page, p);
  await api.del(`/projects/${p.id}`);
  await press(page, ui, page.getByRole('button', { name: 'Add track' }));
  const alert = page.getByRole('alert').filter({ hasText: 'Could not save' });
  await expect(alert).toContainText('Project not found');
  await expect(alert).not.toContainText('. your edits', { timeout: 2000 });
});

test('switching projects saves the pending edit to the one being left; Back returns', async ({ page, api }) => {
  const a = await seedProject(api, 'Leave me');
  const b = await seedProject(api, 'Go here', [track('T1')]);
  const ui = await openProject(page, a);
  await press(page, ui, page.getByRole('button', { name: 'Add track' }));
  await page.goto(`/#/arrange/${b.id}`);
  await expect(picker(page)).toContainText(b.name);
  await pollProject(api, a.id, (d) => d.tracks.length).toBe(2);
  expect((await getProject(api, b.id)).tracks).toHaveLength(1);
  // undo history starts over with the other project
  const undo = page.getByRole('button', { name: /^Undo/ }).locator('visible=true');
  if (await undo.count()) await expect(undo.first()).toBeDisabled();
  await page.goBack();
  await expect(picker(page)).toContainText(a.name);
});

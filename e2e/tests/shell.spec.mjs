import { test, expect } from '../support/fixtures.mjs';

// The app shell on every device: sections, routing, no sideways scroll.

const SECTIONS = ['Split', 'Library', 'Arrange'];

async function noHorizontalOverflow(page) {
  const o = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    // on a mobile viewport a too-wide page widens the layout viewport instead
    layout: window.innerWidth - document.documentElement.clientWidth,
  }));
  expect(o.scroll, 'page scrolls sideways').toBeLessThanOrEqual(1);
  expect(o.layout, 'layout viewport widened').toBeLessThanOrEqual(1);
}

test('every section opens from the header and has its own URL and title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/#\/split$|\/$/);
  for (const name of SECTIONS) {
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/${name.toLowerCase()}`));
    await expect(page).toHaveTitle(new RegExp(`^${name} — Audio Splitter`));
    await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
    // route focus and screen readers find the section by its heading (Arrange opens on its project instead)
    if (name !== 'Arrange') await expect(page.getByRole('main').getByRole('heading', { name: new RegExp(`^${name}`) }).first()).toBeAttached();
    await noHorizontalOverflow(page);
  }
});

test('the tab has an icon, and /favicon.ico exists for browsers that ask for it anyway', async ({ page }) => {
  await page.goto('/');
  const icons = await page.locator('link[rel=icon]').evaluateAll((links) => links.map((l) => l.href));
  expect(icons.length).toBeGreaterThan(0);
  for (const url of [...icons, '/favicon.ico']) {
    const res = await page.request.get(url);
    expect(res.ok(), url).toBe(true);
    // not the test server's index.html fallback for unknown paths
    expect((await res.text()).slice(0, 20).toLowerCase(), url).not.toContain('<!doctype');
  }
});

test('a deep link and a reload land on the same screen; Back returns', async ({ page }) => {
  await page.goto('/#/library?q=kick');
  await expect(page).toHaveTitle(/^Library/);
  await expect(page.getByRole('searchbox').or(page.getByPlaceholder(/Search/i)).first()).toHaveValue('kick');
  await page.reload();
  await expect(page.getByRole('searchbox').or(page.getByPlaceholder(/Search/i)).first()).toHaveValue('kick');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Arrange', exact: true }).click();
  await expect(page).toHaveURL(/#\/arrange/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/library\?q=kick/);
});

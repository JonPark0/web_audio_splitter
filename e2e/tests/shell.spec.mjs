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
    await noHorizontalOverflow(page);
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

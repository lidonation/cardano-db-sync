import {expect, test, type Page} from '@playwright/test';

import {VERSION_HOME} from '../../playwright.versions.config';

const INTRO = `${VERSION_HOME}docs/next/intro`;
const menuButton = (page: Page) => page.getByRole('button', {name: 'Menu'});
async function open(page: Page, url: string, width: number) {
  await page.setViewportSize({width, height: 900});
  await page.goto(url);
  await page.locator('main article').waitFor();
  await page.evaluate(() => document.fonts.ready);
}

test.describe('version selector placement (DF-7)', () => {
  // DF-7 keeps the version selector on the bar down to 768; below that it moves into Menu.
  for (const width of [1440, 1024, 768, 375]) {
    test(`${width}px`, async ({page}) => {
      await open(page, INTRO, width);
      const header = page.locator('header[data-dbs-component="Navbar / Full"]');
      const bar = header.locator(':scope > div').first();
      await expect(bar.getByRole('button', {name: 'Unreleased'})).toBeVisible({
        visible: width >= 768,
      });
      if (width < 768) {
        await menuButton(page).click();
        const drawer = page.locator(
          `[id="${await menuButton(page).getAttribute('aria-controls')}"]`,
        );
        await expect(drawer.getByRole('button', {name: 'Unreleased'})).toBeVisible();
      }
    });
  }
});

test.describe('version selector focus across 768px (DF-7)', () => {
  test('the bar hands focus to Menu when the drawer is closed', async ({page}) => {
    await open(page, INTRO, 768);
    const header = page.locator('header[data-dbs-component="Navbar / Full"]');
    const bar = header.locator(':scope > div').first();
    await bar.getByRole('button', {name: 'Unreleased', exact: true}).focus();
    await page.setViewportSize({width: 767, height: 900});
    await expect(menuButton(page)).toBeFocused();
  });

  test('the drawer hands version focus back to the bar', async ({page}) => {
    await open(page, INTRO, 767);
    await menuButton(page).click();
    const drawer = page.locator(`[id="${await menuButton(page).getAttribute('aria-controls')}"]`);
    await drawer.getByRole('button', {name: 'Unreleased', exact: true}).focus();
    await page.setViewportSize({width: 768, height: 900});
    const header = page.locator('header[data-dbs-component="Navbar / Full"]');
    await expect(
      header.locator(':scope > div').first().getByRole('button', {name: 'Unreleased', exact: true}),
    ).toBeFocused();
  });
});

test('a hidden version control keeps focus after the browser blurs it', async ({page}) => {
  await open(page, INTRO, 768);
  const bar = page.locator('header[data-dbs-component="Navbar / Full"] > div').first();
  await bar.getByRole('button', {name: 'Unreleased', exact: true}).focus();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.setViewportSize({width: 767, height: 900});
  await expect(menuButton(page)).toBeFocused();
});

test('resizing the version slot does not take focus from page content', async ({page}) => {
  await open(page, INTRO, 768);
  const bar = page.locator('header[data-dbs-component="Navbar / Full"] > div').first();
  await bar.getByRole('button', {name: 'Unreleased', exact: true}).focus();
  const contentLink = page.locator('main article a').first();
  await contentLink.focus();
  await page.setViewportSize({width: 767, height: 900});
  await expect(contentLink).toBeFocused();
});

test('an open drawer receives the version control when it leaves the bar', async ({page}) => {
  await open(page, INTRO, 768);
  await menuButton(page).click();
  const bar = page.locator('header[data-dbs-component="Navbar / Full"] > div').first();
  await bar.getByRole('button', {name: 'Unreleased', exact: true}).focus();
  await page.setViewportSize({width: 767, height: 900});
  const drawer = page.locator(`[id="${await menuButton(page).getAttribute('aria-controls')}"]`);
  await expect(drawer.getByRole('button', {name: 'Unreleased', exact: true})).toBeFocused();
});

test('clicking page text leaves version focus behind before resizing', async ({page}) => {
  await open(page, INTRO, 768);
  const bar = page.locator('header[data-dbs-component="Navbar / Full"] > div').first();
  await bar.getByRole('button', {name: 'Unreleased', exact: true}).focus();
  await page.locator('main article p').first().click();
  await page.setViewportSize({width: 767, height: 900});
  await expect(menuButton(page)).not.toBeFocused();
});

test('release names and equivalent pages survive version navigation', async ({page}) => {
  await open(page, `${INTRO}?source=versions#introduction`, 1440);
  const toggle = page.getByRole('button', {name: 'Unreleased', exact: true});
  await toggle.focus();
  await page.keyboard.press('Enter');
  const release = page.getByRole('link', {name: '13.6.0.5', exact: true});
  await expect(release).toBeVisible();
  await expect(release).toHaveAttribute('href', /\/docs\/intro\?source=versions#introduction$/);
  await release.click();
  await expect(page).toHaveURL(/\/docs\/intro\?source=versions#introduction$/);
  await expect(page.locator('.theme-doc-markdown')).toBeVisible();
  const releasedToggle = page.getByRole('button', {name: '13.6.0.5', exact: true});
  await releasedToggle.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('link', {name: 'Unreleased', exact: true}).click();
  await expect(page).toHaveURL(/\/docs\/next\/intro\?source=versions#introduction$/);
  await expect(page.getByRole('button', {name: 'Next', exact: true})).toHaveCount(0);
});

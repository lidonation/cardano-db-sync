import {expect, test, type Page} from '@playwright/test';

import {BUILT_HOME} from '../../playwright.built.config';

/**
 * The navbar per DF-7 tier on the built, minified site (NAV-2, NAV-3): section links in the bar
 * from 1280, Menu below; the drawer carries GitHub and the actions only where the bar does not.
 */
const PAGES = ['', 'docs/intro'];

async function open(page: Page, path: string, width: number) {
  await page.setViewportSize({width, height: 900});
  await page.goto(`${BUILT_HOME}${path}`);
  await page.locator('header[data-dbs-component="Navbar / Full"]').waitFor();
}

const menu = (page: Page) => page.getByRole('button', {name: 'Menu'});

for (const path of PAGES) {
  test.describe(`/${path}`, () => {
    for (const width of [375, 768, 1024, 1279, 1280, 1440]) {
      test(`${width}px`, async ({page}) => {
        await open(page, path, width);
        const bar = page.locator('header[data-dbs-component="Navbar / Full"] > div').first();
        await expect(menu(page)).toBeVisible({visible: width < 1280});
        await expect(bar.getByRole('link', {name: 'Docs'})).toBeVisible({visible: width >= 1280});
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        if (width < 1280) {
          await menu(page).click();
          const drawer = page.locator(`#${await menu(page).getAttribute('aria-controls')}`);
          await expect(drawer.getByRole('link', {name: 'Docs'})).toBeVisible();
          // GitHub sits in the bar down to 768 and moves into the drawer below it
          await expect(drawer.getByRole('link', {name: 'GitHub'})).toBeVisible({
            visible: width < 768,
          });
          await expect(bar.getByRole('link', {name: /GitHub/})).toBeVisible({
            visible: width >= 768,
          });
        }
      });
    }
  });
}

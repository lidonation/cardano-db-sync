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
        await expect(bar.getByRole('link', {name: 'Cardano DB Sync'}).locator('svg')).toBeVisible();
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

/** The full header lockup from Penpot rev1551, including the previously missing logo mark. */
for (const palette of ['light', 'dark', 'cream', 'navy']) {
  test(`header branding in ${palette}`, async ({page}) => {
    for (const path of ['', 'docs/guides']) {
      await open(page, path, 320);
      await page.evaluate((name) => {
        document.documentElement.setAttribute('data-dbs-palette', name);
        document.documentElement.setAttribute(
          'data-theme',
          name === 'dark' || name === 'navy' ? 'dark' : 'light',
        );
      }, palette);
      const home = page
        .locator('header[data-dbs-component="Navbar / Full"]')
        .getByRole('link', {name: 'Cardano DB Sync', exact: true});
      await expect(home).toHaveAttribute('href', new URL(BUILT_HOME).pathname);
      const mark = home.locator('svg');
      await expect(mark).toBeVisible();
      await expect(mark).toHaveAttribute('aria-hidden', 'true');
      await expect(mark).toHaveAttribute('focusable', 'false');
      expect(await mark.boundingBox()).toMatchObject({width: 24, height: 24});
      const paint = await mark.evaluate((element) => ({
        stroke: getComputedStyle(element).stroke,
        accent: getComputedStyle(element).getPropertyValue('--dbs-accent-primary').trim(),
      }));
      const channels = paint.accent.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
      expect(channels).not.toBeNull();
      expect(paint.stroke).toBe(
        `rgb(${channels!
          .slice(1)
          .map((channel) => parseInt(channel, 16))
          .join(', ')})`,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await page.getByRole('button', {name: 'Menu', exact: true}).click();
      await expect(home).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', {name: 'Menu', exact: true})).toBeFocused();
    }
  });
}

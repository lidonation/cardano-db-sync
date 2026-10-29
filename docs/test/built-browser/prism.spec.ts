import {expect, test} from '@playwright/test';

import {BUILT_HOME} from '../../playwright.built.config';
import {PALETTES, paletteToTheme} from '../../src/lib/palette';

for (const palette of PALETTES) {
  for (const navigation of ['direct', 'client'] as const) {
    test(`code blocks highlight in ${palette} after ${navigation} navigation`, async ({page}) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript((name) => localStorage.setItem('dbs-palette', name), palette);
      if (navigation === 'direct') {
        await page.goto(`${BUILT_HOME}docs/intro`);
      } else {
        await page.goto(BUILT_HOME);
        await page.evaluate(() => {
          (window as Window & {prismNavigationSentinel?: boolean}).prismNavigationSentinel = true;
        });
        await page.locator('a[href$="/docs/intro"]').first().click();
        expect(
          await page.evaluate(
            () => (window as Window & {prismNavigationSentinel?: boolean}).prismNavigationSentinel,
          ),
        ).toBe(true);
      }
      await expect(page.locator('html')).toHaveAttribute('data-dbs-palette', palette);
      await expect(page.locator('html')).toHaveAttribute('data-theme', paletteToTheme(palette));
      const keyword = page.locator('main pre code .token.keyword').first();
      await expect(keyword).toBeVisible();
      await expect(keyword).toHaveAttribute('style', /color|font-style/i);
      expect(errors).toEqual([]);
    });
  }
}

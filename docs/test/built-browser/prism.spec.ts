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

test('a failed highlighting chunk keeps the source and the rest of the page readable', async ({
  page,
}) => {
  const url = `${BUILT_HOME}docs/intro`;
  let blocked = 0;
  await page.route('**/code-block.*.js', (route) => {
    blocked += 1;
    return route.abort();
  });
  const chunkError = Promise.race([
    page.waitForEvent('console', {
      predicate: (message) =>
        message.type() === 'error' && /ChunkLoadError|Loading chunk.*failed/s.test(message.text()),
    }),
    page.waitForEvent('pageerror', {
      predicate: (error) => /Loading chunk.*failed/s.test(error.message),
    }),
  ]);
  await page.goto(url);
  await chunkError;
  expect(blocked).toBeGreaterThan(0);
  await expect(page.locator('main pre code').first()).toContainText('SELECT count(*) FROM block;');
  await expect(page.locator('main')).toContainText('This site is being rebuilt.');
});

test('server-rendered source reuses the keyboard-accessible classic code container', async ({
  browser,
}) => {
  const context = await browser.newContext({javaScriptEnabled: false});
  try {
    const page = await context.newPage();
    await page.goto(`${BUILT_HOME}docs/intro`);
    const code = page.locator('main pre').first();
    await expect(code).toHaveClass(/theme-code-block/);
    await expect(code).toHaveAttribute('tabindex', '0');
    await expect(code).toContainText('SELECT count(*) FROM block;');
  } finally {
    await context.close();
  }
});

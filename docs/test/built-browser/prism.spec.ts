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
      await expect(keyword).not.toHaveAttribute('style');
      const colors = await keyword.evaluate((element) => ({
        token: getComputedStyle(element).color,
        parent: getComputedStyle(element.closest('pre')!).color,
      }));
      expect(colors.token).not.toBe(colors.parent);
      await expect(
        page.locator('main .theme-code-block[style], main .theme-code-block [style]'),
      ).toHaveCount(0);
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

test('numbered code retains source, line numbering and copy control without inline styles', async ({
  page,
}) => {
  await page.goto(`${BUILT_HOME}docs/intro`);
  const block = page.locator('main .theme-code-block').filter({hasText: 'SELECT 1;'});
  await expect(block.locator('[data-line="7"]')).toHaveCount(1);
  await expect(block.locator('[data-line="8"]')).toHaveCount(1);
  await expect(block.locator('code')).toHaveText('SELECT 1;\nSELECT 2;\n');
  const copy = block.getByRole('button', {name: /copy code/i});
  await expect(copy).toBeVisible();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await copy.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('SELECT 1;\nSELECT 2;');
  await expect(block.locator('[style]')).toHaveCount(0);
});

test('word wrap toggles without an inline style under the site CSP', async ({page}) => {
  await page.goto(`${BUILT_HOME}docs/intro`);
  const block = page.locator('main .theme-code-block').filter({hasText: 'LONGTEXT-'});
  const button = block.getByRole('button', {name: /toggle word wrap/i});
  await expect(button).toBeVisible();
  await button.click();
  await expect(block.locator('code')).toHaveCSS('white-space', 'pre-wrap');
  await expect(block.locator('[style]')).toHaveCount(0);
  await button.click();
  await expect(block.locator('code')).not.toHaveCSS('white-space', 'pre-wrap');
});

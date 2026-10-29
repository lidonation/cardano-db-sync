import {expect, test} from '@playwright/test';

import {BUILT_HOME} from '../../playwright.built.config';
import {PALETTES, paletteToTheme} from '../../src/lib/palette';

for (const palette of PALETTES) {
  test(`${palette} is restored by both inline scripts before hydration`, async ({page}) => {
    await page.addInitScript((name) => {
      localStorage.setItem('dbs-palette', name);
      // Deliberately disagree with the stored palette. The last bootstrap repairs it.
      localStorage.setItem('theme', name === 'dark' || name === 'navy' ? 'light' : 'dark');
    }, palette);
    await page.route('**/assets/js/**', (route) => route.abort());
    await page.goto(BUILT_HOME);
    await expect(page.locator('html')).toHaveAttribute('data-dbs-palette', palette);
    await expect(page.locator('html')).toHaveAttribute('data-theme', paletteToTheme(palette));
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme-choice',
      paletteToTheme(palette),
    );
  });
}

for (const palette of ['cream', 'navy'] as const) {
  test(`a ${palette} query override survives the framework script and hydration`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('dbs-palette', 'dark');
      localStorage.setItem('theme', 'dark');
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${BUILT_HOME}?docusaurus-theme=${palette}`);
    await expect(page.getByRole('button', {name: /^Theme:/})).toHaveAccessibleName(
      `Theme: ${palette[0].toUpperCase()}${palette.slice(1)}. Change theme`,
    );
    await expect(page.locator('html')).toHaveAttribute('data-theme', paletteToTheme(palette));
    await expect(page.locator('html')).toHaveAttribute('data-dbs-palette', palette);
    expect(errors).toEqual([]);
  });
}

test('the locale control reaches the same built doc and preserves query and fragment', async ({
  page,
}) => {
  await page.goto(`${BUILT_HOME}docs/intro?source=switcher#introduction`);
  const heading = await page.locator('main h1').innerText();
  const toggle = page.locator('.navbar__item.dropdown > a.navbar__link').first();
  await toggle.focus();
  await page.keyboard.press('Enter');
  const japanese = page.locator('.dropdown__menu a[lang="ja"]').first();
  await expect(japanese).toHaveAttribute(
    'href',
    /\/ja\/docs\/intro\?source=switcher#introduction$/,
  );
  await japanese.click();
  await page.waitForURL(/\/ja\/docs\/intro\?source=switcher#introduction$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('main h1')).toHaveText(heading);
  await expect(page.locator('.theme-doc-markdown')).toBeVisible();
});

for (const width of [1440, 1024, 768, 767, 375]) {
  test(`a single version has no selector at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    await page.goto(`${BUILT_HOME}docs/intro`);
    const header = page.locator('header[data-dbs-component="Navbar / Full"]');
    if (width < 1280) await header.getByRole('button', {name: 'Menu'}).click();
    await expect(header.getByRole('link', {name: /^(Next|Unreleased)$/})).toHaveCount(0);
  });
}

for (const palette of PALETTES) {
  test(`header control plates and targets in ${palette}`, async ({page}) => {
    await page.addInitScript((name) => localStorage.setItem('dbs-palette', name), palette);
    await page.goto(BUILT_HOME);
    const header = page.locator('header[data-dbs-component="Navbar / Full"]');
    const theme = header.getByRole('button', {name: /^Theme:/});
    const locale = header.locator('.navbar__item.dropdown > .navbar__link').first();
    for (const control of [theme, locale]) {
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
      const plate = await control.evaluate((el) => {
        const style = getComputedStyle(el, '::before');
        return {height: style.height, border: style.borderTopWidth};
      });
      expect(plate).toEqual({height: '32px', border: '1px'});
    }
    expect((await theme.boundingBox())!.width).toBe(96);
    await expect(theme.locator('[data-palette]')).toHaveCount(0);
    await expect(theme.locator('svg')).toBeVisible();
  });
}

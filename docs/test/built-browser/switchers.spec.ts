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

test('the sole version links to the current equivalent doc', async ({page}) => {
  // B11 owns populating the retained version window; this checks today's one-line integration.
  await page.goto(`${BUILT_HOME}docs/intro`);
  await expect(
    page.locator('.navbar').getByRole('link', {name: 'Next', exact: true}),
  ).toHaveAttribute('href', /\/docs\/intro$/);
});

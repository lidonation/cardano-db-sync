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
    await expect(
      header.locator('.navbar__link').filter({hasText: /^(Next|Unreleased)$/}),
    ).toHaveCount(0);
  });
}

for (const palette of PALETTES) {
  for (const route of ['', 'docs/intro', 'ecosystem', 'survey']) {
    test(`header control plates and targets in ${palette} on /${route}`, async ({page}) => {
      await page.addInitScript((name) => localStorage.setItem('dbs-palette', name), palette);
      await page.goto(`${BUILT_HOME}${route}`);
      await page.evaluate(() => document.fonts.ready);
      const header = page.locator('header[data-dbs-component="Navbar / Full"]');
      const theme = header.getByRole('button', {name: /^Theme:/});
      const locale = header.locator('.navbar__item.dropdown > .navbar__link').first();
      const plates = [];
      for (const control of [theme, locale]) {
        // The hydrated theme control may still be hidden after fonts are ready.
        await expect
          .poll(async () => {
            const box = await control.boundingBox();
            return box ? Math.min(box.height, box.width) : 0;
          })
          .toBeGreaterThanOrEqual(44);
        const plate = await control.evaluate((el) => {
          const style = getComputedStyle(el, '::before');
          const root = getComputedStyle(document.documentElement);
          const expected = document.createElement('span');
          expected.style.borderColor = root.getPropertyValue('--dbs-border-interactive');
          expected.style.background = root.getPropertyValue('--dbs-surface-base');
          document.body.append(expected);
          const tokens = getComputedStyle(expected);
          const result = {
            height: style.height,
            border: style.borderTopWidth,
            radius: style.borderRadius,
            color: style.borderTopColor,
            fill: style.backgroundColor,
            expectedColor: tokens.borderTopColor,
            expectedFill: tokens.backgroundColor,
          };
          expected.remove();
          return result;
        });
        expect(plate.height).toBe('32px');
        expect(plate.border).toBe('1px');
        expect(plate.radius).toBe('0px');
        expect(plate.color).toBe(plate.expectedColor);
        expect(plate.fill).toBe(plate.expectedFill);
        plates.push(plate);
        const caret = await control.evaluate((el) => {
          const style = getComputedStyle(el, '::after');
          return {width: style.width, height: style.height, clip: style.clipPath};
        });
        expect(caret).toEqual({
          width: '10px',
          height: '6px',
          clip: 'polygon(0px 0px, 100% 0px, 50% 100%)',
        });
      }
      expect(plates[0]).toEqual(plates[1]);
      expect((await theme.boundingBox())!.width).toBe(96);
      await expect(theme.locator('[data-palette]')).toHaveCount(0);
      await expect(theme).toHaveText('Theme');
    });
  }
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const palette of PALETTES) {
    test(`control carets remain visible in forced ${colorScheme} colors with ${palette}`, async ({
      page,
    }) => {
      await page.emulateMedia({forcedColors: 'active', colorScheme});
      await page.addInitScript((name) => localStorage.setItem('dbs-palette', name), palette);
      await page.goto(BUILT_HOME);
      const header = page.locator('header[data-dbs-component="Navbar / Full"]');
      const controls = [
        header.getByRole('button', {name: /^Theme:/}),
        header.locator('.navbar__item.dropdown > .navbar__link').first(),
      ];
      for (const control of controls) {
        const colors = await control.evaluate((element) => ({
          text: getComputedStyle(element).color,
          caret: getComputedStyle(element, '::after').backgroundColor,
          plate: getComputedStyle(element, '::before').backgroundColor,
        }));
        expect(colors.caret).toBe(colors.text);
        expect(colors.caret).not.toBe(colors.plate);
      }
    });
  }
}

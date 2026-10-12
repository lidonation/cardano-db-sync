import AxeBuilder from '@axe-core/playwright';
import {expect, test, type Page} from '@playwright/test';

import {PROFILES} from '../../config/profiles';
import {BROWSER_ORIGIN} from '../../playwright.config';

/**
 * B30 — the three global controls in the real navbar (THM-1, TOK-2, A11Y-29, DF-7).
 *
 * The theme switcher is the swizzled ColorModeToggle (four palettes, both attributes);
 * locale and version ride on Docusaurus' own dropdowns so same-page navigation is
 * preserved. These tests hold the wired controls — not the inventory demos — to the
 * issue's recommended tests: persistence across reload with no flash of wrong theme,
 * same-page locale switches, equivalent-page version switches, and keyboard with
 * visible focus throughout.
 */
const ORIGIN = BROWSER_ORIGIN;
const BASE = PROFILES.dev.baseUrl;
const HOME = `${ORIGIN}${BASE}`;
const DOCS = `${ORIGIN}${BASE}docs/intro`;

const PALETTES = ['light', 'dark', 'cream', 'navy'] as const;
const THEME: Record<string, string> = {light: 'light', cream: 'light', dark: 'dark', navy: 'dark'};

async function goto(page: Page, url: string, width = 1440) {
  await page.setViewportSize({width, height: 900});
  await page.goto(url);
  await page.locator('.navbar').waitFor();
  await page.evaluate(() => document.fonts.ready);
}

function themeButton(page: Page) {
  return page.getByRole('button', {name: /^Theme: /});
}

test.describe('theme switcher (THM-1, TOK-2, A11Y-29)', () => {
  test('names the current palette and offers all four as radio options', async ({page}) => {
    await goto(page, HOME);
    const button = themeButton(page);
    await expect(button).toHaveAttribute('aria-haspopup', 'menu');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toHaveAccessibleName(/Theme: (Light|Dark|Cream|Navy)/);
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const options = page.getByRole('menuitemradio');
    await expect(options).toHaveCount(4);
    for (const name of ['Light', 'Dark', 'Cream', 'Navy']) {
      await expect(options.getByText(name, {exact: true})).toBeVisible();
    }
    // Exactly one is checked, and it matches the button's announcement — the state is
    // never an ambiguous light/dark alone.
    const checked = page.getByRole('menuitemradio', {checked: true});
    await expect(checked).toHaveCount(1);
    const announced = await button.getAttribute('aria-label');
    const current = (announced ?? '').match(/Theme: (\w+)/)?.[1] ?? '';
    expect(['Light', 'Dark', 'Cream', 'Navy']).toContain(current);
    await expect(checked).toContainText(current);
  });

  test('moves with arrows, closes on Escape with focus back on the button', async ({page}) => {
    await goto(page, HOME);
    const button = themeButton(page);
    await button.focus();
    await page.keyboard.press('ArrowDown');
    const options = page.getByRole('menuitemradio');
    await expect(options.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(options.nth(3)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(options.first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  for (const palette of PALETTES) {
    test(`choosing ${palette} writes both attributes and persists them across reload`, async ({
      page,
    }) => {
      await goto(page, HOME);
      await themeButton(page).click();
      await page
        .getByRole('menuitemradio', {
          name: new RegExp(`^${palette[0].toUpperCase()}${palette.slice(1)}`),
        })
        .click();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-dbs-palette')))
        .toBe(palette);
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
        THEME[palette],
      );
      expect(await page.evaluate(() => window.localStorage.getItem('dbs-palette'))).toBe(palette);
      expect(await page.evaluate(() => window.localStorage.getItem('theme'))).toBe(THEME[palette]);
      await expect(themeButton(page)).toHaveAccessibleName(
        new RegExp(`Theme: ${palette[0].toUpperCase()}${palette.slice(1)}`),
      );
      // Reload: the attributes are already right before paint (no flash of wrong theme).
      await page.reload();
      await page.locator('.navbar').waitFor();
      expect(
        await page.evaluate(() => document.documentElement.getAttribute('data-dbs-palette')),
      ).toBe(palette);
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
        THEME[palette],
      );
    });
  }
});

test.describe('locale switcher (hreflang-consistent)', () => {
  test('offers the same page in the target locale', async ({page}) => {
    await goto(page, HOME);
    // The locale toggle is Docusaurus' own dropdown, restyled by switchers.css.
    const toggle = page.locator('.navbar__item.dropdown > a.navbar__link').first();
    await expect(toggle).toBeVisible();
    await toggle.click();
    const japanese = page
      .locator(
        '.dropdown__menu .dropdown__link[hreflang="ja"], .dropdown__menu .dropdown__link:has-text("日本語")',
      )
      .first();
    // The development server serves only English. Check the actual control's
    // target here; the built-site suite follows it through a real localized page.
    await expect(japanese).toHaveCount(1);
    await expect(japanese).toHaveAttribute('href', /\/ja\/?$/);
  });

  test('is keyboard-operable with a visible name', async ({page}) => {
    await goto(page, HOME);
    const toggle = page.locator('.navbar__item.dropdown > a.navbar__link').first();
    await toggle.focus();
    await expect(toggle).toBeFocused();
    const ring = await toggle.evaluate((element) => {
      const style = getComputedStyle(element);
      return {style: style.outlineStyle, width: parseFloat(style.outlineWidth)};
    });
    expect(ring.style).not.toBe('none');
    expect(ring.width).toBeGreaterThanOrEqual(2);
    await page.keyboard.press('Enter');
    await expect(page.locator('.dropdown__menu').first()).toBeVisible();
  });
});

test.describe('version selector (equivalent pages)', () => {
  test('exists, is keyboard-focusable, and lands on docs content', async ({page}) => {
    // With a single docs line the selector is one link (Docusaurus renders a menu only
    // for multiple lines); the window rule (VER-1) is what populates it once B11 lands.
    await goto(page, DOCS);
    const version = page.getByRole('link', {name: 'Next'});
    await expect(version).toBeVisible();
    await version.focus();
    await expect(version).toBeFocused();
    await version.click();
    await page.locator('.theme-doc-markdown, main').first().waitFor();
    expect(page.url()).toContain('/docs/');
  });
});

test.describe('responsive and focus discipline (DF-7, FLOOR-4, NAV-4)', () => {
  test('no horizontal scroll at 320px with all three controls present', async ({page}) => {
    await goto(page, HOME, 320);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the switcher keeps a 44px target at phone width', async ({page}) => {
    await goto(page, HOME, 375);
    const box = await themeButton(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('every navbar keyboard stop shows the focus ring', async ({page}) => {
    await goto(page, HOME);
    await page.locator('.navbar .navbar__brand').click();
    const unringed: string[] = [];
    let seen = 0;
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || !element.closest('.navbar')) {
          return null;
        }
        const style = getComputedStyle(element);
        return {
          id: `${element.tagName}:${element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 30)}`,
          ringed: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2,
        };
      });
      if (!stop) {
        if (seen > 0) break;
        continue;
      }
      seen += 1;
      if (!stop.ringed) unringed.push(stop.id);
      // Leave any open menu before the next Tab so the walk terminates.
      await page.keyboard.press('Escape');
    }
    expect(seen).toBeGreaterThanOrEqual(4);
    expect(unringed).toEqual([]);
  });
});

test.describe('axe, WCAG 2.2 AA', () => {
  for (const palette of PALETTES) {
    test(`homepage in ${palette}`, async ({page}) => {
      await goto(page, HOME);
      await page.evaluate((name) => {
        document.documentElement.setAttribute(
          'data-theme',
          name === 'dark' || name === 'navy' ? 'dark' : 'light',
        );
        document.documentElement.setAttribute('data-dbs-palette', name);
      }, palette);
      const results = await new AxeBuilder({page})
        .include('.navbar')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  }
});

test.describe('palette regressions', () => {
  test('an explicit palette survives OS appearance changes', async ({page}) => {
    await page.emulateMedia({colorScheme: 'light'});
    await goto(page, HOME);
    await themeButton(page).click();
    await page.getByRole('menuitemradio', {name: 'Navy', exact: true}).click();
    await page.emulateMedia({colorScheme: 'dark'});
    await page.emulateMedia({colorScheme: 'light'});
    // Allow the media-query change event to reach the framework listener.
    await page.waitForTimeout(150);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-dbs-palette', 'navy');
  });

  test('a query palette is the announced and checked palette', async ({page}) => {
    await page.addInitScript(() => localStorage.setItem('dbs-palette', 'cream'));
    await goto(page, `${HOME}?docusaurus-theme=dark`);
    await expect(themeButton(page)).toHaveAccessibleName('Theme: Dark. Change theme');
    await themeButton(page).click();
    await expect(page.getByRole('menuitemradio', {checked: true})).toHaveText('✓Dark');
  });

  test('a denied storage getter does not break selection', async ({page}) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() =>
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('Storage denied', 'SecurityError');
        },
      }),
    );
    await goto(page, HOME);
    await themeButton(page).click();
    await page.getByRole('menuitemradio', {name: 'Navy', exact: true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-dbs-palette', 'navy');
    expect(errors).toEqual([]);
  });

  test('outside pointer and focus dismiss without stealing focus', async ({page}) => {
    await goto(page, HOME);
    await themeButton(page).click();
    await page.locator('h1').click();
    await expect(themeButton(page)).toHaveAttribute('aria-expanded', 'false');
    await themeButton(page).click();
    const docs = page.locator('.navbar .navbar__link').first();
    await docs.focus();
    await expect(docs).toBeFocused();
    await expect(themeButton(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('Tab leaves the menu on a real control and Shift+Tab returns to its trigger', async ({
    page,
  }) => {
    await goto(page, HOME);
    await themeButton(page).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(themeButton(page)).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    await themeButton(page).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Shift+Tab');
    await expect(themeButton(page)).toBeFocused();
  });

  test('desktop and mobile controls announce the same palette', async ({page}) => {
    await goto(page, HOME, 375);
    await themeButton(page).click();
    await page.getByRole('menuitemradio', {name: 'Navy', exact: true}).click();
    await page.getByRole('button', {name: 'Toggle navigation bar'}).click();
    const mobile = page.locator('.navbar-sidebar').getByRole('button', {name: /^Theme:/});
    await expect(mobile).toHaveAccessibleName('Theme: Navy. Change theme');
  });
});

test('system-following and same-family cross-tab palette changes stay synchronized', async ({
  page,
  context,
}) => {
  await page.emulateMedia({colorScheme: 'light'});
  await goto(page, HOME);
  await page.emulateMedia({colorScheme: 'dark'});
  await expect(themeButton(page)).toHaveAccessibleName('Theme: Dark. Change theme');
  const other = await context.newPage();
  await goto(other, HOME);
  await themeButton(other).click();
  await other.getByRole('menuitemradio', {name: 'Cream', exact: true}).click();
  await expect(themeButton(page)).toHaveAccessibleName('Theme: Cream. Change theme');
  await themeButton(other).click();
  await other.getByRole('menuitemradio', {name: 'Light', exact: true}).click();
  await expect(themeButton(page)).toHaveAccessibleName('Theme: Light. Change theme');
  await other.close();
});

import AxeBuilder from '@axe-core/playwright';
import {expect, test, type Page} from '@playwright/test';

import {INVENTORY_URL, BROWSER_ORIGIN} from '../../playwright.config';
import {PROFILES} from '../../config/profiles';
import {contrast, paintedBackground} from './contrast';

/**
 * B35 — control-boundary binding (TOK-6, FLOOR-3) and the active sidebar label (NAV-5).
 *
 * Enabled control boundaries must clear 3:1 against the surface they sit on, which the
 * `border.interactive` token does in every palette; the lint gate (`check:token-lint`)
 * proves the binding, and these tests measure it where it renders. The sidebar half runs
 * on a real docs page: the active label binds `accent.primary-text` in all four palettes.
 */
const PALETTES = ['light', 'dark', 'cream', 'navy'] as const;

/** The NAV-5 binding per palette, as computed `rgb()` (tokens.source.json, lint-gated). */
const ACTIVE_LABEL: Record<string, string> = {
  light: 'rgb(11, 87, 196)',
  cream: 'rgb(11, 87, 196)',
  dark: 'rgb(68, 147, 248)',
  navy: 'rgb(121, 184, 255)',
};

const DOCS = `${BROWSER_ORIGIN}${PROFILES.dev.baseUrl}docs/intro`;

/** Palette tokens and Infima's light/dark surfaces are separate attributes (THM-1). */
async function applyPalette(page: Page, palette: string) {
  await page.evaluate((name) => {
    document.documentElement.setAttribute(
      'data-theme',
      name === 'dark' || name === 'navy' ? 'dark' : 'light',
    );
    document.documentElement.setAttribute('data-dbs-palette', name);
  }, palette);
  // Measure the chosen palette after its legible color transitions have finished.
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

async function openInventory(page: Page, palette: string = 'light', width = 1440) {
  await page.setViewportSize({width, height: 900});
  await page.goto(INVENTORY_URL);
  await page.locator('#inventory').waitFor();
  await applyPalette(page, palette);
  await page.evaluate(() => document.fonts.ready);
}

test.describe('enabled control boundaries clear 3:1 (TOK-6, FLOOR-3)', () => {
  for (const palette of PALETTES) {
    test(palette, async ({page}) => {
      await openInventory(page, palette);
      const probes = [
        ['Card / Tool', 'a'],
        ['Card / Team', 'a'],
        ['Card / Use case', 'a'],
        ['Card / Choice', 'label'],
        ['Card / Option', 'label'],
        ['Card / Data option', 'label'],
        ['Chip / Filter', '[role="tab"][aria-selected="false"]'],
      ];
      for (const [entry, target] of probes) {
        const control = page
          .locator(`[data-inventory-entry="${entry}"] [data-inventory-state="default"] ${target}`)
          .first();
        await expect(control).toBeVisible();
        const border = await control.evaluate((element) => ({
          colour: getComputedStyle(element).borderTopColor,
          width: getComputedStyle(element).borderTopWidth,
          style: getComputedStyle(element).borderTopStyle,
        }));
        expect(parseFloat(border.width), entry).toBeGreaterThan(0);
        expect(border.style, entry).not.toBe('none');
        const backdrop = await control.locator('..').evaluate(paintedBackground);
        expect(contrast(border.colour, backdrop), entry).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

test.describe('disabled choices and tabs retain the interactive boundary (TOK-6)', () => {
  for (const palette of PALETTES) {
    test(palette, async ({page}) => {
      await openInventory(page, palette);
      for (const entry of [
        'Card / Choice',
        'Card / Option',
        'Card / Data option',
        'Chip / Filter',
      ]) {
        const target = entry === 'Chip / Filter' ? '[role="tab"][aria-disabled="true"]' : 'label';
        const control = page
          .locator(`[data-inventory-entry="${entry}"] [data-inventory-state="disabled"] ${target}`)
          .first();
        await expect(control).toBeVisible();
        const expected = await page.evaluate(() => {
          const probe = document.createElement('span');
          probe.style.borderColor = 'var(--dbs-border-interactive)';
          document.body.append(probe);
          const value = getComputedStyle(probe).borderTopColor;
          probe.remove();
          return value;
        });
        const border = await control.evaluate(
          (element) => getComputedStyle(element).borderTopColor,
        );
        expect(border, entry).toBe(expected);
        expect(
          contrast(border, await control.locator('..').evaluate(paintedBackground)),
          entry,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

/** The docs sidebar as B34 renders it; the current page's row carries aria-current. */
const SIDEBAR = 'nav[aria-label="Docs"]';

test.describe('active sidebar label (NAV-5)', () => {
  for (const palette of PALETTES) {
    test(`${palette} binds accent.primary-text at 4.5:1`, async ({page}) => {
      await page.setViewportSize({width: 1440, height: 900});
      await page.goto(DOCS);
      await page.locator(SIDEBAR).waitFor();
      await applyPalette(page, palette);
      const active = page.locator(`${SIDEBAR} [aria-current="page"]`).first();
      await expect(active).toBeVisible();
      // the row is a link, and Infima transitions link colour: read it once the palette settles
      await expect(active).toHaveCSS('color', ACTIVE_LABEL[palette]);
      const colour = await active.evaluate((element) => getComputedStyle(element).color);
      const surface = await active.evaluate(paintedBackground);
      const measured = {color: colour, surface};
      expect(measured.color).toBe(ACTIVE_LABEL[palette]);
      expect(contrast(measured.color, measured.surface)).toBeGreaterThanOrEqual(4.5);
      await active.hover();
      expect(await active.evaluate((element) => getComputedStyle(element).color)).toBe(
        ACTIVE_LABEL[palette],
      );
      expect(contrast(colour, await active.evaluate(paintedBackground))).toBeGreaterThanOrEqual(
        4.5,
      );
    });
  }

  test('axe on the docs sidebar in every palette', async ({page}) => {
    for (const palette of PALETTES) {
      await page.setViewportSize({width: 1440, height: 900});
      await page.goto(DOCS);
      await page.locator(SIDEBAR).waitFor();
      await applyPalette(page, palette);
      await expect(page.locator(`${SIDEBAR} [aria-current="page"]`).first()).toHaveCSS(
        'color',
        ACTIVE_LABEL[palette],
      );
      const results = await new AxeBuilder({page})
        .include(SIDEBAR)
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        results.violations.map((violation) => violation.id),
        palette,
      ).toEqual([]);
    }
  });
});

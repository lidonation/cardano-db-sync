import AxeBuilder from '@axe-core/playwright';
import {expect, test, type Page} from '@playwright/test';

import {INVENTORY_URL} from '../../playwright.config';
import {PROFILES} from '../../config/profiles';

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

const ORIGIN = 'http://127.0.0.1:3100';
const DOCS = `${ORIGIN}${PROFILES.dev.baseUrl}docs/intro`;

async function openInventory(page: Page, palette: string = 'light', width = 1440) {
  await page.setViewportSize({width, height: 900});
  await page.goto(INVENTORY_URL);
  await page.locator('#inventory').waitFor();
  await page.evaluate((name) => document.documentElement.setAttribute('data-theme', name), palette);
  await page.evaluate(() => document.fonts.ready);
}

/** WCAG relative luminance contrast between two computed `rgb()` colours. */
function contrast(a: string, b: string): number {
  const luminance = (colour: string) => {
    const [r, g, bl] = (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const channel = (value: number) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(bl);
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

test.describe('enabled control boundaries clear 3:1 (TOK-6, FLOOR-3)', () => {
  for (const palette of PALETTES) {
    test(palette, async ({page}) => {
      await openInventory(page, palette);
      const pairs = await page.evaluate(() => {
        const page = getComputedStyle(document.querySelector('#inventory')!).backgroundColor;
        const probe = (selector: string) => {
          const element = document.querySelector(selector) as HTMLElement | null;
          if (!element) {
            return null;
          }
          return {where: selector, boundary: getComputedStyle(element).borderColor, page};
        };
        return [
          probe('[data-inventory-entry="Card / Tool"] [data-inventory-state="default"] a'),
          probe(
            '[data-inventory-entry="Chip / Filter"] [data-inventory-state="default"] [role="tab"]',
          ),
          probe('[data-inventory-entry="Card / Choice"] [data-inventory-state="default"] label'),
        ];
      });
      expect(pairs.filter(Boolean)).toHaveLength(3);
      const failures = (
        pairs.filter(Boolean) as {where: string; boundary: string; page: string}[]
      ).flatMap((pair) =>
        contrast(pair.boundary, pair.page) < 3
          ? [`${pair.where}: ${contrast(pair.boundary, pair.page).toFixed(2)}:1`]
          : [],
      );
      expect(failures).toEqual([]);
    });
  }
});

test.describe('active sidebar label (NAV-5)', () => {
  for (const palette of PALETTES) {
    test(`${palette} binds accent.primary-text at 4.5:1`, async ({page}) => {
      await page.setViewportSize({width: 1440, height: 900});
      await page.goto(DOCS);
      await page.locator('.theme-doc-sidebar-container').waitFor();
      await page.evaluate(
        (name) => document.documentElement.setAttribute('data-theme', name),
        palette,
      );
      const active = page.locator('.theme-doc-sidebar-container .menu__link--active').first();
      await expect(active).toBeVisible();
      const measured = await active.evaluate((element) => {
        // The opaque surface behind the link: the link itself wears Infima's translucent
        // active wash, and every container up to <html> is transparent, so walk past any
        // non-opaque layer. (The wash is also present in the axe pass, which audits the
        // full rendering.)
        const opaque = (node: Element | null): string => {
          let current: Element | null = node?.parentElement ?? null;
          while (current) {
            const background = getComputedStyle(current).backgroundColor;
            if (/^rgb\(/.test(background)) {
              return background;
            }
            current = current.parentElement;
          }
          return 'rgb(255, 255, 255)';
        };
        return {
          color: getComputedStyle(element).color,
          surface: opaque(element),
        };
      });
      expect(measured.color).toBe(ACTIVE_LABEL[palette]);
      expect(contrast(measured.color, measured.surface)).toBeGreaterThanOrEqual(4.5);
    });
  }

  test('axe on the docs sidebar in every palette', async ({page}) => {
    for (const palette of PALETTES) {
      await page.setViewportSize({width: 1440, height: 900});
      await page.goto(DOCS);
      await page.locator('.theme-doc-sidebar-container').waitFor();
      await page.evaluate(
        (name) => document.documentElement.setAttribute('data-theme', name),
        palette,
      );
      const results = await new AxeBuilder({page})
        .include('.theme-doc-sidebar-container')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        results.violations.map((violation) => violation.id),
        palette,
      ).toEqual([]);
    }
  });
});

import AxeBuilder from '@axe-core/playwright';
import {expect, test, type Page} from '@playwright/test';

import {INVENTORY, THEME_WORDS, shownStates} from '../../src/components/inventory';
import {INVENTORY_URL} from '../../playwright.config';

/**
 * B29 — the component inventory, audited in a browser (THM-5, THM-6, FLOOR-4, FLOOR-5, DF-2,
 * DF-4, A11Y-28, NAV-3). The inventory renders every definition in every state its manifest says
 * it ships; these tests hold the page to that manifest and to WCAG 2.2 AA.
 */
const PALETTES = ['light', 'dark', 'cream', 'navy'] as const;

/** NAV-3: phone, tablet, desktop — the DF-7 xs and md tiers and the 1440 design width. */
const WIDTHS = [375, 1024, 1440] as const;

async function open(page: Page, palette: string = 'light', width = 1440) {
  await page.setViewportSize({width, height: 900});
  await page.goto(INVENTORY_URL);
  await page.locator('#inventory').waitFor();
  // Both attributes, like the switcher (THM-1).
  await page.evaluate((name) => {
    document.documentElement.setAttribute(
      'data-theme',
      name === 'dark' || name === 'navy' ? 'dark' : 'light',
    );
    document.documentElement.setAttribute('data-dbs-palette', name);
  }, palette);
  await page.evaluate(() => document.fonts.ready);
}

test.describe('component count (THM-5, THM-6)', () => {
  test('the inventory holds the 27 definitions, one each', async ({page}) => {
    await open(page);
    const entries = await page
      .locator('[data-inventory-entry]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-inventory-entry')));
    expect(entries).toHaveLength(27);
    expect(new Set(entries).size).toBe(27);
    expect(entries).toEqual(INVENTORY.map((entry) => entry.design));
  });

  test('no rendered component is named for a theme', async ({page}) => {
    await open(page);
    const markers = await page
      .locator('[data-dbs-component]')
      .evaluateAll((nodes) => [
        ...new Set(nodes.map((node) => node.getAttribute('data-dbs-component'))),
      ]);
    const themed = markers.filter((marker) =>
      THEME_WORDS.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(marker ?? '')),
    );
    expect(themed).toEqual([]);
  });
});

test.describe('states (FLOOR-5, DF-2, DF-4)', () => {
  test('every state the manifest ships is rendered by its component', async ({page}) => {
    await open(page);
    const missing: string[] = [];
    for (const entry of INVENTORY) {
      for (const state of shownStates(entry)) {
        const cell = page.locator(
          `[data-inventory-entry="${entry.design}"] [data-inventory-state="${state}"]`,
        );
        if ((await cell.locator(`[data-dbs-component="${entry.marker}"]`).count()) === 0) {
          missing.push(`${entry.design} · ${state}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('no inline style attribute, which the CSP would refuse (SEC-2)', async ({page}) => {
    await open(page);
    await expect(page.locator('#inventory [style]')).toHaveCount(0);
  });
});

test.describe('axe, WCAG 2.2 AA', () => {
  for (const palette of PALETTES) {
    for (const width of WIDTHS) {
      test(`${palette} at ${width}px`, async ({page}) => {
        await open(page, palette, width);
        const results = await new AxeBuilder({page})
          .include('#inventory')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        // axe cannot see a background painted on a clipped pseudo-element, so it leaves those
        // nodes "incomplete" rather than failing them. Only the hexagon buttons paint that way, and
        // they are measured directly below; anything else left unchecked is a failure here.
        const unchecked = await Promise.all(
          results.incomplete
            .filter((result) => result.id === 'color-contrast')
            .flatMap((result) => result.nodes)
            .map((node) =>
              page
                .locator(node.target.join(' '))
                .first()
                .evaluate((element) =>
                  element.closest('[data-dbs-component="Button"]')
                    ? null
                    : element.outerHTML.slice(0, 80),
                ),
            ),
        );
        expect(unchecked.filter(Boolean)).toEqual([]);
        const found = results.violations.flatMap((violation) =>
          violation.nodes.map(
            (node) => `${violation.id}: ${node.target.join(' ')} — ${node.failureSummary}`,
          ),
        );
        expect(found).toEqual([]);
      });
    }
  }
});

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

test.describe('button contrast, measured on the clipped fill axe cannot see (FLOOR-1, FLOOR-3)', () => {
  for (const palette of PALETTES) {
    test(palette, async ({page}) => {
      await open(page, palette);
      const buttons = await page
        .locator(
          // loading buttons are aria-disabled too, but they are busy, not disabled: measure them
          '#inventory [data-dbs-component="Button"]:not([aria-disabled="true"]:not([aria-busy="true"]))',
        )
        .evaluateAll((elements) =>
          elements.map((element) => ({
            where: `${element.closest('[data-inventory-entry]')?.getAttribute('data-inventory-entry')} · ${element.closest('[data-inventory-state]')?.getAttribute('data-inventory-state')}`,
            label: getComputedStyle(element).color,
            fill: getComputedStyle(element, '::after').backgroundColor,
            boundary: getComputedStyle(element, '::before').backgroundColor,
            page: getComputedStyle(document.querySelector('#inventory')!).backgroundColor,
          })),
        );
      expect(buttons.length).toBeGreaterThanOrEqual(20);
      const failures = buttons.flatMap((button) => [
        ...(contrast(button.label, button.fill) < 4.5
          ? [`${button.where}: label ${contrast(button.label, button.fill).toFixed(2)}:1`]
          : []),
        ...(contrast(button.boundary, button.page) < 3
          ? [`${button.where}: boundary ${contrast(button.boundary, button.page).toFixed(2)}:1`]
          : []),
      ]);
      expect(failures).toEqual([]);
    });
  }
});

test.describe('disabled buttons stay disabled under the pointer (FLOOR-5)', () => {
  for (const palette of PALETTES) {
    test(palette, async ({page}) => {
      await open(page, palette);
      const entry = page.locator('[data-inventory-entry="Button / Disabled"]');
      const fills = await entry.locator('[data-dbs-component="Button"]').evaluateAll((elements) =>
        elements.map((element) => ({
          state: element.closest('[data-inventory-state]')?.getAttribute('data-inventory-state'),
          fill: getComputedStyle(element, '::after').backgroundColor,
        })),
      );
      const rest = fills.find((button) => button.state === 'default')?.fill;
      expect(rest).toBeTruthy();
      // a pinned hover or press on a disabled button paints the disabled fill, not the variant's
      expect(fills.filter((button) => button.fill !== rest)).toEqual([]);
      // and so does a real pointer
      const button = entry
        .locator('[data-inventory-state="default"] [data-dbs-component="Button"]')
        .first();
      await button.hover();
      expect(
        await button.evaluate((element) => getComputedStyle(element, '::after').backgroundColor),
      ).toBe(rest);
    });
  }
});

test('every control has a 44 by 44 hit area at every width (DF-6, NAV-4)', async ({page}) => {
  for (const width of WIDTHS) {
    await open(page, 'light', width);
    const small = await page.evaluate(() => {
      const HALF = 21.5;
      const controls = document.querySelectorAll<HTMLElement>(
        '[data-inventory-state] :is(a[href], button, input, [role="option"], [role="link"])',
      );
      const failures: string[] = [];
      for (const control of Array.from(controls)) {
        const host = control.matches('input') ? (control.closest('label') ?? control) : control;
        const rect = host.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          continue; // not rendered at this width
        }
        host.scrollIntoView({block: 'center', inline: 'center'});
        const box = host.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        // a box that is already 44 wide (or tall) is probed just inside its own edge; a smaller
        // one must still be hit 21.5px out from its centre, by a hit area drawn around it
        const dx = box.width >= 44 ? box.width / 2 - 1 : HALF;
        const dy = box.height >= 44 ? box.height / 2 - 1 : HALF;
        const probes = [
          [cx - dx, cy],
          [cx + dx, cy],
          [cx, cy - dy],
          [cx, cy + dy],
        ];
        const missed = probes.some(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return !hit || !(hit === host || host.contains(hit));
        });
        if (missed) {
          const where = host
            .closest('[data-inventory-entry]')
            ?.getAttribute('data-inventory-entry');
          failures.push(
            `${where} · ${host.tagName} "${host.textContent?.trim().slice(0, 20)}" ${Math.round(box.width)}x${Math.round(box.height)}`,
          );
        }
      }
      return [...new Set(failures)];
    });
    expect(small, `${width}px`).toEqual([]);
  }
});

test('reflows at 320px without horizontal scroll (NAV-3)', async ({page}) => {
  await open(page, 'light', 320);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('every keyboard stop shows the focus ring (FLOOR-4)', async ({page}) => {
  await open(page);
  await page.locator('#inventory h1').click();
  const unringed: string[] = [];
  const seen = new Set<string>();
  for (let step = 0; step < 400; step += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || !element.closest('#inventory')) {
        return null;
      }
      // A selectable card's native input is visually hidden; the ring is drawn on the card (DF-3).
      const ringHost =
        element.matches('input') && element.closest('label') ? element.closest('label')! : element;
      const style = getComputedStyle(ringHost);
      return {
        id: `${element.tagName}:${element.textContent?.trim().slice(0, 30)}:${element.getBoundingClientRect().top}`,
        ringed: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2,
      };
    });
    if (!stop) {
      if (step > 0) {
        break;
      }
      continue;
    }
    if (seen.has(stop.id)) {
      continue;
    }
    seen.add(stop.id);
    if (!stop.ringed) {
      unringed.push(stop.id);
    }
  }
  expect(seen.size).toBeGreaterThan(40);
  expect(unringed).toEqual([]);
});

test.describe('behaviour', () => {
  test('the filter chips are one tab stop with arrow-key movement (A11Y-28)', async ({page}) => {
    await open(page);
    const cell = page.locator(
      '[data-inventory-entry="Chip / Filter"] [data-inventory-state="default"]',
    );
    const tabs = cell.getByRole('tab');
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(tabs.nth(3)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(0)).toBeFocused();
    await expect(cell.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(cell.getByRole('tabpanel')).toBeFocused();
  });

  test('a disabled tab is skipped', async ({page}) => {
    await open(page);
    const cell = page.locator(
      '[data-inventory-entry="Chip / Filter"] [data-inventory-state="disabled"]',
    );
    const tabs = cell.getByRole('tab');
    await tabs.nth(2).click();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(0)).toBeFocused();
  });

  test('Copy copies and says so (DF-4)', async ({page, context}) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page);
    const cell = page.locator(
      '[data-inventory-entry="Code / Copy"] [data-inventory-state="default"]',
    );
    await cell.getByRole('button').click();
    await expect(cell.getByRole('button')).toHaveText('Copied');
    await expect(cell.getByRole('status')).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('docker compose up -d');
  });

  test('selectable cards are native controls', async ({page}) => {
    await open(page);
    const choice = page.locator(
      '[data-inventory-entry="Card / Choice"] [data-inventory-state="default"]',
    );
    const box = choice.getByRole('checkbox');
    await choice.locator('label').click();
    await expect(box).toBeChecked();
    await box.focus();
    await page.keyboard.press('Space');
    await expect(box).not.toBeChecked();
    const toggle = page
      .locator('[data-inventory-entry="Card / Data option"] [data-inventory-state="default"]')
      .getByRole('switch');
    await expect(toggle).toHaveAccessibleName(/Multi-assets/);
    const invalid = page
      .locator('[data-inventory-entry="Card / Choice"] [data-inventory-state="error"]')
      .getByRole('checkbox');
    await expect(invalid).toHaveAttribute('aria-invalid', 'true');
    await expect(invalid).toHaveAccessibleDescription('Choose at least one to continue.');
  });

  test('below 1280px the sections sit behind a Menu disclosure (DF-7, NAV-2)', async ({page}) => {
    await open(page, 'light', 375);
    const navbar = page.locator(
      '[data-inventory-entry="Navbar / Full"] [data-inventory-state="default"]',
    );
    const menu = navbar.getByRole('button', {name: 'Menu'});
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(navbar.getByRole('link', {name: 'Schema'})).toBeHidden();
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(navbar.getByRole('link', {name: 'Schema'})).toBeVisible();
  });

  test('an avatar that fails to load falls back to initials', async ({page}) => {
    await open(page);
    const cell = page.locator(
      '[data-inventory-entry="Avatar / Hexagon"] [data-inventory-state="error"]',
    );
    // the image is lazy: it is only requested, and only fails, once it is near the viewport
    await cell.scrollIntoViewIfNeeded();
    await expect(cell.locator('[data-status="error"]')).toHaveCount(1);
    await expect(cell.getByRole('link')).toHaveAccessibleName('Kostas Dermentzis');
  });
});

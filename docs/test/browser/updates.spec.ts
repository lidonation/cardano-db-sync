import AxeBuilder from '@axe-core/playwright';
import {expect, test, type Page} from '@playwright/test';

import {SITE_URL} from '../../playwright.config';
import {UPDATES_FIXTURE_PATH} from '../../plugins/inventory';

const HOSTILE_TITLE = '<img src=x onerror="window.__updatesInjected=true">';

async function open(page: Page, width = 1440, palette = 'light') {
  await page.setViewportSize({width, height: 900});
  await page.goto(`${SITE_URL}${UPDATES_FIXTURE_PATH}`);
  await page.getByRole('tab', {name: 'Week', exact: true}).waitFor();
  await page.evaluate((name) => {
    document.documentElement.setAttribute('data-dbs-palette', name);
    document.documentElement.setAttribute(
      'data-theme',
      name === 'dark' || name === 'navy' ? 'dark' : 'light',
    );
  }, palette);
  await page.evaluate(() => document.fonts.ready);
}

function panel(page: Page) {
  return page.getByRole('tabpanel');
}

async function range(page: Page, from: string, to: string) {
  await page.getByRole('tab', {name: 'Custom', exact: true}).click();
  await page.getByLabel('From', {exact: true}).fill(from);
  await page.getByLabel('To', {exact: true}).fill(to);
}

test('period tabs implement roving focus, arrows, Home/End and named panels', async ({page}) => {
  await open(page);
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(4);
  await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  const week = page.getByRole('tab', {name: 'Week', exact: true});
  await week.focus();
  for (const [key, name] of [
    ['ArrowRight', 'Month'],
    ['ArrowRight', 'Total'],
    ['End', 'Custom'],
    ['ArrowRight', 'Week'],
    ['ArrowLeft', 'Custom'],
    ['Home', 'Week'],
  ] as const) {
    await page.keyboard.press(key);
    const selected = page.getByRole('tab', {name, exact: true});
    await expect(selected).toBeFocused();
    await expect(selected).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    await expect(panel(page)).toHaveCount(1);
    await expect(panel(page)).toHaveAccessibleName(name);
    expect(await panel(page).getAttribute('id')).toBe(await selected.getAttribute('aria-controls'));
  }
  await page.keyboard.press('Tab');
  await expect(panel(page)).toBeFocused();
});

test('week and month use inclusive UTC boundaries and announce result counts', async ({page}) => {
  await open(page);
  await expect(panel(page).getByRole('link')).toHaveCount(2);
  const status = page.getByRole('status');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toHaveAttribute('aria-atomic', 'true');
  await expect(status).toContainText(/2\s+updates?/i);
  await page.getByRole('tab', {name: 'Month', exact: true}).click();
  await expect(panel(page).getByRole('link')).toHaveCount(4);
  await expect(page.getByRole('status')).toContainText(/4\s+updates?/i);
  await page.getByRole('tab', {name: 'Total', exact: true}).click();
  await expect(panel(page).getByRole('link')).toHaveCount(5);
  await expect(page.getByRole('status')).toContainText(/5\s+updates?/i);
});

test('custom dates include both endpoints and reject a reversed range', async ({page}) => {
  await open(page);
  await range(page, '2026-09-13', '2026-10-05');
  await expect(panel(page).getByRole('link')).toHaveCount(2);
  await expect(
    panel(page).getByRole('link', {name: 'Before week documentation', exact: true}),
  ).toBeVisible();
  await expect(panel(page).getByRole('link', {name: HOSTILE_TITLE, exact: true})).toBeVisible();
  await range(page, '2026-10-06', '2026-10-06');
  await expect(panel(page).getByRole('link')).toHaveCount(1);
  await range(page, '2026-10-12', '2026-09-12');
  await expect(panel(page).getByRole('alert')).toContainText(/before|after|range/i);
  await expect(panel(page).getByRole('link')).toHaveCount(0);
});

test('absence, pre-first-release and filtered-empty are distinct honest states', async ({page}) => {
  await open(page);
  await page.getByRole('button', {name: 'Absent feed', exact: true}).click();
  await expect(page.getByRole('main')).toContainText(/unavailable/i);
  await expect(page.getByRole('main').getByRole('link')).toHaveCount(0);
  await expect(page.getByRole('main')).not.toContainText(/first release|0 updates/i);
  await page.getByRole('button', {name: 'Empty feed', exact: true}).click();
  await expect(page.getByRole('main')).toContainText(/first release/i);
  await page.getByRole('button', {name: 'Populated feed', exact: true}).click();
  await range(page, '2026-08-01', '2026-08-31');
  await expect(panel(page)).toContainText(/no updates/i);
  await expect(panel(page)).not.toContainText(/first release|unavailable/i);
  await expect(page.getByRole('status')).toContainText(/0\s+updates?/i);
});

test('external feed titles remain text, never executable markup', async ({page}) => {
  await open(page);
  await page.getByRole('tab', {name: 'Total', exact: true}).click();
  const link = panel(page).getByRole('link', {name: HOSTILE_TITLE, exact: true});
  await expect(link).toHaveText(HOSTILE_TITLE);
  await expect(link.locator('img, script')).toHaveCount(0);
  expect(await page.evaluate(() => '__updatesInjected' in window)).toBe(false);
  await expect(link).toHaveAttribute('href', 'https://example.com/month');
});

for (const palette of ['light', 'dark', 'cream', 'navy']) {
  for (const width of [320, 768, 1440]) {
    test(`WCAG 2.2 AA, reflow and focus: ${palette} ${width}px`, async ({page}) => {
      await open(page, width, palette);
      await page.getByRole('tab', {name: 'Total', exact: true}).click();
      expect(
        (
          await new AxeBuilder({page})
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
      await range(page, '2026-09-12', '2026-10-12');
      expect(
        (
          await new AxeBuilder({page})
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      const from = page.getByLabel('From', {exact: true});
      await from.focus();
      await expect(from).toBeFocused();
      const focus = await from.evaluate((element) => {
        const style = getComputedStyle(element);
        return {style: style.outlineStyle, width: parseFloat(style.outlineWidth)};
      });
      expect(focus.style).not.toBe('none');
      expect(focus.width).toBeGreaterThanOrEqual(2);
      const bounds = await from.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    });
  }
}

/** B22 is absent: the public route must not substitute fixture or zero-count data. */
test('real Updates route reports unavailable source without invented entries', async ({page}) => {
  await page.goto(`${SITE_URL}updates`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', {name: 'Updates', exact: true})).toBeVisible();
  await expect(main.getByRole('status')).toContainText('Unavailable');
  await expect(main).toContainText(/not available yet/i);
  await expect(main.getByRole('link')).toHaveCount(0);
  await expect(main).not.toContainText(/first release|0\s*updates/i);
});

test('the first skip link focuses the Updates main landmark', async ({page}) => {
  await page.goto(`${SITE_URL}updates`);
  await expect(page.locator('html')).toHaveAttribute('data-has-hydrated', 'true');
  await page.keyboard.press('Tab');
  await expect(page.locator('a.dbs-skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});

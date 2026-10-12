import AxeBuilder from '@axe-core/playwright';
import {expect, test} from '@playwright/test';

import {smallTargets} from './audits';
import {SITE_URL} from '../../playwright.config';

const fixture = (state: string) => `${SITE_URL}__numbers/${state}`;

test('synthetic estimates explain their configuration, methodology and chart alternatives', async ({
  page,
}) => {
  await page.goto(fixture('ready'));
  const main = page.getByRole('main');
  await expect(main).toContainText('MODELLED ESTIMATES');
  await expect(main).toContainText(/synthetic.*test only/i);
  await expect(main).toContainText('full');
  await expect(main).toContainText('120');
  await expect(main).toContainText('12');
  await main.getByText('View the growth data', {exact: true}).click();
  const growth = main.getByRole('table', {name: /Modelled growth per epoch/});
  await expect(growth.locator('tbody tr')).toHaveCount(12);
  await expect(growth).toContainText('MODELLED ESTIMATES');
  await expect(main.locator('#numbers-growth-summary')).toContainText('epoch 88 increased by 1 GB');
  await expect(main.locator('#numbers-growth-summary')).toContainText(
    'epoch 99 increased by 12 GB',
  );
  await expect(main.getByRole('img')).toHaveAttribute('aria-labelledby', 'numbers-growth-summary');
  const sizes = main.getByRole('table', {name: /Modelled table sizes/});
  await expect(sizes.locator('tbody tr')).toHaveCount(2);
  await expect(sizes).toContainText('MODELLED ESTIMATES');
  const epochs = main.getByRole('table', {name: 'Recent provider epoch totals'});
  await expect(epochs.locator('tbody tr')).toHaveCount(12);
  await expect(epochs.locator('tbody tr').first()).toContainText('88');
  await expect(epochs.locator('tbody tr').last()).toContainText('99');
  await expect(main).toContainText('tx_out');
  await expect(main).toContainText('tx');
  await expect(main).toContainText('1,234');
  await expect(main).toContainText('5,678');
  await expect(main).not.toContainText(/sync duration|sync time|healthy/i);
});

test('stale snapshot keeps labelled values and shows a warning', async ({page}) => {
  await page.goto(fixture('stale'));
  await expect(page.getByRole('main')).toContainText(/stale/i);
  await expect(page.getByRole('main')).toContainText('120');
  await expect(page.getByRole('main')).toContainText('MODELLED ESTIMATES');
});

for (const state of ['missing', 'invalid', 'network']) {
  test(`${state} fails closed without fictional metrics`, async ({page}) => {
    await page.goto(fixture(state));
    const main = page.getByRole('main');
    await expect(main).toContainText(/unavailable/i);
    await expect(main).not.toContainText(/0 GB|\$0|healthy|sync time/i);
    await expect(main.getByRole('table')).toHaveCount(0);
  });
}

test('production route names its unavailable snapshot', async ({page}) => {
  await page.goto(`${SITE_URL}numbers`);
  await expect(page.getByRole('main')).toContainText(/unavailable/i);
  await expect(page.getByRole('main')).not.toContainText(/0 GB|\$0|healthy|sync time/i);
});

for (const palette of ['light', 'dark', 'cream', 'navy']) {
  for (const width of [320, 768, 1024, 1440]) {
    test(`${palette} Numbers accessible without overflow at ${width}px`, async ({page}) => {
      await page.setViewportSize({width, height: 900});
      await page.addInitScript((name) => {
        localStorage.setItem('dbs-palette', name);
        localStorage.setItem('theme', name === 'dark' || name === 'navy' ? 'dark' : 'light');
      }, palette);
      await page.goto(fixture('ready'));
      await expect(page.getByRole('main')).toContainText('MODELLED ESTIMATES');
      await expect(page.locator('html')).toHaveAttribute('data-dbs-palette', palette);
      await page.evaluate(() => document.fonts.ready);
      expect(await smallTargets(page)).toEqual([]);
      const wideCard = page.locator('main details').locator('..');
      if (width >= 1024) expect((await wideCard.boundingBox())!.width).toBeGreaterThan(384);
      if (
        process.env.DBS_CAPTURE_DIR &&
        ((width === 1440 && palette === 'light') || (width === 320 && palette === 'dark'))
      )
        await page.screenshot({
          path: `${process.env.DBS_CAPTURE_DIR}/numbers-${palette}-${width}.png`,
          fullPage: true,
        });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const audit = await new AxeBuilder({page})
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(audit.violations).toEqual([]);
    });
  }
}

test('skip link reaches Numbers with Tab and Enter', async ({page}) => {
  await page.goto(fixture('ready'));
  await expect(page.locator('html')).toHaveAttribute('data-has-hydrated', 'true');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', {name: /skip to main/i})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});

test('mainnet fixture is explicitly synthetic, not the real wizard', async ({page}) => {
  await page.goto(fixture('mainnet'));
  await expect(page.getByRole('main')).toContainText(/mainnet/i);
  await expect(page.getByRole('main')).toContainText(/not real wizard output/i);
  await expect(page.getByRole('main')).toContainText('MODELLED ESTIMATES');
});

test('chain facts remain available when the storage model is absent', async ({page}) => {
  await page.goto(fixture('no-model'));
  const main = page.getByRole('main');
  await expect(main).toContainText('1,234');
  await expect(main).toContainText('5,678');
  await expect(main).not.toContainText('tx_out');
  await expect(main).not.toContainText(/0 GB|\$0/);
});

for (const kind of ['empty', 'zero', 'single']) {
  test(`${kind} model outputs retain truthful chart alternatives`, async ({page}) => {
    await page.goto(fixture(kind));
    const main = page.getByRole('main');
    if (kind === 'empty') {
      await expect(main).toContainText('Modelled growth unavailable');
      await expect(main).toContainText('Modelled table sizes unavailable');
      await expect(main).toContainText('Recent epochs unavailable');
      await expect(main.getByRole('img')).toHaveCount(0);
    } else {
      const points = main.locator('svg circle');
      await expect(points).toHaveCount(kind === 'single' ? 1 : 12);
      expect(
        await points.evaluateAll((nodes) =>
          nodes.every(
            (n) =>
              Number.isFinite(Number(n.getAttribute('cx'))) &&
              Number.isFinite(Number(n.getAttribute('cy'))),
          ),
        ),
      ).toBe(true);
      await expect(main.locator('#numbers-growth-summary')).toContainText('GB');
    }
  });
}

import AxeBuilder from '@axe-core/playwright';
import {expect, test, type Page} from '@playwright/test';

import {SITE_URL} from '../../playwright.config';
import {releaseFacts} from '../../src/data/release-facts';
import {SURFACES} from '../../src/data/surfaces';

import {smallTargets} from './audits';

/**
 * B44-a — the landing page in a browser: every tier (DF-7, NAV-3), WCAG 2.2 AA in four palettes,
 * 44px targets (NAV-4, DF-6), the build facts, and links that only point at pages that exist.
 */
async function open(page: Page, width: number, palette = 'light') {
  await page.setViewportSize({width, height: 900});
  await page.goto(SITE_URL);
  await page.locator('#landing-title').waitFor();
  await page.evaluate((name) => document.documentElement.setAttribute('data-theme', name), palette);
  await page.evaluate(() => document.fonts.ready);
}

test.describe('tiers (DF-7, NAV-3)', () => {
  const TIERS = [
    {width: 320, margin: 16, columns: 1, graphic: false},
    {width: 375, margin: 16, columns: 1, graphic: false},
    {width: 768, margin: 32, columns: 2, graphic: false},
    {width: 1024, margin: 48, columns: 3, graphic: false},
    {width: 1280, margin: 48, columns: 3, graphic: true},
    {width: 1440, margin: 120, columns: 3, graphic: true},
  ];
  for (const {width, margin, columns, graphic} of TIERS) {
    test(`${width}px`, async ({page}) => {
      await open(page, width);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const title = (await page.locator('#landing-title').boundingBox())!;
      expect(Math.round(title.x)).toBe(margin);
      const cards = page.locator('section[aria-labelledby="landing-use"] li');
      const tops = await cards.evaluateAll((items) =>
        items.map((item) => Math.round(item.getBoundingClientRect().top)),
      );
      expect(tops.filter((top) => top === tops[0])).toHaveLength(columns);
      await expect(page.locator('[data-dbs-graphic="hero"]')).toBeVisible({visible: graphic});
    });
  }
});

test.describe('44px targets (NAV-4, DF-6)', () => {
  for (const width of [320, 768, 1440]) {
    test(`at ${width}px, every answer open`, async ({page}) => {
      await open(page, width);
      await page
        .locator('details')
        .evaluateAll((items) => items.forEach((item) => item.setAttribute('open', '')));
      expect(await smallTargets(page)).toEqual([]);
    });
  }
});

test.describe('content', () => {
  test('the facts strip shows the counts from the committed schema', async ({page}) => {
    await open(page, 1440);
    const facts = releaseFacts();
    const values = await page
      .locator('section[aria-labelledby="landing-facts"] [data-dbs-component="Metric"]')
      .evaluateAll((items) => items.map((item) => item.firstElementChild?.textContent));
    expect(values).toEqual([
      facts.tables.toLocaleString('en'),
      facts.columns.toLocaleString('en'),
      facts.migration,
      facts.renamed.toLocaleString('en'),
    ]);
  });

  test('every internal link points at a page this build serves', async ({page}) => {
    await open(page, 1440);
    const hrefs = await page
      .locator('main a[href^="/"]')
      .evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute('href')!))]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const response = await page.request.get(new URL(href, SITE_URL).toString());
      expect(response.status(), href).toBe(200);
    }
    // the surfaces not built yet are not linked at all
    for (const surface of [SURFACES.schema, SURFACES.numbers, SURFACES.survey, SURFACES.config]) {
      await expect(page.locator(`main a[href$="${surface}"]`)).toHaveCount(0);
    }
  });

  test('an FAQ answer opens and closes from the keyboard', async ({page}) => {
    await open(page, 1440);
    const item = page.locator('details').nth(1);
    await expect(item).not.toHaveAttribute('open');
    await item.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(item).toHaveAttribute('open');
    await page.keyboard.press('Enter');
    await expect(item).not.toHaveAttribute('open');
  });

  test('one h1, and headings in order', async ({page}) => {
    await open(page, 1440);
    await expect(page.locator('main h1')).toHaveCount(1);
    const levels = await page
      .locator('main h1, main h2, main h3')
      .evaluateAll((headings) => headings.map((heading) => Number(heading.tagName[1])));
    levels.reduce((previous, level) => {
      expect(level - previous).toBeLessThanOrEqual(1);
      return level;
    });
  });

  test('no inline style attribute, which the CSP would refuse (SEC-2)', async ({page}) => {
    await open(page, 1440);
    await expect(page.locator('main [style]')).toHaveCount(0);
  });
});

test.describe('axe, WCAG 2.2 AA', () => {
  for (const palette of ['light', 'dark', 'cream', 'navy']) {
    for (const width of [375, 1024, 1440]) {
      test(`${palette} at ${width}px`, async ({page}) => {
        await open(page, width, palette);
        await page
          .locator('details')
          .evaluateAll((items) => items.forEach((item) => item.setAttribute('open', '')));
        const results = await new AxeBuilder({page})
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
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

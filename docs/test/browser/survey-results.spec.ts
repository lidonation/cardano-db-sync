import AxeBuilder from '@axe-core/playwright';
import {expect, test, type Page} from '@playwright/test';

import {SITE_URL} from '../../playwright.config';

import {smallTargets} from './audits';

/**
 * B44-f — the survey results dashboard in a browser: reflow at every tier, 44px targets,
 * WCAG 2.2 AA in four palettes, and the committed pre-tally state with its basis standing.
 */
const base = () => test.info().project.use.baseURL ?? SITE_URL;

async function open(page: Page, width: number, palette = 'light') {
  await page.setViewportSize({width, height: 900});
  await page.goto(new URL('survey/results', base()).toString());
  await page.locator('#results-title').waitFor();
  await page.evaluate((name) => {
    document.documentElement.setAttribute('data-dbs-palette', name);
    document.documentElement.setAttribute(
      'data-theme',
      name === 'dark' || name === 'navy' ? 'dark' : 'light',
    );
  }, palette);
  await expect(page.locator('html')).toHaveAttribute('data-dbs-palette', palette);
  await page.evaluate(() => document.fonts.ready);
}

test.describe('margins, reflow and targets (DF-7, NAV-3, NAV-4)', () => {
  const MARGINS = {320: 16, 768: 32, 1024: 48, 1440: 120};
  for (const [width, margin] of Object.entries(MARGINS).map(([w, m]) => [Number(w), m])) {
    test(`${width}px`, async ({page}) => {
      await open(page, width);
      const title = (await page.locator('#results-title').boundingBox())!;
      expect(Math.round(title.x)).toBe(margin);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      expect(await smallTargets(page)).toEqual([]);
    });
  }
});

test.describe('content', () => {
  test('states the response-time basis and the interim-forever standing', async ({page}) => {
    await open(page, 1440);
    await expect(page.locator('main')).toContainText('response-time');
    await expect(page.locator('main')).toContainText('interim');
  });

  test('the committed aggregate renders the pre-tally state', async ({page}) => {
    await open(page, 1440);
    await expect(page.locator('main')).toContainText('Pre-tally');
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

  test('no inline style attribute, which the CSP would refuse (SEC-3)', async ({page}) => {
    await open(page, 1440);
    await expect(page.locator('main [style]')).toHaveCount(0);
  });
});

test.describe('axe, WCAG 2.2 AA', () => {
  for (const palette of ['light', 'dark', 'cream', 'navy']) {
    for (const width of [375, 1440]) {
      test(`${palette} at ${width}px`, async ({page}) => {
        await open(page, width, palette);
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

test.describe('populated dashboard', () => {
  for (const width of [320, 768, 1440]) {
    test(`real tables reflow at ${width}px`, async ({page}) => {
      await page.setViewportSize({width, height: 900});
      await page.goto(new URL('__survey-results', base()).toString());
      await expect(page.locator('main table')).toHaveCount(3);
      await expect(page.locator('main')).toContainText('Selections counted: 18');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(0);
      for (const region of await page.getByRole('region').all()) {
        await region.focus();
        await expect(region).toBeFocused();
      }
      expect(
        (await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze())
          .violations,
      ).toEqual([]);
    });
  }
});

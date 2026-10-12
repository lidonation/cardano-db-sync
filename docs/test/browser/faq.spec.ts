import AxeBuilder from '@axe-core/playwright';
import {expect, test, type Page} from '@playwright/test';

import {SITE_URL} from '../../playwright.config';
import {faqSections} from '../../src/faq/questions';

import {smallTargets} from './audits';

/**
 * B44-c — the FAQ page in a browser: reflow at every tier, 44px targets, WCAG 2.2 AA in four
 * palettes, guide links, and an address that opens one answer.
 */
const entries = faqSections(({message}) => message).flatMap((section) => section.items);

const base = () => test.info().project.use.baseURL ?? SITE_URL;

async function open(page: Page, width: number, palette = 'light', hash = '') {
  await page.setViewportSize({width, height: 900});
  await page.goto(new URL(`faq${hash}`, base()).toString());
  await page.locator('#faq-title').waitFor();
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

const openAll = (page: Page) =>
  page
    .locator('main details')
    .evaluateAll((items) => items.forEach((item) => item.setAttribute('open', '')));

test.describe('margins, reflow and targets (DF-7, NAV-3, NAV-4)', () => {
  const MARGINS = {320: 16, 768: 32, 1024: 48, 1440: 120};
  for (const [width, margin] of Object.entries(MARGINS).map(([w, m]) => [Number(w), m])) {
    test(`${width}px, every answer open`, async ({page}) => {
      await open(page, width);
      const title = (await page.locator('#faq-title').boundingBox())!;
      expect(Math.round(title.x)).toBe(margin);
      await openAll(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      expect(await smallTargets(page)).toEqual([]);
    });
  }
});

test.describe('content', () => {
  test('every question, each answer linking its guide where one exists', async ({page}) => {
    await open(page, 1440);
    await expect(page.locator('main details')).toHaveCount(entries.length);
    for (const item of entries) {
      const links = page.locator(`main details[id="${item.key}"] a`);
      if (!item.guide) {
        await expect(links).toHaveCount(0);
        continue;
      }
      await expect(links).toHaveCount(1);
      expect(await links.getAttribute('href')).toMatch(
        new RegExp(`/blob/master/doc/${item.guide.replace('.', '\\.')}$`),
      );
    }
  });

  test('an address with a question anchor opens that answer', async ({page}) => {
    await open(page, 1440, 'light', '#rollback');
    await expect(page.locator('main details#rollback')).toHaveAttribute('open');
    await expect(page.locator('main details[open]')).toHaveCount(1);
  });

  test('changing anchors opens the new answer and scrolls it into view', async ({page}) => {
    await open(page, 1440);
    await page.evaluate(() => {
      window.location.hash = '#%72ollback';
    });
    await expect(page.locator('main details#rollback')).toHaveAttribute('open');
    await expect(page.locator('main details#rollback')).toBeInViewport();
    const summary = page.locator('main details#rollback summary');
    const header = page.locator('header[data-dbs-component="Navbar / Full"]');
    await expect
      .poll(async () => {
        const question = await summary.boundingBox();
        const bar = await header.boundingBox();
        return question!.y - (bar!.y + bar!.height);
      })
      .toBeGreaterThanOrEqual(0);
    await page.evaluate(() => {
      window.location.hash = '#socket';
    });
    await expect(page.locator('main details#socket')).toHaveAttribute('open');
    await expect(page.locator('main details#socket')).toBeInViewport();
    await page.evaluate(() => {
      window.location.hash = '#unknown-question';
    });
    await expect(page.locator('#faq-title')).toHaveCount(1);
  });

  test('the landing page links here', async ({page}) => {
    await page.goto(base());
    const link = page.getByRole('link', {name: 'All questions'});
    await link.click();
    await expect(page.locator('#faq-title')).toBeVisible();
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
    for (const width of [375, 1440]) {
      test(`${palette} at ${width}px`, async ({page}) => {
        await open(page, width, palette);
        await openAll(page);
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

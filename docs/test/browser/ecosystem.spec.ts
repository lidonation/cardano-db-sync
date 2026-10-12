import AxeBuilder from '@axe-core/playwright';
import {expect, test, type Page} from '@playwright/test';

import {PROFILES} from '../../config/profiles';

import {SITE_URL} from '../../playwright.config';
import {ECOSYSTEM_TOOLS} from '../../src/ecosystem/tools';

import {smallTargets} from './audits';

/**
 * B44-b — the ecosystem page in a browser: every tier (DF-7, NAV-3), WCAG 2.2 AA in four
 * palettes, 44px targets (NAV-4, DF-6), the tools grounded in doc/community-tools.md, and
 * links that only point where something exists.
 */
async function open(page: Page, width: number, palette = 'light') {
  await page.setViewportSize({width, height: 900});
  await page.goto(`${test.info().project.use.baseURL ?? SITE_URL}ecosystem`);
  await page.locator('#ecosystem-title').waitFor();
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

test.describe('tiers (DF-7, NAV-3)', () => {
  const TIERS = [
    {width: 320, margin: 16, columns: 1},
    {width: 375, margin: 16, columns: 1},
    {width: 768, margin: 32, columns: 2},
    {width: 1024, margin: 48, columns: 3},
    {width: 1280, margin: 48, columns: 3},
    {width: 1440, margin: 120, columns: 3},
  ];
  for (const {width, margin, columns} of TIERS) {
    test(`${width}px`, async ({page}) => {
      await open(page, width);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const title = (await page.locator('#ecosystem-title').boundingBox())!;
      expect(Math.round(title.x)).toBe(margin);
      const cards = page.locator('section[aria-labelledby="ecosystem-tools"] li');
      const tops = await cards.evaluateAll((items) =>
        items.map((item) => Math.round(item.getBoundingClientRect().top)),
      );
      expect(tops.filter((top) => top === tops[0])).toHaveLength(columns);
    });
  }
});

test.describe('44px targets (NAV-4, DF-6)', () => {
  for (const width of [320, 768, 1440]) {
    test(`at ${width}px`, async ({page}) => {
      await open(page, width);
      expect(await smallTargets(page)).toEqual([]);
    });
  }
});

test.describe('content', () => {
  test('lists every tool with its card, repository and SQL links', async ({page}) => {
    await open(page, 1440);
    const cards = page.locator('main [data-dbs-component="Card / Tool"]');
    await expect(cards).toHaveCount(ECOSYSTEM_TOOLS.length);
    for (const tool of ECOSYSTEM_TOOLS) {
      const card = cards.filter({hasText: tool.name});
      await expect(card).toHaveCount(1);
      await expect(card).toHaveAttribute('href', tool.website);
      const item = page.locator('section[aria-labelledby="ecosystem-tools"] li', {
        hasText: tool.name,
      });
      await expect(item.getByRole('link', {name: 'Repository'})).toHaveAttribute(
        'href',
        tool.repository,
      );
      await expect(item.getByRole('link', {name: tool.queriesLabel})).toHaveAttribute(
        'href',
        tool.queries,
      );
    }
  });

  test('tool proposals go to this build repository', async ({page}) => {
    await open(page, 1440);
    const profile = test.info().project.name === 'built-prod' ? PROFILES.prod : PROFILES.dev;
    await expect(page.getByRole('link', {name: 'Propose a tool'})).toHaveAttribute(
      'href',
      `${profile.repoUrl}/issues/new`,
    );
  });

  test('untranslated locale marks tool content as English', async ({page}) => {
    test.skip(
      !test.info().project.use.baseURL,
      'The development server serves only the default locale; built profiles cover Japanese.',
    );
    const base = test.info().project.use.baseURL ?? SITE_URL;
    await page.goto(`${base}ja/ecosystem`);
    await expect(page.locator('main')).toHaveAttribute('lang', 'en');
    await expect(page.locator('main')).toContainText(ECOSYSTEM_TOOLS[0].description);
  });

  test('external links leave the site safely', async ({page}) => {
    await open(page, 1440);
    const hrefs = await page
      .locator('main a[href^="https://"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')!));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const link of await page.locator('main a[href^="https://"]').all()) {
      await expect(link).toHaveAttribute('target', '_blank');
      expect(((await link.getAttribute('rel')) ?? '').split(' ')).toEqual(
        expect.arrayContaining(['noopener', 'noreferrer']),
      );
    }
  });

  test('the navbar Ecosystem link resolves, and marks itself current here', async ({page}) => {
    await open(page, 1440);
    const navbar = page.getByRole('navigation', {name: 'Sections'}).first();
    const link = navbar.getByRole('link', {name: 'Ecosystem'});
    await expect(link).toHaveAttribute('aria-current', 'page');
    const response = await page.request.get(
      new URL((await link.getAttribute('href'))!, page.url()).toString(),
    );
    expect(response.status()).toBe(200);
  });

  test('skip link moves focus to the ecosystem main landmark', async ({page}) => {
    await open(page, 1440);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', {name: 'Skip to main content'});
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
    await expect(page.locator('main')).toHaveAttribute('id', 'dbs-main-content');
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

import AxeBuilder from '@axe-core/playwright';
import {expect, test, type Page} from '@playwright/test';

import {SITE_URL} from '../../playwright.config';
import {teams, tools} from '../../src/ecosystem/entries';

import {smallTargets} from './audits';
import {contrast, paintedBackground} from './contrast';

/**
 * B44-b — the Ecosystem page in a browser: margins and reflow per tier, 44px targets, every entry
 * linked to its source, the facts from the changelog, the navbar's active item, and WCAG 2.2 AA
 * in four palettes.
 */
const english = ({message}: {message: string}) => message;

function requireRepositoryFixture() {
  test.skip(
    Boolean(test.info().project.use.baseURL) && process.env.DBS_REPOSITORY_FIXTURE_BUILT !== '1',
    'Repository fixture not included in this build',
  );
}

async function open(page: Page, width: number, palette = 'light') {
  await page.setViewportSize({width, height: 900});
  await page.goto(new URL('ecosystem', test.info().project.use.baseURL ?? SITE_URL).toString());
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

test.describe('margins, reflow and targets (DF-7, NAV-3, NAV-4)', () => {
  const TIERS = [
    {width: 320, margin: 16, columns: 1},
    {width: 768, margin: 32, columns: 2},
    {width: 1024, margin: 48, columns: 3},
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
      const tops = await page
        .locator('section[aria-labelledby="ecosystem-tools"] li')
        .evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
      expect(tops.filter((top) => top === tops[0])).toHaveLength(columns);
      expect(await smallTargets(page)).toEqual([]);
    });
  }
});

test.describe('content', () => {
  test('every tool and team links its source', async ({page}) => {
    await open(page, 1440);
    const hrefs = await page
      .locator(
        'section[aria-labelledby="ecosystem-tools"] li a, section[aria-labelledby="ecosystem-teams"] li a',
      )
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    const expected = [
      ...tools(english).flatMap((tool) =>
        [tool.url, tool.website, tool.sql].filter((url): url is string => Boolean(url)),
      ),
      ...teams(english).map((team) => team.url),
    ];
    expect(hrefs.sort()).toEqual(expected.sort());
    await expect(page.getByRole('link', {name: 'Koios website'})).toHaveAttribute(
      'href',
      'https://koios.rest/',
    );
    await expect(page.getByRole('link', {name: 'Koios SQL'})).toBeVisible();
    for (const tool of tools(english)) {
      for (const [label, href] of [
        ['repository', tool.url],
        ['website', tool.website],
        ['SQL', tool.sql],
      ] as const) {
        if (href)
          await expect(
            page.getByRole('link', {name: `${tool.name} ${label}`, exact: true}),
          ).toHaveAttribute('href', href);
      }
    }
    await expect(page.locator('section[aria-labelledby=ecosystem-tools]')).toContainText('ALT');
  });

  test('does not infer production deployments from project participation', async ({page}) => {
    await open(page, 1440);
    await expect(page.locator('#ecosystem-teams')).toHaveText('Teams building with db-sync');
    await expect(page.locator('section[aria-labelledby="ecosystem-teams"]')).toContainText(
      'These sources do not establish where or how it deploys it.',
    );
    await expect(page.locator('section[aria-labelledby="ecosystem-title"]')).toContainText(
      'Other indexers can also serve Cardano data in SQL.',
    );
  });

  test('repository figures, people and country table come from the fixture', async ({page}) => {
    requireRepositoryFixture();
    await page.route('**/repository-avatars/*.png', async (route) => {
      await route.fulfill({
        path: 'test/fixtures/repository-activity/avatars/' + 'c'.repeat(64) + '.png',
        contentType: 'image/png',
      });
    });
    const externalImages: string[] = [];
    page.on('request', (request) => {
      if (
        request.resourceType() === 'image' &&
        new URL(request.url()).origin !==
          new URL(test.info().project.use.baseURL ?? SITE_URL).origin
      )
        externalImages.push(request.url());
    });
    await open(page, 1440);
    const facts = page.locator(
      'section[aria-labelledby="ecosystem-facts"] [data-dbs-component="Metric"]',
    );
    await expect(facts).toHaveCount(5);
    expect(
      await facts.evaluateAll((nodes) => nodes.map((node) => node.firstElementChild?.textContent)),
    ).toEqual(['2', '1', '17', '2', '5']);
    await expect(page.locator('#ecosystem-title')).toContainText('Built by 2 people.');
    await expect(page.locator('section[aria-labelledby="ecosystem-origins"] table')).toContainText(
      'Kenya',
    );
    await expect(page.locator('section[aria-labelledby="ecosystem-origins"] table')).toContainText(
      'Unknown',
    );
    await expect(
      page.locator('section[aria-labelledby="ecosystem-people"] [data-dbs-component="Avatar"]'),
    ).toHaveCount(7);
    await expect(page.locator('section[aria-labelledby="ecosystem-people"] img')).toHaveCount(1);
    expect(externalImages).toEqual([]);
  });

  test('the navbar marks Ecosystem as the current page', async ({page}) => {
    await open(page, 1440);
    const current = page.locator('nav a[aria-current="page"]:visible');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText('Ecosystem');
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

test('empty tools fixture names the state and offers recovery without accessibility violations', async ({
  page,
}) => {
  test.skip(
    Boolean(test.info().project.use.baseURL),
    'Fixture exists only on the development server',
  );
  await page.goto(new URL('__ecosystem-empty', SITE_URL).toString());
  await expect(page.getByText('No ecosystem tools are listed yet.')).toBeVisible();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  const recovery = page.getByRole('link', {name: 'Tell us about a tool on Discord'});
  await expect(recovery).toHaveAttribute('href', /discord/);
  await page.keyboard.press('Tab');
  await expect(recovery).toBeFocused();
  // Exercise native link activation without sending a test browser to Discord.
  await recovery.evaluate((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      link.setAttribute('data-activated', 'true');
    });
  });
  await page.keyboard.press('Enter');
  await expect(recovery).toHaveAttribute('data-activated', 'true');
  const results = await new AxeBuilder({page})
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('activity ranges change the chart, summary and table with the keyboard', async ({page}) => {
  requireRepositoryFixture();
  await open(page, 1440);
  const section = page.locator('section[aria-labelledby="ecosystem-code-title"]');
  const tabs = section.getByRole('tablist');
  const selected = tabs.getByRole('tab', {name: '12 months'});
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await expect(section.locator('[role=tabpanel]:visible tbody tr')).toHaveCount(12);
  await expect(section.locator('[role=tabpanel]:visible svg rect')).toHaveCount(12);
  await expect(section.locator('[role=tabpanel]:visible svg text').first()).toHaveText('17');
  await expect(section.locator('[role=tabpanel]:visible svg text').nth(1)).toHaveText('Jul');
  await selected.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', {name: '30 days'})).toHaveAttribute('aria-selected', 'true');
  await expect(section.locator('[role=tabpanel]:visible tbody tr')).toHaveCount(30);
  await expect(section.locator('[role=tabpanel]:visible svg rect')).toHaveCount(30);
  await expect(section.locator('[role=tabpanel]:visible [id^=code-summary]')).toContainText('30');
  await page.keyboard.press('ArrowRight');
  await expect(section.locator('[role=tabpanel]:visible tbody tr')).toHaveCount(7);
  await expect(section.locator('[role=tabpanel]:visible svg rect')).toHaveCount(7);
  await expect(section.locator('[role=tabpanel]:visible [id^=code-summary]')).toContainText('7');
});

test('heatmap weekly table agrees with its day cells', async ({page}) => {
  requireRepositoryFixture();
  await open(page, 1440);
  const section = page.locator('section[aria-labelledby="ecosystem-activity-title"]');
  const cells = await section.locator('[data-week][data-count]').evaluateAll((nodes) => {
    const sums = Array.from({length: 52}, () => 0);
    nodes.forEach((node) => {
      sums[Number(node.getAttribute('data-week'))] += Number(node.getAttribute('data-count'));
    });
    return sums;
  });
  const table = await section.locator('tbody tr td').allTextContents();
  expect(table.map(Number)).toEqual(cells);
  expect(cells).toHaveLength(52);
  await expect(section.locator('[data-week][data-count]')).toHaveCount(364);
});

for (const palette of ['light', 'dark', 'cream', 'navy']) {
  test(`each activity range is accessible in ${palette}`, async ({page}) => {
    requireRepositoryFixture();
    await open(page, 375, palette);
    const section = page.locator('section[aria-labelledby="ecosystem-code-title"]');
    for (const name of ['12 months', '30 days', '7 days']) {
      await section.getByRole('tab', {name}).click();
      const results = await new AxeBuilder({page})
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    }
  });
}

for (const palette of ['light', 'dark', 'cream', 'navy']) {
  test(`chart marks stay visible and intensity increases in ${palette}`, async ({page}) => {
    requireRepositoryFixture();
    await open(page, 375, palette);
    const code = page.locator('section[aria-labelledby="ecosystem-code-title"]');
    const backdrop = await code.evaluate(paintedBackground);
    const bars = await code.locator('[role=tabpanel]:visible svg rect').evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return {fill: style.fill, stroke: style.stroke, width: parseFloat(style.strokeWidth)};
      }),
    );
    expect(bars).toHaveLength(12);
    for (const bar of bars) {
      const boundary = bar.stroke !== 'none' && bar.width > 0 ? bar.stroke : bar.fill;
      expect.soft(contrast(boundary, backdrop)).toBeGreaterThanOrEqual(3);
    }
    const activity = page.locator('section[aria-labelledby="ecosystem-activity-title"]');
    const background = await activity.evaluate(paintedBackground);
    const swatches = await activity
      .locator('ul span[aria-hidden]')
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
    const steps = swatches.map((colour) => contrast(colour, background));
    expect(steps).toHaveLength(4);
    for (let index = 1; index < steps.length; index++) {
      expect(steps[index]).toBeGreaterThan(steps[index - 1]);
    }
  });
}

test('built page reports missing repository data instead of inventing charts', async ({page}) => {
  test.skip(!test.info().project.use.baseURL, 'Built profile check');
  await open(page, 1440);
  const facts = page.locator('section[aria-labelledby="ecosystem-facts"]');
  if (
    (await facts.getByText('Repository activity data is unavailable in this build.').count()) > 0
  ) {
    await expect(page.locator('#ecosystem-code-title')).toHaveCount(0);
    await expect(page.locator('#ecosystem-activity-title')).toHaveCount(0);
  } else {
    await expect(page.locator('#ecosystem-code-title')).toBeVisible();
    await expect(page.locator('#ecosystem-activity-title')).toBeVisible();
  }
});

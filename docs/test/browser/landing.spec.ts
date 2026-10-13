import AxeBuilder from '@axe-core/playwright';
import {expect, test, type Page} from '@playwright/test';

import {SITE_URL} from '../../playwright.config';
import {QUICKSTART_COMMANDS} from '../../src/data/quickstart';
import {SAMPLE_QUERIES} from '../../src/data/sample-queries';
import {releaseFacts} from '../../src/data/release-facts';
import {SURFACES} from '../../src/data/surfaces';

import {smallTargets} from './audits';

/**
 * B44-a — the landing page in a browser: every tier (DF-7, NAV-3), WCAG 2.2 AA in four palettes,
 * 44px targets (NAV-4, DF-6), the build facts, and links that only point at pages that exist.
 */
async function open(page: Page, width: number, palette = 'light') {
  await page.setViewportSize({width, height: 900});
  await page.goto(test.info().project.use.baseURL ?? SITE_URL);
  await page.locator('#landing-title').waitFor();
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
  test('every Copy button copies the command or SQL it presents', async ({page, context}) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, 320);
    const expected = [
      'docker compose up -d && docker compose logs -f',
      SAMPLE_QUERIES.tip,
      SAMPLE_QUERIES.balance,
      SAMPLE_QUERIES.rewards,
      QUICKSTART_COMMANDS.restore,
      QUICKSTART_COMMANDS.run,
      QUICKSTART_COMMANDS.query,
    ];
    const buttons = page.locator('main [data-dbs-component="Code / Copy"] button');
    await expect(buttons).toHaveCount(expected.length);
    for (let i = 0; i < expected.length; i++) {
      await buttons.nth(i).click();
      await expect(buttons.nth(i)).toContainText('Copied');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected[i]);
    }
  });

  test('clipboard failure keeps the command readable at 320px', async ({page}) => {
    await open(page, 320);
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async () => {
            throw new Error('denied');
          },
        },
      }),
    );
    const hero = page.locator('section[aria-labelledby="landing-title"]');
    await hero.locator('button').click();
    await expect(hero.getByRole('status')).toContainText('Copy failed');
    const command = await hero.locator('pre').boundingBox();
    expect(command!.width).toBeGreaterThan(80);
  });

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
      const response = await page.request.get(new URL(href, page.url()).toString());
      expect(response.status(), href).toBe(200);
    }
    await expect(page.locator(`main a[href$="${SURFACES.numbers}"]`)).toHaveCount(1);
    // the surfaces not built yet are not linked at all
    for (const surface of [SURFACES.schema, SURFACES.survey, SURFACES.config]) {
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

test.describe('locked Landing 1440 contract', () => {
  test('layout geometry, bands and plain copy targets', async ({page}) => {
    await open(page, 1440);
    const geometry = await page.evaluate(() => {
      const section = (id: string) => document.querySelector(`section[aria-labelledby="${id}"]`)!;
      const box = (el: Element) => el.getBoundingClientRect();
      const hero = section('landing-title');
      const command = hero.querySelector('[data-dbs-component="Command"]')!;
      const stages = Array.from(section('landing-how').querySelectorAll('ol > li'));
      const facts = Array.from(section('landing-facts').querySelectorAll('ul > li'));
      return {
        command: [box(command).width, box(command).height],
        stageWidths: stages.map((el) => box(el).width),
        stagePitch: box(stages[1]).x - box(stages[0]).x,
        factPitch: box(facts[1]).x - box(facts[0]).x,
        bandPadding: getComputedStyle(section('landing-facts')).paddingBlockStart,
        heroGap: box(section('landing-facts')).top - box(hero).bottom,
        copies: Array.from(
          document.querySelectorAll('main [data-dbs-component="Code / Copy"] button'),
        ).map((el) => ({
          height: box(el).height,
          border: getComputedStyle(el).borderTopWidth,
          background: getComputedStyle(el).backgroundColor,
        })),
      };
    });
    expect(geometry.command).toEqual([560, 52]);
    expect(geometry.stageWidths).toEqual([276, 276, 276, 276]);
    expect(geometry.stagePitch).toBe(308);
    expect(geometry.factPitch).toBe(300);
    expect(geometry.bandPadding).toBe('64px');
    expect(geometry.heroGap).toBe(96);
    for (const copy of geometry.copies) {
      expect(copy.height).toBe(44);
      expect(copy.border).toBe('0px');
      expect(copy.background).toBe('rgba(0, 0, 0, 0)');
    }
  });

  test('section heads, card grids, quickstart tracks and decoration', async ({page}) => {
    await open(page, 1440);
    const measured = await page.evaluate(() => {
      const section = (id: string) => document.querySelector(`section[aria-labelledby="${id}"]`)!;
      const box = (el: Element) => el.getBoundingClientRect();
      const how = section('landing-how');
      const use = section('landing-use');
      const queries = section('landing-queries');
      const quick = section('landing-quick');
      const faq = section('landing-faq');
      const community = section('landing-community');
      const hero = section('landing-title');
      const stages = Array.from(how.querySelectorAll('ol > li'));
      const cards = Array.from(use.querySelectorAll('ul > li'));
      const queryCards = Array.from(queries.querySelectorAll('ul > li'));
      const step = quick.querySelector('ol > li')!;
      const badge = step.children[0];
      const copy = step.children[1];
      const command = step.children[2];
      const hexes = Array.from(community.querySelectorAll('svg')).slice(0, 3);
      const graph = hero.querySelector('[data-dbs-graphic="hero"]')!;
      return {
        headingDelta: box(how.querySelector('h2')!).top - box(how.querySelector('p')!).top,
        introGap: box(how.querySelectorAll('p')[1]).top - box(how.querySelector('h2')!).bottom,
        contentGap: box(stages[0]).top - box(how.querySelectorAll('p')[1]).bottom,
        plainGap: box(use.querySelector('p')!).top - box(how).bottom,
        cardWidths: cards.map((el) => box(el).width),
        cardPitch: box(cards[1]).left - box(cards[0]).left,
        cardRowGap: box(cards[3]).top - box(cards[0]).bottom,
        stageIcons: stages.map((el) => box(el.querySelector('svg')!).width),
        queryHeights: queryCards.map((el) => box(el).height),
        queryHeader: box(queryCards[0].querySelector('[data-kind="Query"]')!.firstElementChild!)
          .height,
        badge: [box(badge).width, box(badge).height],
        tracks: [
          box(copy).width,
          box(command).width,
          box(copy).left - box(badge).left,
          box(command).left - box(copy).right,
        ],
        closedFaq: box(faq.querySelectorAll('details')[1]).height,
        faqWidth: box(faq.querySelector('details')!).width,
        faqPitch:
          box(faq.querySelectorAll('details')[1]).left - box(faq.querySelector('details')!).left,
        graphic: [box(graph).left, box(graph).top - box(hero.querySelector('h1')!).top],
        hexes: hexes.map((el) => [box(el).left, box(el).top - box(community).top, box(el).width]),
        bandPadding: [quick, community].map((el) => [
          getComputedStyle(el).paddingBlockStart,
          getComputedStyle(el).paddingBlockEnd,
        ]),
      };
    });
    expect(measured.headingDelta).toBeCloseTo(32, 0);
    expect(measured.introGap).toBe(16);
    expect(measured.contentGap).toBe(32);
    expect(measured.plainGap).toBe(96);
    expect(measured.cardWidths).toEqual([384, 384, 384, 384, 384, 384]);
    expect(measured.cardPitch).toBe(408);
    expect(measured.cardRowGap).toBe(24);
    expect(measured.stageIcons).toEqual([48, 48, 48, 48]);
    expect(new Set(measured.queryHeights).size).toBe(1);
    expect(measured.queryHeader).toBe(40);
    expect(measured.badge).toEqual([40, 46]);
    expect(measured.tracks).toEqual([528, 580, 68, 24]);
    expect(measured.closedFaq).toBe(64);
    expect(measured.faqWidth).toBe(584);
    expect(measured.faqPitch).toBe(616);
    expect(measured.graphic[0]).toBe(820);
    expect(measured.graphic[1]).toBeCloseTo(10, 0);
    expect(measured.hexes).toEqual([
      [1180, 30, 64],
      [1250, 90, 40],
      [1160, 110, 32],
    ]);
    expect(measured.bandPadding).toEqual([
      ['64px', '64px'],
      ['64px', '64px'],
    ]);
  });

  for (const palette of ['light', 'dark', 'cream', 'navy']) {
    test(`colour roles in ${palette}`, async ({page}) => {
      await open(page, 1440, palette);
      const roles = await page.evaluate(() => {
        const section = (id: string) => document.querySelector(`section[aria-labelledby="${id}"]`)!;
        const colour = (el: Element, role: string) => {
          const probe = document.createElement('span');
          probe.style.color = `var(${role})`;
          el.append(probe);
          const expected = getComputedStyle(probe).color;
          probe.remove();
          return {actual: getComputedStyle(el).color, expected};
        };
        return {
          kicker: colour(section('landing-how').querySelector('p')!, '--dbs-text-kicker'),
          codeKicker: colour(section('landing-quick').querySelector('p')!, '--dbs-code-accent'),
          accent: colour(
            document.querySelector('#landing-title span:last-child')!,
            '--dbs-text-accent-display',
          ),
          band: getComputedStyle(section('landing-facts')).backgroundColor,
        };
      });
      expect(roles.kicker.actual).toBe(roles.kicker.expected);
      expect(roles.codeKicker.actual).toBe(roles.codeKicker.expected);
      expect(roles.accent.actual).toBe(roles.accent.expected);
      expect(roles.band).toBe(palette === 'dark' ? 'rgb(22, 27, 34)' : 'rgb(15, 17, 23)');
    });
  }
});

test('expanded translated copy reflows without overlapping facts or query content', async ({
  page,
}) => {
  await open(page, 320);
  await page.evaluate(() => {
    document.querySelector('#landing-facts')!.textContent =
      'Aktueller Stand dieser Veröffentlichung';
    const header = document.querySelector('[data-kind="Query"] > div')!;
    header.querySelector('span')!.textContent =
      'Wie hoch ist das aktuell verfügbare Guthaben einer beliebigen Adresse in dieser Datenbank?';
  });
  const layout = await page.evaluate(() => {
    const facts = document.querySelector('#landing-facts')!;
    const link = facts.parentElement!.querySelector('a')!;
    const range = document.createRange();
    range.selectNodeContents(facts);
    const f = range.getBoundingClientRect();
    const l = link.getBoundingClientRect();
    const header = document.querySelector('[data-kind="Query"] > div')!;
    const title = header.querySelector('span')!;
    const t = title.getBoundingClientRect();
    const sql = header.nextElementSibling!.getBoundingClientRect();
    return {
      factsOverlap: f.left < l.right && f.right > l.left && f.top < l.bottom && f.bottom > l.top,
      titleBottom: t.bottom,
      sqlTop: sql.top,
    };
  });
  expect(layout.factsOverlap).toBe(false);
  expect(layout.titleBottom).toBeLessThanOrEqual(layout.sqlTop);
});

test('standalone FAQ keeps space above the footer', async ({page}) => {
  await open(page, 1440);
  await page.goto(new URL('faq', test.info().project.use.baseURL ?? SITE_URL).href);
  await page.locator('#faq-title').waitFor();
  const padding = await page
    .locator('main section')
    .last()
    .evaluate((el) => getComputedStyle(el).paddingBlockEnd);
  expect(padding).toBe('96px');
});

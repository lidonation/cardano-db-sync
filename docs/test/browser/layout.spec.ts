import AxeBuilder from '@axe-core/playwright';
import {expect, test, type Page} from '@playwright/test';

import {LAYOUT_URL, SITE_URL} from '../../playwright.config';

import {smallTargets} from './audits';

/**
 * B34 — the responsive chrome and docs layout (NAV-1..4, CONTENT-3, DF-6, DF-7), run against the
 * fixture docs (sections and a long page with a table of contents) and the real docs.
 */
const PAGE = `${LAYOUT_URL}/getting-started/installation`;
const INTRO = `${SITE_URL}docs/intro`;

/** DF-7: one width inside each tier, plus the tier edges that are easiest to get wrong. */
const TIERS = [
  {width: 375, tier: 'xs', margin: 16, sidebar: 0, toc: false, links: false},
  {width: 768, tier: 'sm', margin: 32, sidebar: 200, toc: false, links: false},
  {width: 1023, tier: 'sm', margin: 32, sidebar: 200, toc: false, links: false},
  {width: 1024, tier: 'md', margin: 48, sidebar: 240, toc: false, links: false},
  {width: 1279, tier: 'md', margin: 48, sidebar: 240, toc: false, links: false},
  {width: 1280, tier: 'lg', margin: 48, sidebar: 240, toc: true, links: true},
  {width: 1440, tier: 'lg', margin: 120, sidebar: 240, toc: true, links: true},
] as const;

async function open(page: Page, url: string, width: number, palette = 'light') {
  await page.setViewportSize({width, height: 900});
  await page.goto(url);
  await page.locator('main article').waitFor();
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

const sidebar = (page: Page) => page.getByRole('navigation', {name: 'Docs', exact: true});
const sectionButton = (page: Page) => page.getByRole('button', {name: /On this section/});
const pageButton = (page: Page) => page.getByRole('button', {name: 'On this page'});
const tocColumn = (page: Page) => page.getByRole('complementary', {name: 'On this page'});
const menuButton = (page: Page) => page.getByRole('button', {name: 'Menu'});

test.describe('tiers (DF-7, NAV-2, NAV-3)', () => {
  for (const {width, tier, margin, sidebar: sidebarWidth, toc, links} of TIERS) {
    test(`${tier} at ${width}px`, async ({page}) => {
      await open(page, PAGE, width);
      // the sidebar is a column from 768, a disclosure below
      if (sidebarWidth) {
        await expect(sidebar(page)).toBeVisible();
        await expect(sectionButton(page)).toBeHidden();
        const box = (await sidebar(page).boundingBox())!;
        expect(Math.round(box.width)).toBe(sidebarWidth);
        expect(Math.round(box.x)).toBe(margin);
      } else {
        await expect(sidebar(page)).toBeHidden();
        await expect(sectionButton(page)).toBeVisible();
        const box = (await sectionButton(page).boundingBox())!;
        expect(Math.round(box.x)).toBe(margin);
        expect(Math.round(box.x + box.width)).toBe(width - margin);
      }
      // the table of contents is a column at 1280, a disclosure below
      await expect(tocColumn(page)).toBeVisible({visible: toc});
      await expect(pageButton(page)).toBeVisible({visible: !toc});
      // section links in the bar at 1280, behind Menu below
      await expect(menuButton(page)).toBeVisible({visible: !links});
      await expect(
        page.getByRole('navigation', {name: 'Sections'}).first().getByRole('link', {name: 'Docs'}),
      ).toBeVisible({visible: links});
    });
  }
});

test.describe('version selector placement (DF-7)', () => {
  // DF-7 keeps the version selector on the bar down to 768; below that it moves into Menu.
  for (const width of [1440, 1024, 768, 375]) {
    test(`${width}px`, async ({page}) => {
      await open(page, INTRO, width);
      const header = page.locator('header[data-dbs-component="Navbar / Full"]');
      const bar = header.locator(':scope > div').first();
      await expect(bar.getByRole('link', {name: 'Next'})).toBeVisible({visible: width >= 768});
      if (width < 768) {
        await menuButton(page).click();
        const drawer = page.locator(
          `[id="${await menuButton(page).getAttribute('aria-controls')}"]`,
        );
        await expect(drawer.getByRole('link', {name: 'Next'})).toBeVisible();
      }
    });
  }
});

test.describe('reflow (NAV-3, CONTENT-3)', () => {
  for (const width of [320, 375, 768, 1024, 1440]) {
    test(`nothing scrolls sideways at ${width}px`, async ({page}) => {
      for (const url of [PAGE, INTRO]) {
        await open(page, url, width);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, url).toBeLessThanOrEqual(0);
      }
    });
  }

  // 1279 is the widest column, where the measure cap rather than the grid sets the width
  for (const width of [1024, 1279, 1440]) {
    test(`the reading measure is 65–75ch at ${width}px`, async ({page}) => {
      await open(page, PAGE, width);
      const measure = await page
        .locator('main article p')
        .first()
        .evaluate((paragraph) => {
          // 1ch is the advance of "0" in the paragraph's own font
          const context = document.createElement('canvas').getContext('2d')!;
          context.font = getComputedStyle(paragraph).font;
          return paragraph.getBoundingClientRect().width / context.measureText('0').width;
        });
      expect(measure).toBeGreaterThanOrEqual(65);
      expect(measure).toBeLessThanOrEqual(75);
    });
  }
});

test.describe('44px targets (NAV-4, DF-6)', () => {
  for (const width of [320, 375, 768, 1024, 1440]) {
    test(`at ${width}px, every panel open`, async ({page}) => {
      await open(page, PAGE, width);
      for (const button of [sectionButton(page), pageButton(page)]) {
        if (await button.isVisible()) await button.click();
      }
      if (await menuButton(page).isVisible()) await menuButton(page).click();
      expect(await smallTargets(page)).toEqual([]);
    });
  }
});

test.describe('derived active state (NAV-1)', () => {
  test('a real doc marks its navbar section and its sidebar row', async ({page}) => {
    await open(page, INTRO, 1440);
    const navbar = page.getByRole('navigation', {name: 'Sections'}).first();
    await expect(navbar.getByRole('link', {name: 'Docs'})).toHaveAttribute('aria-current', 'page');
    await expect(sidebar(page).locator('[aria-current="page"]')).toHaveText(['Introduction']);
  });

  test('a page outside the docs sidebar marks no navbar section', async ({page}) => {
    await open(page, PAGE, 1440);
    const navbar = page.getByRole('navigation', {name: 'Sections'}).first();
    await expect(navbar.locator('[aria-current="page"]')).toHaveCount(0);
    await expect(sidebar(page).locator('[aria-current="page"]')).toHaveText(['Installation']);
  });

  test('following a sidebar link moves the current row with no code naming it', async ({page}) => {
    await open(page, PAGE, 1440);
    await sidebar(page).getByRole('link', {name: 'Tuning'}).click();
    await expect(page).toHaveURL(/operations\/tuning$/);
    await expect(sidebar(page).locator('[aria-current="page"]')).toHaveText(['Tuning']);
  });
});

test.describe('disclosures and the drawer (NAV-2)', () => {
  test('"On this section" opens on the current section, collapsed by default', async ({page}) => {
    await open(page, PAGE, 375);
    const button = sectionButton(page);
    await expect(button).toHaveAccessibleName(/On this section:\s*getting started/);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    const panel = page.locator(`#${await button.getAttribute('aria-controls')}`);
    await expect(panel).toBeHidden();
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.getByRole('link', {name: 'Tuning'})).toBeVisible();
    await expect(panel.locator('[aria-current="page"]')).toHaveText(['Installation']);
    await panel.getByRole('link', {name: 'Configuration'}).click();
    await expect(page).toHaveURL(/getting-started\/configuration$/);
    await expect(sectionButton(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('"On this page" lists the headings and closes when one is followed', async ({page}) => {
    await open(page, PAGE, 1024);
    const button = pageButton(page);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    const panel = page.locator(`#${await button.getAttribute('aria-controls')}`);
    await expect(panel.getByRole('link')).toHaveText([
      'Before you start',
      'Hardware',
      'PostgreSQL',
      'Install',
      'Check the sync',
    ]);
    await panel.getByRole('link', {name: 'Install', exact: true}).click();
    await expect(page).toHaveURL(/#install$/);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('the Menu drawer takes focus, and Esc closes it and returns focus', async ({page}) => {
    await open(page, PAGE, 375);
    const menu = menuButton(page);
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    const drawer = page.locator(`#${await menu.getAttribute('aria-controls')}`);
    await expect(drawer).toBeVisible();
    expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    // the preferences that sit in the bar at 1280 are in the drawer below it
    await expect(drawer.getByRole('button', {name: /^Theme: /})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(drawer).toBeHidden();
    await expect(menu).toBeFocused();
  });
});

test.describe('chrome', () => {
  test('the footer is the designed footer, with the configured columns', async ({page}) => {
    await open(page, INTRO, 1440);
    const footer = page.locator('footer[data-dbs-component="Footer"]');
    await expect(footer).toBeVisible();
    await expect(footer.getByRole('link', {name: 'Introduction'})).toBeVisible();
    await expect(footer.getByRole('link', {name: 'Issues'})).toBeVisible();
  });

  test('the chrome sets no inline style attribute, which the CSP would refuse (SEC-2)', async ({
    page,
  }) => {
    await open(page, PAGE, 375);
    for (const button of [sectionButton(page), pageButton(page), menuButton(page)]) {
      await button.click();
    }
    // the stock Prism code block is not B34's chrome and is left out
    await expect(
      page.locator('#__docusaurus [style]:not(.theme-code-block, .theme-code-block *)'),
    ).toHaveCount(0);
  });
});

test.describe('axe, WCAG 2.2 AA', () => {
  for (const palette of ['light', 'dark', 'cream', 'navy']) {
    for (const width of [375, 1024, 1440]) {
      test(`${palette} at ${width}px`, async ({page}) => {
        await open(page, PAGE, width, palette);
        for (const button of [sectionButton(page), pageButton(page)]) {
          if (await button.isVisible()) await button.click();
        }
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

test.describe('review regressions', () => {
  test('mobile navigation keeps the other sections reachable', async ({page}) => {
    await open(page, PAGE, 375);
    const button = sectionButton(page);
    await button.click();
    const panel = page.locator(`[id="${await button.getAttribute('aria-controls')}"]`);
    await panel.getByRole('link', {name: 'Tuning'}).click();
    await expect(page).toHaveURL(/operations\/tuning$/);
    await expect(sectionButton(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('generated category pages retain mobile sidebar navigation', async ({page}) => {
    await page.setViewportSize({width: 375, height: 900});
    await page.goto(`${LAYOUT_URL}/category/operations`);
    await expect(sectionButton(page)).toBeVisible();
    await sectionButton(page).click();
    const panel = page.locator(`[id="${await sectionButton(page).getAttribute('aria-controls')}"]`);
    await panel.getByRole('link', {name: 'Installation'}).click();
    await expect(page).toHaveURL(/getting-started\/installation$/);
  });

  test('the desktop TOC highlights the visible current heading', async ({page}) => {
    await open(page, PAGE, 1440);
    await page.locator('h2#install').evaluate((heading) => {
      window.scrollTo(0, heading.getBoundingClientRect().top + window.scrollY - 120);
    });
    await expect(tocColumn(page).getByRole('link', {name: 'Install', exact: true})).toHaveClass(
      /tocLinkActive/,
    );
  });

  test('a short viewport can scroll the Menu drawer to its controls', async ({page}) => {
    await page.setViewportSize({width: 375, height: 180});
    await page.goto(PAGE);
    await menuButton(page).click();
    const drawer = page.locator(`[id="${await menuButton(page).getAttribute('aria-controls')}"]`);
    const control = drawer.getByRole('button', {name: /^Theme: /});
    await control.scrollIntoViewIfNeeded();
    const box = (await control.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(180);
  });
});

test('resizing closes the drawer without leaving focus on hidden content', async ({page}) => {
  await open(page, PAGE, 375);
  await menuButton(page).click();
  await page.setViewportSize({width: 1440, height: 900});
  await expect(page.locator('header[data-dbs-component="Navbar / Full"] a').first()).toBeFocused();
  await page.setViewportSize({width: 375, height: 900});
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
});

test('blurring a narrow drawer closes it without stealing focus on later resize', async ({
  page,
}) => {
  await open(page, PAGE, 375);
  await menuButton(page).click();
  // An intentional blur at narrow width leaves the nonmodal drawer before any resize.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
  await page.setViewportSize({width: 1440, height: 900});
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test('all language choices remain reachable in a landscape-phone drawer', async ({page}) => {
  await page.setViewportSize({width: 568, height: 320});
  await page.goto(PAGE);
  await menuButton(page).click();
  const drawer = page.locator(`[id="${await menuButton(page).getAttribute('aria-controls')}"]`);
  const language = drawer.locator('.dropdown > [role="button"]');
  await language.focus();
  await page.keyboard.press('Enter');
  const choices = drawer.locator('.dropdown__menu a');
  await expect(choices).toHaveCount(5);
  for (const choice of await choices.all()) {
    await choice.scrollIntoViewIfNeeded();
    await expect(choice).toBeVisible();
    const box = (await choice.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(73);
    expect(box.y + box.height).toBeLessThanOrEqual(320);
  }
});

test('headings outside the configured levels do not reserve an empty TOC', async ({page}) => {
  for (const width of [375, 1440]) {
    await open(page, `${LAYOUT_URL}/reference/filtered-toc`, width);
    await expect(pageButton(page)).toHaveCount(0);
    await expect(tocColumn(page)).toHaveCount(0);
  }
});

test('grown navbar leaves sidebar and TOC focus rings inside their scrollports', async ({page}) => {
  await open(page, PAGE, 1440);
  await page.setViewportSize({width: 1440, height: 400});
  await page.evaluate(() => {
    const sheet = Array.from(document.styleSheets).find((style) =>
      style.href?.startsWith(location.origin),
    )!;
    sheet.insertRule('.navbar {min-block-size: 180px !important;}', sheet.cssRules.length);
    for (const selector of ['nav[aria-label="Docs"]', 'aside[aria-label="On this page"]']) {
      const nav = document.querySelector(selector)!;
      const source = nav.querySelector('li')!;
      for (let count = 0; count < 20; count++) source.parentElement!.append(source.cloneNode(true));
    }
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--dbs-navbar-block-size'),
        ),
      ),
    )
    .toBe(180);
  await page.evaluate(() => scrollTo(0, 400));
  for (const navigation of [sidebar(page), tocColumn(page)]) {
    await expect(navigation).toBeVisible();
    const links = navigation.getByRole('link');
    for (const link of [links.last(), links.first()]) {
      await link.focus();
      await expect
        .poll(() =>
          link.evaluate((node) => {
            const box = node.getBoundingClientRect();
            const parent = node.closest('nav, aside')!;
            const viewport = parent.getBoundingClientRect();
            const style = getComputedStyle(node);
            const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
            const header = document.querySelector('.navbar')!.getBoundingClientRect();
            return (
              box.top - reach >= viewport.top + parent.clientTop - 1 &&
              box.bottom + reach <= viewport.top + parent.clientTop + parent.clientHeight + 1 &&
              box.left - reach >= viewport.left + parent.clientLeft - 1 &&
              box.right + reach <= viewport.left + parent.clientLeft + parent.clientWidth + 1 &&
              viewport.top >= header.bottom &&
              viewport.bottom <= innerHeight
            );
          }),
        )
        .toBe(true);
    }
  }
});

import AxeBuilder from '@axe-core/playwright';
import {expect, test, type Page} from '@playwright/test';

import {LOCALES} from '../../config/i18n';
import {PROFILES, type ProfileName} from '../../config/profiles';
import {PALETTES, type Palette} from '../../src/lib/palette';

/** Functional chrome only. Full published-route recordings live outside the repository. */
const ROUTES = ['', 'docs/intro/', 'updates/', '404.html'] as const;
const CHROME_ROUTES = LOCALES.flatMap((locale) =>
  ROUTES.map((route) => `${locale === 'en' ? '' : locale + '/'}${route}`),
);
const SPACING = [
  '* {line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important;}',
  'p {margin-block-end: 2em !important;}',
];
const STOPS = 'a[href], button, input, select, textarea, summary, [tabindex]';

async function open(page: Page, route = '', palette: Palette = 'light') {
  await page.addInitScript((name) => {
    localStorage.setItem('dbs-palette', name);
    localStorage.setItem('theme', name === 'dark' || name === 'navy' ? 'dark' : 'light');
  }, palette);
  // Docusaurus' static server redirects an explicit 404.html to /404 outside a dev baseUrl.
  // Request a missing URL in the same locale so the actual emitted 404 page is exercised.
  const requestRoute = route.endsWith('404.html')
    ? route.replace(/404\.html$/, '__b43_missing__/')
    : route || './';
  const response = await page.goto(requestRoute);
  if (route.endsWith('404.html')) {
    expect(response?.status()).toBe(404);
    await expect(page.locator('main .hero__title')).toBeVisible();
    await expect(page.locator('#landing-title')).toHaveCount(0);
  }
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-dbs-palette', palette);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('html')).toHaveAttribute('data-has-hydrated', 'true');
}

/** CSSOM models user overrides without bypassing the production style-src policy. */
async function overrideStyles(page: Page, rules: readonly string[]) {
  await page.evaluate(
    (values) => {
      const sheet = Array.from(document.styleSheets).find((style) =>
        style.href?.startsWith(location.origin),
      );
      if (!sheet) throw new Error('No same-origin stylesheet available for user overrides');
      for (const rule of values) sheet.insertRule(rule, sheet.cssRules.length);
    },
    [...rules],
  );
}

/** Check a real keyboard stop, including hit testing against sticky chrome. */
async function focusMeasurement(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const accent = style.getPropertyValue('--dbs-accent-primary').trim();
    const expectedColor = /^#[a-f0-9]{6}$/i.test(accent)
      ? `rgb(${[1, 3, 5].map((index) => parseInt(accent.slice(index, index + 2), 16)).join(', ')})`
      : accent;
    // Client dimensions and outlines are layout pixels; rectangles include CSS zoom.
    const scale = element.offsetWidth ? rect.width / element.offsetWidth : 1;
    const reach =
      Math.max(0, parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth)) * scale;
    const ringClipped: string[] = [];
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const parentStyle = getComputedStyle(ancestor);
      const box = ancestor.getBoundingClientRect();
      const scaleX = ancestor.offsetWidth ? box.width / ancestor.offsetWidth : 1;
      const scaleY = ancestor.offsetHeight ? box.height / ancestor.offsetHeight : 1;
      const left = box.left + ancestor.clientLeft * scaleX;
      const top = box.top + ancestor.clientTop * scaleY;
      const right = left + ancestor.clientWidth * scaleX;
      const bottom = top + ancestor.clientHeight * scaleY;
      if (
        (/^(auto|scroll|hidden|clip)$/.test(parentStyle.overflowX) &&
          (rect.left - reach < left - 1 || rect.right + reach > right + 1)) ||
        (/^(auto|scroll|hidden|clip)$/.test(parentStyle.overflowY) &&
          (rect.top - reach < top - 1 || rect.bottom + reach > bottom + 1))
      )
        ringClipped.push(ancestor.tagName + '.' + ancestor.className);
    }
    const navbar = document.querySelector('.navbar');
    const header = navbar?.getBoundingClientRect();
    const hit = document.elementFromPoint(
      Math.min(innerWidth - 1, Math.max(0, rect.x + rect.width / 2)),
      Math.min(innerHeight - 1, Math.max(0, rect.y + rect.height / 2)),
    );
    return {
      tag: element.tagName,
      skip: element.matches('.dbs-skip-link'),
      ring: {style: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset},
      color: style.outlineColor,
      expectedColor,
      keyboard: element.matches(':focus-visible'),
      ringClipped,
      inView:
        rect.x >= -1 &&
        rect.right <= innerWidth + 1 &&
        rect.top >= -1 &&
        rect.bottom <= innerHeight + 1,
      clear: element.contains(hit) || hit?.contains(element) === true,
      belowHeader:
        !header ||
        navbar?.contains(element) ||
        rect.top >= header.bottom - 1 ||
        rect.bottom <= header.top + 1 ||
        element.matches('.dbs-skip-link'),
      marker: element.getAttribute('data-chrome-stop'),
    };
  });
}

async function tabThrough(page: Page) {
  const count = await page.locator(STOPS).evaluateAll((nodes) => {
    const stops = nodes.filter((node) => {
      const element = node as HTMLElement;
      const style = getComputedStyle(element);
      return (
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        !element.closest('[inert], [hidden]') &&
        style.visibility !== 'hidden' &&
        element.getClientRects().length > 0
      );
    });
    stops.forEach((node, index) => node.setAttribute('data-chrome-stop', String(index)));
    return stops.length;
  });
  expect(count).toBeGreaterThan(2);
  const records = [];
  for (let index = 0; index < count; index++) {
    await page.keyboard.press('Tab');
    const measurement = await focusMeasurement(page);
    expect(measurement.marker, JSON.stringify(measurement)).toBe(String(index));
    expect(measurement.keyboard).toBe(true);
    expect(measurement.ringClipped, JSON.stringify(measurement)).toEqual([]);
    expect(measurement.color).toBe(measurement.expectedColor);
    expect(measurement.ring).toEqual({style: 'solid', width: '2px', offset: '2px'});
    expect(measurement.inView, JSON.stringify(measurement)).toBe(true);
    expect(measurement.clear, JSON.stringify(measurement)).toBe(true);
    expect(measurement.belowHeader, JSON.stringify(measurement)).toBe(true);
    records.push(measurement);
  }
  // Reverse traversal must leave the last stop and reach its predecessor, not a trap.
  await page.keyboard.press('Shift+Tab');
  expect((await focusMeasurement(page)).marker).toBe(String(count - 2));
  await test.info().attach('keyboard-stops.json', {
    body: JSON.stringify(records, null, 2),
    contentType: 'application/json',
  });
}

async function noContentLoss(page: Page, baseline?: readonly string[]) {
  const measurements = await page.evaluate(() => {
    // Stable DOM identity distinguishes duplicate labels without counting hidden copies.
    const identity = (element: Element): string => {
      const segments: string[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        segments.unshift(
          `${node.tagName}:${Array.from(node.parentElement?.children ?? []).indexOf(node)}`,
        );
      }
      return segments.join('/');
    };
    const visible = (element: HTMLElement): boolean => {
      if (
        !element.getClientRects().length ||
        element.closest('[inert], [hidden], [aria-hidden="true"]')
      )
        return false;
      for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse' ||
          Number(style.opacity) === 0 ||
          style.clip !== 'auto' ||
          style.clipPath !== 'none'
        )
          return false;
        if (
          node instanceof HTMLDetailsElement &&
          !node.open &&
          !node.querySelector('summary')?.contains(element)
        )
          return false;
      }
      return true;
    };
    const content: string[] = [];
    for (const root of Array.from(
      document.querySelectorAll<HTMLElement>('main, .navbar, footer'),
    )) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = node.textContent?.replace(/\s+/g, ' ').trim();
        const parent = node.parentElement!;
        if (!text || parent.closest('script, style, svg') || !visible(parent)) continue;
        content.push(
          `text:${identity(parent)}:${Array.from(parent.childNodes).indexOf(node as ChildNode)}:${text}`,
        );
      }
      for (const control of Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, summary, [role="button"], [role="menuitemradio"]',
        ),
      )) {
        if (visible(control))
          content.push(`control:${identity(control)}:${control.getAttribute('aria-label') ?? ''}`);
      }
    }
    const clipped = Array.from(
      document.querySelectorAll<HTMLElement>('main *, .navbar *, footer *'),
    )
      .filter((element) => {
        if (!element.getClientRects().length || element.closest('[inert], [hidden]')) return false;
        const style = getComputedStyle(element);
        if (
          style.visibility === 'hidden' ||
          style.clip !== 'auto' ||
          style.clipPath !== 'none' ||
          !element.textContent?.trim()
        )
          return false;
        // Scrollable code/table regions preserve access. Hidden/clip regions cannot.
        return (
          ((style.overflowY === 'hidden' || style.overflowY === 'clip') &&
            element.scrollHeight > element.clientHeight + 2) ||
          ((style.overflowX === 'hidden' || style.overflowX === 'clip') &&
            element.scrollWidth > element.clientWidth + 2)
        );
      })
      .map((element) => element.outerHTML.slice(0, 140));
    return {
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      clipped,
      content,
    };
  });
  expect(measurements.horizontalOverflow).toBeLessThanOrEqual(2);
  expect(measurements.clipped).toEqual([]);
  await expect(page.locator('main h1')).toBeVisible();
  if (baseline) expect(measurements.content).toEqual(baseline);
  return measurements.content;
}

// A lossless layout must preserve rendered content, not merely DOM textContent.
for (const target of ['text', 'control'] as const) {
  for (const hiding of ['display: none', 'clip-path: inset(50%)'] as const) {
    test(`content-loss oracle rejects newly hidden ${target}: ${hiding}`, async ({page}) => {
      await open(page, 'docs/intro/');
      const selector = target === 'text' ? 'main p' : 'footer a[href]';
      await page
        .locator(selector)
        .first()
        .evaluate((node) => node.setAttribute('data-loss-seed', ''));
      const baseline = await noContentLoss(page);
      await overrideStyles(page, [`[data-loss-seed] {${hiding} !important;}`]);
      await expect(noContentLoss(page, baseline)).rejects.toThrow();
    });
  }
}

async function labelInName(page: Page) {
  const controls = page.locator(
    'a[href], button, summary, [role="button"], [role="menuitemradio"]',
  );
  for (let index = 0; index < (await controls.count()); index++) {
    const control = controls.nth(index);
    if (
      !(await control.isVisible()) ||
      (await control.evaluate((node) => Boolean(node.closest('[inert]'))))
    )
      continue;
    const fragments = await control.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const labels: string[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement!;
        if (parent.closest('[aria-hidden="true"], svg')) continue;
        const style = getComputedStyle(parent);
        if (
          style.visibility === 'hidden' ||
          style.display === 'none' ||
          style.clipPath !== 'none' ||
          style.clip !== 'auto'
        )
          continue;
        const label = node.textContent?.replace(/\s+/g, ' ').trim();
        if (label) labels.push(label);
      }
      return labels;
    });
    if (!fragments.length) continue;
    const escaped = fragments.map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    await expect(control).toHaveAccessibleName(new RegExp(escaped.join('.*'), 'i'));
  }
}

for (const route of CHROME_ROUTES) {
  for (const palette of PALETTES) {
    test(`${route || 'home'} ${palette}: skip, keyboard, named chrome and axe`, async ({page}) => {
      await open(page, route, palette);
      await page.keyboard.press('Tab');
      await expect(page.locator('a.dbs-skip-link')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('main')).toBeFocused();
      if (route.includes('docs/')) {
        const names = await page
          .getByRole('navigation')
          .evaluateAll((nodes) =>
            nodes
              .filter((node) => !node.closest('[inert]'))
              .map((node) => node.getAttribute('aria-label')),
          );
        expect(names.length).toBeGreaterThanOrEqual(2);
        expect(names.every((name) => Boolean(name?.trim()))).toBe(true);
        expect(new Set(names).size).toBe(names.length);
      }
      const profile = (process.env.DBS_BUILT_PROFILE ?? 'dev') as ProfileName;
      await expect(page.locator('footer a[href="' + PROFILES[profile].repoUrl + '"]')).toHaveCount(
        1,
      );
      await open(page, route, palette);
      await tabThrough(page);
      await labelInName(page);
      const results = await new AxeBuilder({page})
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
}

for (const route of ROUTES) {
  for (const width of [375, 1024, 1440]) {
    test(`${route || 'home'} text spacing at ${width}px`, async ({page}) => {
      await page.setViewportSize({width, height: 900});
      await open(page, route);
      const original = await noContentLoss(page);
      await overrideStyles(page, SPACING);
      const spacing = await page
        .locator('main p')
        .first()
        .evaluate((node) => {
          const style = getComputedStyle(node);
          const size = parseFloat(style.fontSize);
          return {
            line: parseFloat(style.lineHeight) / size,
            letter: parseFloat(style.letterSpacing) / size,
            word: parseFloat(style.wordSpacing) / size,
            paragraph: parseFloat(style.marginBlockEnd) / size,
          };
        });
      expect(spacing.line).toBeCloseTo(1.5, 2);
      expect(spacing.letter).toBeCloseTo(0.12, 2);
      expect(spacing.word).toBeCloseTo(0.16, 2);
      expect(spacing.paragraph).toBeCloseTo(2, 2);
      expect(await noContentLoss(page)).toEqual(original);
      const header = await page.evaluate(() => ({
        padding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingBlockStart),
        height: document.querySelector<HTMLElement>('.navbar')!.offsetHeight,
      }));
      expect(header.padding).toBeGreaterThanOrEqual(header.height + 8);
      await test.info().attach('text-spacing.json', {
        body: JSON.stringify({route, width, spacing, header}, null, 2),
        contentType: 'application/json',
      });
      await tabThrough(page);
    });
  }

  test(`${route || 'home'} 200% CSS layout zoom, separate from reflow`, async ({page}) => {
    await open(page, route);
    const original = await noContentLoss(page);
    const initialHeight = await page
      .locator('main h1')
      .evaluate((node) => node.getBoundingClientRect().height);
    // CSS zoom magnifies layout and text. This is not viewport resizing or device pixel ratio,
    // and does not claim to automate the browser's Ctrl+plus toolbar setting.
    await overrideStyles(page, ['html {zoom: 2;}']);
    expect(await page.locator('html').evaluate((node) => getComputedStyle(node).zoom)).toBe('2');
    const zoomedHeight = await page
      .locator('main h1')
      .evaluate((node) => node.getBoundingClientRect().height);
    expect(zoomedHeight / initialHeight).toBeGreaterThanOrEqual(1.9);
    await test.info().attach('layout-zoom.json', {
      body: JSON.stringify(
        {
          route,
          method: 'CSS layout zoom',
          cssZoom: 2,
          viewport: page.viewportSize(),
          initialHeight,
          zoomedHeight,
          ratio: zoomedHeight / initialHeight,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(await noContentLoss(page)).toEqual(original);
    await page.keyboard.press('Tab');
    await expect(page.locator('a.dbs-skip-link')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
  });
}

test('native skip anchor works without JavaScript on docs', async ({browser, baseURL}) => {
  const context = await browser.newContext({javaScriptEnabled: false, baseURL});
  const page = await context.newPage();
  await page.goto('docs/intro/');
  await page.keyboard.press('Tab');
  await expect(page.locator('a.dbs-skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await expect(page).toHaveURL(/#dbs-main-content$/);
  await context.close();
});

test('native skip anchor works without JavaScript on the FAQ', async ({browser, baseURL}) => {
  const context = await browser.newContext({javaScriptEnabled: false, baseURL});
  const page = await context.newPage();
  await page.goto('faq/');
  await page.keyboard.press('Tab');
  await expect(page.locator('a.dbs-skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await expect(page).toHaveURL(/#dbs-main-content$/);
  await context.close();
});

test('client navigation restores the first skip stop', async ({page}) => {
  await open(page);
  await page.locator('main a[href*="docs/intro"]').first().click();
  await expect(page).toHaveURL(/\/docs\/intro\/?$/);
  await expect(page.locator('main')).toHaveAttribute('id', 'dbs-main-content');
  await page.keyboard.press('Tab');
  await expect(page.locator('a.dbs-skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});

for (const height of [400, 900]) {
  test(`mobile navigation disclosure at 375x${height}: Tab, nested Escape and routes`, async ({
    page,
  }) => {
    await page.setViewportSize({width: 375, height});
    await open(page, 'docs/intro/');
    const navbar = page.locator('[data-dbs-component="Navbar / Full"]');
    const trigger = navbar.getByRole('button', {name: 'Menu', exact: true});
    const drawerId = await trigger.getAttribute('aria-controls');
    expect(drawerId).toBeTruthy();
    const drawer = page.locator(`[id="${drawerId}"]`);
    await expect(drawer).toHaveAttribute('hidden', '');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(drawer).not.toHaveAttribute('hidden', '');
    await expect
      .poll(() => drawer.evaluate((node) => node.contains(document.activeElement)))
      .toBe(true);
    // This is a disclosure, not a modal. Tab must eventually reach the page after its controls.
    let leftDrawer = false;
    for (let index = 0; index < 30; index++) {
      const measurement = await focusMeasurement(page);
      expect(measurement.inView, JSON.stringify(measurement)).toBe(true);
      expect(measurement.clear, JSON.stringify(measurement)).toBe(true);
      expect(measurement.ring).toEqual({style: 'solid', width: '2px', offset: '2px'});
      await page.keyboard.press('Tab');
      if (!(await drawer.evaluate((node) => node.contains(document.activeElement)))) {
        leftDrawer = true;
        break;
      }
    }
    expect(leftDrawer).toBe(true);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(drawer).toHaveAttribute('hidden', '');
    const outside = await focusMeasurement(page);
    expect(outside.inView, JSON.stringify(outside)).toBe(true);
    expect(outside.clear, JSON.stringify(outside)).toBe(true);
    expect(outside.belowHeader, JSON.stringify(outside)).toBe(true);
    expect(outside.ring).toEqual({style: 'solid', width: '2px', offset: '2px'});
    await page.keyboard.press('Shift+Tab');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(drawer).not.toHaveAttribute('hidden', '');
    const paletteTrigger = drawer.locator('[data-dbs-component="Theme switcher"] button');
    await paletteTrigger.focus();
    await page.keyboard.press('Enter');
    await expect(drawer.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(paletteTrigger).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveAttribute('hidden', '');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await drawer.evaluate((node) => node.contains(document.activeElement))).toBe(false);
    await trigger.focus();
    await page.keyboard.press('Enter');
    await navbar.locator('a').first().click();
    await expect(page).toHaveURL(test.info().project.use.baseURL!);
    await expect(page.locator('main')).toHaveAttribute('id', 'dbs-main-content');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const newDrawer = page.locator(`[id="${await trigger.getAttribute('aria-controls')}"]`);
    await expect(newDrawer).toHaveAttribute('hidden', '');
    await page.keyboard.press('Tab');
    await expect(page.locator('a.dbs-skip-link')).toBeFocused();
  });
}

test('reduced motion keeps short state feedback and disables smooth scrolling', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await open(page);
  const result = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const button = document.querySelector('[data-dbs-component="Theme switcher"] button')!;
    const style = getComputedStyle(button);
    return {
      scroll: root.scrollBehavior,
      transition: style.transitionDuration,
      property: style.transitionProperty,
    };
  });
  expect(result.scroll).toBe('auto');
  expect(result.property).not.toContain('transform');
  expect(
    result.transition.split(',').every((duration) => {
      const seconds = duration.trim().endsWith('ms')
        ? parseFloat(duration) / 1000
        : parseFloat(duration);
      return seconds >= 0.05 && seconds <= 0.15;
    }),
  ).toBe(true);
  const theme = page.locator(
    '[data-dbs-component="Navbar / Full"] [data-dbs-component="Theme switcher"] button:visible',
  );
  await theme.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(theme).toBeFocused();
});

test('focus measurement rejects an outline clipped by a scrollport', async ({page}) => {
  await open(page, 'docs/intro/');
  const link = page.getByRole('navigation', {name: 'Docs', exact: true}).getByRole('link').first();
  await link.focus();
  await overrideStyles(page, ['nav[aria-label="Docs"] {padding-inline: 0 !important;}']);
  expect((await focusMeasurement(page)).ringClipped.length).toBeGreaterThan(0);
});

test('sticky docs navigation follows an enlarged measured navbar', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 400});
  await open(page, 'docs/intro/');
  await overrideStyles(page, [
    '.navbar {min-block-size: 180px !important;}',
    'main {min-block-size: 2000px;}',
  ]);
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
  const nav = page.getByRole('navigation', {name: 'Docs', exact: true});
  await expect
    .poll(() =>
      nav.evaluate((node) => {
        const header = document.querySelector('.navbar')!.getBoundingClientRect();
        const box = node.getBoundingClientRect();
        return box.top >= header.bottom && box.bottom <= innerHeight;
      }),
    )
    .toBe(true);
  await nav.getByRole('link').first().focus();
  expect((await focusMeasurement(page)).belowHeader).toBe(true);
});

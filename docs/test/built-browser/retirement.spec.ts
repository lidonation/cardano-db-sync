import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import {expect, test} from '@playwright/test';
import {BUILT_HOME} from '../../playwright.built.config';

const manifest = JSON.parse(
  fs.readFileSync(path.resolve('config/route-manifest.json'), 'utf8'),
) as {routes: Record<string, {status: string; redirect?: string}>};
const localeBases = ['', 'ja/', 'es/', 'de/', 'vi/'];

for (const locale of localeBases) {
  test(`every B04 manifest route resolves (${locale || 'en'})`, async ({request}) => {
    for (const [route, entry] of Object.entries(manifest.routes)) {
      const url = new URL(locale + route.slice(1), BUILT_HOME).href;
      const response = await request.get(url);
      expect(response.status(), url).toBe(200);
      if (entry.status === 'retired') {
        const html = await response.text();
        expect(html).toContain('http-equiv="refresh"');
        expect(html).toContain('rel="canonical"');
        expect(
          (await request.get(new URL(locale + entry.redirect!.slice(1), BUILT_HOME).href)).status(),
        ).toBe(200);
      }
    }
  });
}

for (const width of [320, 1440]) {
  test(`retired deep link is a real non-redirecting, accessible 404 at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({width, height: 900});
    const url = new URL('v1/guides/running?from=legacy#section', BUILT_HOME).href;
    const response = await page.goto(url);
    expect(response?.status()).toBe(404);
    await expect(page.locator('main')).toContainText('Documentation for v1 has retired');
    await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
    expect(page.url()).toBe(url);
    const current = page
      .locator('main')
      .getByRole('link', {name: 'Open the nearest current equivalent'});
    expect(
      (await request.get(new URL((await current.getAttribute('href'))!, BUILT_HOME).href)).status(),
    ).toBe(200);
    await expect(
      page.locator('main').getByRole('link', {name: 'Browse archived releases'}),
    ).toHaveAttribute('href', /\/tags$/);
    await current.focus();
    await expect(current).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    expect(
      (
        await new AxeBuilder({page})
          .include('main')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  });
}

test('unknown routes have useful real links and noindex without JavaScript', async ({browser}) => {
  const context = await browser.newContext({javaScriptEnabled: false});
  try {
    const page = await context.newPage();
    expect((await page.goto(new URL('docs/never-existed', BUILT_HOME).href))?.status()).toBe(404);
    await expect(
      page.locator('main').getByRole('link', {name: 'Read the current documentation'}),
    ).toBeVisible();
    await expect(
      page.locator('main').getByRole('link', {name: 'Browse archived releases'}),
    ).toHaveAttribute('href', /\/tags$/);
    await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
    await expect(page.locator('meta[http-equiv="refresh"]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('known retired release gets its verified tag archive, locale and current equivalent', async ({
  page,
}) => {
  expect(
    (await page.goto(new URL('ja/docs/13.3.0.0/guides/running', BUILT_HOME).href))?.status(),
  ).toBe(404);
  await expect(
    page.locator('main').getByRole('link', {name: 'Read the 13.3.0.0 archive'}),
  ).toHaveAttribute('href', /\/tree\/13\.3\.0\.0\/doc$/);
  await expect(
    page.locator('main').getByRole('link', {name: 'Open the nearest current equivalent'}),
  ).toHaveAttribute('href', new URL('ja/docs/guides/running', BUILT_HOME).pathname);
});

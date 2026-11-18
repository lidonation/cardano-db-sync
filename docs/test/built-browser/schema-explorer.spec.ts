import {expect, test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {openPalette} from '../browser/audits';
for (const palette of ['light', 'dark', 'cream', 'navy']) {
  test(`schema diagrams and semantic tables in ${palette}`, async ({page, baseURL}) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openPalette(page, `${new URL(baseURL!).pathname}schema`, 'main h1', 1440, palette);
    await expect(page.getByRole('heading', {name: 'Schema', exact: true})).toBeVisible();
    await expect(page.getByRole('img', {name: 'core schema relationships'})).toBeVisible();
    expect(
      await page
        .locator('svg.schema-erd .schema-node-label')
        .first()
        .evaluate((el) => getComputedStyle(el).fill),
    ).toBe(await page.locator('main').evaluate((el) => getComputedStyle(el).color));
    const results = await new AxeBuilder({page}).include('main').analyze();
    expect(results.violations).toEqual([]);
    await page.setViewportSize({width: 320, height: 900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
test('column anchors, rename continuity, guide links and client navigation work', async ({
  page,
  baseURL,
}) => {
  const base = new URL(baseURL!).pathname;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}schema/ada_pots#column-deposits`);
  await expect(page.locator('#column-deposits_stake')).toContainText('deposits_stake');
  await expect(page.locator('#column-deposits_stake')).toContainText('Renamed from deposits');
  await page.goto(`${base}docs/guides/schema-management`);
  await expect(page.getByRole('heading', {name: 'Schema references'})).toBeVisible();
  await page.locator('main a[href$="schema/schema_version"]').click();
  await expect(page.locator('#column-stage_three')).toBeVisible();
  await expect(page.locator('main')).toContainText('Guides that use this table');
  await expect(page.locator('main a[href$="docs/guides/schema-management"]')).toBeVisible();
  await expect
    .poll(
      async () =>
        (await page.locator('script[type="application/ld+json"]').allTextContents())
          .map((text) => JSON.parse(text))
          .filter((data) => data['@type'] === 'Dataset').length,
    )
    .toBe(1);
  expect(errors).toEqual([]);
});
test('localized fallback is marked English and canonicalizes to the actual English schema', async ({
  page,
  baseURL,
}) => {
  const base = new URL(baseURL!).pathname;
  const response = await page.goto(`${base}ja/schema/tx_out`);
  expect(response?.status()).toBe(200);
  await expect(page.locator('main[lang="en"]')).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    /(?<!\/ja)\/schema\/tx_out\/?$/,
  );
  await expect(page.locator('#column-value')).toBeVisible();
});

// A partial deployment can serve the 404 shell for a URL the client knows. Recover without a loop.
test('a missing static schema article bounds recovery to one native retry', async ({
  page,
  baseURL,
}) => {
  const base = new URL(baseURL!).pathname;
  const missing = await page.request.get(`${base}__missing_schema_artifact__/`);
  expect(missing.status()).toBe(404);
  const html = await missing.text();
  let requests = 0;
  await page.route(`**${base}schema/ada_pots`, async (route) => {
    requests++;
    await route.fulfill({status: 404, contentType: 'text/html', body: html});
  });
  await page.goto(`${base}schema/ada_pots`, {waitUntil: 'networkidle'});
  await expect(page.getByRole('status')).toContainText('Schema content unavailable');
  await expect(page.getByRole('link', {name: 'Open page', exact: true})).toHaveAttribute(
    'href',
    `${base}schema/ada_pots`,
  );
  expect(requests).toBe(2);
});

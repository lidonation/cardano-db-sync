import {expect, test, type Page} from '@playwright/test';
import {BUILT_HOME} from '../../playwright.built.config';

async function expectContent(page: Page, type: string): Promise<void> {
  await expect
    .poll(async () => {
      const values = await page.locator('script[type="application/ld+json"]').allTextContents();
      return values.map((text) => JSON.parse(text)['@type']).sort();
    })
    .toEqual(['BreadcrumbList', type].sort());
  const title = await page.locator('meta[property="og:title"]').getAttribute('content');
  await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute('content', /.+/);
  expect(title).toBeTruthy();
  await expect(page.locator('meta[name="twitter:description"]')).toHaveAttribute('content', /.+/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    new RegExp(`/social/${type}\\.webp$`),
  );
}

for (const locale of ['', 'ja/'])
  test(`metadata reconciles across content types after client navigation (${locale || 'en'})`, async ({
    page,
  }) => {
    await page.goto(new URL(locale + 'docs/guides/installation', BUILT_HOME).href);
    await expectContent(page, 'HowTo');
    await page.getByRole('contentinfo').getByRole('link', {name: 'FAQ', exact: true}).click();
    await expectContent(page, 'FAQPage');
    await page
      .getByRole('navigation', {name: 'Sections'})
      .first()
      .getByRole('link', {name: 'Docs', exact: true})
      .click();
    await expectContent(page, 'WebPage');
    await page
      .getByRole('contentinfo')
      .getByRole('link', {name: 'Introduction', exact: true})
      .click();
    await expectContent(page, 'TechArticle');
    const entities = await page.locator('script[type="application/ld+json"]').allTextContents();
    const entity = entities
      .map((text) => JSON.parse(text))
      .find((item) => item['@type'] === 'TechArticle');
    expect(entity.url).toBe(await page.locator('link[rel="canonical"]').getAttribute('href'));
  });

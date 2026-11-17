import {expect, test} from '@playwright/test';
import {VERSION_HOME} from '../../playwright.versions.config';

const old = new URL('docs/13.3.0.0/guides/running', VERSION_HOME).href;
const current = new URL('docs/guides/running', VERSION_HOME).href;

test('previously published routes emit HTTP 200, canonical and zero-delay no-JS redirects', async ({
  browser,
  request,
}) => {
  const response = await request.get(old);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('http-equiv="refresh" content="0; url=');
  expect(html).toContain('rel="canonical"');
  expect(html).toContain('redirect.js');
  const context = await browser.newContext({javaScriptEnabled: false});
  try {
    const page = await context.newPage();
    await page.goto(old);
    await expect(page).toHaveURL(current);
    await expect(page.locator('main')).toContainText('Running');
  } finally {
    await context.close();
  }
});

test('the same-origin redirect script forwards query and fragment under the built CSP', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|Refused to/.test(message.text()))
      errors.push(message.text());
  });
  await page.goto(`${old}?source=legacy#postgresql-server`);
  await expect(page).toHaveURL(`${current}?source=legacy#postgresql-server`);
  expect(errors).toEqual([]);
});

test('unpublished deep links remain explanatory 404s instead of soft redirects', async ({page}) => {
  const url = new URL('docs/13.3.0.0/not-a-published-page', VERSION_HOME).href;
  expect((await page.goto(url))?.status()).toBe(404);
  await expect(page.locator('main')).toContainText('Documentation for 13.3.0.0 has retired');
  await expect(
    page.locator('main').getByRole('link', {name: 'Read the 13.3.0.0 archive'}),
  ).toHaveAttribute('href', /\/tree\/13\.3\.0\.0\/doc$/);
  expect(page.url()).toBe(url);
  await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
});

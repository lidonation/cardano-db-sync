import {expect, test} from '@playwright/test';

test('systemd guide publishes the correct release credential format', async ({page, baseURL}) => {
  const base = new URL(baseURL!).pathname;
  await page.goto(`${base}docs/guides/ubuntu-systemd`);
  const article = page.locator('main article');
  await expect(article).toContainText('no colons or backslashes');
  await expect(article).toContainText('does not unescape');
  await expect(article).toContainText('socket itself must grant write access');
  await page.goto(`${base}docs/guides/`);
  await page
    .getByRole('link', {name: /Ubuntu systemd service/})
    .first()
    .click();
  await expect(article).toContainText('no colons or backslashes');
});

test('Kubernetes guide publishes compatible image credential guidance', async ({page, baseURL}) => {
  const base = new URL(baseURL!).pathname;
  await page.goto(`${base}docs/guides/kubernetes`);
  const article = page.locator('main article');
  await expect(article).toContainText('no colons or backslashes');
  await expect(article).toContainText('high-entropy password');
});

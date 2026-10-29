import {expect, test} from '@playwright/test';
import {VERSION_HOME} from '../../playwright.versions.config';

test('current optimized and released native guides survive version navigation', async ({page}) => {
  await page.goto(`${VERSION_HOME}docs/next/guides/interesting-queries`);
  await expect(page.locator('html')).toHaveAttribute('data-has-hydrated', 'true');
  await expect(page.locator('main [data-static-guide="guides/interesting-queries"]')).toBeVisible();
  await page.getByRole('button', {name: 'Unreleased', exact: true}).click();
  await page.getByRole('link', {name: '13.6.0.5', exact: true}).click();
  await expect(page).toHaveURL(/\/docs\/guides\/interesting-queries$/);
  await expect(
    page.getByRole('heading', {name: 'Interesting SQL queries', level: 1}),
  ).toBeVisible();
  await expect(page.locator('main [data-static-guide]')).toHaveCount(0);
  await page.getByRole('button', {name: '13.6.0.5', exact: true}).click();
  await page.getByRole('link', {name: 'Unreleased', exact: true}).click();
  await expect(page).toHaveURL(/\/docs\/next\/guides\/interesting-queries$/);
  await expect(page.locator('main [data-static-guide="guides/interesting-queries"]')).toBeVisible();
});

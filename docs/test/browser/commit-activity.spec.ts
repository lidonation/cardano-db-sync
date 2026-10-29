import AxeBuilder from '@axe-core/playwright';
import {expect, test} from '@playwright/test';
import {SITE_URL} from '../../playwright.config';
import {smallTargets} from './audits';

test('commit filters use keyboard, show counts and reject reversed dates', async ({page}) => {
  await page.route('**/assets/data/*.json', (route) =>
    route.fulfill({
      json: {
        status: 'available',
        data: {
          asOf: '2026-06-01',
          entries: [
            {id: 'a'.repeat(40), date: '2025-06-01', subject: 'first'},
            {id: 'b'.repeat(40), date: '2020-07-01', subject: 'initial'},
          ],
        },
      },
    }),
  );
  await page.goto(new URL('ecosystem', test.info().project.use.baseURL ?? SITE_URL).toString());
  const activity = page.getByRole('region', {name: 'Commit activity'});
  const month = activity.getByRole('tab', {name: 'Month'});
  await expect(month).toHaveAttribute('aria-selected', 'true');
  await expect(activity.getByRole('status')).toContainText('0 updates');
  await month.focus();
  await page.keyboard.press('ArrowRight');
  await expect(activity.getByRole('tab', {name: 'Total'})).toBeFocused();
  await expect(activity.getByRole('status')).toContainText('2 updates');
  await expect(activity.locator('li')).toHaveCount(2);
  await expect(activity.getByRole('link', {name: /aaaaaaaa/})).toHaveAttribute(
    'href',
    `https://github.com/IntersectMBO/cardano-db-sync/commit/${'a'.repeat(40)}`,
  );
  await activity.getByRole('tab', {name: 'Custom'}).click();
  await activity.getByLabel('From').fill('2026-06-01');
  await activity.getByLabel('To', {exact: true}).fill('2020-01-01');
  await expect(activity).toContainText('The To date must be on or after the From date.');
  expect((await new AxeBuilder({page}).include('main').analyze()).violations).toEqual([]);
});

test('hostile subjects remain text and the capped list reports the full count', async ({page}) => {
  const entries = Array.from({length: 10}, (_, n) => ({
    id: n.toString(16).padStart(40, '0'),
    date: '2026-06-01',
    subject: n === 0 ? '<img src=x onerror="window.injected=1">' : `commit ${n}`,
  }));
  await page.route('**/assets/data/*.json', (route) =>
    route.fulfill({json: {status: 'available', data: {asOf: '2026-06-01', entries}}}),
  );
  await page.goto(new URL('ecosystem', test.info().project.use.baseURL ?? SITE_URL).toString());
  const activity = page.getByRole('region', {name: 'Commit activity'});
  await expect(activity.getByRole('status')).toContainText('10 updates');
  await expect(activity.getByRole('status')).toContainText('Showing the latest eight');
  await expect(activity.locator('li')).toHaveCount(8);
  expect(await smallTargets(page)).toEqual([]);
  await expect(activity).toContainText('<img src=x onerror="window.injected=1">');
  await expect(activity.locator('img')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as {injected?: number}).injected),
  ).toBeUndefined();
  expect((await new AxeBuilder({page}).include('main').analyze()).violations).toEqual([]);
});

test('empty and unavailable feeds are distinguished', async ({page}) => {
  await page.route('**/assets/data/*.json', (route) =>
    route.fulfill({json: {status: 'available', data: {asOf: '2026-06-01', entries: []}}}),
  );
  await page.goto(new URL('ecosystem', test.info().project.use.baseURL ?? SITE_URL).toString());
  const activity = page.getByRole('region', {name: 'Commit activity'});
  await expect(activity).toContainText('No commits yet in this snapshot.');
  expect((await new AxeBuilder({page}).include('main').analyze()).violations).toEqual([]);
  await page.unrouteAll();
  await page.route('**/assets/data/*.json', (route) =>
    route.fulfill({status: 503, body: 'unavailable'}),
  );
  await page.reload();
  await expect(activity).toContainText('Commit activity is unavailable in this build.');
  await expect(activity.getByRole('status')).toContainText('Unavailable');
  expect((await new AxeBuilder({page}).include('main').analyze()).violations).toEqual([]);
});

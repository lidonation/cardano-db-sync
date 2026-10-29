import {expect, test} from '@playwright/test';

test('static legacy guide retains visible prose and code controls after hydration', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('docs/guides/interesting-queries/');
  await expect(
    page.getByRole('heading', {name: 'Interesting SQL queries', level: 1}),
  ).toBeVisible();
  await expect(page.locator('main pre code').first()).toContainText('PGPASSFILE');
  await expect(page.getByRole('button', {name: /copy code/i}).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('client navigation to a static guide preserves its content', async ({page}) => {
  await page.goto('docs/intro/');
  await page.evaluate(() => {
    (window as Window & {sentinel?: boolean}).sentinel = true;
  });
  await page.getByRole('link', {name: 'Interesting SQL queries'}).first().click();
  expect(await page.evaluate(() => (window as Window & {sentinel?: boolean}).sentinel)).toBe(true);
  await expect(
    page.getByRole('heading', {name: 'Interesting SQL queries', level: 1}),
  ).toBeVisible();
  await expect(page.locator('main pre code').first()).toContainText('PGPASSFILE');
});

const optimized = [
  'building-running',
  'database-encode-decode',
  'docker',
  'installing',
  'interesting-queries',
  'manual-rollbacks',
  'migrations',
  'schema-management',
  'state-snapshot',
  'troubleshooting',
  'upgrading-postgresql',
  'validation',
  'first-queries',
  'kubernetes',
  'monitoring-rollback',
  'pool-metadata',
  'restore-from-snapshot',
  'running',
  'smash-operations',
  'trimming',
  'ubuntu-systemd',
  'installing-with-nix',
];
for (const name of optimized) {
  test(`${name}: server HTML hydrates without errors and keeps content`, async ({page}) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    const response = await page.goto(`docs/guides/${name}/`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('data-has-hydrated', 'true');
    await expect(page.locator('main h1')).toHaveCount(1);
    await expect(page.locator('main [data-static-guide]')).not.toBeEmpty();
    if (await page.locator('main pre').count())
      await expect(page.getByRole('button', {name: /copy code/i}).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

for (const name of optimized) {
  test(`${name}: hydration keeps the server-rendered table of contents`, async ({
    browser,
    page,
  }) => {
    const staticContext = await browser.newContext({javaScriptEnabled: false});
    try {
      const plain = await staticContext.newPage();
      const response = await page.goto(`docs/guides/${name}/`);
      await plain.goto(response!.url());
      const links = (p: typeof page) =>
        p.locator('aside[aria-label="On this page"] a').evaluateAll((nodes) =>
          nodes.map((node) => ({
            text: node.textContent?.trim(),
            href: node.getAttribute('href'),
          })),
        );
      const expected = await links(plain);
      expect(expected.length).toBeGreaterThan(0);
      await expect(page.locator('html')).toHaveAttribute('data-has-hydrated', 'true');
      expect(await links(page)).toEqual(expected);
    } finally {
      await staticContext.close();
    }
  });
}

test('a malformed fetched guide fails safely with a usable recovery link', async ({page}) => {
  await page.goto('docs/intro/');
  const permalink = await page
    .locator('a[href$="/docs/guides/validation"]')
    .first()
    .getAttribute('href');
  await page.route('**/docs/guides/validation', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<div data-static-guide="guides/validation" data-static-permalink="${permalink}"><script>window.__pwned = true</script><p>Injected</p></div>`,
    });
  });
  await page
    .locator('a[href$="/docs/guides/validation"]')
    .first()
    .evaluate((node) => (node as HTMLAnchorElement).click());
  await expect(page.getByRole('alert')).toContainText('Unable to load guide');
  await expect(page.getByRole('link', {name: 'Open guide'})).toHaveAttribute(
    'href',
    /docs\/guides\/validation/,
  );
  expect(
    await page.evaluate(() => (window as Window & {__pwned?: boolean}).__pwned),
  ).toBeUndefined();
});

test('executable links from a fetched guide are rejected', async ({page}) => {
  await page.goto('docs/intro/');
  const link = page.locator('a[href$="/docs/guides/validation"]').first();
  const permalink = await link.getAttribute('href');
  await page.route('**/docs/guides/validation', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<div data-static-guide="guides/validation" data-static-permalink="${permalink}"><p><a href="javascript:window.__pwned=true">Unsafe</a></p></div>`,
    });
  });
  await link.evaluate((node) => (node as HTMLAnchorElement).click());
  await expect(page.getByRole('alert')).toContainText('Unable to load guide');
  await expect(page.getByRole('link', {name: 'Unsafe'})).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as Window & {__pwned?: boolean}).__pwned),
  ).toBeUndefined();
});

test('in-content internal links preserve client-side navigation', async ({page}) => {
  await page.goto('docs/guides/state-snapshot/');
  await expect(page.locator('html')).toHaveAttribute('data-has-hydrated', 'true');
  await page.evaluate(() => {
    (window as Window & {sentinel?: boolean}).sentinel = true;
  });
  await page
    .locator('main article .markdown')
    .getByRole('link', {name: 'Restore from a snapshot'})
    .first()
    .click();
  await expect(
    page.getByRole('heading', {name: 'Restore from a snapshot', level: 1}),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as Window & {sentinel?: boolean}).sentinel)).toBe(true);
});

for (const name of optimized) {
  test(`${name}: client-side navigation retrieves the correct page`, async ({page}) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('docs/intro/');
    await page.evaluate(() => {
      (window as Window & {sentinel?: boolean}).sentinel = true;
    });
    const link = page.locator(`a[href$="/docs/guides/${name}"]`).first();
    await expect(link).toHaveCount(1);
    await link.evaluate((node) => (node as HTMLAnchorElement).click());
    await expect(page.locator(`main [data-static-guide="guides/${name}"]`)).toBeVisible();
    await expect(page.locator('main h1')).toHaveCount(1);
    expect(await page.evaluate(() => (window as Window & {sentinel?: boolean}).sentinel)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}

test('a static guide can be revisited with browser back navigation', async ({page}) => {
  await page.goto('docs/guides/state-snapshot/');
  await expect(page.locator('html')).toHaveAttribute('data-has-hydrated', 'true');
  await page
    .locator('main article .markdown')
    .getByRole('link', {name: 'Restore from a snapshot'})
    .first()
    .click();
  await expect(
    page.getByRole('heading', {name: 'Restore from a snapshot', level: 1}),
  ).toBeVisible();
  await page.goBack();
  await expect(page.locator('main [data-static-guide="guides/state-snapshot"]')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'State Snapshot', level: 1})).toBeVisible();
});

test('the home page does not eagerly request static guide content', async ({page}) => {
  const guideFetches: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'fetch' && request.url().includes('/docs/guides/'))
      guideFetches.push(request.url());
  });
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-has-hydrated', 'true');
  await page.waitForTimeout(1000);
  expect(guideFetches).toEqual([]);
});

for (const name of optimized) {
  test(`${name}: hydrated content matches server-rendered content`, async ({browser, page}) => {
    const staticContext = await browser.newContext({javaScriptEnabled: false});
    try {
      const plain = await staticContext.newPage();
      const response = await page.goto(`docs/guides/${name}/`);
      await plain.goto(response!.url());
      const text = (p: typeof page) =>
        p.locator('main [data-static-guide]').evaluate((node) => {
          const copy = node.cloneNode(true) as HTMLElement;
          copy.querySelectorAll('button').forEach((button) => button.remove());
          return copy.textContent?.replace(/\s+/g, ' ').trim();
        });
      const expected = await text(plain);
      await expect(page.locator('html')).toHaveAttribute('data-has-hydrated', 'true');
      await expect.poll(() => text(page)).toBe(expected);
    } finally {
      await staticContext.close();
    }
  });
}

test('sidebar prefetch does not fetch guide HTML before interaction', async ({page}) => {
  const guideFetches: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'fetch' && request.url().includes('/docs/guides/'))
      guideFetches.push(request.url());
  });
  await page.goto('docs/intro/');
  await expect(page.locator('html')).toHaveAttribute('data-has-hydrated', 'true');
  await page.waitForTimeout(1200);
  expect(guideFetches).toEqual([]);
});

test('ordinary homepage does not request guide reconstruction chunks', async ({page}) => {
  const chunks: string[] = [];
  page.on('request', (request) => {
    if (/\/(?:static-guide|guide-metadata)\.[a-f0-9]+\.js/.test(request.url()))
      chunks.push(request.url());
  });
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-has-hydrated', 'true');
  await page.waitForTimeout(1200);
  expect(chunks).toEqual([]);
});

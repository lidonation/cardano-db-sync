import {readFile} from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import {expect, test} from '@playwright/test';

import {LOCALES} from '../../config/i18n';

// Exercise the production index and shared worker under the actual site's CSP, rather than
// only the synthetic version-isolation fixture. No search UI ships in this headless layer.
for (const locale of LOCALES) {
  test(`built prose search resolves ${locale} results under the shipped CSP`, async ({
    page,
    baseURL,
  }) => {
    const errors: string[] = [];
    const searchRequests: string[] = [];
    let workers = 0;
    page.on('worker', () => workers++);
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.includes('/pagefind/'))
        searchRequests.push(request.url());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const violations: string[] = [];
      Object.assign(window, {proseCspViolations: violations});
      document.addEventListener('securitypolicyviolation', (event) => {
        violations.push(`${event.effectiveDirective}: ${event.blockedURI}`);
      });
    });
    const localeBase = `${new URL(baseURL!).pathname}${locale === 'en' ? '' : `${locale}/`}`;
    const helperUrl = `${localeBase}__prose-test-helper.js`;
    const source = await readFile(path.resolve('src/search/prose.ts'), 'utf8');
    await page.route(`**${helperUrl}`, (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: ts.transpileModule(source, {
          compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
        }).outputText,
      }),
    );
    await page.goto(`${localeBase}docs/intro/`);
    expect(searchRequests).toEqual([]);
    const result = await page.evaluate(
      async ({helperUrl, localeBase}) => {
        const helper = await import(/* webpackIgnore: true */ helperUrl);
        const bundle = `${localeBase}pagefind/current/`;
        const api = await helper.loadProseApi(bundle);
        const first = await helper.searchProse(api, bundle, 'tx_out');
        const second = await helper.searchProse(api, bundle, 'tx_out');
        const migrated = await helper.searchProse(api, bundle, 'cexplorer database table');
        const natural = await helper.searchProse(api, bundle, 'how do I prune tx_out?');
        await api.destroy();
        return {
          first,
          second,
          migrated,
          natural,
          violations: (window as unknown as {proseCspViolations: string[]}).proseCspViolations,
        };
      },
      {helperUrl, localeBase},
    );
    expect(workers).toBe(1);
    expect(searchRequests.length).toBeGreaterThan(0);
    expect(result.first.length).toBeGreaterThan(0);
    expect(result.second).toEqual(result.first);
    expect(
      result.migrated.some((item: {url: string}) =>
        item.url.includes('/guides/interesting-queries'),
      ),
    ).toBe(true);
    if (locale === 'en') {
      expect(result.natural[0]?.url).toContain('/guides/trimming');
      expect(result.natural[0]?.excerpt.toLowerCase()).toMatch(/prun/);
    }
    for (const item of result.first) {
      expect(item.url.startsWith(`${localeBase}docs/`)).toBe(true);
      expect(item.excerpt.length).toBeGreaterThan(0);
    }
    const response = await page.request.get(result.first[0].url);
    expect(response.ok()).toBe(true);
    expect(result.violations).toEqual([]);
    expect(errors).toEqual([]);
  });
}

// Exercise the worker shipped by the built site directly: do not inject ranking code.
test('published worker ranks the natural pruning question', async ({page, baseURL}) => {
  const base = new URL(baseURL!).pathname;
  await page.goto(`${base}docs/intro/`);
  const results = await page.evaluate(async (base) => {
    const worker = new Worker(`${base}pagefind/_runtime/prose-worker.js`, {type: 'module'});
    let id = 0;
    const call = (method: string, query?: string) =>
      new Promise<Array<{url: string; excerpt: string}>>((resolve, reject) => {
        const requestId = id++;
        const timer = setTimeout(() => reject(new Error('worker timed out')), 30_000);
        worker.addEventListener('message', function receive({data}) {
          if (data.id !== requestId) return;
          worker.removeEventListener('message', receive);
          clearTimeout(timer);
          if (data.error) reject(new Error(data.error));
          else resolve(data.results ?? []);
        });
        worker.postMessage({
          id: requestId,
          method,
          query,
          options: {basePath: `${base}pagefind/current/`, baseUrl: '/', language: 'en'},
        });
      });
    try {
      await call('init');
      return await call('search', 'how do I prune tx_out?');
    } finally {
      worker.terminate();
    }
  }, base);
  expect(results[0]?.url).toContain('/guides/trimming');
  expect(results[0]?.excerpt.toLowerCase()).toMatch(/prun/);
});

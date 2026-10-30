import {test, expect} from '@playwright/test';
import {indexVersions} from '../../plugins/pagefind-prose';
import {mkdtemp, mkdir, readFile, rm, writeFile, access, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer, type Server} from 'node:http';
import {once} from 'node:events';
import ts from 'typescript';
import {gzipSync} from 'node:zlib';

let root: string;
let server: Server;
let origin: string;

test.beforeAll(async () => {
  const pagefind = await import('pagefind');
  root = await mkdtemp(path.join(tmpdir(), 'prose-index-'));
  for (const [version, text] of [
    ['v1', 'Prune tx_out safely with the snapshot procedure.'],
    ['v2', 'Zebraquartz is available exclusively in this newer guide.'],
    ['v3', 'Third version content.'],
    ['v4', 'Fourth version content.'],
    ['v5', 'Fifth version content.'],
  ]) {
    const dir = path.join(root, 'docs', version, 'guide');
    await mkdir(dir, {recursive: true});
    await writeFile(
      path.join(dir, 'index.html'),
      `<html lang="en"><body><nav>Navigationonlyquartz</nav><article><div class="markdown"><h1>Database guide</h1><h2 id="pruning">Pruning</h2><p>${text}</p></div></article></body></html>`,
    );
  }
  try {
    await indexVersions({
      outDir: root,
      baseUrl: '/preview/ja/',
      versions: ['v1', 'v2', 'v3', 'v4', 'v5'].map((versionName) => ({
        versionName,
        docs: [{permalink: `/preview/ja/docs/${versionName}/guide`}],
      })),
      create: () => pagefind.createIndex({rootSelector: 'article .markdown'}),
      read: (file) => readFile(file, 'utf8'),
    });
  } finally {
    await pagefind.close();
  }
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        `<html lang="en"><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'"></head></html>`,
      );
      return;
    }
    if (pathname === '/helper.js') {
      const source = await readFile(path.resolve('src/search/prose.ts'), 'utf8');
      res.setHeader('Content-Type', 'text/javascript');
      res.end(
        ts.transpileModule(source, {
          compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
        }).outputText,
      );
      return;
    }
    const relative = pathname.startsWith('/preview/ja/')
      ? pathname.slice('/preview/ja'.length)
      : pathname;
    const file = path.resolve(root, `.${decodeURIComponent(relative)}`);
    if (!file.startsWith(`${root}${path.sep}`)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const data = await readFile(file);
      const extension = path.extname(file);
      res.setHeader(
        'Content-Type',
        extension === '.js'
          ? 'text/javascript'
          : extension === '.wasm'
            ? 'application/wasm'
            : 'application/octet-stream',
      );
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port');
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) {
    server.close();
    await once(server, 'close');
  }
  if (root) await rm(root, {recursive: true, force: true});
});

test('real headless search preserves identifiers, excerpts, deep links and version isolation', async ({
  page,
}) => {
  await expect(access(path.join(root, 'pagefind/v1/pagefind-ui.js'))).rejects.toThrow();
  await page.goto(origin);
  const results = await page.evaluate(async () => {
    const helperUrl = '/helper.js';
    const helper = await import(/* webpackIgnore: true */ helperUrl);
    const base = '/preview/ja/pagefind/';
    const api = await helper.loadProseApi(`${base}v1/`);
    const search = (version: string, query: string) =>
      helper.searchProse(api, `${base}${version}/`, query);
    return {
      prose: await search('v1', 'how do I prune tx_out?'),
      whole: await search('v1', 'tx_out'),
      split: await search('v1', 'tx'),
      absent: await search('v1', 'zebraquartz'),
      naturalV2: await search('v2', 'how do I prune tx_out?'),
      navigation: await search('v1', 'Navigationonlyquartz'),
      present: await search('v2', 'zebraquartz'),
      concurrent: await Promise.all([search('v1', 'tx_out'), search('v2', 'zebraquartz')]),
    };
  });
  expect(results.prose).toHaveLength(1);
  expect(results.prose[0].excerpt).toContain('tx_out');
  expect(results.prose[0].url).toBe('/preview/ja/docs/v1/guide');
  expect(
    results.prose[0].sub_results.some((item: {url: string}) => item.url.endsWith('#pruning')),
  ).toBe(true);
  expect(results.whole).toHaveLength(1);
  expect(results.split).toHaveLength(1);
  expect(results.absent).toHaveLength(0);
  expect(
    results.naturalV2.every((item: {url: string}) => item.url.startsWith('/preview/ja/docs/v2/')),
  ).toBe(true);
  expect(results.naturalV2).toHaveLength(1);
  expect(results.navigation).toHaveLength(0);
  expect(results.present).toHaveLength(1);
  expect(results.concurrent[0][0].url).toBe('/preview/ja/docs/v1/guide');
  expect(results.concurrent[1][0].url).toBe('/preview/ja/docs/v2/guide');
});

test('identical source regenerates byte-identical headless bundles', async () => {
  const second = await mkdtemp(path.join(tmpdir(), 'prose-repeat-'));
  const pagefind = await import('pagefind');
  async function snapshot(dir: string, prefix = ''): Promise<Array<[string, string]>> {
    const result: Array<[string, string]> = [];
    for (const entry of await readdir(dir, {withFileTypes: true})) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory())
        result.push(...(await snapshot(path.join(dir, entry.name), `${name}/`)));
      else result.push([name, (await readFile(path.join(dir, entry.name))).toString('base64')]);
    }
    return result.sort(([a], [b]) => a.localeCompare(b));
  }
  try {
    await indexVersions({
      outDir: second,
      baseUrl: '/preview/ja/',
      versions: ['v1', 'v2', 'v3', 'v4', 'v5'].map((versionName) => ({
        versionName,
        docs: [{permalink: `/preview/ja/docs/${versionName}/guide`}],
      })),
      create: () => pagefind.createIndex({rootSelector: 'article .markdown'}),
      read: (file) => readFile(file.replace(second, root), 'utf8'),
    });
    const files = await snapshot(path.join(second, 'pagefind'));
    expect(files).toEqual(await snapshot(path.join(root, 'pagefind')));
    const jsBytes = files
      .filter(([name]) => name.endsWith('.js'))
      .reduce((total, [, encoded]) => total + gzipSync(Buffer.from(encoded, 'base64')).length, 0);
    expect(jsBytes).toBeLessThan(11 * 1024);
    expect(files.filter(([name]) => name.endsWith('/pagefind.js'))).toHaveLength(1);
  } finally {
    await pagefind.close();
    await rm(second, {recursive: true, force: true});
  }
});

test('a missing bundle rejects and a valid bundle can recover', async ({page}) => {
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const helperUrl = '/helper.js';
    const helper = await import(/* webpackIgnore: true */ helperUrl);
    const base = '/preview/ja/pagefind/';
    const api = await helper.loadProseApi(`${base}v1/`);
    let failure = '';
    try {
      await helper.searchProse(api, `${base}missing/`, 'tx_out');
    } catch (error) {
      failure = String(error);
    }
    const results = await helper.searchProse(api, `${base}v1/`, 'tx_out');
    await api.destroy();
    return {failure, results};
  });
  expect(result.failure).not.toBe('');
  expect(result.results).toHaveLength(1);
  expect(result.results[0].url).toBe('/preview/ja/docs/v1/guide');
});

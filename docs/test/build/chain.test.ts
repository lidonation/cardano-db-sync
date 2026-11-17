import {execFile} from 'node:child_process';
import {readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {promisify} from 'node:util';
import {chromium, expect as browserExpect} from '@playwright/test';
import {expect, it} from 'vitest';
import {PROFILES} from '../../config/profiles';
import {epochBoundary, refreshNetwork} from '../../scripts/chain-refresh.mjs';
import {formatNumber} from '../../src/numbers/data';

const root = path.resolve(import.meta.dirname, '../..');
const run = promisify(execFile);

it('builds real committed estimates without keys; hydrates and ages them without provider requests', async () => {
  const now = new Date().toISOString();
  const epoch = Math.floor(
    (Date.parse(now) - Date.parse(epochBoundary('preview', 0))) / 86_400_000,
  );
  const http = (async (url: string) => {
    const value = url.endsWith('/blocks/latest')
      ? {height: 1_000_000, epoch, time: Math.floor(Date.parse(now) / 1000)}
      : url.includes('/previous?')
        ? Array.from({length: 12}, (_, n) => ({
            epoch: epoch - n - 1,
            block_count: 1000,
            tx_count: 20_000,
          }))
        : {epoch, block_count: 10, tx_count: 100};
    return new Response(JSON.stringify(value));
  }) as typeof fetch;
  const result = await refreshNetwork(
    {network: 'preview', key: 'synthetic-fixture', existing: null, now},
    http,
  );
  if (result.status !== 'updated' || !result.snapshot.storage) throw new Error('Fixture missing');
  const snapshot = result.snapshot;
  const storage = result.snapshot.storage;
  const file = path.join(root, 'generated/chain-preview.json');
  const previous = await readFile(file, 'utf8');
  const output = path.join(root, 'build/chain-integration');
  const env: NodeJS.ProcessEnv = {...process.env, ROADMAP_OFFLINE: '1'};
  delete env.BLOCKFROST_MAINNET_PROJECT_ID;
  delete env.BLOCKFROST_PREVIEW_PROJECT_ID;
  try {
    await writeFile(file, JSON.stringify(snapshot));
    await run('npm', ['run', 'build:dev', '--', '--locale', 'en', '--out-dir', output], {
      cwd: root,
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
    const html = await readFile(path.join(output, 'numbers/index.html'), 'utf8');
    expect(html).toContain('MODELLED ESTIMATES');
    expect(html).toContain('Blockfrost (preview)');
    expect(html).toContain('Transactions this epoch');
    expect(html).toContain('uncalibrated');
    expect(html).toContain(formatNumber(storage.databaseGB));
    const mime: Record<string, string> = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
    };
    const server = createServer(async (request, response) => {
      try {
        const name = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (!name.startsWith(PROFILES.dev.baseUrl)) throw new Error('Outside base URL');
        const relative = name.slice(PROFILES.dev.baseUrl.length);
        const target = path.resolve(
          output,
          relative.endsWith('/') ? `${relative}index.html` : relative,
        );
        if (!target.startsWith(`${output}${path.sep}`)) throw new Error('Outside build');
        response.setHeader('Content-Type', mime[path.extname(target)] ?? 'text/html');
        response.end(await readFile(target));
      } catch {
        response.writeHead(404);
        response.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server');
    const origin = `http://127.0.0.1:${address.port}`;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      browser = await chromium.launch();
      const page = await browser.newPage();
      const errors: string[] = [];
      const requests: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('request', (request) => {
        if (!request.url().startsWith(origin)) requests.push(request.url());
      });
      await page.clock.install({time: new Date(now)});
      await page.goto(`${origin}${PROFILES.dev.baseUrl}numbers/`);
      // Finish the real hydration chunk before advancing timers; jumping early would also
      // expire webpack's pending chunk-request timeout instead of testing snapshot expiry.
      await page.waitForLoadState('networkidle');
      const main = page.getByRole('main');
      await browserExpect(main).toContainText('MODELLED ESTIMATES');
      await browserExpect(main).toContainText(formatNumber(storage.databaseGB));
      await browserExpect(main).not.toContainText('Stale snapshot:');
      await page.clock.fastForward(Date.parse(snapshot.nextBoundary) - Date.parse(now) + 1);
      await browserExpect(main).toContainText('Stale snapshot:');
      await browserExpect(main).toContainText(formatNumber(storage.databaseGB));
      expect(errors).toEqual([]);
      expect(requests).toEqual([]);
    } finally {
      await browser?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    await writeFile(file, previous);
    await rm(output, {recursive: true, force: true});
  }
});

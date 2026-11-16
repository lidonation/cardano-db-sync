#!/usr/bin/env node
/**
 * `npm run start:all-locales` — every configured locale on one dev URL, with live reload.
 *
 * `docusaurus start` serves a single locale per server. This runs one `docusaurus start --locale
 * <locale>` per locale on a free loopback port and puts a small proxy on the public port: a path
 * under a locale's base URL (`/ja/…`) goes to that locale's server, everything else to the
 * default locale's. WebSocket upgrades are routed the same way; the environment plugin moves each
 * server's hot-reload socket under its own base URL (`/ja/ws`) when `DOCS_DEV_ALL_LOCALES=1`, so
 * HMR reaches the right server. Locales and their base URLs come from the site config itself, as
 * Docusaurus resolves them (the `DOCS_DEV_BASE_URL` override included).
 *
 * Ctrl+C (or SIGTERM/SIGHUP) stops every server. If one server exits on its own, the runner
 * names it, stops the others and exits non-zero.
 *
 * Usage: node scripts/start-all-locales.mjs [--host 0.0.0.0] [--port 3003] [--locales en,ja]
 */
import {spawn} from 'node:child_process';
import http from 'node:http';
import {createRequire} from 'node:module';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import {setTimeout} from 'node:timers';
import {setTimeout as delay} from 'node:timers/promises';
import {parseArgs} from 'node:util';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

/** Matches the environment plugin's `ALL_LOCALES_ENV_VAR`. */
export const ALL_LOCALES_ENV_VAR = 'DOCS_DEV_ALL_LOCALES';

/** How long a stopped server gets to exit before it is killed. */
export const STOP_GRACE_MS = 5000;

/**
 * @typedef {{locale: string, baseUrl: string, port: number}} LocaleServer
 * @typedef {{host: string, port: number, locales: string[] | undefined}} Options
 */

/**
 * @param {string[]} argv
 * @returns {Options}
 */
export function parseOptions(argv) {
  const {values} = parseArgs({
    args: argv,
    options: {
      host: {type: 'string', default: 'localhost'},
      port: {type: 'string', default: '3000'},
      locales: {type: 'string'},
    },
    strict: true,
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`--port must be a TCP port number, got "${values.port}".`);
  }
  const locales = values.locales
    ?.split(',')
    .map((l) => l.trim())
    .filter(Boolean);
  return {host: values.host, port, locales: locales?.length ? locales : undefined};
}

/**
 * The servers to run: every locale (or the requested subset), default first, each with the base
 * URL Docusaurus gives it.
 *
 * @param {{defaultLocale: string, locales: string[], localeConfigs: Record<string, {baseUrl: string}>}} i18n
 * @param {string[] | undefined} only
 * @returns {{locale: string, baseUrl: string}[]}
 */
export function planLocales(i18n, only) {
  const unknown = (only ?? []).filter((l) => !i18n.locales.includes(l));
  if (unknown.length) {
    throw new Error(
      `Unknown locale(s): ${unknown.join(', ')}. Configured: ${i18n.locales.join(', ')}.`,
    );
  }
  const wanted = new Set(only ?? i18n.locales);
  // The default locale serves every path no other locale claims, so it always runs.
  wanted.add(i18n.defaultLocale);
  const ordered = [i18n.defaultLocale, ...i18n.locales.filter((l) => l !== i18n.defaultLocale)];
  const plan = ordered
    .filter((l) => wanted.has(l))
    .map((locale) => ({locale, baseUrl: i18n.localeConfigs[locale].baseUrl}));
  const seen = new Map();
  for (const {locale, baseUrl} of plan) {
    if (seen.has(baseUrl)) {
      throw new Error(
        `Locales ${seen.get(baseUrl)} and ${locale} share the base URL ${baseUrl}; one origin cannot serve both.`,
      );
    }
    seen.set(baseUrl, locale);
  }
  return plan;
}

/**
 * The server for a request path: the locale with the longest base URL the path is under (or the
 * base URL without its trailing slash, `/ja`), else the default locale, which is listed first.
 *
 * @template {{baseUrl: string}} T
 * @param {string} url Request target, path plus optional query.
 * @param {T[]} servers Default locale first.
 * @returns {T}
 */
export function pickServer(url, servers) {
  const pathname = url.split(/[?#]/, 1)[0];
  let best = servers[0];
  for (const server of servers.slice(1)) {
    const base = server.baseUrl;
    const under = pathname.startsWith(base) || pathname === base.slice(0, -1);
    if (under && base.length > best.baseUrl.length) best = server;
  }
  return best;
}

/**
 * Each locale server's own generated-files directory, inside `.docusaurus` so the existing
 * ignores and `npm run clear` cover it.
 *
 * @param {string} locale
 */
export function generatedFilesDir(locale) {
  return path.join('.docusaurus', 'all-locales', locale);
}

/** A free TCP port on the loopback interface. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const {port} = /** @type {net.AddressInfo} */ (probe.address());
      probe.close(() => resolve(port));
    });
  });
}

/**
 * The public proxy: plain HTTP and WebSocket upgrades to the locale server that owns the path.
 *
 * @param {LocaleServer[]} servers Default locale first.
 * @param {{target?: string}} [options] Host the locale servers listen on.
 */
export function createLocaleProxy(servers, {target = '127.0.0.1'} = {}) {
  const proxy = http.createServer((req, res) => {
    const server = pickServer(req.url ?? '/', servers);
    const upstream = http.request(
      {host: target, port: server.port, method: req.method, path: req.url, headers: req.headers},
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.rawHeaders);
        upstreamRes.pipe(res);
      },
    );
    upstream.on('error', (error) => {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      res.writeHead(502, {'content-type': 'text/plain; charset=utf-8'});
      res.end(
        `The ${server.locale} dev server is not answering (${/** @type {NodeJS.ErrnoException} */ (error).code ?? error.message}). It may still be starting.\n`,
      );
    });
    req.pipe(upstream);
  });

  proxy.on('upgrade', (req, socket, head) => {
    const server = pickServer(req.url ?? '/', servers);
    const upstream = net.connect(server.port, target, () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
  });

  return proxy;
}

/**
 * Prefix every complete line of a stream with a tag, holding a partial line until it ends.
 *
 * @param {string} tag
 * @param {(line: string) => void} write
 */
export function linePrefixer(tag, write) {
  let pending = '';
  return {
    /** @param {Buffer | string} chunk */
    push(chunk) {
      const lines = (pending + chunk.toString()).split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) write(`${tag} ${line}\n`);
    },
    flush() {
      if (pending) write(`${tag} ${pending}\n`);
      pending = '';
    },
  };
}

/**
 * Wait until a dev server answers at its base URL. webpack-dev-middleware holds requests until
 * the first compile finishes, so an answer means the locale is ready.
 *
 * @param {LocaleServer} server
 * @param {{isDone: () => boolean, intervalMs?: number, host?: string}} options
 */
export async function waitForServer(server, {isDone, intervalMs = 1000, host = '127.0.0.1'}) {
  while (!isDone()) {
    try {
      const res = await globalThis.fetch(`http://${host}:${server.port}${server.baseUrl}`);
      await res.body?.cancel();
      if (res.status < 500) return true;
    } catch {
      // Not listening yet.
    }
    await delay(intervalMs);
  }
  return false;
}

/** Load the site config and locales exactly as `docusaurus start` would. */
async function loadLocales(siteDir) {
  const {loadSiteConfig} = require('@docusaurus/core/lib/server/config.js');
  const {loadI18n} = require('@docusaurus/core/lib/server/i18n.js');
  const {siteConfig} = await loadSiteConfig({siteDir});
  const i18n = await loadI18n({
    siteDir,
    config: siteConfig,
    currentLocale: siteConfig.i18n.defaultLocale,
    automaticBaseUrlLocalizationDisabled: false,
  });
  return {siteConfig, i18n};
}

/**
 * @param {{argv?: string[], siteDir?: string, out?: Pick<Console, 'log' | 'error'>}} [options]
 * @returns {Promise<number>} The exit code once every server has stopped.
 */
export async function main({argv = process.argv.slice(2), siteDir = ROOT, out = console} = {}) {
  let options;
  let plan;
  let siteConfig;
  // `docusaurus start` runs its config with NODE_ENV=development; the dev base URL override
  // (DOCS_DEV_BASE_URL) only applies there, so resolve the config the same way.
  process.env.NODE_ENV = 'development';
  process.env.DOCS_PROFILE ??= 'dev';
  try {
    options = parseOptions(argv);
    const loaded = await loadLocales(siteDir);
    siteConfig = loaded.siteConfig;
    plan = planLocales(loaded.i18n, options.locales);
  } catch (error) {
    out.error(`start:all-locales - ${error instanceof Error ? error.message : error}`);
    return 2;
  }

  /** @type {LocaleServer[]} */
  const servers = [];
  for (const entry of plan) servers.push({...entry, port: await freePort()});

  const proxy = createLocaleProxy(servers);
  try {
    await new Promise((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(options.port, options.host, () => resolve(undefined));
    });
  } catch (error) {
    out.error(
      `start:all-locales - cannot listen on ${options.host}:${options.port}: ${error instanceof Error ? error.message : error}`,
    );
    return 2;
  }

  const bin = require.resolve('@docusaurus/core/bin/docusaurus.mjs');
  const color = process.stdout.isTTY ? {FORCE_COLOR: '1'} : {};
  const width = Math.max(...servers.map((s) => s.locale.length));
  let stopping = false;
  let exitCode = 0;
  /** @type {Set<import('node:child_process').ChildProcess>} */
  const running = new Set();
  /** @type {(value?: unknown) => void} */
  let allExited = () => {};
  const done = new Promise((resolve) => (allExited = resolve));

  function stop(reason, code) {
    if (stopping) return;
    stopping = true;
    exitCode = code;
    out.log(`start:all-locales - ${reason}; stopping ${running.size} dev server(s)…`);
    proxy.close();
    proxy.closeAllConnections();
    for (const child of running) signal(child, 'SIGTERM');
    setTimeout(() => {
      for (const child of running) signal(child, 'SIGKILL');
    }, STOP_GRACE_MS).unref();
    if (running.size === 0) allExited();
  }

  /** Each server runs in its own process group, so its workers stop with it. */
  function signal(child, name) {
    try {
      process.kill(-(/** @type {number} */ (child.pid)), name);
    } catch {
      // Already gone.
    }
  }

  for (const server of servers) {
    const tag = `[${server.locale.padEnd(width)}]`;
    const child = spawn(
      process.execPath,
      [
        bin,
        'start',
        '--locale',
        server.locale,
        '--host',
        '127.0.0.1',
        '--port',
        String(server.port),
        '--no-open',
      ],
      {
        cwd: siteDir,
        env: {
          ...process.env,
          ...color,
          [ALL_LOCALES_ENV_VAR]: '1',
          // Every `docusaurus start` writes its routes, i18n and config into the generated-files
          // directory; concurrent servers (or a plain `npm start` alongside) must not share it.
          DOCUSAURUS_GENERATED_FILES_DIR_NAME: generatedFilesDir(server.locale),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      },
    );
    running.add(child);
    const stdout = linePrefixer(tag, (l) => process.stdout.write(l));
    const stderr = linePrefixer(tag, (l) => process.stderr.write(l));
    child.stdout.on('data', (c) => stdout.push(c));
    child.stderr.on('data', (c) => stderr.push(c));
    child.on('error', (error) => {
      out.error(`${tag} could not start docusaurus: ${error.message}`);
    });
    child.on('exit', (code, sig) => {
      stdout.flush();
      stderr.flush();
      running.delete(child);
      if (!stopping) {
        const how = sig ? `was killed by ${sig}` : `exited with code ${code}`;
        out.error(
          `start:all-locales - the ${server.locale} dev server (${server.baseUrl}) ${how}.`,
        );
        stop(`${server.locale} failed`, 1);
      }
      if (stopping && running.size === 0) allExited();
    });
  }

  for (const name of /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP'])) {
    process.on(name, () => stop(`received ${name}`, 0));
  }

  const started = Date.now();
  const ready = await Promise.all(servers.map((s) => waitForServer(s, {isDone: () => stopping})));
  if (ready.every(Boolean) && !stopping) {
    const shownHost = ['0.0.0.0', '::'].includes(options.host) ? 'localhost' : options.host;
    const local = `http://${shownHost}:${options.port}`;
    const lines = [
      '',
      `start:all-locales - ${servers.length} locale(s) ready in ${Math.round((Date.now() - started) / 1000)}s:`,
      ...servers.map((s) => `  ${s.locale.padEnd(width)}  ${local}${s.baseUrl}`),
    ];
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(siteConfig.url)) {
      lines.push(`  Site URL: ${siteConfig.url}${servers[0].baseUrl}`);
    }
    lines.push('  Press Ctrl+C to stop every locale.', '');
    out.log(lines.join('\n'));
  }

  await done;
  return exitCode;
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main();
}

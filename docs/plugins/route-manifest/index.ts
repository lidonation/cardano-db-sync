import fs from 'node:fs/promises';
import path from 'node:path';

import type {LoadContext, Plugin} from '@docusaurus/types';

import {resolveProfile, type BuildProfile} from '../../config/profiles';

/**
 * VER-5 — every route this site has ever published keeps resolving.
 *
 * The record of published routes can only be built forward: a page that retires before it is
 * recorded leaves a permanent 404 and no trace that it existed. So the build writes the manifest,
 * never a person, and it starts before the first public publish (B04).
 *
 * After each build the published routes are reconciled with the committed manifest:
 *   - a route the manifest has never seen is appended as `live`;
 *   - a `live` route that is no longer published becomes `retired`, with a redirect to its nearest
 *     published ancestor, and a redirect page is emitted at the old URL;
 *   - a retired route that is published again goes back to `live`.
 * Entries are never removed. `scripts/check-route-manifest.mjs` fails CI if one is.
 *
 * Paths are relative to `baseUrl`, so both profiles share one manifest. A local build writes the
 * reconciled manifest. Under CI the build only checks, and fails listing every route the committed
 * manifest does not account for, so the manifest that ships is always the one a build wrote.
 */

/** Manifest location, relative to the docs root. */
export const MANIFEST_FILE = 'config/route-manifest.json';

/** Selects write (local) or check (CI) explicitly; otherwise `CI` decides. */
export const MODE_ENV_VAR = 'ROUTE_MANIFEST';

export type ManifestMode = 'write' | 'check';

export type RouteEntry =
  {readonly status: 'live'} | {readonly status: 'retired'; readonly redirect: string};

export interface RouteManifest {
  readonly routes: Readonly<Record<string, RouteEntry>>;
}

export interface Reconciliation {
  readonly manifest: RouteManifest;
  /** Published for the first time. */
  readonly added: readonly string[];
  /** Published before, gone now. */
  readonly retired: readonly string[];
  /** Retired before, published again. */
  readonly revived: readonly string[];
  /** Retired routes whose redirect target is no longer published and had to move. */
  readonly retargeted: readonly string[];
}

const COMMENT =
  'Written by the docs build (plugins/route-manifest), never by hand. Append-only (VER-5): every ' +
  'route ever published stays listed; retired routes redirect.';

export function resolveMode(env: NodeJS.ProcessEnv = process.env): ManifestMode {
  const explicit = env[MODE_ENV_VAR]?.trim();
  if (explicit === 'write' || explicit === 'check') {
    return explicit;
  }
  if (explicit) {
    throw new Error(`${MODE_ENV_VAR}="${explicit}" is not a mode. Expected "write" or "check".`);
  }
  const ci = env.CI?.trim().toLowerCase();
  return ci && ci !== 'false' && ci !== '0' ? 'check' : 'write';
}

/**
 * Turn a Docusaurus route (`<baseUrl>docs/intro`) into a manifest path (`/docs/intro`).
 * Returns null for routes that are not pages, such as the `404.html` fallback.
 */
export function toManifestPath(route: string, baseUrl: string): string | null {
  if (!route.startsWith(baseUrl)) {
    return null;
  }
  const rest = route.slice(baseUrl.length).replace(/\/+$/, '');
  if (rest.endsWith('.html')) {
    return null;
  }
  return `/${rest}`;
}

/** The closest ancestor of `route` that is published, falling back to the site root. */
export function nearestLiveAncestor(route: string, live: ReadonlySet<string>): string {
  const segments = route.split('/').filter(Boolean);
  while (segments.length > 0) {
    segments.pop();
    const candidate = `/${segments.join('/')}`;
    if (live.has(candidate)) {
      return candidate;
    }
  }
  return '/';
}

export function reconcile(manifest: RouteManifest, published: Iterable<string>): Reconciliation {
  const live = new Set(published);
  const routes: Record<string, RouteEntry> = {};
  const added: string[] = [];
  const retired: string[] = [];
  const revived: string[] = [];
  const retargeted: string[] = [];

  for (const [route, entry] of Object.entries(manifest.routes)) {
    if (live.has(route)) {
      if (entry.status === 'retired') {
        revived.push(route);
      }
      routes[route] = {status: 'live'};
      continue;
    }
    if (entry.status === 'live') {
      retired.push(route);
      routes[route] = {status: 'retired', redirect: nearestLiveAncestor(route, live)};
      continue;
    }
    if (!live.has(entry.redirect)) {
      retargeted.push(route);
      routes[route] = {status: 'retired', redirect: nearestLiveAncestor(route, live)};
      continue;
    }
    routes[route] = entry;
  }

  for (const route of live) {
    if (!(route in manifest.routes)) {
      added.push(route);
      routes[route] = {status: 'live'};
    }
  }

  const sorted = Object.fromEntries(
    Object.keys(routes)
      .sort()
      .map((route) => [route, routes[route]]),
  );

  return {
    manifest: {routes: sorted},
    added: added.sort(),
    retired: retired.sort(),
    revived: revived.sort(),
    retargeted: retargeted.sort(),
  };
}

export function serializeManifest(manifest: RouteManifest): string {
  return `${JSON.stringify({$comment: COMMENT, routes: manifest.routes}, null, 2)}\n`;
}

export async function readManifest(file: string): Promise<RouteManifest> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {routes: {}};
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as Partial<RouteManifest>;
  if (typeof parsed.routes !== 'object' || parsed.routes === null) {
    throw new Error(`${file} has no "routes" object.`);
  }
  return {routes: parsed.routes};
}

/** The report a CI build fails with when the committed manifest is out of date. */
export function describeDrift(result: Reconciliation): string | null {
  const sections: [string, readonly string[]][] = [
    ['published but not in the manifest', result.added],
    ['no longer published, not yet marked retired', result.retired],
    ['published again, still marked retired', result.revived],
    ['redirect target no longer published', result.retargeted],
  ];
  const lines = sections
    .filter(([, routes]) => routes.length > 0)
    .flatMap(([label, routes]) => [`  ${label}:`, ...routes.map((route) => `    ${route}`)]);

  if (lines.length === 0) {
    return null;
  }
  return [
    `${MANIFEST_FILE} does not match the published routes (VER-5):`,
    ...lines,
    `Run a local build (npm run build:dev) and commit the ${MANIFEST_FILE} it writes.`,
  ].join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** A static redirect page. GitHub Pages has no server-side redirects. */
export function redirectPage(target: string, profile: BuildProfile): string {
  const href = `${profile.baseUrl}${target.slice(1)}`;
  const attr = escapeHtml(href);
  const canonical = escapeHtml(`${profile.url}${href}`);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>Page moved</title>',
    '<meta name="robots" content="noindex">',
    `<link rel="canonical" href="${canonical}">`,
    `<meta http-equiv="refresh" content="0; url=${attr}">`,
    `<script>location.replace(${JSON.stringify(href).replaceAll('<', '\\u003c')} + location.hash)</script>`,
    '</head>',
    '<body>',
    `<p>This page has moved to <a href="${attr}">${escapeHtml(target)}</a>.</p>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** Writes a redirect page at every retired route. Refuses to overwrite a published file. */
export async function emitRedirects(
  outDir: string,
  manifest: RouteManifest,
  profile: BuildProfile,
): Promise<string[]> {
  const written: string[] = [];
  for (const [route, entry] of Object.entries(manifest.routes)) {
    if (entry.status !== 'retired') {
      continue;
    }
    const file = path.join(outDir, ...route.split('/').filter(Boolean), 'index.html');
    try {
      await fs.writeFile(file, redirectPage(entry.redirect, profile), {
        encoding: 'utf8',
        flag: 'wx',
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Cannot write the redirect for retired route ${route}: ${String(error)}`);
      }
      await fs.mkdir(path.dirname(file), {recursive: true});
      await fs.writeFile(file, redirectPage(entry.redirect, profile), {
        encoding: 'utf8',
        flag: 'wx',
      });
    }
    written.push(route);
  }
  return written;
}

export interface ManifestRunOptions {
  readonly siteDir: string;
  readonly outDir: string;
  readonly routesPaths: readonly string[];
  readonly profile: BuildProfile;
  readonly mode: ManifestMode;
}

/** Reconcile, then write (local) or verify (CI) the manifest, then emit redirects. */
export async function runManifest(options: ManifestRunOptions): Promise<Reconciliation> {
  const file = path.join(options.siteDir, MANIFEST_FILE);
  const current = await readManifest(file);
  const published = options.routesPaths
    .map((route) => toManifestPath(route, options.profile.baseUrl))
    .filter((route): route is string => route !== null);
  const result = reconcile(current, published);

  if (options.mode === 'check') {
    const drift = describeDrift(result);
    if (drift !== null) {
      throw new Error(drift);
    }
  } else {
    const next = serializeManifest(result.manifest);
    const previous = await fs.readFile(file, 'utf8').catch(() => null);
    if (next !== previous) {
      await fs.mkdir(path.dirname(file), {recursive: true});
      await fs.writeFile(file, next, 'utf8');
    }
  }

  await emitRedirects(options.outDir, result.manifest, options.profile);
  return result;
}

export default function routeManifestPlugin(context: LoadContext): Plugin {
  const profile = resolveProfile();
  const mode = resolveMode();

  return {
    name: 'dbsync-route-manifest',
    async postBuild({outDir, routesPaths}) {
      await runManifest({siteDir: context.siteDir, outDir, routesPaths, profile, mode});
    },
  };
}

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {PROFILES} from '../../config/profiles';
import routeManifestPlugin, {
  MANIFEST_FILE,
  REDIRECT_SCRIPT,
  REDIRECT_SCRIPT_FILE,
  isManifestPath,
  nearestLiveAncestor,
  parseManifest,
  readManifest,
  reconcile,
  redirectPage,
  resolveMode,
  runManifest,
  serializeManifest,
  toManifestPath,
  type RouteManifest,
} from '../../plugins/route-manifest';
import type {LoadContext, Plugin} from '@docusaurus/types';

let siteDir: string;
let outDir: string;

beforeEach(async () => {
  siteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-manifest-site-'));
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-manifest-out-'));
});

afterEach(async () => {
  await fs.rm(siteDir, {recursive: true, force: true});
  await fs.rm(outDir, {recursive: true, force: true});
});

const dev = PROFILES.dev;
const prod = PROFILES.prod;
const routes = (...paths: string[]) => paths.map((p) => `${dev.baseUrl}${p.slice(1)}`);

async function writeManifest(manifest: RouteManifest): Promise<void> {
  await fs.mkdir(path.join(siteDir, 'config'), {recursive: true});
  await fs.writeFile(path.join(siteDir, MANIFEST_FILE), serializeManifest(manifest));
}

async function manifestOnDisk(): Promise<RouteManifest> {
  return readManifest(path.join(siteDir, MANIFEST_FILE));
}

describe('resolveMode', () => {
  it('writes locally and checks under CI', () => {
    expect(resolveMode({})).toBe('write');
    expect(resolveMode({CI: 'true'})).toBe('check');
    expect(resolveMode({CI: 'false'})).toBe('write');
  });

  it('honours an explicit mode over CI', () => {
    expect(resolveMode({CI: 'true', ROUTE_MANIFEST: 'write'})).toBe('write');
    expect(resolveMode({ROUTE_MANIFEST: 'check'})).toBe('check');
  });

  it('rejects an unknown mode', () => {
    expect(() => resolveMode({ROUTE_MANIFEST: 'append'})).toThrow(/not a mode/);
  });
});

describe('toManifestPath', () => {
  it('strips the baseUrl so both profiles share one manifest', () => {
    expect(toManifestPath('/cardano-db-sync/docs/intro', dev.baseUrl)).toBe('/docs/intro');
    expect(toManifestPath('/docs/intro', prod.baseUrl)).toBe('/docs/intro');
    expect(toManifestPath('/cardano-db-sync/', dev.baseUrl)).toBe('/');
    expect(toManifestPath('/docs/intro/', prod.baseUrl)).toBe('/docs/intro');
  });

  it('skips the 404 fallback and routes outside the baseUrl', () => {
    expect(toManifestPath('/cardano-db-sync/404.html', dev.baseUrl)).toBeNull();
    expect(toManifestPath('/elsewhere/page', dev.baseUrl)).toBeNull();
  });
});

describe('nearestLiveAncestor', () => {
  it('walks up to the closest published ancestor, then the root', () => {
    const live = new Set(['/', '/docs']);
    expect(nearestLiveAncestor('/docs/guides/old', live)).toBe('/docs');
    expect(nearestLiveAncestor('/blog/post', live)).toBe('/');
  });
});

describe('reconcile (VER-5)', () => {
  const live = {status: 'live'} as const;

  it('appends routes it has never seen', () => {
    const result = reconcile({routes: {'/': live}}, ['/', '/docs/intro']);
    expect(result.added).toEqual(['/docs/intro']);
    expect(result.manifest.routes['/docs/intro']).toEqual(live);
  });

  it('retires a route that is no longer published, redirecting to its nearest ancestor', () => {
    const result = reconcile({routes: {'/': live, '/docs': live, '/docs/old': live}}, [
      '/',
      '/docs',
    ]);
    expect(result.retired).toEqual(['/docs/old']);
    expect(result.manifest.routes['/docs/old']).toEqual({status: 'retired', redirect: '/docs'});
  });

  it('never drops an entry', () => {
    const before = {
      routes: {'/': live, '/a': live, '/b': {status: 'retired', redirect: '/'}} as const,
    };
    const result = reconcile(before, ['/']);
    expect(Object.keys(result.manifest.routes)).toEqual(['/', '/a', '/b']);
  });

  it('revives a retired route that is published again', () => {
    const result = reconcile({routes: {'/': live, '/a': {status: 'retired', redirect: '/'}}}, [
      '/',
      '/a',
    ]);
    expect(result.revived).toEqual(['/a']);
    expect(result.manifest.routes['/a']).toEqual(live);
  });

  it('retargets a redirect whose target has itself retired', () => {
    const before = {
      routes: {'/': live, '/docs': live, '/docs/x': {status: 'retired', redirect: '/docs'}},
    } as const;
    const result = reconcile(before, ['/']);
    expect(result.retargeted).toEqual(['/docs/x']);
    expect(result.manifest.routes['/docs/x']).toEqual({status: 'retired', redirect: '/'});
  });

  it('is stable: an up-to-date manifest reconciles to itself, sorted', () => {
    const first = reconcile({routes: {}}, ['/docs/b', '/', '/docs/a']);
    expect(Object.keys(first.manifest.routes)).toEqual(['/', '/docs/a', '/docs/b']);
    const second = reconcile(first.manifest, ['/', '/docs/a', '/docs/b']);
    expect(serializeManifest(second.manifest)).toBe(serializeManifest(first.manifest));
    expect([second.added, second.retired, second.revived, second.retargeted].flat()).toEqual([]);
  });
});

describe('reconcile when the site root is not published', () => {
  it('fails instead of redirecting into a 404 or a refresh loop', () => {
    expect(() =>
      reconcile({routes: {'/': {status: 'live'}, '/a': {status: 'live'}}}, ['/b']),
    ).toThrow(/site root "\/" is not published.*\/, \/a/);
  });
});

describe('manifest validation', () => {
  it('accepts build-shaped paths and rejects traversal or malformed ones', () => {
    expect(isManifestPath('/')).toBe(true);
    expect(isManifestPath('/docs/intro')).toBe(true);
    for (const bad of ['', 'docs', '/docs/', '//evil.com', '/../x', '/docs/./x', '/a b', 7]) {
      expect(isManifestPath(bad)).toBe(false);
    }
  });

  it('rejects an entry whose route could escape outDir', () => {
    const raw = JSON.stringify({routes: {'/': {status: 'live'}, '/../../x': {status: 'live'}}});
    expect(() => parseManifest('m.json', raw)).toThrow(/"\/..\/..\/x" is not a valid route path/);
  });

  it('rejects unknown statuses and retired entries without a valid redirect', () => {
    for (const entry of [
      {status: 'gone'},
      {status: 'retired'},
      {status: 'retired', redirect: '//x'},
    ]) {
      const raw = JSON.stringify({routes: {'/a': entry}});
      expect(() => parseManifest('m.json', raw)).toThrow(/entry for "\/a" must be/);
    }
  });

  it('drops unknown keys from valid entries', () => {
    const raw = JSON.stringify({routes: {'/': {status: 'live', note: 'x'}}});
    expect(parseManifest('m.json', raw).routes).toEqual({'/': {status: 'live'}});
  });
});

describe('redirectPage', () => {
  it('is an instant meta refresh with a canonical to the target, under the profile baseUrl', () => {
    const html = redirectPage('/docs', dev);
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=/cardano-db-sync/docs">');
    expect(html).toContain(
      '<link rel="canonical" href="https://lidonation.github.io/cardano-db-sync/docs">',
    );
    expect(redirectPage('/', prod)).toContain('url=/"');
  });

  it('loads only the same-origin forwarding script, ahead of the refresh', () => {
    const html = redirectPage('/docs', dev);
    const script =
      '<script src="/cardano-db-sync/redirect.js" data-target="/cardano-db-sync/docs">';
    expect(html).toContain(`${script}</script>`);
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('http-equiv="refresh"'));
    expect(html.match(/<script/g)).toHaveLength(1);
  });

  it('carries noindex on the preview build only (ENV-3)', () => {
    expect(redirectPage('/docs', dev)).toContain('<meta name="robots" content="noindex">');
    expect(redirectPage('/docs', prod)).not.toMatch(/noindex/);
  });

  it('escapes the target', () => {
    const html = redirectPage('/a"<b>&', prod);
    expect(html).toContain('url=/a&quot;&lt;b&gt;&amp;"');
    expect(html).not.toContain('<b>');
  });
});

describe('REDIRECT_SCRIPT', () => {
  function run(target: string | null, search = '', hash = '') {
    const replaced: string[] = [];
    vm.runInNewContext(REDIRECT_SCRIPT, {
      document: {currentScript: {getAttribute: () => target}},
      location: {search, hash, replace: (url: string) => replaced.push(url)},
    });
    return replaced;
  }

  it('forwards the query and fragment a meta refresh would drop', () => {
    expect(run('/docs', '?v=1', '#flags')).toEqual(['/docs?v=1#flags']);
  });

  it('does nothing without a target, leaving the meta refresh to redirect', () => {
    expect(run(null, '', '#flags')).toEqual([]);
  });
});

describe('runManifest', () => {
  it('writes the manifest locally, then leaves it untouched when nothing changed', async () => {
    const run = () =>
      runManifest({
        siteDir,
        outDir,
        routesPaths: [...routes('/', '/docs/intro'), '/cardano-db-sync/404.html'],
        profile: dev,
        mode: 'write',
      });
    await run();
    const file = path.join(siteDir, MANIFEST_FILE);
    expect(Object.keys((await manifestOnDisk()).routes)).toEqual(['/', '/docs/intro']);
    const {mtimeMs} = await fs.stat(file);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await run();
    expect((await fs.stat(file)).mtimeMs).toBe(mtimeMs);
  });

  it('fails a CI build listing every published route the manifest lacks', async () => {
    await writeManifest({routes: {'/': {status: 'live'}}});
    await expect(
      runManifest({
        siteDir,
        outDir,
        routesPaths: routes('/', '/docs/new', '/docs/other'),
        profile: dev,
        mode: 'check',
      }),
    ).rejects.toThrow(
      /published but not in the manifest:\n {4}\/docs\/new\n {4}\/docs\/other\nRun a local build/,
    );
  });

  it('fails a CI build when a retirement was not recorded, and does not write', async () => {
    await writeManifest({routes: {'/': {status: 'live'}, '/gone': {status: 'live'}}});
    await expect(
      runManifest({siteDir, outDir, routesPaths: routes('/'), profile: dev, mode: 'check'}),
    ).rejects.toThrow(/not yet marked retired:\n {4}\/gone/);
    expect((await manifestOnDisk()).routes['/gone']).toEqual({status: 'live'});
  });

  it('passes a CI build when the manifest matches, and emits redirects for retired routes', async () => {
    await writeManifest({
      routes: {'/': {status: 'live'}, '/docs/old/page': {status: 'retired', redirect: '/'}},
    });
    await runManifest({siteDir, outDir, routesPaths: ['/'], profile: prod, mode: 'check'});
    const html = await fs.readFile(path.join(outDir, 'docs', 'old', 'page', 'index.html'), 'utf8');
    expect(html).toContain('url=/"');
    expect(await fs.readFile(path.join(outDir, REDIRECT_SCRIPT_FILE), 'utf8')).toBe(
      REDIRECT_SCRIPT,
    );
  });

  it('writes no redirect script when nothing is retired', async () => {
    await writeManifest({routes: {'/': {status: 'live'}}});
    await runManifest({siteDir, outDir, routesPaths: ['/'], profile: prod, mode: 'check'});
    await expect(fs.stat(path.join(outDir, REDIRECT_SCRIPT_FILE))).rejects.toThrow(/ENOENT/);
  });

  it('refuses to overwrite a published file with the redirect script', async () => {
    await writeManifest({
      routes: {'/': {status: 'live'}, '/x': {status: 'retired', redirect: '/'}},
    });
    await fs.writeFile(path.join(outDir, REDIRECT_SCRIPT_FILE), 'published');
    await expect(
      runManifest({siteDir, outDir, routesPaths: ['/'], profile: prod, mode: 'check'}),
    ).rejects.toThrow(/Cannot write redirect\.js/);
  });

  it('retires a removed page locally and redirects its old URL', async () => {
    await writeManifest({routes: {'/': {status: 'live'}, '/docs/intro': {status: 'live'}}});
    await runManifest({siteDir, outDir, routesPaths: routes('/'), profile: dev, mode: 'write'});
    expect((await manifestOnDisk()).routes['/docs/intro']).toEqual({
      status: 'retired',
      redirect: '/',
    });
    const html = await fs.readFile(path.join(outDir, 'docs', 'intro', 'index.html'), 'utf8');
    expect(html).toContain('url=/cardano-db-sync/"');
  });

  it('refuses to overwrite a published file with a redirect', async () => {
    await writeManifest({
      routes: {'/': {status: 'live'}, '/x': {status: 'retired', redirect: '/'}},
    });
    await fs.mkdir(path.join(outDir, 'x'));
    await fs.writeFile(path.join(outDir, 'x', 'index.html'), 'real page');
    await expect(
      runManifest({siteDir, outDir, routesPaths: routes('/'), profile: dev, mode: 'check'}),
    ).rejects.toThrow(/Cannot write the redirect for retired route \/x/);
  });

  it('rejects a manifest without a routes object', async () => {
    await fs.mkdir(path.join(siteDir, 'config'));
    await fs.writeFile(path.join(siteDir, MANIFEST_FILE), '{}');
    await expect(readManifest(path.join(siteDir, MANIFEST_FILE))).rejects.toThrow(/no "routes"/);
  });
});

describe('routeManifestPlugin', () => {
  it('runs through postBuild with the profile and mode from the environment', async () => {
    const previous = {profile: process.env.DOCS_PROFILE, mode: process.env.ROUTE_MANIFEST};
    process.env.DOCS_PROFILE = 'dev';
    process.env.ROUTE_MANIFEST = 'write';
    try {
      const plugin = routeManifestPlugin({siteDir} as LoadContext) as Plugin & {
        postBuild: (props: {outDir: string; routesPaths: string[]}) => Promise<void>;
      };
      expect(plugin.name).toBe('dbsync-route-manifest');
      await plugin.postBuild({outDir, routesPaths: routes('/')});
      expect((await manifestOnDisk()).routes).toEqual({'/': {status: 'live'}});
    } finally {
      for (const [key, value] of [
        ['DOCS_PROFILE', previous.profile],
        ['ROUTE_MANIFEST', previous.mode],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

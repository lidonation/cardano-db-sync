import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {execFileSync, spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {LoadContext} from '@docusaurus/types';
import type {LoadedContent} from '@docusaurus/plugin-content-docs';
import metadataPlugin, {buildMetadata, gitLastmod} from '../../plugins/metadata';
import {main as metadataMain} from '../../scripts/check-metadata.mjs';
import {PROFILES} from '../../config/profiles';
import {contentJsonLd, breadcrumbJsonLd} from '../../src/metadata/model';
const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'metadata-test-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true});
  vi.unstubAllEnvs();
});
const context = (siteDir: string) =>
  ({
    siteDir,
    baseUrl: '/',
    siteConfig: {title: 'Cardano DB Sync'},
    i18n: {currentLocale: 'en', defaultLocale: 'en', locales: ['en', 'ja', 'es', 'de', 'vi']},
  }) as LoadContext;
const page = (type = 'SoftwareSourceCode') =>
  `<head><title>Title</title><meta name="description" content="Lead"><script type="application/ld+json">${JSON.stringify(contentJsonLd({type: type as 'SoftwareSourceCode', title: 'Title', description: 'Lead'}, 'https://docs.test/', 'https://repo.test'))}</script><script type="application/ld+json">${JSON.stringify(breadcrumbJsonLd([{name: 'Home', path: '/'}], 'https://docs.test'))}</script></head><body><main><h1>Title</h1></main></body>`;
describe('metadata producer and CI gate', () => {
  it('derives breadcrumbs/version/columns from loaded sources without shipping doc metadata globally', async () => {
    vi.stubEnv('DOCS_PROFILE', 'prod');
    const dir = temp();
    mkdirSync(path.join(dir, 'docs/guides'), {recursive: true});
    writeFileSync(
      path.join(dir, 'docs/guides/install.md'),
      '# Install\n\nA complete lead.\n\n## Prepare\n\nSelect a release.',
    );
    const doc = {
      id: 'guides/install',
      title: 'Install',
      description: 'A complete lead.',
      permalink: '/docs/v1/guides/install',
      source: '@site/docs/guides/install.md',
    };
    const docs = {
      loadedVersions: [{versionName: 'v1', contentPath: path.join(dir, 'docs'), docs: [doc]}],
    } as unknown as LoadedContent;
    const pages = [
      {type: 'jsx' as const, source: '@site/src/pages/index.tsx', permalink: '/'},
      {
        type: 'jsx' as const,
        source: '@site/src/pages/schema/block.tsx',
        permalink: '/schema/block',
      },
    ];
    const ctx = context(dir);
    const data = buildMetadata(ctx, docs, pages);
    expect(data.pages['/docs/v1/guides/install']).toMatchObject({
      type: 'HowTo',
      version: 'v1',
      steps: [{name: 'Prepare', text: 'Select a release.'}],
      breadcrumbs: [
        {name: 'Cardano DB Sync', path: '/'},
        {name: 'Install', path: '/docs/v1/guides/install'},
      ],
    });
    expect(data.pages['/schema/block'].variables).toContain('id');
    const plugin = metadataPlugin(ctx);
    const setGlobalData = vi.fn();
    await (plugin.allContentLoaded as (input: unknown) => Promise<void>)({
      allContent: {
        'docusaurus-plugin-content-docs': {default: docs},
        'docusaurus-plugin-content-pages': {default: pages},
      },
      actions: {setGlobalData},
    });
    expect(setGlobalData.mock.calls[0][0].pages).not.toHaveProperty('/docs/v1/guides/install');
  });
  it('lastmod is committed source time, unchanged by working-tree mtimes', () => {
    const dir = temp();
    const git = (args: string[]) =>
      execFileSync('git', args, {
        cwd: dir,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: '2020-01-02T00:00:00Z',
          GIT_COMMITTER_DATE: '2020-01-02T00:00:00Z',
        },
      });
    git(['init', '-q']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.test']);
    writeFileSync(path.join(dir, 'page.md'), 'first');
    git(['add', '.']);
    git(['commit', '-qm', 'fixture']);
    expect(gitLastmod(dir, ['page.md'])).toBe('2020-01-02T00:00:00+00:00');
    writeFileSync(path.join(dir, 'page.md'), 'changed');
    expect(gitLastmod(dir, ['page.md'])).toBe('2020-01-02T00:00:00+00:00');
    expect(gitLastmod(dir, ['unknown'])).toBeUndefined();
    expect(gitLastmod(temp(), ['page.md'])).toBeUndefined();
  });
  for (const profile of ['dev', 'prod'] as const)
    it(`runs the actual postBuild contract for ${profile}, rejecting invalid markup`, async () => {
      vi.stubEnv('DOCS_PROFILE', profile);
      const dir = temp();
      const out = temp();
      const ctx = context(dir);
      ctx.baseUrl = PROFILES[profile].baseUrl;
      const plugin = metadataPlugin(ctx);
      await (plugin.allContentLoaded as (input: unknown) => Promise<void>)({
        allContent: {
          'docusaurus-plugin-content-pages': {
            default: [{type: 'jsx', source: '@site/src/pages/index.tsx', permalink: ctx.baseUrl}],
          },
        },
        actions: {setGlobalData: vi.fn()},
      });
      writeFileSync(path.join(out, 'index.html'), page());
      if (profile === 'dev') writeFileSync(path.join(out, 'sitemap.xml'), 'stale');
      await (plugin.postBuild as (input: unknown) => Promise<void>)({
        outDir: out,
        routesPaths: [ctx.baseUrl, ctx.baseUrl + '404.html'],
      });
      expect(existsSync(path.join(out, 'sitemap.xml'))).toBe(profile === 'prod');
      expect(existsSync(path.join(out, 'social/SoftwareSourceCode.webp'))).toBe(true);
      if (profile === 'prod')
        expect(readFileSync(path.join(out, 'sitemap.xml'), 'utf8')).toContain(PROFILES.prod.url);
      writeFileSync(path.join(out, 'index.html'), '<main><h1>Broken</h1></main>');
      await expect(
        (plugin.postBuild as (input: unknown) => Promise<void>)({
          outDir: out,
          routesPaths: [ctx.baseUrl],
        }),
      ).rejects.toThrow(/META-10/);
    });
  it('CLI fails on seeded invalid HTML, with no output and with no pages; excludes only 404/stubs', async () => {
    const dir = temp();
    const out = {log: vi.fn(), error: vi.fn()};
    expect(await metadataMain([dir], out)).toBe(1);
    writeFileSync(path.join(dir, 'index.html'), page());
    writeFileSync(path.join(dir, '404.html'), '404');
    writeFileSync(path.join(dir, 'old.html'), '<meta http-equiv="refresh" content="0; url=/">');
    expect(await metadataMain([dir], out)).toBe(0);
    const script = path.resolve(import.meta.dirname, '../../scripts/check-metadata.mjs');
    writeFileSync(
      path.join(dir, 'index.html'),
      page().replace('"@type":"SoftwareSourceCode"', '"@type":"Invented"'),
    );
    const result = spawnSync(process.execPath, [script, dir], {encoding: 'utf8'});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unsupported @type');
  });
});

it('lastmod follows the schema artifact and translated app copy, not only its route wrapper', () => {
  const dir = temp();
  for (const area of ['src/pages/schema', 'generated', 'i18n/ja'])
    mkdirSync(path.join(dir, area), {recursive: true});
  const git = (args: string[], day: string) =>
    execFileSync('git', args, {
      cwd: dir,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: `2020-01-${day}T00:00:00Z`,
        GIT_COMMITTER_DATE: `2020-01-${day}T00:00:00Z`,
      },
    });
  git(['init', '-q'], '02');
  git(['config', 'user.name', 'Fixture'], '02');
  git(['config', 'user.email', 'fixture@example.test'], '02');
  writeFileSync(path.join(dir, 'src/pages/schema/block.tsx'), '// route wrapper');
  git(['add', '.'], '02');
  git(['commit', '-qm', 'route'], '02');
  writeFileSync(path.join(dir, 'generated/schema.json'), '{}');
  git(['add', '.'], '03');
  git(['commit', '-qm', 'artifact'], '03');
  const page = {
    type: 'jsx' as const,
    source: '@site/src/pages/schema/block.tsx',
    permalink: '/schema/block',
  };
  expect(buildMetadata(context(dir), undefined, [page]).pages['/schema/block'].lastmod).toBe(
    '2020-01-03T00:00:00+00:00',
  );
  writeFileSync(path.join(dir, 'i18n/ja/code.json'), '{}');
  git(['add', '.'], '04');
  git(['commit', '-qm', 'translated copy'], '04');
  const ctx = context(dir);
  ctx.baseUrl = '/ja/';
  ctx.i18n.currentLocale = 'ja';
  expect(
    buildMetadata(ctx, undefined, [{...page, permalink: '/ja/schema/block'}]).pages['/schema/block']
      .lastmod,
  ).toBe('2020-01-04T00:00:00+00:00');
});

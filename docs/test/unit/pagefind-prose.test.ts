import {describe, expect, it, vi} from 'vitest';
import {indexVersions} from '../../plugins/pagefind-prose/index';
import {bundlePath} from '../../src/search/version';
import {searchProse} from '../../src/search/prose';

describe('Pagefind prose bundles', () => {
  it('uses locale-aware bundle URLs and safe version segments', () => {
    expect(bundlePath('/preview/ja/', '13.6.0.5')).toBe('/preview/ja/pagefind/13.6.0.5/');
    expect(() => bundlePath('/', '../escape')).toThrow();
  });

  it('indexes only each version’s own generated doc pages', async () => {
    const add = vi.fn(async (_value: {url: string; content: string}) => ({errors: []}));
    const write = vi.fn(async (_value: {outputPath: string}) => ({errors: []}));
    const drop = vi.fn(async () => ({errors: []}));
    const create = vi.fn(async () => ({
      errors: [],
      index: {addHTMLFile: add, writeFiles: write, deleteIndex: drop},
    }));
    const read = vi.fn(async (file: string) => `<html>${file}</html>`);
    await indexVersions({
      outDir: '/site',
      baseUrl: '/preview/',
      versions: [
        {versionName: 'current', docs: [{permalink: '/preview/docs/a'}]},
        {versionName: '13.6', docs: [{permalink: '/preview/docs/13.6/b'}]},
      ],
      create,
      read,
      compact: async () => {},
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(add.mock.calls.map(([value]) => value.url)).toEqual([
      '/preview/docs/a',
      '/preview/docs/13.6/b',
    ]);
    expect(read.mock.calls.map(([file]) => file)).toEqual([
      '/site/docs/a/index.html',
      '/site/docs/13.6/b/index.html',
    ]);
    expect(write.mock.calls.map(([value]) => value.outputPath)).toEqual([
      '/site/pagefind/current',
      '/site/pagefind/13.6',
    ]);
    expect(drop).toHaveBeenCalledTimes(2);
  });

  it('fails rather than emitting an incomplete bundle', async () => {
    const drop = vi.fn(async () => ({errors: []}));
    const create = async () => ({
      errors: [],
      index: {
        addHTMLFile: async () => ({errors: ['bad HTML']}),
        writeFiles: vi.fn(),
        deleteIndex: drop,
      },
    });
    await expect(
      indexVersions({
        outDir: '/site',
        baseUrl: '/',
        versions: [{versionName: 'current', docs: [{permalink: '/docs/a'}]}],
        create,
        read: async () => '',
        compact: async () => {},
      }),
    ).rejects.toThrow('bad HTML');
    expect(drop).toHaveBeenCalledOnce();
  });

  it('switches bundles headlessly and hydrates sub-results', async () => {
    const api = {
      destroy: vi.fn(async () => {}),
      options: vi.fn(async () => {}),
      init: vi.fn(async () => {}),
      search: vi.fn(async () => ({
        results: [
          {
            data: async () => ({
              url: '/guide',
              excerpt: 'prune <mark>tx_out</mark>',
              sub_results: [{url: '/guide#prune'}],
            }),
          },
        ],
      })),
    };
    const results = await searchProse(api, '/preview/pagefind/current/', 'prune tx_out');
    expect(api.destroy).toHaveBeenCalledOnce();
    expect(api.options).toHaveBeenCalledWith({
      basePath: '/preview/pagefind/current/',
      baseUrl: '/',
    });
    expect(api.init).toHaveBeenCalledOnce();
    expect(results[0].sub_results[0].url).toBe('/guide#prune');
  });
});

describe('build lifecycle and error handling', () => {
  it('rejects absent content and indexes actual generated documentation', async () => {
    const {default: pluginFactory} = await import('../../plugins/pagefind-prose');
    const {mkdtemp, mkdir, writeFile, readFile, rm} = await import('node:fs/promises');
    const {tmpdir} = await import('node:os');
    const path = await import('node:path');
    const outDir = await mkdtemp(path.join(tmpdir(), 'pagefind-unit-'));
    try {
      const plugin = pluginFactory({siteDir: process.cwd()} as never);
      expect(() => plugin.allContentLoaded!({allContent: {}} as never)).toThrow(
        'default docs plugin',
      );
      plugin.allContentLoaded!({
        allContent: {
          'docusaurus-plugin-content-docs': {
            default: {loadedVersions: [{versionName: 'current', docs: [{permalink: '/docs/a'}]}]},
          },
        },
      } as never);
      await mkdir(path.join(outDir, 'docs/a'), {recursive: true});
      await writeFile(
        path.join(outDir, 'docs/a/index.html'),
        '<html lang="en"><body><article><div class="markdown"><h1>Alpha</h1><p>Some prose.</p></div></article></body></html>',
      );
      await plugin.postBuild!({outDir, baseUrl: '/'} as never);
      const entry = JSON.parse(
        await readFile(path.join(outDir, 'pagefind/current/pagefind-entry.json'), 'utf8'),
      );
      expect(entry.languages.en.page_count).toBe(1);
      await expect(
        readFile(path.join(outDir, 'pagefind/current/pagefind-ui.js')),
      ).rejects.toThrow();
    } finally {
      await rm(outDir, {recursive: true, force: true});
    }
  });

  it('rejects invalid URLs and failed index creation or writes', async () => {
    const version = [{versionName: 'v1', docs: [{permalink: '/docs/a'}]}];
    const args = {
      outDir: '/tmp/nonexistent-index-test',
      baseUrl: '/',
      versions: version,
      read: async () => '',
      compact: async () => {},
    };
    await expect(
      indexVersions({...args, create: async () => ({errors: ['create failed']})}),
    ).rejects.toThrow('create failed');
    await expect(indexVersions({...args, create: async () => ({errors: []})})).rejects.toThrow(
      'did not create',
    );
    const drop = vi.fn(async () => {});
    const create = async () => ({
      errors: [],
      index: {
        addHTMLFile: async () => ({errors: []}),
        writeFiles: async () => ({errors: ['write failed']}),
        deleteIndex: drop,
      },
    });
    await expect(indexVersions({...args, create})).rejects.toThrow('write failed');
    await expect(indexVersions({...args, baseUrl: '/preview/', create})).rejects.toThrow(
      'Invalid doc URL',
    );
    await expect(
      indexVersions({
        ...args,
        versions: [{versionName: 'v1', docs: [{permalink: '/docs/../outside'}]}],
        create,
      }),
    ).rejects.toThrow('Invalid doc URL');
    expect(drop).toHaveBeenCalledTimes(3);
  });

  it('rejects unsafe version segments across deterministic generated cases', () => {
    for (const value of ['', '.', '..', '../x', 'x/y', 'x\\y', '/x', 'x?y', 'x%2fy']) {
      expect(() => bundlePath('/', value)).toThrow();
    }
    for (let i = 0; i < 200; i++) {
      const version = `v${i}.${(i * 37) % 101}-rc_${i}`;
      expect(bundlePath('/en/', version)).toBe(`/en/pagefind/${version}/`);
    }
  });
});

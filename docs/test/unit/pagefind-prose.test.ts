import {describe, expect, it, vi} from 'vitest';
import {indexVersions} from '../../plugins/pagefind-prose/index';
import {bundlePath} from '../../src/search/version';
import {proseAdapter, searchProse} from '../../src/search/prose';

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

it('shares only identical Pagefind runtimes between versions', async () => {
  const {shareRuntime} = await import('../../plugins/pagefind-prose');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const {tmpdir} = await import('node:os');
  const root = await fs.mkdtemp(path.join(tmpdir(), 'pagefind-runtime-'));
  try {
    for (const [name, contents] of [
      ['v1', 'same'],
      ['v2', 'same'],
      ['v3', 'different'],
    ]) {
      const dir = path.join(root, name);
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, 'pagefind.js'), contents);
      await fs.writeFile(path.join(dir, 'pagefind-worker.js'), 'worker');
      if (name === 'v3') await expect(shareRuntime(dir)).rejects.toThrow('runtime differs');
      else await shareRuntime(dir);
    }
    expect(await fs.readFile(path.join(root, '_runtime/pagefind.js'), 'utf8')).toBe('same;');
    await expect(fs.readFile(path.join(root, 'v2/pagefind-worker.js'))).rejects.toThrow();
    expect(await fs.readFile(path.join(root, '_runtime/prose-worker.js'), 'utf8')).toContain(
      './pagefind.js',
    );
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});

describe('search lifecycle regressions', () => {
  const makeApi = () => ({
    destroy: vi.fn(async () => {}),
    options: vi.fn(async () => {}),
    init: vi.fn(async () => {}),
    search: vi.fn(async () => ({
      results: [] as Array<{data(): Promise<import('../../src/search/prose').ProseResult>}>,
    })),
  });

  it('retains a warm index for repeated queries and resets on a bundle change', async () => {
    const api = makeApi();
    await searchProse(api, '/pagefind/v1/', 'first');
    await searchProse(api, '/pagefind/v1/', 'second');
    expect(api.destroy).toHaveBeenCalledTimes(1);
    expect(api.init).toHaveBeenCalledTimes(1);
    await searchProse(api, '/pagefind/v2/', 'third');
    expect(api.destroy).toHaveBeenCalledTimes(2);
    expect(api.options).toHaveBeenLastCalledWith({basePath: '/pagefind/v2/', baseUrl: '/'});
  });

  it('holds the bundle lock until every hydration settles after a failure', async () => {
    const api = makeApi();
    let finish!: (value: import('../../src/search/prose').ProseResult) => void;
    const pending = new Promise<import('../../src/search/prose').ProseResult>((resolve) => {
      finish = resolve;
    });
    api.search.mockResolvedValueOnce({
      results: [
        {
          data: async () => {
            throw new Error('fragment failed');
          },
        },
        {data: () => pending},
      ],
    });
    const first = searchProse(api, '/pagefind/v1/', 'first');
    const rejected = expect(first).rejects.toThrow('fragment failed');
    const second = searchProse(api, '/pagefind/v2/', 'second');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.destroy).toHaveBeenCalledTimes(1);
    finish({url: '/guide', excerpt: '', sub_results: []});
    await rejected;
    await second;
    expect(api.destroy).toHaveBeenCalledTimes(2);
  });

  it('reinitializes the same bundle after a failed search', async () => {
    const api = makeApi();
    api.search.mockRejectedValueOnce(new Error('offline'));
    await expect(searchProse(api, '/pagefind/v1/', 'first')).rejects.toThrow('offline');
    await expect(searchProse(api, '/pagefind/v1/', 'retry')).resolves.toEqual([]);
    expect(api.init).toHaveBeenCalledTimes(2);
  });
});

it('snapshots hydrated results before Pagefind mutates its cached fragments', async () => {
  const fragment = {url: '/guide', excerpt: 'first', sub_results: [{url: '/guide#first'}]};
  const api = {
    destroy: async () => {},
    options: async () => {},
    init: async () => {},
    search: async () => ({results: [{data: async () => fragment}]}),
  };
  const first = await searchProse(api, '/pagefind/v1/', 'first');
  fragment.excerpt = 'second';
  fragment.sub_results[0].url = '/guide#second';
  await searchProse(api, '/pagefind/v1/', 'second');
  expect(first[0].excerpt).toBe('first');
  expect(first[0].sub_results[0].url).toBe('/guide#first');
});

it('invalidates the warm bundle on external cleanup or option changes', async () => {
  const raw = {
    destroy: vi.fn(async () => {}),
    options: vi.fn(async () => {}),
    init: vi.fn(async () => {}),
    search: async () => null,
  };
  const api = proseAdapter(raw);
  expect(proseAdapter(raw)).toBe(api);
  await searchProse(api, '/pagefind/v1/', 'first');
  await api.destroy();
  await searchProse(api, '/pagefind/v1/', 'second');
  await api.options({basePath: '/pagefind/v2/', baseUrl: '/'});
  await searchProse(api, '/pagefind/v1/', 'third');
  expect(raw.init).toHaveBeenCalledTimes(3);
  expect(raw.options).toHaveBeenLastCalledWith({basePath: '/pagefind/v1/', baseUrl: '/'});
});

it('finds a relevant excerpt for a natural-language question without leaking unrelated results', async () => {
  const item = (url: string, excerpt: string) => ({
    data: async () => ({url, excerpt, sub_results: []}),
  });
  const api = {
    destroy: async () => {},
    options: async () => {},
    init: async () => {},
    search: vi.fn(async (q: string) => ({
      results:
        q === 'prune'
          ? [item('/trim', 'prune outputs'), item('/other', 'pruned')]
          : q === 'tx_out'
            ? [item('/trim', 'tx_out'), item('/queries', 'tx_out')]
            : [item('/queries', 'how much')],
    })),
  };
  const result = await searchProse(api, '/pagefind/current/', 'how do I prune tx_out?');
  expect(result.map((x) => x.url)).toEqual(['/trim']);
  expect(result[0].excerpt).toContain('prune');
});

it('falls back to the original question if no document matches both meaningful terms', async () => {
  const item = (url: string) => ({data: async () => ({url, excerpt: url, sub_results: []})});
  const api = {
    destroy: async () => {},
    options: async () => {},
    init: async () => {},
    search: vi.fn(async (q: string) => ({
      results: q === 'prune' ? [item('/a')] : q === 'tx_out' ? [item('/b')] : [item('/fallback')],
    })),
  };
  expect((await searchProse(api, '/pagefind/current/', 'how can we prune tx_out?'))[0].url).toBe(
    '/fallback',
  );
  expect(api.search).toHaveBeenCalledTimes(3);
});

it('preserves ordinary and quoted Pagefind query semantics', async () => {
  const api = {
    destroy: async () => {},
    options: async () => {},
    init: async () => {},
    search: vi.fn(async (_query: string) => ({results: []})),
  };
  for (const query of [
    'tx_out',
    'prune tx_out',
    '"how do I prune tx_out?"',
    '¿cómo podar tx_out?',
    'how do I safely prune tx_out?',
  ]) {
    await searchProse(api, '/pagefind/current/', query);
  }
  expect(api.search.mock.calls.map(([query]) => query)).toEqual([
    'tx_out',
    'prune tx_out',
    '"how do I prune tx_out?"',
    '¿cómo podar tx_out?',
    'how do I safely prune tx_out?',
  ]);
});

it('resets the active bundle if the second question lookup fails', async () => {
  const api = {
    destroy: vi.fn(async () => {}),
    options: vi.fn(async () => {}),
    init: vi.fn(async () => {}),
    search: vi.fn(async (term: string) => {
      if (term === 'tx_out') throw new Error('object lookup failed');
      return {results: []};
    }),
  };
  await expect(searchProse(api, '/pagefind/v1/', 'how do I prune tx_out?')).rejects.toThrow(
    'object lookup failed',
  );
  await searchProse(api, '/pagefind/v1/', 'other');
  expect(api.init).toHaveBeenCalledTimes(2);
});

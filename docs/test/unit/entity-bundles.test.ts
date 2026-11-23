import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {buildRecords, emitBundles} from '../../plugins/entity-search/model';
import {createEntityIndex, loadEntityIndex, searchEntities} from '../../src/search/engine';
import schema from '../../generated/schema.json';
import history from '../../generated/schema-explorer.json';
import renames from '../../generated/schema-renames.json';
import locks from '../../generated/guide-locks.json';
import type {ExplorerInput} from '../../src/schema/types';

const input = {schema, history, renames} as ExplorerInput;
const docs = (title = 'Your first SQL queries') => [
  {
    versionName: 'current',
    docs: [
      {
        id: 'guides/first-queries',
        title,
        description: 'Query the chain tip',
        permalink: '/base/docs/guides/first-queries',
        frontMatter: {},
      },
      {
        id: 'guides/runtime-option-migration',
        title: 'Runtime option migration',
        description: 'Configuration',
        permalink: '/base/docs/guides/runtime-option-migration',
        frontMatter: {requires: {config: ['insert_options.tx_out']}},
      },
      {
        id: 'intro',
        title: 'Intro',
        description: 'tx_out',
        permalink: '/base/docs/intro',
        frontMatter: {},
      },
    ],
  },
];
describe('entity bundles (SRCH-3, SRCH-5)', () => {
  it('reuses explorer routes/aliases, typed facets and current guide declarations', () => {
    const records = buildRecords(docs(), input, locks, '/base/');
    const table = records.current.find((r) => r.identifier === 'tx_out' && r.kind === 'table')!;
    expect(table).toMatchObject({
      url: '/base/schema/tx_out',
      facets: {variants: ['core'], columns: expect.any(Number)},
    });
    expect(table.facets).not.toHaveProperty('indexed'); // no extraction evidence, never guess
    const alias = records.current.find((r) => r.identifier === 'off_chain_pool_data')!;
    expect(alias.aliases).toContain('pool_offline_data');
    expect(
      records.current.find((r) => r.kind === 'column' && r.identifier === 'block_no')!.url,
    ).toContain('#column-block_no');
    expect(records.current.find((r) => r.kind === 'config')).toMatchObject({
      identifier: 'insert_options.tx_out',
      url: '/base/docs/guides/runtime-option-migration',
    });
    expect(records.current.find((r) => r.kind === 'guide')!.facets.versions).toContain('current');
    const found = searchEntities(
      loadEntityIndex(JSON.stringify(createEntityIndex(records.current))),
      'current',
      'tx_out',
    );
    expect(found[0].hits[0].url).toBe('/base/schema/tx_out');
    expect(
      searchEntities(createEntityIndex(records.current), 'current', 'tx_out.value')[0].hits[0].url,
    ).toBe('/base/schema/tx_out#column-value');
  });
  it('excludes unsupported guides and never leaks current schema/options into older lines', () => {
    const versions = [...docs(), {versionName: '13.6', docs: docs()[0].docs}];
    const result = buildRecords(
      versions,
      input,
      {ranges: {'docs/guides/first-queries.md': ['current']}},
      '/base/',
    );
    expect(result['13.6'].some((r) => r.id.includes('first-queries'))).toBe(false);
    expect(result['13.6'].every((r) => ['guide', 'doc'].includes(r.kind))).toBe(true);
  });
  it('emits stable hashes independent of input order, localized content, and actual version sets', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'entities-'));
    try {
      const records = buildRecords(docs(), input, locks, '/base/');
      const first = await emitBundles(outDir, 'en', records);
      const firstBytes = await readFile(path.join(outDir, first.bundles.current), 'utf8');
      expect(first.bundles.current).toMatch(/^entities\/current\.[a-f0-9]{64}\.json$/);
      const second = await emitBundles(outDir, 'en', {current: [...records.current].reverse()});
      expect(second).toEqual(first);
      expect(await readFile(path.join(outDir, second.bundles.current), 'utf8')).toBe(firstBytes);
      const changed = await emitBundles(
        outDir,
        'en',
        buildRecords(docs('New title'), input, locks, '/base/'),
      );
      expect(changed.bundles.current).not.toBe(first.bundles.current);
      const ja = await emitBundles(outDir, 'ja', records);
      expect(ja.bundles.current).not.toBe(first.bundles.current);
      expect(
        JSON.parse(await readFile(path.join(outDir, 'entities/manifest.json'), 'utf8')),
      ).toEqual(ja);
      expect((await readdir(path.join(outDir, 'entities'))).length).toBe(2); // stale hashes cleaned
      await expect(emitBundles(outDir, 'en', {'../escape': []})).rejects.toThrow(/version/);
    } finally {
      await rm(outDir, {recursive: true, force: true});
    }
  });
});

it('rejects nonexistent config declarations and indexes only explicitly documented current CLI flags', () => {
  const version = docs();
  version[0].docs[0].frontMatter = {requires: {config: ['does_not_exist']}};
  expect(() => buildRecords(version, input, locks, '/base/')).toThrow(/Unknown extracted config/);
  const cliDocs = [
    {
      versionName: 'current',
      docs: [
        {
          ...docs()[0].docs[0],
          sourceText: '--config-file is not --config; --config FILE; --disable-ledger is retired.',
        },
      ],
    },
  ];
  const found = buildRecords(cliDocs, input, locks, '/base/').current.filter(
    (r) => r.kind === 'cli',
  );
  expect(found.map((r) => r.identifier)).toEqual(['--config']);
});

it('runs the real build hook without leaking the entity model to global browser data', async () => {
  const {default: plugin} = await import('../../plugins/entity-search');
  const directory = await mkdtemp(path.join(tmpdir(), 'entity-plugin-'));
  try {
    const siteDir = path.resolve(import.meta.dirname, '../..');
    const p = plugin({siteDir, baseUrl: '/base/', i18n: {currentLocale: 'en'}} as never);
    await expect(p.allContentLoaded!({allContent: {}, actions: {} as never})).rejects.toThrow(
      /default docs/,
    );
    const allContent = {
      'docusaurus-plugin-content-docs': {
        default: {
          loadedVersions: [
            {
              versionName: 'current',
              docs: [
                {...docs()[0].docs[0], source: '@site/docs/guides/first-queries.md'},
                {...docs()[0].docs[2], source: path.join(siteDir, 'docs/intro.md')},
              ],
            },
          ],
        },
      },
    };
    await p.allContentLoaded!({allContent, actions: {} as never});
    await p.postBuild!({outDir: directory} as never);
    expect(p).not.toHaveProperty('getClientModules');
    const manifest = JSON.parse(
      await readFile(path.join(directory, 'entities/manifest.json'), 'utf8'),
    );
    expect(manifest.bundles.current).toBeTruthy();
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

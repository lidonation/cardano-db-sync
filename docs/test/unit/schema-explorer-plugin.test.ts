import path from 'node:path';
import {afterEach, expect, it, vi} from 'vitest';
import plugin from '../../plugins/schema-explorer';
import metadataPlugin, {buildMetadata} from '../../plugins/metadata';
import i18nPlugin from '../../plugins/i18n';
import {pageLocales} from '../../src/i18n/pages';
import type {ExplorerDocument} from '../../src/schema/types';
import type {LoadContext} from '@docusaurus/types';
afterEach(() => vi.unstubAllEnvs());
const context = {
  siteDir: path.resolve(import.meta.dirname, '../..'),
  baseUrl: '/cardano-db-sync/',
  siteConfig: {title: 'Cardano DB Sync'},
  i18n: {currentLocale: 'ja', defaultLocale: 'en', locales: ['en', 'ja']},
} as LoadContext;
it('registers all routes from one model and replaces the server document pool with an empty client module', async () => {
  const p = plugin(context);
  const content = (await p.loadContent!()) as Record<string, ExplorerDocument>;
  const createData = vi.fn(async (name: string, _data: string) => `/generated/${name}`),
    addRoute = vi.fn();
  await p.contentLoaded!({content, actions: {createData, addRoute} as never});
  expect(addRoute).toHaveBeenCalledTimes(Object.keys(content).length);
  expect(new Set(addRoute.mock.calls.map(([route]) => route.component)).size).toBe(1);
  expect(createData.mock.calls.map(([name]) => name)).toEqual(['documents.json', 'entities.json']);
  expect(JSON.parse(createData.mock.calls[0][1])).toHaveProperty('/cardano-db-sync/schema/block');
  const cache = {type: 'filesystem' as const, version: 'original'};
  const client = await p.configureWebpack!({cache} as never, false, {} as never, {} as never);
  expect(client).toMatchObject({
    resolve: {alias: {'@schema-documents': path.join(context.siteDir, 'src/schema/empty.ts')}},
  });
  expect(cache.version).toMatch(/^original-schema-[a-f0-9]{64}$/);
  const server = await p.configureWebpack!({} as never, true, {} as never, {} as never);
  expect(server).toMatchObject({
    resolve: {alias: {'@schema-documents': '/generated/documents.json'}},
  });
});
it('validates schema Dataset metadata without shipping table columns globally or advertising invented translations', async () => {
  vi.stubEnv('DOCS_PROFILE', 'dev');
  const document: ExplorerDocument = {
    html: '<h1>block</h1>',
    metadata: {type: 'Dataset', title: 'block', description: 'Block columns.', variables: ['id']},
  };
  const documents = {'/schema/block': document};
  const data = buildMetadata(context, undefined, [], documents);
  expect(data.pages['/schema/block']).toMatchObject({type: 'Dataset', variables: ['id']});
  const allContent = {'schema-explorer': {default: documents}};
  const setGlobalData = vi.fn();
  await metadataPlugin(context).allContentLoaded!({allContent, actions: {setGlobalData} as never});
  expect(setGlobalData.mock.calls[0][0].pages).toEqual({});
  setGlobalData.mockClear();
  await i18nPlugin(context).allContentLoaded!({allContent, actions: {setGlobalData} as never});
  const localeData = setGlobalData.mock.calls[0][0];
  expect(localeData).toMatchObject({englishSchema: true, docs: {}});
  expect(pageLocales('/schema/block', localeData, ['en', 'ja'])).toEqual(['en']);
  expect(pageLocales('/schema', localeData, ['en', 'ja'])).toEqual(['en']);
  expect(pageLocales('/numbers', localeData, ['en', 'ja'])).toEqual(['en', 'ja']);
});

import path from 'node:path';
import {readFile} from 'node:fs/promises';
import type {LoadedContent} from '@docusaurus/plugin-content-docs';
import type {LoadContext, Plugin} from '@docusaurus/types';
import schema from '../../generated/schema.json';
import renames from '../../generated/schema-renames.json';
import history from '../../generated/schema-explorer.json';
import locks from '../../generated/guide-locks.json';
import type {ExplorerInput} from '../../src/schema/types';
import type {SearchEntity} from '../../src/search/entities';
import {buildRecords, emitBundles, type EntityDoc} from './model';

/** Build-only: neither MiniSearch nor the schema is imported into global browser chrome. */
export default function entitySearch(context: LoadContext): Plugin {
  let records: Record<string, SearchEntity[]> = {};
  return {
    name: 'entity-search',
    async allContentLoaded({allContent}) {
      const content = allContent['docusaurus-plugin-content-docs']?.default as
        LoadedContent | undefined;
      if (!content) throw new Error('Entity search requires the default docs plugin');
      const versions = await Promise.all(
        content.loadedVersions.map(async (version) => ({
          versionName: version.versionName,
          docs: await Promise.all(
            version.docs.map(async (doc) => ({
              ...doc,
              frontMatter: doc.frontMatter as EntityDoc['frontMatter'],
              sourceText: await readFile(
                doc.source.startsWith('@site/')
                  ? path.join(context.siteDir, doc.source.slice(6))
                  : doc.source,
                'utf8',
              ),
            })),
          ),
        })),
      );
      records = buildRecords(
        versions,
        {schema, renames, history} as ExplorerInput,
        locks,
        context.baseUrl,
      );
    },
    async postBuild({outDir}) {
      await emitBundles(outDir, context.i18n.currentLocale, records);
    },
  };
}

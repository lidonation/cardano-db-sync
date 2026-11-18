import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {LoadContext, Plugin} from '@docusaurus/types';
import schema from '../../generated/schema.json';
import renames from '../../generated/schema-renames.json';
import history from '../../generated/schema-explorer.json';
import locks from '../../generated/guide-locks.json';
import type {SchemaArtifact} from '../../src/data/schema';
import type {ExplorerHistory, ExplorerDocument} from '../../src/schema/types';
import {buildDocuments, entityIndex} from './model';

/** Build artifacts stay server-only. Every schema URL reuses one small client route module. */
export default function schemaExplorer(context: LoadContext): Plugin {
  let serverFile: string;
  const input = {
    schema: schema as SchemaArtifact,
    renames: renames as ExplorerInputRenames,
    history: history as ExplorerHistory,
  };
  return {
    name: 'schema-explorer',
    getPathsToWatch: () => [
      path.join(
        context.siteDir,
        'generated/{schema,schema-renames,schema-explorer,guide-locks,versions}.json',
      ),
    ],
    async loadContent() {
      return buildDocuments(input, locks, context.baseUrl);
    },
    async contentLoaded({content, actions}) {
      serverFile = await actions.createData(
        'documents.json',
        JSON.stringify(
          Object.fromEntries(
            Object.entries(content as Record<string, ExplorerDocument>).map(([route, document]) => [
              context.baseUrl + route.slice(1),
              document,
            ]),
          ),
        ),
      );
      // Available to B19's build-side consumer, without becoming global browser data.
      await actions.createData('entities.json', JSON.stringify(entityIndex(input)));
      for (const route of Object.keys(content as Record<string, ExplorerDocument>))
        actions.addRoute({
          path: context.baseUrl + route.slice(1),
          component: path.resolve(context.siteDir, 'src/schema/Page.tsx'),
          exact: true,
        });
    },
    configureWebpack(config, isServer) {
      // The remark producer is outside webpack's graph. Invalidate cached MDX when its
      // source or declarations change, rather than serving links from an older schema.
      if (config.cache && typeof config.cache === 'object' && config.cache.type === 'filesystem') {
        const source = readFileSync(
          path.join(context.siteDir, 'plugins/schema-explorer/references.mjs'),
          'utf8',
        );
        const digest = createHash('sha256')
          .update(source)
          .update(JSON.stringify([schema, locks, renames]))
          .digest('hex');
        config.cache.version = `${config.cache.version ?? ''}-schema-${digest}`;
      }
      return {
        resolve: {
          alias: {
            '@schema-documents': isServer
              ? serverFile
              : path.resolve(context.siteDir, 'src/schema/empty.ts'),
          },
        },
      };
    },
  };
}
type ExplorerInputRenames = import('../../src/data/schema-renames').RenameMap;

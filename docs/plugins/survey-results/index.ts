import {readFileSync} from 'node:fs';
import path from 'node:path';
import type {LoadContext, Plugin} from '@docusaurus/types';
import {resolveAggregate} from '../../src/survey-results/resolve';
import type {Aggregate, SurveyManifest} from '../../src/survey-results/types';

/** SUR-7: webpack only receives reviewed text. Raw artifacts never enter a client import. */
export default function surveyResultsPlugin(context: LoadContext): Plugin {
  return {
    name: 'survey-results',
    configureWebpack(_config, isServer) {
      if (isServer) return {};
      return {
        optimization: {
          splitChunks: {
            cacheGroups: {
              resultsPageHelpers: {
                test: /[\\/]src[\\/](?:i18n[\\/](?:pageTranslator|useFallbackLang)\.ts|landing[\\/]styles\.module\.css)$/,
                chunks: 'async',
                minChunks: 2,
                minSize: 0,
                priority: 20,
                reuseExistingChunk: true,
              },
            },
          },
        },
      };
    },
    async contentLoaded({actions: {createData}}) {
      const root = path.join(context.siteDir, 'src/survey-results');
      const aggregate = JSON.parse(
        readFileSync(path.join(root, 'aggregate.json'), 'utf8'),
      ) as Aggregate;
      const manifest = JSON.parse(
        readFileSync(path.join(root, 'manifest.json'), 'utf8'),
      ) as SurveyManifest;
      const resolved = resolveAggregate(manifest, aggregate);
      await createData('resolved.json', JSON.stringify(resolved));
      const empty =
        resolved.questions.length === 0 &&
        resolved.closed.length === 0 &&
        resolved.freeText.length === 0;
      const view = path.join(root, empty ? 'Empty.tsx' : 'Dashboard.tsx');
      await createData('view.js', 'export {default} from ' + JSON.stringify(view) + ';');
    },
    getPathsToWatch() {
      return [path.join(context.siteDir, 'src/survey-results/*.json')];
    },
  };
}

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
      const manifest = JSON.parse(
        readFileSync(path.join(root, 'manifest.json'), 'utf8'),
      ) as SurveyManifest;
      const network = (context.siteConfig?.customFields?.profile as {network?: string} | undefined)
        ?.network;
      if (network !== 'preview' && network !== 'mainnet')
        throw new Error('Survey build requires an explicit profile network');
      const file = path.join(context.siteDir, `generated/survey-${network}/aggregate.json`);
      const artifact = JSON.parse(readFileSync(file, 'utf8')) as {
        network: string;
        surveys: (Aggregate & {network: string})[];
      };
      if (
        artifact.network !== network ||
        !Array.isArray(artifact.surveys) ||
        artifact.surveys.some((s) => s.network !== network)
      )
        throw new Error('Survey artifact network mismatch');
      let aggregate: Aggregate;
      if (artifact.surveys.length) {
        const selected = artifact.surveys.filter((s) => s.surveyRef === manifest.surveyRef);
        if (selected.length !== 1)
          throw new Error('Reviewed render manifest must identify exactly one tallied survey');
        aggregate = selected[0];
        // The standing-survey dashboard only renders interim figures. Final snapshots stay
        // available in the audit artifact, never mislabeled as response-time-only figures.
        if (aggregate.interim !== true || aggregate.tallyBasis !== 'response-time-only')
          throw new Error('Final survey snapshot requires a final-results renderer');
      } else {
        aggregate = JSON.parse(
          readFileSync(path.join(root, 'aggregate.json'), 'utf8'),
        ) as Aggregate;
        if (aggregate.questions.length || aggregate.freeText.length)
          throw new Error('Unscoped legacy survey data cannot render');
      }
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
      return [
        path.join(context.siteDir, 'src/survey-results/*.json'),
        path.join(context.siteDir, 'generated/survey-*/aggregate.json'),
      ];
    },
  };
}

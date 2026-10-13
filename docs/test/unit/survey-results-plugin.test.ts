import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {LoadContext} from '@docusaurus/types';
import {describe, expect, it} from 'vitest';
import plugin from '../../plugins/survey-results';
import aggregate from '../../src/survey-results/aggregate.json';
import manifest from '../../src/survey-results/manifest.json';

describe('SUR-7 generation boundary', () => {
  it('never emits pending text into webpack data', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'survey-review-'));
    try {
      mkdirSync(path.join(root, 'src/survey-results'), {recursive: true});
      writeFileSync(path.join(root, 'src/survey-results/manifest.json'), JSON.stringify(manifest));
      writeFileSync(
        path.join(root, 'src/survey-results/aggregate.json'),
        JSON.stringify({
          ...aggregate,
          freeText: [
            {id: 'a', text: 'Approved', moderated: true},
            {id: 'b', text: 'Pending-secret-marker', moderated: false},
            {id: 'c', text: 'Invalid-approval-marker', moderated: 'false'},
          ],
        }),
      );
      let output = '';
      await plugin({siteDir: root} as LoadContext).contentLoaded!({
        content: undefined,
        actions: {
          createData: async (_name: string, data: string) => {
            if (_name === 'resolved.json') output = data;
            return '';
          },
        } as never,
      });
      expect(output).toContain('Approved');
      expect(output).not.toContain('secret-marker');
      expect(output).not.toContain('approval-marker');
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
});

it('extracts only reused local presentation helpers in client builds', () => {
  const instance = plugin({siteDir: '/site'} as LoadContext);
  expect(instance.configureWebpack!({} as never, true, {} as never, {} as never)).toEqual({});
  const client = instance.configureWebpack!({} as never, false, {} as never, {} as never) as {
    optimization: {
      splitChunks: {cacheGroups: {resultsPageHelpers: {test: RegExp; minChunks: number}}};
    };
  };
  const group = client.optimization.splitChunks.cacheGroups.resultsPageHelpers;
  expect(group.minChunks).toBe(2);
  expect(group.test.test('/site/src/i18n/pageTranslator.ts')).toBe(true);
  expect(group.test.test('/site/src/landing/styles.module.css')).toBe(true);
  expect(group.test.test('/site/src/survey-results/Dashboard.tsx')).toBe(false);
});

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
      mkdirSync(path.join(root, 'generated/survey-preview'), {recursive: true});
      writeFileSync(
        path.join(root, 'generated/survey-preview/aggregate.json'),
        JSON.stringify({
          network: 'preview',
          surveys: [
            {
              ...aggregate,
              network: 'preview',
              freeText: [
                {id: 'a', text: 'Approved', moderated: true},
                {id: 'b', text: 'Pending-secret-marker', moderated: false},
                {id: 'c', text: 'Invalid-approval-marker', moderated: 'false'},
              ],
            },
          ],
        }),
      );
      let output = '';
      await plugin({
        siteDir: root,
        siteConfig: {customFields: {profile: {network: 'preview'}}},
      } as unknown as LoadContext).contentLoaded!({
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

it('builds only its profile network and rejects swapped/legacy public data', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'survey-isolation-'));
  const manifestFile = path.join(root, 'src/survey-results/manifest.json');
  const artifactFile = path.join(root, 'generated/survey-mainnet/aggregate.json');
  const instance = plugin({
    siteDir: root,
    siteConfig: {customFields: {profile: {network: 'mainnet'}}},
  } as unknown as LoadContext);
  const load = () =>
    instance.contentLoaded!({content: undefined, actions: {createData: async () => ''} as never});
  try {
    mkdirSync(path.dirname(manifestFile), {recursive: true});
    mkdirSync(path.dirname(artifactFile), {recursive: true});
    writeFileSync(manifestFile, JSON.stringify(manifest));
    writeFileSync(artifactFile, JSON.stringify({network: 'preview', surveys: []}));
    await expect(load()).rejects.toThrow('network mismatch');
    writeFileSync(
      artifactFile,
      JSON.stringify({network: 'mainnet', surveys: [{...aggregate, network: 'preview'}]}),
    );
    await expect(load()).rejects.toThrow('network mismatch');
    writeFileSync(
      artifactFile,
      JSON.stringify({
        network: 'mainnet',
        surveys: [{...aggregate, network: 'mainnet', surveyRef: 'wrong'}],
      }),
    );
    await expect(load()).rejects.toThrow('exactly one');
    writeFileSync(
      artifactFile,
      JSON.stringify({
        network: 'mainnet',
        surveys: [{...aggregate, network: 'mainnet', interim: false, tallyBasis: 'end-epoch'}],
      }),
    );
    await expect(load()).rejects.toThrow('Final survey snapshot');
    writeFileSync(artifactFile, JSON.stringify({network: 'mainnet', surveys: []}));
    writeFileSync(
      path.join(root, 'src/survey-results/aggregate.json'),
      JSON.stringify({...aggregate, freeText: [{id: 'x', text: 'legacy', moderated: true}]}),
    );
    await expect(load()).rejects.toThrow('Unscoped legacy');
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

it('emits the named empty view for an inactive network, without guessing a missing profile', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'survey-inactive-'));
  try {
    mkdirSync(path.join(root, 'src/survey-results'), {recursive: true});
    mkdirSync(path.join(root, 'generated/survey-mainnet'), {recursive: true});
    writeFileSync(path.join(root, 'src/survey-results/manifest.json'), JSON.stringify(manifest));
    writeFileSync(path.join(root, 'src/survey-results/aggregate.json'), JSON.stringify(aggregate));
    writeFileSync(
      path.join(root, 'generated/survey-mainnet/aggregate.json'),
      JSON.stringify({network: 'mainnet', surveys: []}),
    );
    const output: Record<string, string> = {};
    const args = {
      content: undefined,
      actions: {
        createData: async (name: string, value: string) => {
          output[name] = value;
          return '';
        },
      } as never,
    };
    await plugin({
      siteDir: root,
      siteConfig: {customFields: {profile: {network: 'mainnet'}}},
    } as unknown as LoadContext).contentLoaded!(args);
    expect(output['view.js']).toContain('Empty.tsx');
    expect(JSON.parse(output['resolved.json']).freeText).toEqual([]);
    await expect(plugin({siteDir: root} as LoadContext).contentLoaded!(args)).rejects.toThrow(
      'explicit profile network',
    );
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

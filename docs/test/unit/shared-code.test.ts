import type {Configuration} from 'webpack';
import {expect, it} from 'vitest';
import sharedCode from '../../plugins/shared-code';
it('deduplicates site modules reused by two async routes, without changing server or CSS groups', () => {
  const plugin = sharedCode();
  const configure = plugin.configureWebpack as (
    config: Configuration,
    isServer: boolean,
  ) => Configuration;
  expect(configure({}, true)).toEqual({});
  const group = (
    configure({}, false).optimization?.splitChunks as Exclude<
      NonNullable<Configuration['optimization']>['splitChunks'],
      boolean | undefined
    >
  ).cacheGroups!.siteShared as {test: RegExp};
  expect(group).toMatchObject({
    name: 'site-shared',
    chunks: 'async',
    minChunks: 2,
    minSize: 0,
    enforce: true,
    priority: 45,
  });
  expect((group.test as RegExp).test('/project/docs/src/components/Card/Frame.tsx')).toBe(true);
  expect((group.test as RegExp).test('/project/docs/node_modules/react/index.js')).toBe(false);
  expect((group.test as RegExp).test('/project/docs/src/numbers/styles.module.css')).toBe(true);
});

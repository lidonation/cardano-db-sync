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

it('uses safe extra compression passes while preserving the stock JavaScript compatibility settings', () => {
  const compress = {ecma: 5, passes: 1};
  const css = {options: {minimizer: {options: [{preset: 'default'}]}}};
  const disabled = {options: {minimizer: {options: {compress: false}}}};
  const js = {options: {minimizer: {options: {compress, mangle: {safari10: true}}}}};
  const config = {optimization: {minimizer: [js, css, disabled]}};
  const configure = sharedCode().configureWebpack as (
    config: Configuration,
    isServer: boolean,
  ) => Configuration;
  configure(config as unknown as Configuration, false);
  expect(compress).toEqual({ecma: 5, passes: 3});
  expect(js.options.minimizer.options.mangle).toEqual({safari10: true});
  expect(css.options.minimizer.options).toEqual([{preset: 'default'}]);
  expect(disabled.options.minimizer.options.compress).toBe(false);
});

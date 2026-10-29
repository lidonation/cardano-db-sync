import {expect, it} from 'vitest';
import {clientModule, serverModule} from '../../plugins/static-guide-content/strip.mjs';

const input =
  "export const frontMatter = {title:'x'};\nexport const contentTitle = 'x';\nexport {default as metadata} from '@site/meta.json'\nexport const assets = {};\nimport {jsx as _jsx} from 'react/jsx-runtime';\nexport const toc = [{value:'PRIVATE_HEADING',id:'a',level:2}];\nfunction _createMdxContent(props) { return 'PRIVATE_TEST_BODY'; }\nexport default function MDXContent() {}";
it('client reuses metadata and obtains TOC and prose from the static document', () => {
  const output = clientModule(input);
  expect(output).toContain('staticMetadata.frontMatter');
  expect(output).toContain('staticDocument.toc');
  expect(output).toContain('export default');
  expect(output).not.toContain('PRIVATE_TEST_BODY');
  expect(output).not.toContain('PRIVATE_HEADING');
});
it('server retains the full body within a stable boundary', () => {
  const output = serverModule(input);
  expect(output).toContain('PRIVATE_TEST_BODY');
  expect(output).toContain('data-static-guide');
  expect(output).toContain('staticServerMetadata.id');
});
it('fails closed if the compiler format changes', () => {
  expect(() => clientModule('unexpected output')).toThrow();
  expect(() => serverModule('unexpected output')).toThrow();
});

it('optimizes only explicitly reviewed current guides, not installation or versioned docs', async () => {
  const {default: plugin} = await import('../../plugins/static-guide-content');
  const {default: path} = await import('node:path');
  const siteDir = path.resolve(import.meta.dirname, '../..');
  const config = plugin({siteDir} as never).configureWebpack!(
    {mode: 'production'} as never,
    false,
    {} as never,
    {} as never,
  ) as {module: {rules: {test: (path: string) => boolean}[]}};
  const test = config.module.rules[0].test;
  expect(test(`${siteDir}/docs/guides/interesting-queries.md`)).toBe(true);
  expect(test(`${siteDir}/docs/guides/kubernetes.md`)).toBe(true);
  expect(test(`${siteDir}/docs/guides/installation.md`)).toBe(false);
  expect(test(`${siteDir}/docs/guides/new-guide.md`)).toBe(false);
  expect(test(`${siteDir}/versioned_docs/version-1/guides/kubernetes.md`)).toBe(false);
  expect(test(`${siteDir}/docs/intro.md`)).toBe(false);
});

it('does not replace guide modules in the development server', async () => {
  const {default: plugin} = await import('../../plugins/static-guide-content');
  const config = plugin({siteDir: '/project/docs'} as never).configureWebpack!(
    {mode: 'development'} as never,
    false,
    {} as never,
    {} as never,
  );
  expect(config).toEqual({});
});

it('does not strip a guide containing an upgraded procedure-tabs component', async () => {
  const {isInteractive} = await import('../../plugins/static-guide-content/strip.mjs');
  expect(isInteractive('const {ProcedureTabs} = _components;')).toBe(true);
  expect(isInteractive('function _createMdxContent() {}')).toBe(false);
});

it('lists only distinct existing reviewed guides and leaves installation interactive', async () => {
  const {default: names} = await import('../../data/static-guides.json');
  const {existsSync} = await import('node:fs');
  const {default: path} = await import('node:path');
  expect(new Set(names).size).toBe(names.length);
  expect(names).toHaveLength(22);
  expect(names).not.toContain('installation');
  for (const name of names) {
    expect(name).toMatch(/^[a-z0-9-]+$/);
    expect(
      existsSync(path.resolve(import.meta.dirname, '../../docs/guides', `${name}.md`)),
      name,
    ).toBe(true);
  }
});

it('groups only optimized guide modules and their metadata in a lazy chunk', async () => {
  const {default: plugin} = await import('../../plugins/static-guide-content');
  const {default: path} = await import('node:path');
  const siteDir = path.resolve(import.meta.dirname, '../..');
  const config = plugin({siteDir} as never).configureWebpack!(
    {mode: 'production'} as never,
    false,
    {} as never,
    {} as never,
  ) as {
    optimization: {
      splitChunks: {
        cacheGroups: {
          guideMetadata: {
            name: string;
            chunks: string;
            test: (module: {resource?: string}) => boolean;
          };
        };
      };
    };
  };
  const group = config.optimization.splitChunks.cacheGroups.guideMetadata;
  expect(group.name).toBe('guide-metadata');
  expect(group.chunks).toBe('async');
  expect(group.test({resource: `${siteDir}/docs/guides/interesting-queries.md`})).toBe(true);
  expect(
    group.test({
      resource: `${siteDir}/.docusaurus/docusaurus-plugin-content-docs/default/site-docs-guides-interesting-queries-md-d86.json`,
    }),
  ).toBe(true);
  expect(group.test({resource: `${siteDir}/docs/guides/installation.md`})).toBe(false);
  expect(
    group.test({
      resource: `${siteDir}/.docusaurus/docusaurus-plugin-content-docs/default/site-docs-guides-installation-md-abc.json`,
    }),
  ).toBe(false);
});

it('excludes guides with procedure tab markers from the optimized metadata group', async () => {
  const {hasProcedureTabs} = await import('../../plugins/static-guide-content');
  expect(hasProcedureTabs('```sh tab="Docker"\necho hi\n```')).toBe(true);
  expect(hasProcedureTabs('~~~sh tab="Nix"\necho hi\n~~~')).toBe(true);
  expect(hasProcedureTabs('```sh\necho hi\n```')).toBe(false);
  expect(hasProcedureTabs('> ```sh tab="Docker"\n> echo hi\n> ```')).toBe(true);
  expect(hasProcedureTabs('```text\n```sh tab="not-a-fence"\n```')).toBe(false);
});

it('uses content-only names for generated route chunks while retaining named utility chunks', async () => {
  const {default: plugin} = await import('../../plugins/static-guide-content');
  const {default: path} = await import('node:path');
  const siteDir = path.resolve(import.meta.dirname, '../..');
  const config = plugin({siteDir} as never).configureWebpack!(
    {mode: 'production'} as never,
    false,
    {} as never,
    {} as never,
  ) as {output: {chunkFilename: (value: {chunk: {name: string}}) => string}};
  expect(config.output.chunkFilename({chunk: {name: '013b1dd5'}})).toBe(
    'assets/js/[contenthash:16].js',
  );
  expect(config.output.chunkFilename({chunk: {name: 'code-block'}})).toBe(
    'assets/js/[name].[contenthash:8].js',
  );
});

it('keeps an opted-in guide native if it later adds tabbed procedures', async () => {
  const {default: plugin} = await import('../../plugins/static-guide-content');
  const {default: names} = await import('../../data/static-guides.json');
  const {mkdtemp, mkdir, writeFile, rm} = await import('node:fs/promises');
  const {default: os} = await import('node:os');
  const {default: path} = await import('node:path');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'static-tabs-'));
  try {
    const guides = path.join(dir, 'docs/guides');
    await mkdir(guides, {recursive: true});
    await Promise.all(
      names.map((name) =>
        writeFile(
          path.join(guides, `${name}.md`),
          name === 'kubernetes' ? '```sh tab="Docker"\necho hi\n```' : '# Ordinary guide\n',
        ),
      ),
    );
    const config = plugin({siteDir: dir} as never).configureWebpack!(
      {mode: 'production'} as never,
      false,
      {} as never,
      {} as never,
    ) as {
      module: {rules: {test: (path: string) => boolean}[]};
      optimization: {
        splitChunks: {
          cacheGroups: {guideMetadata: {test: (module: {resource?: string}) => boolean}};
        };
      };
    };
    const file = path.join(guides, 'kubernetes.md');
    expect(config.module.rules[0].test(file)).toBe(false);
    expect(config.optimization.splitChunks.cacheGroups.guideMetadata.test({resource: file})).toBe(
      false,
    );
    expect(config.module.rules[0].test(path.join(guides, 'validation.md'))).toBe(true);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

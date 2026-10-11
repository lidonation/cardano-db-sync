import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
  CONFIG,
  configProblems,
  globToRegExp,
  isSource,
  main,
  sourcesInTree,
} from '../../scripts/check-i18n.mjs';

const ENTRIES = [
  {
    source: '/i18n/en/**/*.json',
    ignore: ['/i18n/en/docusaurus-plugin-content-docs/version-*.json'],
    translation: '/i18n/%two_letters_code%/**/%original_file_name%',
  },
  {
    source: '/docs/**/*.{md,mdx}',
    translation:
      '/i18n/%two_letters_code%/docusaurus-plugin-content-docs/current/**/%original_file_name%',
  },
];

const CONFIG_OK = {
  project_id_env: 'CROWDIN_PROJECT_ID',
  api_token_env: 'CROWDIN_PERSONAL_TOKEN',
  files: ENTRIES,
};

const toYaml = (config: object) => JSON.stringify(config); // JSON is YAML

describe('globToRegExp (Crowdin patterns)', () => {
  it.each([
    ['/docs/**/*.md', '/docs/intro.md', true],
    ['/docs/**/*.md', '/docs/a/b/intro.md', true],
    ['/docs/**/*.md', '/docs/intro.mdx', false],
    ['/docs/*.md', '/docs/a/intro.md', false],
    ['/docs/**/*.{md,mdx}', '/docs/a/x.mdx', true],
    ['/i18n/en/v?.json', '/i18n/en/v1.json', true],
    ['/a.b', '/aXb', false],
  ])('%s against %s', (glob, file, matches) => {
    expect(globToRegExp(glob).test(file)).toBe(matches);
  });
});

describe('VER-2: only the current line is a source', () => {
  it('uploads current docs and UI strings', () => {
    for (const file of [
      '/docs/intro.md',
      '/i18n/en/code.json',
      '/i18n/en/docusaurus-plugin-content-docs/current.json',
    ]) {
      expect(isSource(file, ENTRIES), file).toBe(true);
    }
  });

  it('does not upload an edited page or label file on a released line', () => {
    for (const file of [
      '/versioned_docs/version-13.6/intro.md',
      '/versioned_sidebars/version-13.6-sidebars.json',
      '/i18n/en/docusaurus-plugin-content-docs/version-13.6.json',
    ]) {
      expect(isSource(file, ENTRIES), file).toBe(false);
    }
  });

  it('accepts the shipped shape', () => {
    expect(configProblems(CONFIG_OK)).toEqual([]);
  });

  it('flags a source reaching an old line, and an ignore removed', () => {
    const problems = configProblems({
      ...CONFIG_OK,
      files: [
        {...ENTRIES[0], ignore: []},
        {...ENTRIES[1], source: '/{docs,versioned_docs}/**/*.{md,mdx}'},
      ],
    });
    expect(problems).toEqual([
      '/versioned_docs/version-13.6/intro.md would be uploaded: a released line must not be translatable (VER-2)',
      '/versioned_docs/version-13.6/guides/restore.mdx would be uploaded: a released line must not be translatable (VER-2)',
      '/i18n/en/docusaurus-plugin-content-docs/version-13.6.json would be uploaded: a released line must not be translatable (VER-2)',
    ]);
  });

  it('flags docs translated anywhere but current/, and a non-locale translation path', () => {
    expect(
      configProblems({
        ...CONFIG_OK,
        files: [ENTRIES[0], {...ENTRIES[1], translation: '/i18n/ja/docs/**/%original_file_name%'}],
      }),
    ).toEqual([
      '/docs/**/*.{md,mdx}: translation /i18n/ja/docs/**/%original_file_name% is not per-locale',
      '/docs/**/*.{md,mdx}: docs must translate into current/ only (VER-2)',
    ]);
  });

  it('flags a sync that would upload nothing current', () => {
    expect(configProblems({...CONFIG_OK, files: [ENTRIES[0]]})).toContain(
      '/docs/intro.md would not be uploaded: the current line must be translatable',
    );
  });

  it('keeps credentials out of the file', () => {
    expect(configProblems({project_id: '1', api_token: 'x', files: ENTRIES})).toEqual([
      'credentials are in crowdin.yml; use project_id_env and api_token_env',
      'project_id_env and api_token_env must name the environment variables',
    ]);
    expect(configProblems({...CONFIG_OK, files: []})).toEqual(['crowdin.yml has no files']);
    expect(configProblems({...CONFIG_OK, files: [{source: '/docs/a.md'}]})).toContain(
      'every file entry needs a source and a translation',
    );
  });
});

describe('check:i18n over a tree', () => {
  let root: string;
  const lines: string[] = [];
  const out = {log: (m: string) => lines.push(m), error: (m: string) => lines.push(m)};
  const write = async (file: string, text = 'x') => {
    await fs.mkdir(path.dirname(path.join(root, file)), {recursive: true});
    await fs.writeFile(path.join(root, file), text);
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-i18n-'));
    lines.length = 0;
    await write(CONFIG, toYaml(CONFIG_OK));
    await write('docs/intro.md');
    await write('versioned_docs/version-13.6/intro.md');
    await write('node_modules/x/docs/a.md');
  });

  afterEach(async () => {
    await fs.rm(root, {recursive: true, force: true});
  });

  it('lists the current-line sources and exits 0', async () => {
    expect(await sourcesInTree(root, ENTRIES)).toEqual({sources: ['/docs/intro.md'], oldLine: []});
    expect(await main({root, out})).toBe(0);
    expect(lines.join('\n')).toMatch(/1 current-line source file/);
  });

  it('exits 1 when a released-line file in the tree would be uploaded', async () => {
    const broad = [
      {
        source: '/**/*.md',
        translation:
          '/i18n/%two_letters_code%/docusaurus-plugin-content-docs/current/**/%original_file_name%',
      },
    ];
    expect((await sourcesInTree(root, broad)).oldLine).toEqual([
      '/versioned_docs/version-13.6/intro.md',
    ]);
    await write(CONFIG, toYaml({...CONFIG_OK, files: [...ENTRIES, ...broad]}));
    expect(await main({root, out})).toBe(1);
    expect(lines.join('\n')).toMatch(/version-13.6\/intro.md would be uploaded/);
  });

  it('catches an old-line file in the tree that the probes miss', async () => {
    await write('versioned_docs/version-13.5/intro.md');
    const narrow = {
      source: '/versioned_docs/version-13.5/**/*.md',
      translation:
        '/i18n/%two_letters_code%/docusaurus-plugin-content-docs/current/**/%original_file_name%',
    };
    await write(CONFIG, toYaml({...CONFIG_OK, files: [...ENTRIES, narrow]}));
    expect(await main({root, out})).toBe(1);
    expect(lines.join('\n')).toMatch(
      /version-13.5\/intro.md would be uploaded: it is on a released line/,
    );
  });

  it('cannot run without crowdin.yml, and fails an empty one', async () => {
    await fs.rm(path.join(root, CONFIG));
    expect(await main({root, out})).toBe(2);
    await write(CONFIG, '');
    expect(await main({root, out})).toBe(1);
  });
});

import {execFile} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

import {afterEach, beforeEach, expect, test} from 'vitest';

const run = promisify(execFile);
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'dbsync-fixture-unit-'));
});
afterEach(async () => {
  await rm(root, {recursive: true, force: true});
});

test('the disposable version build cannot write the normal persistent cache', async () => {
  const docs = path.join(root, 'docs');
  const cli = path.join(docs, 'node_modules/@docusaurus/core/bin/docusaurus.mjs');
  const log = path.join(root, 'calls.jsonl');
  await mkdir(path.dirname(cli), {recursive: true});
  await mkdir(path.join(docs, 'scripts'), {recursive: true});
  await symlink(
    path.resolve(import.meta.dirname, '../../node_modules/cheerio'),
    path.join(docs, 'node_modules/cheerio'),
    'dir',
  );
  await mkdir(path.join(root, 'cardano-db-sync'), {recursive: true});
  await writeFile(path.join(root, 'cardano-db-sync/CHANGELOG.md'), '# Release history');
  await cp(
    path.resolve(import.meta.dirname, '../../scripts/serve-version-fixture.mjs'),
    path.join(docs, 'scripts/serve-version-fixture.mjs'),
  );
  await writeFile(
    cli,
    `import {appendFileSync,readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === 'docs:version') {
  const versions = existsSync('versions.json') ? JSON.parse(readFileSync('versions.json','utf8')) : [];
  writeFileSync('versions.json', JSON.stringify([args[1], ...versions]));
  mkdirSync('versioned_docs/version-' + args[1], {recursive: true});
  mkdirSync('versioned_sidebars', {recursive: true});
  writeFileSync('versioned_sidebars/version-' + args[1] + '-sidebars.json', '{}');
}

if (args[0] === 'build' && process.env.DOCS_PROFILE === 'prod') {
  const origin = 'https://fixture.test';
  const locales = ['en','ja','es','de','vi'];
  mkdirSync('build/prod', {recursive:true});
  writeFileSync('build/prod/index.html', '<link rel="canonical" href="' + origin + '/">');
  const alternates = locales.map(locale => '<link hreflang="' + locale + '" href="' + origin + '/' + (locale === 'en' ? '' : locale + '/') + 'docs/next/intro">').join('');
  for (const locale of locales) {
    const prefix = locale === 'en' ? '' : locale + '/';
    for (const route of ['docs/next/intro','docs/intro','docs/13.3.0.0/intro']) {
      const canonical = origin + '/' + (route.includes('/next/') ? prefix : '') + route;
      const dir = 'build/prod/' + prefix + route;
      mkdirSync(dir, {recursive:true});
      writeFileSync(dir + '/index.html', '<head><link rel="canonical" href="' + canonical + '">' + alternates + '<script type="application/ld+json">' + JSON.stringify({'@type':'TechArticle',url:canonical}) + '</script></head>');
    }
    writeFileSync('build/prod/' + prefix + 'sitemap.xml', '<loc>' + origin + '/' + prefix + 'docs/next/intro</loc>');
  }
}
appendFileSync(${JSON.stringify(log)}, JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  profile: process.env.DOCS_PROFILE,
  manifest: process.env.ROUTE_MANIFEST,
  noCache: process.env.DOCUSAURUS_NO_PERSISTENT_CACHE,
}) + '\\n');`,
  );
  await run(process.execPath, [path.join(docs, 'scripts/serve-version-fixture.mjs')], {
    env: {...process.env, DOCUSAURUS_NO_PERSISTENT_CACHE: ''},
  });
  const calls = (await readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(calls.map(({args}) => args[0])).toEqual([
    'docs:version',
    'docs:version',
    'build',
    'build',
    'serve',
  ]);
  expect(calls.map((call) => call.profile)).toEqual(['dev', 'dev', 'prod', 'dev', 'dev']);
  for (const call of calls) {
    expect(call.manifest).toBe('write');
    expect(call.noCache).toBe('1');
    expect(call.cwd).not.toBe(docs);
    await expect(
      readFile(path.join(call.cwd, 'scripts/serve-version-fixture.mjs')),
    ).rejects.toMatchObject({code: 'ENOENT'});
  }
});

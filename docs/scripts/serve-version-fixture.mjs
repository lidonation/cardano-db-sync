#!/usr/bin/env node
/** Build the real site with a second docs release in a disposable directory.
 * No version, route-manifest or generated cache can leak into the normal build. */
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {cp, mkdir, mkdtemp, rm, symlink, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(path.join(tmpdir(), 'dbsync-version-test-'));
const site = path.join(temporary, 'docs');
const port = process.env.DBS_VERSION_TEST_PORT ?? '3415';
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
  await rm(temporary, {recursive: true, force: true});
  throw new Error('DBS_VERSION_TEST_PORT must be an integer from 1024 to 65535.');
}
const skip = new Set([
  'node_modules',
  'build',
  '.docusaurus',
  'coverage',
  'test-results',
  'playwright-report',
]);
let child;
let interrupted = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    interrupted = true;
    child?.kill(signal);
  });
}
async function run(args, profile = 'dev') {
  if (interrupted) throw new Error('Version fixture interrupted.');
  await new Promise((resolve, reject) => {
    child = spawn(
      process.execPath,
      [path.join(root, 'node_modules/@docusaurus/core/bin/docusaurus.mjs'), ...args],
      {
        cwd: site,
        // node_modules is shared with the checkout, including Webpack's default cache.
        // This disposable build must not read or write that persistent cache.
        env: {
          ...process.env,
          DOCS_PROFILE: profile,
          ROUTE_MANIFEST: 'write',
          DOCUSAURUS_NO_PERSISTENT_CACHE: '1',
        },
        stdio: 'inherit',
      },
    );
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 || interrupted ? resolve() : reject(new Error(`Docusaurus exited ${code}`)),
    );
  });
}
try {
  await cp(root, site, {
    recursive: true,
    filter: (source) => !skip.has(path.relative(root, source).split(path.sep)[0]),
  });
  await symlink(path.join(root, 'node_modules'), path.join(site, 'node_modules'), 'dir');
  await cp(
    path.join(root, '..', 'cardano-db-sync', 'CHANGELOG.md'),
    path.join(temporary, 'cardano-db-sync/CHANGELOG.md'),
    {recursive: true},
  );
  // Publish, then retire an actual version in the disposable fixture. Its paths come from
  // B04's first build, not invented manifest entries; the second build must emit real stubs.
  await run(['docs:version', '13.3.0.0']);
  await run(['docs:version', '13.6.0.5']);
  // Only the current line is translated. Both retained historical lines stay English.
  for (const locale of ['ja', 'es', 'de', 'vi']) {
    const target = path.join(site, 'i18n', locale, 'docusaurus-plugin-content-docs/current');
    await mkdir(target, {recursive: true});
    await writeFile(
      path.join(target, 'intro.md'),
      `---\nsidebar_position: 1\n---\n\n# Fixture ${locale}\n\nA real translated-fixture lead for ${locale}.\n`,
    );
  }
  await run(['build', '--out-dir', 'build/prod'], 'prod');
  // META-4/5: test actual static output, not synthetic URL helpers. This also checks
  // both release versions before the older release is retired by the next build.
  const origin = 'https://dbsync.cardano.intersectmbo.org';
  const languages = ['en', 'ja', 'es', 'de', 'vi'];
  const alternates = languages
    .map((locale) => origin + (locale === 'en' ? '/' : `/${locale}/`) + 'docs/next/intro')
    .sort();
  for (const locale of languages) {
    const prefix = locale === 'en' ? '' : `${locale}/`;
    const read = async (route) =>
      load(await readFile(path.join(site, 'build/prod', prefix, route, 'index.html'), 'utf8'));
    const current = await read('docs/next/intro');
    const expected = origin + '/' + prefix + 'docs/next/intro';
    assert.equal(current('link[rel="canonical"]').attr('href'), expected);
    assert.deepEqual(
      current('link[hreflang]:not([hreflang="x-default"])')
        .map((_, node) => current(node).attr('href'))
        .get()
        .sort(),
      alternates,
    );
    const entity = current('script[type="application/ld+json"]')
      .map((_, node) => JSON.parse(current(node).text()))
      .get()
      .find((item) => item['@type'] === 'TechArticle');
    assert.equal(entity.url, expected);
    const xml = await readFile(path.join(site, 'build/prod', prefix, 'sitemap.xml'), 'utf8');
    assert.ok(xml.includes(`<loc>${expected}</loc>`));
    for (const route of ['docs/intro', 'docs/13.3.0.0/intro']) {
      const released = await read(route);
      assert.equal(released('link[rel="canonical"]').attr('href'), `${origin}/${route}`);
      if (prefix) assert.ok(!xml.includes(`<loc>${origin}/${prefix}${route}</loc>`));
    }
  }
  console.log(
    'META fixture: both retained releases self-canonical; current translation cluster reciprocal in all five locales.',
  );
  const versionsFile = path.join(site, 'versions.json');
  const versions = JSON.parse(await readFile(versionsFile, 'utf8'));
  await writeFile(versionsFile, JSON.stringify(versions.filter((name) => name !== '13.3.0.0')));
  await rm(path.join(site, 'versioned_docs/version-13.3.0.0'), {recursive: true});
  await rm(path.join(site, 'versioned_sidebars/version-13.3.0.0-sidebars.json'));
  await run(['build', '--locale', 'en', '--out-dir', 'build/dev']);
  await run(['serve', '--dir', 'build/dev', '--host', '127.0.0.1', '--port', port, '--no-open']);
} catch (error) {
  if (!interrupted) throw error;
} finally {
  await rm(temporary, {recursive: true, force: true});
}

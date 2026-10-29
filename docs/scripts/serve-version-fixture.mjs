#!/usr/bin/env node
/** Build the real site with a second docs release in a disposable directory.
 * No version, route-manifest or generated cache can leak into the normal build. */
import {spawn} from 'node:child_process';
import {cp, mkdtemp, rm, symlink} from 'node:fs/promises';
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
async function run(args) {
  if (interrupted) throw new Error('Version fixture interrupted.');
  await new Promise((resolve, reject) => {
    child = spawn(
      process.execPath,
      [path.join(root, 'node_modules/@docusaurus/core/bin/docusaurus.mjs'), ...args],
      {
        cwd: site,
        env: {...process.env, DOCS_PROFILE: 'dev', ROUTE_MANIFEST: 'write'},
        stdio: 'inherit',
      },
    );
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Docusaurus exited ${code}`)),
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
    path.join(root, '../cardano-db-sync/CHANGELOG.md'),
    path.join(temporary, 'cardano-db-sync/CHANGELOG.md'),
    {recursive: true},
  );
  await run(['docs:version', '13.6.0.5']);
  await run(['build', '--locale', 'en', '--out-dir', 'build/dev']);
  await run(['serve', '--dir', 'build/dev', '--host', '127.0.0.1', '--port', port, '--no-open']);
} finally {
  await rm(temporary, {recursive: true, force: true});
}

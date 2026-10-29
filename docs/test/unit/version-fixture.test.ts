import {execFile} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
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
  await mkdir(path.join(root, 'cardano-db-sync'), {recursive: true});
  await writeFile(path.join(root, 'cardano-db-sync/CHANGELOG.md'), '# Release history');
  await cp(
    path.resolve(import.meta.dirname, '../../scripts/serve-version-fixture.mjs'),
    path.join(docs, 'scripts/serve-version-fixture.mjs'),
  );
  await writeFile(
    cli,
    `import {appendFileSync} from 'node:fs';
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
  expect(calls.map(({args}) => args[0])).toEqual(['docs:version', 'build', 'serve']);
  for (const call of calls) {
    expect(call.profile).toBe('dev');
    expect(call.manifest).toBe('write');
    expect(call.noCache).toBe('1');
    expect(call.cwd).not.toBe(docs);
    await expect(
      readFile(path.join(call.cwd, 'scripts/serve-version-fixture.mjs')),
    ).rejects.toMatchObject({code: 'ENOENT'});
  }
});

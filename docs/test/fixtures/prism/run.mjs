import {spawnSync} from 'node:child_process';
import {rm} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// Build a fenced-code fixture into a disposable directory, never into a published profile.
const output = path.resolve('build/prism-fixture');
const env = {...process.env, DOCS_PROFILE: 'dev'};
let status = 1;
try {
  const build = spawnSync(
    'npx',
    ['docusaurus', 'build', '--config', 'test/fixtures/prism/config.ts', '--locale', 'en', '--out-dir', `${output}/dev`],
    {stdio: 'inherit', env},
  );
  if (build.status !== 0) throw new Error('Fixture build failed');
  const test = spawnSync(
    'npx',
    ['playwright', 'test', '--config', 'playwright.prism.config.ts', 'test/built-browser/prism.spec.ts'],
    {stdio: 'inherit', env: {...env, DBS_BUILT_SKIP_BUILD: '1', DBS_BUILT_BUILD_ROOT: output}},
  );
  status = test.status ?? 1;
} finally {
  await rm(output, {recursive: true, force: true});
}
process.exitCode = status;

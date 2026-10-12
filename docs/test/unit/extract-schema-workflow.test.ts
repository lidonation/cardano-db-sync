import {readFileSync} from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';
import {describe, expect, it} from 'vitest';

const source = readFileSync(
  path.resolve(import.meta.dirname, '../../../.github/workflows/extract-schema.yml'),
  'utf8',
);
const workflow = yaml.load(source) as {
  on: {pull_request: {paths: string[]}; push: {paths: string[]}};
  jobs: {
    extract: {services: {postgres: {image: string}}; steps: Array<{run?: string; shell?: string}>};
  };
};

describe('Schema extraction workflow (SCH-1, GDE-6)', () => {
  it('checks drift without committing repairs', () => {
    expect(source).toContain('contents: read');
    expect(source).not.toContain('git commit');
    expect(source).not.toContain('git push');
    const gate = workflow.jobs.extract.steps.find((s) => s.run?.includes('extract:schema'));
    expect(gate?.run).toContain('-- --check');
    expect(gate?.shell).toBe('bash');
  });

  it('replays against a pinned Postgres 17 image, never a floating tag', () => {
    expect(workflow.jobs.extract.services.postgres.image).toMatch(/^postgres:17\.\d+(-[a-z]+)?$/);
  });

  it('runs the replay suite before the drift gate', () => {
    const runs = workflow.jobs.extract.steps.map((s) => s.run ?? '');
    const replay = runs.findIndex((r) => r.includes('test:schema-db'));
    const gate = runs.findIndex((r) => r.includes('extract:schema'));
    expect(replay).toBeGreaterThanOrEqual(0);
    expect(replay).toBeLessThan(gate);
  });

  it('triggers on every input the extraction reads', () => {
    for (const trigger of [workflow.on.pull_request, workflow.on.push]) {
      expect(trigger.paths).toEqual(
        expect.arrayContaining([
          'schema/**',
          'cardano-db/src/Cardano/Db/Schema/**',
          'cardano-db/src/Cardano/Db/Statement/ConsumedTxOut.hs',
          'cardano-db/src/Cardano/Db/Statement/Types.hs',
          'docs/scripts/extract-schema.mjs',
          'docs/scripts/lib/schema-*.mjs',
          'docs/generated/schema.json',
          'docs/.prettierrc',
          'docs/package-lock.json',
        ]),
      );
    }
  });
});

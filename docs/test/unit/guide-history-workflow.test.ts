import {readFileSync} from 'node:fs';
import path from 'node:path';
import {expect, it} from 'vitest';
import yaml from 'js-yaml';

it('regenerates guide history from full release tags with PostgreSQL 17 and Haskell parser', () => {
  const text = readFileSync(path.resolve('../.github/workflows/guide-history.yml'), 'utf8');
  const workflow = yaml.load(text) as {
    on: {pull_request: {paths: string[]}};
    jobs: {
      history: {
        services: {postgres: {image: string}};
        steps: Array<{uses?: string; with?: {['fetch-depth']?: number}; run?: string}>;
      };
    };
  };
  const job = workflow.jobs.history;
  expect(job.services.postgres.image).toMatch(/^postgres:17\./);
  expect(
    job.steps.find((step) => step.uses?.startsWith('actions/checkout'))?.with?.['fetch-depth'],
  ).toBe(0);
  expect(job.steps.some((step) => step.uses?.startsWith('haskell-actions/setup'))).toBe(true);
  expect(
    job.steps.some(
      (step) => step.run?.includes('extract:guide-history') && step.run.includes('--check'),
    ),
  ).toBe(true);
  expect(workflow.on.pull_request.paths).toEqual(
    expect.arrayContaining([
      'docs/generated/guide-history.json',
      'docs/generated/versions.json',
      'docs/scripts/extract-guide-history.mjs',
    ]),
  );
});

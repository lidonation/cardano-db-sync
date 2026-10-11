import fs from 'node:fs/promises';
import path from 'node:path';

import yaml from 'js-yaml';
import {describe, expect, it} from 'vitest';

/**
 * Workflow hygiene. A `run:` step pipes a gate through `tee` to copy its report into the job
 * summary; under the default `bash -e` the pipeline's status is `tee`'s, so a failing gate would
 * pass. Only an explicit `shell: bash` (which GitHub runs with `-o pipefail`) keeps the gate's
 * exit code. This caught the BLD-1 deploy checks in B41 and the asset budget in B02.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const DIRS = ['.github/workflows', '.github/actions'];

interface Step {
  name?: string;
  run?: string;
  shell?: string;
}
interface Job {
  steps?: Step[];
  defaults?: {run?: {shell?: string}};
}
interface Workflow {
  on?: Record<string, unknown>;
  jobs?: Record<string, Job & {uses?: string; if?: string}>;
  defaults?: {run?: {shell?: string}};
  runs?: {steps?: Step[]};
}

async function* yamlFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* yamlFiles(full);
    } else if (/\.ya?ml$/.test(entry.name)) {
      yield full;
    }
  }
}

/** Every `run:` step that pipes into `tee` without a shell that sets pipefail. */
function teeWithoutPipefail(doc: Workflow, file: string): string[] {
  const found: string[] = [];
  const check = (steps: Step[] | undefined, inherited: string | undefined, where: string) => {
    for (const step of steps ?? []) {
      const shell = step.shell ?? inherited;
      if (step.run && /\|\s*tee\b/.test(step.run) && shell !== 'bash') {
        found.push(`${file} ${where}: ${step.name ?? step.run.split('\n')[0]}`);
      }
    }
  };
  for (const [id, job] of Object.entries(doc.jobs ?? {})) {
    check(job.steps, job.defaults?.run?.shell ?? doc.defaults?.run?.shell, id);
  }
  check(doc.runs?.steps, undefined, 'composite');
  return found;
}

describe('workflow run steps', () => {
  it('flags a tee pipeline under the default shell and accepts one under shell: bash', () => {
    const doc = {
      jobs: {
        a: {steps: [{name: 'gate', run: 'node gate.mjs | tee -a "$GITHUB_STEP_SUMMARY"'}]},
        b: {steps: [{name: 'gate', shell: 'bash', run: 'node gate.mjs | tee x'}]},
        c: {defaults: {run: {shell: 'bash'}}, steps: [{run: 'x | tee y'}]},
      },
      runs: {steps: [{run: 'x | tee y', shell: 'sh'}]},
    };
    expect(teeWithoutPipefail(doc, 'f.yml')).toEqual([
      'f.yml a: gate',
      'f.yml composite: x | tee y',
    ]);
  });

  it('pipe no gate through tee without pipefail', async () => {
    const found: string[] = [];
    for (const dir of DIRS) {
      for await (const file of yamlFiles(path.join(ROOT, dir))) {
        const doc = yaml.load(await fs.readFile(file, 'utf8')) as Workflow;
        found.push(...teeWithoutPipefail(doc, path.relative(ROOT, file)));
      }
    }
    expect(found).toEqual([]);
  });
});

describe('scheduled-job alerts (NUM-4)', () => {
  it('every scheduled docs workflow ends with the ops alert, on manual runs too', async () => {
    const problems: string[] = [];
    for await (const file of yamlFiles(path.join(ROOT, '.github/workflows'))) {
      const doc = yaml.load(await fs.readFile(file, 'utf8')) as Workflow;
      // The Haskell workflows are the node team's, not the docs site's.
      if (!path.basename(file).startsWith('docs-') || !doc.on || !('schedule' in doc.on)) {
        continue;
      }
      const name = path.basename(file);
      const alerts = Object.values(doc.jobs ?? {}).filter((job) =>
        job.uses?.endsWith('/docs-ops-alert.yml'),
      );
      if (alerts.length === 0) {
        problems.push(`${name}: no ops alert job`);
      }
      for (const job of alerts) {
        // The runbook clears an alert with a manual run, so the alert cannot be schedule-only.
        if (/event_name\s*==\s*'schedule'/.test(job.if ?? '')) {
          problems.push(`${name}: the alert only reports scheduled runs`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

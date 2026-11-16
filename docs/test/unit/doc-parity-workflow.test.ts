import {readFileSync} from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {expect, it} from 'vitest';

it('runs parity for legacy-only edits, requires it, and preserves failure reports for B17', () => {
  type Step = {uses?: string; run?: string; if?: string; with?: Record<string, string>};
  type Job = {needs?: string[]; 'continue-on-error'?: boolean; steps: Step[]};
  const root = path.resolve(import.meta.dirname, '../../..');
  const workflow = yaml.load(
    readFileSync(path.join(root, '.github/workflows/docs-site.yml'), 'utf8'),
  ) as {
    on: Record<'push' | 'pull_request', {paths: string[]}>;
    jobs: Record<string, Job>;
  };
  for (const event of ['push', 'pull_request'] as const) {
    expect(workflow.on[event].paths).toEqual(expect.arrayContaining(['doc/**', 'docs/**']));
  }
  const job = workflow.jobs['doc-parity'];
  expect(job).toBeDefined();
  expect(job['continue-on-error']).not.toBe(true);
  expect(workflow.jobs.gate.needs).toContain('doc-parity');
  expect(
    job.steps.some(
      (step) => step.run === 'npm run --silent check:doc-parity > doc-parity-report.md',
    ),
  ).toBe(true);
  const summary = job.steps.find((step) => step.run?.includes('GITHUB_STEP_SUMMARY'));
  expect(summary?.if).toBe('always()');
  const archive = job.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
  expect(archive?.if).toBe('always()');
  expect(archive?.with?.path).toBe('docs/doc-parity-report.md');
  const pkg = JSON.parse(readFileSync(path.join(root, 'docs/package.json'), 'utf8'));
  expect(pkg.scripts['check:doc-parity']).toBe('node scripts/check-doc-parity.mjs');
  expect(pkg.scripts.verify).toContain('npm run check:doc-parity');
});

import {readFileSync} from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {describe, expect, it} from 'vitest';

type Job = Record<string, unknown> & {
  uses?: string;
  if?: string;
  environment?: string;
  name?: string;
  steps: Array<{
    id?: string;
    uses?: string;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
    run?: string;
  }>;
  services: {postgres: {image: string}};
};
const workflow = (name: string): {jobs: Record<string, Job>; on?: unknown} =>
  yaml.load(
    readFileSync(
      path.resolve(import.meta.dirname, `../../../.github/workflows/${name}.yml`),
      'utf8',
    ),
  ) as {jobs: Record<string, Job>};
const selected = "${{ needs.site-runner.outputs.runner || 'ubuntu-24.04' }}";

describe('fork CI balanced runner policy', () => {
  it('runs site policy checks when selector scripts or workflows change', () => {
    const triggers = workflow('docs-site').on as Record<string, {paths: string[]}>;
    for (const event of ['push', 'pull_request']) {
      expect(triggers[event].paths).toContain('.github/scripts/blacksmith-*.py');
      expect(triggers[event].paths).toContain('.github/scripts/blacksmith-*.pem');
      expect(triggers[event].paths).toContain('.github/tests/test_blacksmith_*.py');
      expect(triggers[event].paths).toContain('.github/workflows/blacksmith-*.yml');
    }
  });

  it('splits site checks while keeping deploy and unit jobs GitHub-hosted', () => {
    const jobs = workflow('docs-site').jobs;
    for (const name of ['format', 'static-analysis', 'build', 'links']) {
      expect(jobs[name]['runs-on'], name).toBe(selected);
      expect(JSON.stringify(jobs[name].needs), name).toContain('site-runner');
    }
    expect(jobs['unit-tests']['runs-on']).toBe('ubuntu-24.04');
    for (const name of ['asset-budget', 'gate', 'deploy-dev', 'deploy-production']) {
      expect(jobs[name]['runs-on'], name).toBe('ubuntu-latest');
    }
    expect(jobs.links.if).toBe("${{ !cancelled() && needs.build.result == 'success' }}");
  });

  it('uses the selector for one Linux Haskell matrix variant without routing macOS', () => {
    const jobs = workflow('haskell').jobs;
    expect(jobs['site-runner'].uses).toBe('./.github/workflows/blacksmith-selector.yml');
    expect(jobs.build['runs-on']).toContain("matrix.os == 'ubuntu-latest'");
    expect(jobs.build['runs-on']).toContain("matrix.compiler-nix-name == 'ghc912'");
    expect(jobs.build['runs-on']).toContain('needs.site-runner.outputs.runner');
    expect(jobs.build.if).toContain("needs.changes.outputs.run != 'false'");
  });

  it('splits equivalent formatting and extraction workflows', () => {
    expect(workflow('check-fourmolu').jobs.build['runs-on']).toBe(selected);
    expect(workflow('check-git-dependencies').jobs.build['runs-on']).toBe('ubuntu-latest');
    expect(workflow('extract-haddock').jobs.extract['runs-on']).toBe(selected);
    expect(workflow('extract-schema').jobs.extract['runs-on']).toBe('ubuntu-latest');
    expect(workflow('guide-history').jobs.history['runs-on']).toBe(selected);
    expect(workflow('guide-history').jobs.history.services.postgres.image).toBe(
      'postgres:17.11-bookworm',
    );
  });

  it('does not pass repository secrets through any caller', () => {
    for (const file of [
      'docs-site',
      'haskell',
      'check-fourmolu',
      'extract-haddock',
      'guide-history',
    ]) {
      const job = workflow(file).jobs['site-runner'];
      expect(job.uses, file).toBe('./.github/workflows/blacksmith-selector.yml');
      expect(job.secrets, file).toBeUndefined();
    }
    const selector = workflow('blacksmith-selector').jobs;
    expect(selector.push.environment).toBe('blacksmith-usage');
    expect(selector.pr.environment).toBeUndefined();
    expect(JSON.stringify(selector.pr)).not.toContain('BLACKSMITH_ORG_TOKEN');
    expect(workflow('blacksmith-budget').jobs.budget.environment).toBe('blacksmith-usage');
  });

  it('keeps PR code away from the budget token and checks out only the trusted base', () => {
    const budget = workflow('blacksmith-budget').jobs;
    expect(budget.budget.steps[0].with?.ref).toBe('${{ github.event.pull_request.base.sha }}');
    expect(budget.budget.steps[0].with?.['persist-credentials']).toBe(false);
    expect(JSON.stringify(budget.budget.steps[0])).not.toContain('pull_request.head.sha');
    expect(budget.budget.steps[1].run).toBe('python3 .github/scripts/blacksmith-budget.py');
    expect(budget.budget.steps[2].uses).toBe('actions/upload-artifact@v4');
    expect(budget.budget.steps[2].with?.name).toContain('blacksmith-budget-pr-');
    const selector = workflow('blacksmith-selector').jobs.pr;
    const pr = selector.steps.find((step) => step.id === 'pr');
    expect(pr?.env?.GH_TOKEN).toBe('${{ github.token }}');
    expect(JSON.stringify(pr)).not.toContain('org_token');
    expect(pr?.run).toContain('blacksmith-pr-budget.py');
  });
});

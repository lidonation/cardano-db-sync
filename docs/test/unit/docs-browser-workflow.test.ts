import {readFileSync} from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';
import {describe, expect, it} from 'vitest';

const workflow = yaml.load(
  readFileSync(
    path.resolve(import.meta.dirname, '../../../.github/workflows/docs-site.yml'),
    'utf8',
  ),
) as {jobs: Record<string, {'runs-on'?: string; steps?: Array<{run?: string}>}>};

describe('docs browser runner compatibility', () => {
  it('supports reusable workflow jobs without step lists', () => {
    expect(workflow.jobs['activity-alert'].steps).toBeUndefined();
    expect(
      Object.values(workflow.jobs).some((job) =>
        job.steps?.some((step) => step.run?.includes('playwright install')),
      ),
    ).toBe(true);
  });
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (!job.steps?.some((step) => step.run?.includes('playwright install'))) continue;
    it(`${name} pins the OS supported by the locked Playwright version`, () => {
      const expected = "${{ needs.site-runner.outputs.runner || 'ubuntu-24.04' }}";
      expect(job['runs-on']).toBe(name === 'unit-tests' ? 'ubuntu-24.04' : expected);
      const selector = readFileSync(
        path.resolve(import.meta.dirname, '../../../.github/scripts/blacksmith-runner.py'),
        'utf8',
      );
      expect(selector).toContain("GITHUB = 'ubuntu-24.04'");
      expect(selector).toContain("BLACKSMITH = 'blacksmith-4vcpu-ubuntu-2404'");
    });
  }
});

describe('fork-only runner selection', () => {
  const jobs = workflow.jobs as Record<
    string,
    {
      needs?: string;
      if?: string;
      steps?: Array<{id?: string; if?: string; run?: string; 'working-directory'?: string}>;
    }
  >;

  it('uses the shared policy without passing secrets from the PR workflow', () => {
    expect(jobs['site-runner']).toHaveProperty(
      'uses',
      './.github/workflows/blacksmith-selector.yml',
    );
    expect(jobs['site-runner']).not.toHaveProperty('secrets');
  });

  it('runs selector regressions as a required CI step from the repository root', () => {
    const tests = jobs['static-analysis'].steps?.find((item) =>
      item.run?.includes('python3 -m unittest discover -s .github/tests'),
    );
    expect(tests, 'selector regressions must be a required CI step').toBeDefined();
    expect(tests?.['working-directory']).toBe('.');
    // Do not hide failures behind a status override, conditional or shell fallback.
    expect(tests?.run).toBe('python3 -m unittest discover -s .github/tests -v');
    expect(tests?.if).toBeUndefined();
    expect(tests).not.toHaveProperty('continue-on-error');
  });

  it('keeps build consumers gated on success even when the selector is skipped', () => {
    for (const name of ['links', 'asset-budget']) {
      expect(jobs[name].if).toBe("${{ !cancelled() && needs.build.result == 'success' }}");
    }
    for (const name of ['deploy-dev', 'deploy-production']) {
      expect(jobs[name].if).toContain('!cancelled()');
      expect(jobs[name].if).toContain("needs.gate.result == 'success'");
    }
  });

  it('limits credential use to the protected release environment and preserves fallback', () => {
    const selector = yaml.load(
      readFileSync(
        path.resolve(import.meta.dirname, '../../../.github/workflows/blacksmith-selector.yml'),
        'utf8',
      ),
    ) as {
      jobs: Record<
        string,
        {environment?: string; if?: string; steps?: Array<{env?: Record<string, string>}>}
      >;
    };
    expect(selector.jobs.push.environment).toBe('blacksmith-usage');
    expect(selector.jobs.push.if).toContain("github.event_name == 'push'");
    expect(selector.jobs.push.if).toContain("github.ref == 'refs/heads/release/community-site'");
    expect(selector.jobs.pr.environment).toBeUndefined();
    expect(JSON.stringify(selector.jobs.pr)).not.toContain('BLACKSMITH_ORG_TOKEN');
    expect(jobs.build.needs).toBe('site-runner');
    expect(jobs.build.if).toBe('${{ !cancelled() }}');
  });
});

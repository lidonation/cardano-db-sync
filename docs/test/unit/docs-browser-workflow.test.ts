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
      expect(job['runs-on']).toBe(expected);
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
  it('limits credential use to trusted release pushes and preserves fallback', () => {
    const source = readFileSync(
      path.resolve(import.meta.dirname, '../../../.github/workflows/docs-site.yml'),
      'utf8',
    );
    const parsed = yaml.load(source) as {
      jobs: Record<
        string,
        {needs?: string; if?: string; steps?: Array<{id?: string; if?: string}>}
      >;
    };
    const selector = parsed.jobs['site-runner'];
    const step = selector.steps?.find((item) => item.id === 'select');
    expect(step?.if).toContain("github.repository == 'lidonation/cardano-db-sync'");
    expect(step?.if).toContain("github.event_name == 'push'");
    expect(step?.if).toContain("github.ref == 'refs/heads/release/community-site'");
    for (const name of ['unit-tests', 'build']) {
      expect(parsed.jobs[name].needs).toBe('site-runner');
      expect(parsed.jobs[name].if).toBe('${{ !cancelled() }}');
    }
  });
});

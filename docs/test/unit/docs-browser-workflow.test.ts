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
      expect(job['runs-on']).toBe('ubuntu-24.04');
    });
  }
});

import {readFileSync} from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {describe, expect, it} from 'vitest';

describe('repository activity CI', () => {
  it('checks out full upstream history and restores the cache without making outages fatal', () => {
    const workflow = yaml.load(
      readFileSync(path.resolve('../.github/workflows/docs-site.yml'), 'utf8'),
    ) as {
      on: Record<string, unknown>;
      jobs: Record<
        string,
        {
          steps: {
            name?: string;
            uses?: string;
            with?: Record<string, unknown>;
            'continue-on-error'?: boolean;
          }[];
        }
      >;
    };
    expect(workflow.on.workflow_dispatch).toBeDefined();
    const raw = readFileSync(path.resolve('../.github/workflows/docs-site.yml'), 'utf8');
    expect(raw).toContain("github.event_name == 'workflow_dispatch'");
    expect(raw).toContain("github.ref == 'refs/heads/release/community-site'");
    expect(raw).toContain('activity-alert:');
    for (const job of ['build', 'deploy-dev', 'deploy-production']) {
      const steps = workflow.jobs[job].steps;
      const checkout = steps.find((step) => step.name === 'Check out upstream full history');
      expect(checkout?.with?.repository).toBe('IntersectMBO/cardano-db-sync');
      expect(checkout?.with?.ref).toBe('master');
      expect(checkout?.with?.['fetch-depth']).toBe(0);
      expect(checkout?.['continue-on-error']).toBe(true);
      expect(
        steps.find((step) => step.name === 'Restore repository activity cache')?.[
          'continue-on-error'
        ],
      ).toBe(true);
    }
  });
  it('defines a default-branch scheduler that dispatches the release ref', () => {
    const scheduler = yaml.load(
      readFileSync(path.resolve('../.github/workflows/docs-weekly-dispatch.yml'), 'utf8'),
    ) as {on: {schedule: {cron: string}[]}; jobs: {dispatch: {steps: {run: string}[]}}};
    expect(scheduler.on.schedule).toEqual([{cron: '30 4 * * 1'}]);
    expect(scheduler.jobs.dispatch.steps[0].run).toContain(
      'actions/workflows/docs-site.yml/dispatches',
    );
    expect(scheduler.jobs.dispatch.steps[0].run).toContain('ref=release/community-site');
  });
});

import {readFileSync} from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {expect, it} from 'vitest';

it('isolates scheduled chain credentials to the default branch and rebuilds changed snapshots', () => {
  const text = readFileSync(
    path.resolve(import.meta.dirname, '../../../.github/workflows/docs-chain-refresh.yml'),
    'utf8',
  );
  const workflow = yaml.load(text) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: Record<
      string,
      {
        if: string;
        uses?: string;
        permissions: Record<string, string>;
        needs?: string[];
        steps?: {name?: string; env?: Record<string, string>; run?: string; if?: string}[];
      }
    >;
  };
  expect(Object.keys(workflow.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
  expect(workflow.permissions).toEqual({contents: 'read'});
  const refresh = workflow.jobs.refresh;
  expect(refresh.if).toContain('github.ref_name == github.event.repository.default_branch');
  expect(refresh.permissions).toEqual({contents: 'write', actions: 'write'});
  const credentialSteps = refresh.steps!.filter((step) =>
    Object.keys(step.env ?? {}).some((key) => key.startsWith('BLOCKFROST_')),
  );
  expect(credentialSteps).toHaveLength(1);
  expect(credentialSteps[0].run).toBe('npm run chain:refresh');
  expect(
    refresh.steps!.find((step) => step.name === 'Commit changed public snapshots only')?.if,
  ).toContain('!cancelled()');
  const commands = refresh.steps!.map((step) => step.run ?? '').join('\n');
  expect(commands).toContain(
    'git add -- docs/generated/chain-preview.json docs/generated/chain-mainnet.json',
  );
  expect(commands).toContain('HEAD:refs/heads/$DEFAULT_BRANCH');
  expect(commands).toContain('docs-site.yml/dispatches');
  expect(commands).not.toContain('--force');
  expect(workflow.jobs.alert.uses).toBe('./.github/workflows/docs-ops-alert.yml');
  expect(workflow.jobs.alert.if).toContain('always()');
  expect(workflow.jobs.alert.needs).toEqual(['refresh']);
});

it('lets cron-dispatched production builds reach the existing protected deploy gate', () => {
  const site = yaml.load(
    readFileSync(
      path.resolve(import.meta.dirname, '../../../.github/workflows/docs-site.yml'),
      'utf8',
    ),
  ) as {jobs: Record<string, {if: string; needs: string; environment: {name: string}}>};
  const production = site.jobs['deploy-production'];
  expect(production.if).toContain("github.event_name == 'workflow_dispatch'");
  expect(production.if).toContain("needs.gate.result == 'success'");
  expect(production.if).toContain("github.repository == 'IntersectMBO/cardano-db-sync'");
  expect(production.if).toContain("github.ref == 'refs/heads/master'");
  expect(production.environment.name).toBe('production');
});

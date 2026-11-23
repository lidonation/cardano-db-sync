import {readFileSync} from 'node:fs';
import path from 'node:path';
import {load} from 'js-yaml';
import {describe, expect, it} from 'vitest';
const root = path.resolve(import.meta.dirname, '../../..');
function workflow(name: string) {
  return load(readFileSync(path.join(root, '.github/workflows', name), 'utf8')) as {
    on: Record<string, unknown>;
    concurrency: {group: string};
    jobs: Record<
      string,
      {
        if: string;
        permissions: Record<string, string>;
        steps: {run?: string; env?: Record<string, string>}[];
        uses?: string;
      }
    >;
  };
}
describe('B26 trusted scheduled workflow', () => {
  it('runs only default-branch code with network-scoped read-only provider secrets', () => {
    const w = workflow('docs-survey-tally.yml');
    expect(w.on.schedule).toEqual([{cron: '37 * * * *'}]);
    expect(w.jobs.tally.if).toBe('github.ref_name == github.event.repository.default_branch');
    expect(w.concurrency.group).toBe(workflow('docs-chain-refresh.yml').concurrency.group);
    expect(w.jobs.tally.steps.find((s) => s.run?.startsWith('npm run survey:tally'))?.env).toEqual({
      SELECTED_NETWORK: '${{ github.event.inputs.network }}',
      BLOCKFROST_PREVIEW_PROJECT_ID: '${{ secrets.BLOCKFROST_PREVIEW_PROJECT_ID }}',
      BLOCKFROST_MAINNET_PROJECT_ID: '${{ secrets.BLOCKFROST_MAINNET_PROJECT_ID }}',
    });
    const commit = w.jobs.tally.steps.find((s) => s.run?.includes('git add --'))!.run!;
    expect(commit.split('\n').find((l) => l.startsWith('git add'))).toBe(
      'git add -- docs/generated/survey-preview/aggregate.json docs/generated/survey-mainnet/aggregate.json',
    );
    expect(commit).not.toContain('git add .');
    expect(w.jobs.alert.uses).toBe('./.github/workflows/docs-ops-alert.yml');
  });
});

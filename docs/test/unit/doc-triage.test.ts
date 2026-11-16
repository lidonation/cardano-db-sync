import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');
const entries: {file: string; disposition: string; reason: string}[] = JSON.parse(
  readFileSync(path.join(root, 'docs/data/doc-triage.json'), 'utf8'),
);

const expected: Record<string, string[]> = {
  annotation: ['command-line-options.md', 'configuration.md', 'schema.md'],
  both: ['pool-offchain-data.md', 'smash.md'],
  guide: [
    'building-running.md',
    'database-encode-decode.md',
    'docker.md',
    'installing-with-nix.md',
    'installing.md',
    'interesting-queries.md',
    'manual-rollbacks.md',
    'migrations.md',
    'running.md',
    'schema-management.md',
    'state-snapshot.md',
    'troubleshooting.md',
    'upgrading-postgresql.md',
    'validation.md',
  ],
  omission: [
    'ERD.png',
    'Readme.md',
    'community-tools.md',
    'hlint-stylish-haskell.md',
    'release-process.md',
  ],
};

describe('CON-13 legacy documentation triage', () => {
  it('records every file exactly once with a disposition and reason', () => {
    const baseline = JSON.parse(
      readFileSync(path.join(root, 'docs/data/doc-retirement.json'), 'utf8'),
    );
    const files = execFileSync('git', ['ls-tree', '--name-only', `${baseline.sourceCommit}:doc`], {
      cwd: root,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .sort();
    expect(entries).toHaveLength(24);
    expect(entries.map((entry) => entry.file).sort()).toEqual(files);
    expect(new Set(entries.map((entry) => entry.file)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(Object.keys(expected)).toContain(entry.disposition);
      expect(entry.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it('preserves the specified destination for each source', () => {
    for (const [disposition, files] of Object.entries(expected)) {
      expect(
        entries
          .filter((entry) => entry.disposition === disposition)
          .map((entry) => entry.file)
          .sort(),
      ).toEqual(files.sort());
    }
  });
});

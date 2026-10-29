import {describe, expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {
  deriveVersions,
  selectReleaseTags,
  versionsFromTree,
} from '../../scripts/lib/version-derivation.mjs';

const root = new URL('../../../', import.meta.url).pathname;

describe('version derivation', () => {
  it('retains all releases in the five newest numeric minor lines, ignoring prereleases', () => {
    expect(
      selectReleaseTags([
        '1.1.0.0',
        '1.2.0.0',
        '1.3.0.0',
        '1.4.0.0',
        '1.5.0.0',
        '1.6.0.0',
        '1.6.1.0',
        '1.9.0.0-rc1',
      ]),
    ).toEqual(['1.2.0.0', '1.3.0.0', '1.4.0.0', '1.5.0.0', '1.6.0.0', '1.6.1.0']);
  });
  it('takes stage version maxima, never interpreting migration dates', () => {
    expect(
      versionsFromTree([
        'schema/migration-2-0045-20250708.sql',
        'schema/migration-2-0046-20250223.sql',
        'schema/migration-4-0008-20240604.sql',
      ]),
    ).toEqual({stage_two: '0046', stage_four: '0008'});
    expect(() => versionsFromTree(['schema/migration-2-0045-20250708.sql'])).toThrow();
  });
  it('selects stage maxima regardless of dates or input ordering across generated cases', () => {
    for (let n = 1; n <= 200; n += 1) {
      const a = String(n).padStart(4, '0');
      const b = String(n + 1).padStart(4, '0');
      const files = [
        `schema/migration-2-${a}-20991231.sql`,
        `schema/migration-2-${b}-19000101.sql`,
        'schema/migration-4-0001-20000101.sql',
      ];
      expect(versionsFromTree(files).stage_two).toBe(b);
      expect(versionsFromTree(files.reverse()).stage_two).toBe(b);
    }
  });
  it('rejects malformed stage migrations instead of silently ignoring them', () => {
    expect(() =>
      versionsFromTree([
        'schema/migration-2-0052-bad.sql',
        'schema/migration-2-0051-20260709.sql',
        'schema/migration-4-0009-20250223.sql',
      ]),
    ).toThrow(/malformed/i);
  });
  it('reproduces all six hand-verified historical pairs from actual tag trees', () => {
    const tags = ['13.5.0.2', '13.6.0.8', '13.7.0.0', '13.7.1.0', '13.7.2.0', '13.7.2.1'];
    const result = deriveVersions(tags, (tag) =>
      execFileSync('git', ['ls-tree', '-r', '--name-only', `refs/tags/${tag}`, '--', 'schema/'], {
        cwd: root,
        encoding: 'utf8',
      })
        .trim()
        .split('\n'),
    );
    expect(result.map(({stage_two, stage_four}) => [stage_two, stage_four])).toEqual([
      ['0043', '0008'],
      ['0044', '0008'],
      ['0045', '0008'],
      ['0048', '0009'],
      ['0050', '0009'],
      ['0050', '0009'],
    ]);
  });
});

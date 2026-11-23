import {execFileSync} from 'node:child_process';
import {describe, expect, it} from 'vitest';
import committed from '../../src/survey/manifest/registry.json';
import {readRegistry, validateEvolution} from '../../src/survey/manifest/lifecycle';

/** CI supplies the exact PR base / replaced push commit. Full-history unit checkout contains it.
 * Locally compare committed history; callers can also specify SURVEY_MANIFEST_BASE_REF. */
describe('reviewed registry history (R3/R7)', () => {
  it('retains every previously registered immutable definition', () => {
    const base = process.env.SURVEY_MANIFEST_BASE_REF || 'HEAD';
    const cwd = new URL('../../..', import.meta.url);
    if (/^0+$/.test(base)) {
      expect(() => readRegistry(committed)).not.toThrow();
      return;
    }
    execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], {cwd, stdio: 'pipe'});
    const file = 'docs/src/survey/manifest/registry.json';
    const names = execFileSync('git', ['ls-tree', '--name-only', base, '--', file], {
      cwd,
      encoding: 'utf8',
    });
    const current = readRegistry(committed);
    if (!names.trim()) return; // First introduction has no published registry history.
    const previous = readRegistry(
      JSON.parse(execFileSync('git', ['show', `${base}:${file}`], {cwd, encoding: 'utf8'})),
    );
    expect(validateEvolution(previous, current)).toEqual([]);
  });
});

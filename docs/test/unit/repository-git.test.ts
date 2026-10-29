import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {readHistory} from '../../plugins/repository-activity/git';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true});
});

describe('repository history', () => {
  it('reads full history, normalizes mailmap identities, and excludes bots from people', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'repo-activity-'));
    dirs.push(dir);
    const git = (...args: string[]) => execFileSync('git', args, {cwd: dir, encoding: 'utf8'});
    git('init');
    git('config', 'user.name', 'Alice');
    git('config', 'user.email', 'alice@example.org');
    writeFileSync(
      path.join(dir, '.mailmap'),
      'Alice <alice@example.org> Alias <alias@example.org>\n',
    );
    writeFileSync(path.join(dir, 'app.hs'), 'main = 1\n');
    git('add', '.');
    git('-c', 'user.name=Alias', '-c', 'user.email=alias@example.org', 'commit', '-m', 'first');
    writeFileSync(path.join(dir, 'app.hs'), 'main = 1\n-- another line\n');
    git('add', '.');
    git('commit', '-m', 'second');
    writeFileSync(path.join(dir, 'app.hs'), 'main = 1\n');
    git('add', '.');
    git('-c', 'user.name=release[bot]', '-c', 'user.email=bot@example.org', 'commit', '-m', 'bot');
    const history = readHistory(dir);
    expect(history.commits).toHaveLength(3);
    expect(history.authors).toEqual([
      {
        name: 'Alice',
        email: 'alice@example.org',
        commits: 2,
        sha: expect.stringMatching(/^[a-f0-9]{40}$/),
      },
    ]);
    expect(history.dailyLines.reduce((sum, day) => sum + day.haskell, 0)).toBe(1);
    expect(history.firstCommit).toMatch(/^\d{4}-\d\d-\d\d$/);
  });
  it('counts merge-resolution changes in the first-parent daily series', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'repo-merge-'));
    dirs.push(dir);
    const git = (...args: string[]) => execFileSync('git', args, {cwd: dir, encoding: 'utf8'});
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Alice');
    git('config', 'user.email', 'alice@example.org');
    writeFileSync(path.join(dir, 'base.hs'), 'base\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', 'feature');
    writeFileSync(path.join(dir, 'feature.hs'), 'feature\n');
    git('add', '.');
    git('commit', '-qm', 'feature');
    git('checkout', '-q', 'main');
    writeFileSync(path.join(dir, 'master.hs'), 'master\n');
    git('add', '.');
    git('commit', '-qm', 'master');
    git('merge', '--no-ff', '--no-commit', 'feature');
    writeFileSync(path.join(dir, 'resolution.hs'), 'resolution\n');
    git('add', '.');
    git('commit', '-qm', 'merge with resolution');
    const history = readHistory(dir);
    expect(history.commits).toHaveLength(4);
    expect(history.dailyLines.reduce((sum, day) => sum + day.haskell, 0)).toBe(4);
  });
  it('reports a genuinely empty repository as empty', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'repo-empty-'));
    dirs.push(dir);
    execFileSync('git', ['init', '-q'], {cwd: dir});
    expect(readHistory(dir)).toEqual({commits: [], authors: [], firstCommit: null, dailyLines: []});
  });
  it('rejects malformed log output instead of reporting an empty snapshot', () => {
    const fakeGit = (...args: string[]) =>
      args[0] === 'rev-parse' && args[1] === '--is-shallow-repository'
        ? 'false\n'
        : args[0] === 'rev-parse'
          ? 'a'.repeat(40)
          : 'not a git log';
    expect(() => readHistory('/unused', fakeGit)).toThrow('Malformed git log');
  });
  it('rejects a missing repository', () =>
    expect(() => readHistory('/not-a-repository')).toThrow());
});

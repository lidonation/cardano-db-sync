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
    expect(history.authors).toEqual([{name: 'Alice', email: 'alice@example.org', commits: 2}]);
    expect(history.dailyLines.reduce((sum, day) => sum + day.haskell, 0)).toBe(1);
    expect(history.firstCommit).toMatch(/^\d{4}-\d\d-\d\d$/);
  });
  it('rejects a missing repository', () =>
    expect(() => readHistory('/not-a-repository')).toThrow());
});

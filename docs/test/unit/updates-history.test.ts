import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {ENTRIES_PER_KIND, readUpdates} from '../../plugins/updates/history';

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach((dir) => rmSync(dir, {recursive: true, force: true})));
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'updates-history-'));
  temporary.push(dir);
  const git = (...args: string[]) => execFileSync('git', args, {cwd: dir, encoding: 'utf8'}).trim();
  git('init', '-b', 'main');
  git('remote', 'add', 'origin', 'https://github.com/lidonation/cardano-db-sync.git');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'private@example.com');
  const file = (name: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, name)), {recursive: true});
    writeFileSync(path.join(dir, name), text);
  };
  const commit = (title: string, date = '2026-01-02T01:00:00+03:00') => {
    git('add', '.');
    execFileSync('git', ['commit', '-qm', title], {
      cwd: dir,
      env: {...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date},
    });
    return git('rev-parse', 'HEAD');
  };
  return {dir, git, file, commit};
}

describe('git-derived updates (R1, R2)', () => {
  it('uses stable numeric tags and real migration/doc changes, with UTC dates and no author data', () => {
    const {dir, git, file, commit} = fixture();
    file('schema/migration-2-0001-20990101.sql', 'select 1;');
    file('cardano-db/src/Example.hs', '-- | Reference\n-- continued prose\nf = 1\n');
    const initial = commit('Initial reference & schema');
    git('tag', '1.0.0.0');
    git('tag', '1.0.0.0-rc.1');
    file('cardano-db/src/Example.hs', '-- | Reference\n-- changed continuation\nf = 1\n');
    const docs = commit('Reference <update>', '2026-01-03T01:00:00Z');
    // A code-only edit in an annotated file is not a documentation event.
    file(
      'cardano-db/src/Example.hs',
      '-- | Reference\n-- changed continuation\nf = 2\n-- ordinary comment\n',
    );
    const code = commit('Code only', '2026-01-04T01:00:00Z');
    execFileSync('git', ['tag', '-a', '1.1.0.0', '-m', 'Release'], {
      cwd: dir,
      env: {...process.env, GIT_COMMITTER_DATE: '2026-01-05T00:00:00Z'},
    });
    const feed = readUpdates(dir);
    expect(feed.asOf).toBe('2026-01-05');
    expect(
      feed.entries.every((e) => e.url.startsWith('https://github.com/lidonation/cardano-db-sync/')),
    ).toBe(true);
    expect(feed.entries.find((e) => e.id === 'release:1.1.0.0')?.url).toContain('/tree/1.1.0.0');
    expect(feed.entries.filter((e) => e.kind === 'release').map((e) => e.title)).toEqual([
      'Release 1.1.0.0',
      'Release 1.0.0.0',
    ]);
    expect(feed.entries.find((e) => e.id === `schema:${initial}`)?.date).toBe('2026-01-01');
    expect(feed.entries.find((e) => e.id === `docs:${docs}`)?.title).toBe('Reference <update>');
    expect(feed.entries.some((e) => e.id === `docs:${code}`)).toBe(false);
    expect(JSON.stringify(feed)).not.toMatch(/private@example|Fixture|2099/);
    expect(readUpdates(dir)).toEqual(feed);
  });
  it('reports a merged change once, includes releases on other branches, ignores non-migration SQL', () => {
    const {dir, git, file, commit} = fixture();
    file('Readme.md', 'Operator docs');
    commit('Initial');
    git('checkout', '-qb', 'other');
    file('docs/docs/guides/run.md', 'Run');
    file('schema/migration-2-0002-20260101.sql', 'select 2;');
    const side = commit('Side docs/schema');
    git('checkout', '-q', 'main');
    git('merge', '--no-ff', 'other', '-m', 'Merge docs/schema');
    const merge = git('rev-parse', 'HEAD');
    file('schema/test-uniqueness.sql', 'select 1;');
    const testOnly = commit('SQL test only', '2026-01-06T00:00:00Z');
    git('checkout', '--orphan', 'unrelated');
    git('rm', '-rf', '.');
    file('unrelated', 'not a release of this branch');
    commit('Unrelated');
    git('tag', '9.9.9.9');
    git('checkout', '-q', 'main');
    const feed = readUpdates(dir);
    expect(feed.entries.some((e) => e.id === 'release:9.9.9.9')).toBe(true);
    expect(
      feed.entries
        .filter((e) => e.id.endsWith(merge))
        .map((e) => e.kind)
        .sort(),
    ).toEqual(['docs', 'schema']);
    expect(feed.entries.some((e) => e.id.endsWith(side) || e.id.endsWith(testOnly))).toBe(false);
  });
  it('bounds each kind independently without changing IDs or generation bytes', () => {
    const {dir, git, file, commit} = fixture();
    for (let i = 0; i < 4; i++) {
      file('docs/docs/intro.md', String(i));
      commit(`Docs ${i}`, `2026-01-0${i + 1}T00:00:00Z`);
      git('tag', `1.0.0.${i}`);
    }
    const feed = readUpdates(dir, 2);
    expect(feed.entries.filter((e) => e.kind === 'docs').map((e) => e.title)).toEqual([
      'Docs 3',
      'Docs 2',
    ]);
    expect(feed.entries.filter((e) => e.kind === 'release')).toHaveLength(2);
    expect(JSON.stringify(readUpdates(dir, 2))).toBe(JSON.stringify(feed));
  });
  it('rejects shallow or unborn histories rather than publishing a misleading empty feed', () => {
    const {dir, file, commit} = fixture();
    expect(() => readUpdates(dir)).toThrow(/HEAD|history|commit/i);
    file('Readme.md', 'first');
    commit('first');
    file('Readme.md', 'second');
    commit('second');
    const shallow = `${dir}-shallow`;
    temporary.push(shallow);
    execFileSync('git', ['clone', '-q', '--depth=1', `file://${dir}`, shallow]);
    expect(() => readUpdates(shallow)).toThrow(/full history|shallow/i);
  });
});

it('supports SSH origins, rejects credential-bearing origins, and distinguishes a real empty feed', () => {
  const {dir, git, file, commit} = fixture();
  file('only-code.txt', 'no update events yet');
  commit('Initial source');
  git('remote', 'set-url', 'origin', 'git@github.com:example/repository.git');
  expect(readUpdates(dir).entries).toEqual([]);
  expect(() => readUpdates(dir, 0)).toThrow(/retention/);
  git('remote', 'set-url', 'origin', 'https://secret@github.com/example/repository');
  expect(() => readUpdates(dir)).toThrow(/without credentials/);
});

it('tracks block and inline Haddock edits and removals without leaking source text', () => {
  const {dir, file, commit} = fixture();
  file(
    'cardano-db/src/Block.hs',
    '{-| Block documentation\ncontinued\n-}\nf = 1 -- ^ Inline field doc\n',
  );
  const first = commit('Documented source');
  file(
    'cardano-db/src/Block.hs',
    '{-| Block documentation\nchanged continuation\n-}\nf = 1 -- ^ Inline field doc\n',
  );
  const changed = commit('Continued block');
  file('cardano-db/src/Block.hs', 'f = 1\n');
  const removed = commit('Removed docs');
  expect(
    readUpdates(dir)
      .entries.filter((e) => e.kind === 'docs')
      .map((e) => e.id)
      .sort(),
  ).toEqual([first, changed, removed].map((sha) => `docs:${sha}`).sort());
});

it('does not treat Haddock-like text in Haskell string literals as documentation edits', () => {
  const {dir, file, commit} = fixture();
  file('cardano-db/src/Strings.hs', 'example = "-- ^ not documentation"\n');
  commit('String value');
  file('cardano-db/src/Strings.hs', 'example = "-- ^ changed string value"\n');
  commit('String-only change');
  expect(readUpdates(dir).entries).toEqual([]);
});

it('retains the latest bounded subscription window independently for all three kinds', () => {
  const {dir, git, file, commit} = fixture();
  let first = '';
  for (let i = 0; i <= ENTRIES_PER_KIND; i++) {
    file('docs/docs/intro.md', `Guide ${i}`);
    file('schema/migration-2-0001-20260101.sql', `select ${i};`);
    const sha = commit(`Change ${i}`, new Date(Date.UTC(2026, 0, i + 1)).toISOString());
    if (i === 0) first = sha;
    git('tag', `1.0.0.${i}`);
  }
  const feed = readUpdates(dir);
  for (const kind of ['release', 'schema', 'docs'])
    expect(feed.entries.filter((e) => e.kind === kind)).toHaveLength(ENTRIES_PER_KIND);
  expect(feed.entries.some((e) => e.id.endsWith(first) || e.id === 'release:1.0.0.0')).toBe(false);
  expect(() => readUpdates(dir, ENTRIES_PER_KIND + 1)).toThrow(/retention/);
});

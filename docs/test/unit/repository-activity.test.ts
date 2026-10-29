import {describe, expect, it} from 'vitest';
import {enrichHistory, resolveActivity} from '../../plugins/repository-activity/data';
import type {GitHistory} from '../../plugins/repository-activity/git';

const history: GitHistory = {
  commits: [{sha: 'a'.repeat(40), date: '2026-01-01', subject: 'first', author: 'Alice'}],
  authors: [{name: 'Alice', email: 'private@example.org', commits: 1, sha: 'a'.repeat(40)}],
  firstCommit: '2026-01-01',
  dailyLines: [{date: '2026-01-01', haskell: 1, sql: 0, nix: 0, cabal: 0, docs: 0}],
};
const profile = {
  login: 'alice',
  name: 'Alice',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1',
  location: 'Nairobi, Kenya',
};

describe('repository activity build data', () => {
  it('publishes country counts without emails or per-person locations', async () => {
    const data = await enrichHistory(
      history,
      [profile],
      '2026-02-01T00:00:00.000Z',
      async () => '/repository-avatars/alice.png',
    );
    expect(data.contributors).toEqual([
      {login: 'alice', name: 'Alice', commits: 1, avatar: '/repository-avatars/alice.png'},
    ]);
    expect(data.countries).toEqual([{country: 'Kenya', count: 1}]);
    expect(JSON.stringify(data)).not.toMatch(/private@example|Nairobi/);
  });
  it('falls back to valid cached data and distinguishes unavailable from an empty repository', async () => {
    const data = await enrichHistory(
      {...history, commits: [], authors: [], firstCommit: null, dailyLines: []},
      [],
      '2026-02-01T00:00:00.000Z',
      async () => null,
    );
    expect(
      await resolveActivity(
        async () => {
          throw new Error('offline');
        },
        async () => data,
      ),
    ).toEqual({status: 'available', data});
    expect(
      await resolveActivity(
        async () => {
          throw new Error('offline');
        },
        async () => null,
      ),
    ).toEqual({status: 'unavailable'});
    expect(
      await resolveActivity(
        async () => data,
        async () => null,
      ),
    ).toEqual({status: 'available', data});
  });
  it('rejects incomplete or malformed profile responses', async () => {
    await expect(
      enrichHistory(history, [], '2026-02-01T00:00:00.000Z', async () => null),
    ).rejects.toThrow();
    await expect(
      enrichHistory(
        history,
        [{...profile, login: 'bad/name'}],
        '2026-02-01T00:00:00.000Z',
        async () => null,
      ),
    ).rejects.toThrow();
  });
});

describe('cached build data', () => {
  it('rejects corrupt and unsafe cache data', async () => {
    const {parseCache} = await import('../../plugins/repository-activity/cache');
    const data = await enrichHistory(
      history,
      [profile],
      '2026-02-01T00:00:00.000Z',
      async () => null,
    );
    expect(parseCache(JSON.stringify(data))).toEqual(data);
    expect(() => parseCache('{')).toThrow();
    expect(() =>
      parseCache(
        JSON.stringify({
          ...data,
          contributors: [{...data.contributors[0], avatar: 'https://evil.example/a.png'}],
        }),
      ),
    ).toThrow();
    expect(() => parseCache(JSON.stringify({...data, dailyLines: 'not-an-array'}))).toThrow();
    expect(() => parseCache(JSON.stringify({...data, unknownCountries: 42}))).toThrow();
    expect(() => parseCache(JSON.stringify({...data, firstCommit: '2026-02-31'}))).toThrow();
  });
});

it('keeps commit details out of the page summary while preserving measured values', async () => {
  const {summarizeActivity} = await import('../../plugins/repository-activity/data');
  const data = await enrichHistory(
    history,
    [profile],
    '2026-02-01T00:00:00.000Z',
    async () => null,
  );
  const summary = summarizeActivity({status: 'available', data});
  expect(summary.status).toBe('available');
  if (summary.status === 'available') {
    expect(summary.data.metrics.commits).toBe(1);
    expect(JSON.stringify(summary)).not.toContain('first');
    expect(JSON.stringify(summary)).not.toContain('dailyLines');
  }
  expect(summarizeActivity({status: 'unavailable'})).toEqual({status: 'unavailable'});
});

it('shows non-committing core maintainers without counting their location as a contributor', async () => {
  const maintainer = {
    login: 'profd2004',
    name: 'Darlington',
    avatarUrl: 'https://avatars.githubusercontent.com/u/2',
    location: 'Kenya',
  };
  const data = await enrichHistory(
    history,
    [profile],
    '2026-02-01T00:00:00.000Z',
    async () => null,
    [maintainer],
  );
  expect(data.contributors).toHaveLength(1);
  expect(data.coreTeam).toEqual([
    {login: 'profd2004', name: 'Darlington', commits: 0, avatar: null},
  ]);
  expect(data.countries).toEqual([{country: 'Kenya', count: 1}]);
});

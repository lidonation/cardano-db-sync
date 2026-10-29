import {describe, expect, it} from 'vitest';
import {activityMetrics} from '../../src/repository-activity/metrics';
import type {RepositoryData} from '../../src/repository-activity/types';

describe('repository metrics', () => {
  it('uses one build timestamp and one contributor count for all metrics', () => {
    const data: RepositoryData = {
      version: 1,
      builtAt: '2026-06-01T00:00:00.000Z',
      firstCommit: '2020-07-01',
      commits: [
        {sha: 'a'.repeat(40), date: '2025-05-31', subject: '', author: 'A'},
        {sha: 'b'.repeat(40), date: '2025-06-01', subject: '', author: 'A'},
      ],
      contributors: [{login: 'a', name: 'A', commits: 2, avatar: null}],
      coreTeam: [],
      countries: [],
      unknownCountries: 1,
      dailyLines: [{date: '2020-07-01', haskell: 3, sql: 2, nix: -1, cabal: 0, docs: 4}],
    };
    expect(activityMetrics(data)).toEqual({
      commits: 2,
      pastYear: 1,
      lines: 8,
      contributors: 1,
      years: 5,
    });
  });
  it('represents an empty repository without invented dates', () => {
    const data: RepositoryData = {
      version: 1,
      builtAt: '2026-06-01T00:00:00Z',
      firstCommit: null,
      commits: [],
      contributors: [],
      coreTeam: [],
      countries: [],
      unknownCountries: 0,
      dailyLines: [],
    };
    expect(activityMetrics(data)).toEqual({
      commits: 0,
      pastYear: 0,
      lines: 0,
      contributors: 0,
      years: null,
    });
  });
});

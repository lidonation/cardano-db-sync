import {describe, expect, it} from 'vitest';
import {chartData, selectSeries} from '../../src/ecosystem/chart-data';
import type {RepositoryData} from '../../src/repository-activity/types';

const data: RepositoryData = {
  version: 1,
  builtAt: '2026-08-15T12:00:00.000Z',
  firstCommit: '2025-01-01',
  contributors: [],
  coreTeam: [],
  countries: [],
  unknownCountries: 0,
  commits: [
    {sha: 'a', date: '2026-08-15', author: 'A', subject: ''},
    {sha: 'b', date: '2026-08-15', author: 'B', subject: ''},
    {sha: 'c', date: '2026-08-08', author: 'A', subject: ''},
    {sha: 'd', date: '2024-01-01', author: 'A', subject: ''},
  ],
  dailyLines: [
    {date: '2025-01-01', haskell: 100, sql: 0, nix: 0, cabal: 0, docs: 0},
    {date: '2026-08-08', haskell: 10, sql: 0, nix: 0, cabal: 0, docs: 0},
    {date: '2026-08-15', haskell: -4, sql: 0, nix: 0, cabal: 0, docs: 0},
  ],
};

describe('activity charts', () => {
  it('selects cumulative monthly or daily totals including days without changes', () => {
    const charts = chartData(data);
    expect(selectSeries(charts, '12m')).toHaveLength(12);
    expect(selectSeries(charts, '30d')).toHaveLength(30);
    const week = selectSeries(charts, '7d');
    expect(week).toHaveLength(7);
    expect(week[0].value).toBe(110);
    expect(week.at(-1)).toEqual({date: '2026-08-15', value: 106});
  });
  it('has 52 weeks of seven cells and consistent weekly totals', () => {
    const {weeks} = chartData(data);
    expect(weeks).toHaveLength(52);
    expect(weeks.every((week) => week.days.length === 7)).toBe(true);
    expect(weeks.at(-1)!.days.at(-1)).toEqual({date: '2026-08-15', count: 2});
    expect(weeks.reduce((sum, week) => sum + week.total, 0)).toBe(3);
    for (const week of weeks) expect(week.total).toBe(week.days.reduce((s, d) => s + d.count, 0));
  });
});

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
  it.each([
    ['2026-08-15T23:30:00-03:00', '2026-08-16'],
    ['2026-08-15T00:30:00+03:00', '2026-08-14'],
    ['August 15, 2026 12:00:00 GMT', '2026-08-15'],
  ])('normalizes accepted timestamps to the UTC chart date: %s', (builtAt, expected) => {
    const result = chartData({...data, builtAt});
    expect(result.daily.at(-1)?.date).toBe(expected);
    expect(result.monthly.at(-1)?.date).toBe(expected);
    expect(result.weeks.at(-1)?.days.at(-1)?.date).toBe(expected);
  });
  it('has 52 weeks of seven cells and consistent weekly totals', () => {
    const {weeks} = chartData(data);
    expect(weeks).toHaveLength(52);
    expect(weeks.every((week) => week.days.length === 7)).toBe(true);
    expect(weeks.at(-1)!.days.at(-1)).toEqual({date: '2026-08-15', count: 2});
    expect(weeks.reduce((sum, week) => sum + week.total, 0)).toBe(3);
    for (const week of weeks) expect(week.total).toBe(week.days.reduce((s, d) => s + d.count, 0));
  });
  it('handles leap days, unsorted changes and future records without leaking future totals', () => {
    const snapshot = {
      ...data,
      builtAt: '2024-03-01T00:00:00.000Z',
      dailyLines: [
        {date: '2024-03-02', haskell: 1000, sql: 0, nix: 0, cabal: 0, docs: 0},
        {date: '2024-02-29', haskell: -2, sql: 0, nix: 0, cabal: 0, docs: 0},
        {date: '2024-01-01', haskell: 10, sql: 0, nix: 0, cabal: 0, docs: 0},
      ],
    };
    const result = chartData(snapshot);
    expect(result.monthly.at(-2)).toEqual({date: '2024-02-29', value: 8});
    expect(result.daily.at(-1)).toEqual({date: '2024-03-01', value: 8});
    expect(result.daily.at(-2)).toEqual({date: '2024-02-29', value: 8});
  });
  it('agrees with a direct sum for varied daily series', () => {
    let seed = 47;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed;
    };
    const rows = Array.from({length: 100}, (_, index) => ({
      date: new Date(Date.UTC(2026, 4, 1 + index)).toISOString().slice(0, 10),
      haskell: (random() % 21) - 10,
      sql: random() % 5,
      nix: 0,
      cabal: 0,
      docs: 0,
    }));
    const result = chartData({...data, dailyLines: rows.reverse()});
    for (const point of [...result.monthly, ...result.daily]) {
      expect(point.value).toBe(
        rows
          .filter((row) => row.date <= point.date)
          .reduce((sum, row) => sum + row.haskell + row.sql, 0),
      );
    }
  });
  it('represents a valid empty history as zero rather than unavailable', () => {
    const result = chartData({...data, commits: [], dailyLines: []});
    expect(result.daily.every((point) => point.value === 0)).toBe(true);
    expect(result.monthly.every((point) => point.value === 0)).toBe(true);
    expect(result.weeks.every((week) => week.total === 0)).toBe(true);
  });
});

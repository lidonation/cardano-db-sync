import type {RepositoryData} from '../repository-activity/types';

export type Range = '12m' | '30d' | '7d';
export type LinePoint = {date: string; value: number};
export type CommitDay = {date: string; count: number};
export type CommitWeek = {days: CommitDay[]; total: number};
export type ActivityCharts = {monthly: LinePoint[]; daily: LinePoint[]; weeks: CommitWeek[]};

const DAY = 86400000;
const dateString = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Produce bounded, public chart data at build time, not the full commit history. */
export function chartData(data: RepositoryData): ActivityCharts {
  const end = Date.parse(`${data.builtAt.slice(0, 10)}T00:00:00Z`);
  const endDate = new Date(end);
  const monthEnds = Array.from({length: 12}, (_, index) => {
    if (index === 11) return dateString(end);
    return dateString(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - (10 - index), 0));
  });
  const dailyDates = Array.from({length: 30}, (_, index) => dateString(end - (29 - index) * DAY));
  const changes = [...data.dailyLines].sort((a, b) => a.date.localeCompare(b.date));
  const dates = [...new Set([...monthEnds, ...dailyDates])].sort();
  let value = 0;
  let cursor = 0;
  const totals = new Map<string, number>();
  for (const date of dates) {
    while (cursor < changes.length && changes[cursor].date <= date) {
      const row = changes[cursor++];
      value += row.haskell + row.sql + row.nix + row.cabal + row.docs;
    }
    totals.set(date, value);
  }
  const point = (date: string): LinePoint => ({date, value: totals.get(date)!});
  const counts = new Map<string, number>();
  for (const commit of data.commits) counts.set(commit.date, (counts.get(commit.date) ?? 0) + 1);
  const days = Array.from({length: 364}, (_, index) => {
    const date = dateString(end - (363 - index) * DAY);
    return {date, count: counts.get(date) ?? 0};
  });
  const weeks = Array.from({length: 52}, (_, index) => {
    const week = days.slice(index * 7, index * 7 + 7);
    return {days: week, total: week.reduce((sum, day) => sum + day.count, 0)};
  });
  return {monthly: monthEnds.map(point), daily: dailyDates.map(point), weeks};
}

export function selectSeries(data: ActivityCharts, range: Range): LinePoint[] {
  return range === '12m' ? data.monthly : data.daily.slice(range === '7d' ? -7 : -30);
}

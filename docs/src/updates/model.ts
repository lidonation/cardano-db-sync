import type {DateRange, Period, UpdateEntry, UpdatesFeed} from './types';

const DAY = 86_400_000;
/** Calendar dates only, with no timezone-dependent parse or rolled invalid day. */
export function validDate(value: string): boolean {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function rangeError(range: DateRange): 'required' | 'invalid' | 'reversed' | null {
  if (!range.from || !range.to) return 'required';
  if (!validDate(range.from) || !validDate(range.to)) return 'invalid';
  return range.from > range.to ? 'reversed' : null;
}
/** Reject bad build data, including unsafe outbound URLs, before it reaches the UI. */
export function validateFeed(value: unknown): UpdatesFeed {
  if (!value || typeof value !== 'object') throw new Error('Updates feed must be an object.');
  const feed = value as Partial<UpdatesFeed>;
  if (typeof feed.asOf !== 'string' || !validDate(feed.asOf) || !Array.isArray(feed.entries)) {
    throw new Error('Updates feed needs a valid asOf date and entries.');
  }
  const ids = new Set<string>();
  const entries: UpdateEntry[] = feed.entries.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid update entry.');
    const e = entry as Partial<UpdateEntry>;
    if (
      typeof e.id !== 'string' ||
      !e.id.trim() ||
      ids.has(e.id) ||
      typeof e.date !== 'string' ||
      !validDate(e.date) ||
      e.date > feed.asOf! ||
      !['release', 'schema', 'docs'].includes(e.kind ?? '') ||
      typeof e.title !== 'string' ||
      !e.title.trim() ||
      typeof e.url !== 'string'
    ) {
      throw new Error('Invalid update entry.');
    }
    const url = new URL(e.url);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Unsafe update URL.');
    ids.add(e.id);
    return {id: e.id, date: e.date, kind: e.kind!, title: e.title, url: url.href};
  });
  return {asOf: feed.asOf, entries};
}
/** Stable, inclusive UTC calendar windows, anchored to the feed snapshot, not hydration time. */
export function selectEntries(
  feed: UpdatesFeed,
  period: Period,
  range: DateRange,
): readonly UpdateEntry[] {
  if (period === 'custom' && rangeError(range)) return [];
  const days = period === 'week' ? 7 : 30;
  const from =
    period === 'custom'
      ? range.from
      : period === 'total'
        ? ''
        : new Date(Date.parse(`${feed.asOf}T00:00:00Z`) - (days - 1) * DAY)
            .toISOString()
            .slice(0, 10);
  const to = period === 'custom' ? range.to : feed.asOf;
  return feed.entries
    .filter((e) => e.date >= from && e.date <= to)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

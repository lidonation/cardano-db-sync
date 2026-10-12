import {describe, expect, it} from 'vitest';
import {rangeError, selectEntries, validDate, validateFeed} from '../../src/updates/model';
import type {UpdatesFeed} from '../../src/updates/types';
const feed: UpdatesFeed = {
  asOf: '2026-10-12',
  entries: ['2026-10-12', '2026-10-06', '2026-10-05', '2026-09-13', '2026-09-12'].map(
    (date, i) => ({
      id: String(i),
      date,
      kind: 'docs',
      title: 'Real change',
      url: 'https://github.com/IntersectMBO/cardano-db-sync/commit/' + i,
    }),
  ),
};
describe('Updates feed boundary', () => {
  it('accepts an empty real feed and preserves immutable input', () => {
    expect(validateFeed({asOf: feed.asOf, entries: []})).toEqual({asOf: feed.asOf, entries: []});
    expect(validateFeed(feed)).toEqual(feed);
  });
  it.each([
    null,
    {},
    {asOf: 'bad', entries: []},
    {...feed, entries: null},
    {...feed, entries: [{...feed.entries[0], kind: 'other'}]},
    {...feed, entries: [{...feed.entries[0], date: '2026-02-30'}]},
    {...feed, entries: [{...feed.entries[0], date: '2026-10-13'}]},
    {...feed, entries: [{...feed.entries[0], url: 'javascript:alert(1)'}]},
    {...feed, entries: [{...feed.entries[0], url: 'https://user:pass@example.com/'}]},
    {...feed, entries: [feed.entries[0], feed.entries[0]]},
    {...feed, entries: [{...feed.entries[0], title: ''}]},
    {...feed, entries: [{...feed.entries[0], id: ''}]},
  ])('rejects malformed or unsafe input %#', (value) =>
    expect(() => validateFeed(value)).toThrow(),
  );
  it('normalizes HTTPS sources so browser resolution matches validation', () => {
    const entry = validateFeed({
      ...feed,
      entries: [{...feed.entries[0], url: 'https:example.com/change'}],
    }).entries[0];
    expect(entry.url).toBe('https://example.com/change');
    expect(new URL(entry.url, 'https://dbsync.cardano.intersect.org/updates/').href).toBe(
      entry.url,
    );
  });
  it('retains hostile titles as plain text data', () => {
    expect(
      validateFeed({...feed, entries: [{...feed.entries[0], title: '<script>alert(1)</script>'}]})
        .entries[0].title,
    ).toContain('<script>');
  });
});
describe('UTC filtering', () => {
  it('uses inclusive seven and thirty calendar days', () => {
    expect(selectEntries(feed, 'week', {from: '', to: ''}).map((e) => e.id)).toEqual(['0', '1']);
    expect(selectEntries(feed, 'month', {from: '', to: ''}).map((e) => e.id)).toEqual([
      '0',
      '1',
      '2',
      '3',
    ]);
  });
  it('sorts newest first without mutating the feed', () => {
    const reversed = {...feed, entries: [...feed.entries].reverse()};
    expect(selectEntries(reversed, 'total', {from: '', to: ''})).toEqual(feed.entries);
    expect(reversed.entries[0].id).toBe('4');
  });
  it('includes both custom endpoints', () =>
    expect(
      selectEntries(feed, 'custom', {from: '2026-10-05', to: '2026-10-06'}).map((e) => e.id),
    ).toEqual(['1', '2']));
  it.each([
    {from: '', to: ''},
    {from: '2026-02-30', to: '2026-10-12'},
    {from: '2026-10-12', to: '2026-10-05'},
  ])('shows no results for invalid custom range', (range) =>
    expect(selectEntries(feed, 'custom', range)).toEqual([]),
  );
  it('reports required, malformed and reversed ranges separately', () => {
    expect(rangeError({from: '', to: ''})).toBe('required');
    expect(rangeError({from: 'invalid', to: '2026-10-12'})).toBe('invalid');
    expect(rangeError({from: '2026-10-12', to: '2026-10-11'})).toBe('reversed');
    expect(rangeError({from: '2026-10-12', to: '2026-10-12'})).toBeNull();
  });
  it('validates leap years and rejects rolled dates', () => {
    expect(validDate('2024-02-29')).toBe(true);
    for (const d of ['2026-02-29', '2026-13-01', '2026-1-01', '0000-01-01', '2026-04-31'])
      expect(validDate(d)).toBe(false);
  });
  it('bounded calendar-property check over 500 days', () => {
    for (let i = 0; i < 500; i++) {
      const date = new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
      expect(validDate(date)).toBe(true);
      expect(
        selectEntries({...feed, asOf: date, entries: [{...feed.entries[0], date}]}, 'week', {
          from: '',
          to: '',
        }),
      ).toHaveLength(1);
    }
  });
});

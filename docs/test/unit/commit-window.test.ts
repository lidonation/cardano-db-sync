import {describe, expect, it} from 'vitest';
import {selectDatedEntries} from '../../src/updates/model';

describe('repository commit windows', () => {
  const entries = [
    {id: 'a', date: '2026-06-01', subject: '<b>literal</b>'},
    {id: 'b', date: '2026-05-26', subject: 'week boundary'},
    {id: 'c', date: '2026-05-03', subject: 'month boundary'},
    {id: 'd', date: '2020-01-01', subject: 'old'},
  ];
  const range = {from: '2026-05-03', to: '2026-05-26'};
  const select = (period: 'week' | 'month' | 'total' | 'custom') =>
    selectDatedEntries({asOf: '2026-06-01', entries}, period, range).map((e) => e.id);
  it('uses inclusive UTC windows for commits without converting them into curated events', () => {
    expect(select('week')).toEqual(['a', 'b']);
    expect(select('month')).toEqual(['a', 'b', 'c']);
    expect(select('total')).toEqual(['a', 'b', 'c', 'd']);
    expect(select('custom')).toEqual(['b', 'c']);
  });
  it('rejects a reversed range', () => {
    expect(
      selectDatedEntries({asOf: '2026-06-01', entries}, 'custom', {
        from: '2026-06-01',
        to: '2026-01-01',
      }),
    ).toEqual([]);
  });
});

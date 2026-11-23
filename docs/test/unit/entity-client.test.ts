import {describe, expect, it, vi} from 'vitest';
import {createEntitySearch} from '../../src/search/client';
import {createEntityIndex} from '../../src/search/engine';
import type {SearchEntity} from '../../src/search/entities';

const record: SearchEntity = {
  id: 'tx_out',
  identifier: 'tx_out',
  aliases: [],
  kind: 'table',
  group: 'tables',
  title: 'tx_out',
  body: '',
  facets: {},
  url: '/schema/tx_out',
};
const hash = 'a'.repeat(64);
function fixture() {
  const manifest = {
    schemaVersion: 1,
    locale: 'ja',
    bundles: {current: `entities/current.${hash}.json`, '13.6': `entities/13.6.${hash}.json`},
  };
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
    const line = url.includes('13.6.') ? '13.6' : 'current';
    return {
      ok: true,
      json: async (): Promise<unknown> =>
        url.endsWith('manifest.json')
          ? manifest
          : {
              schemaVersion: 1,
              line,
              locale: 'ja',
              index: createEntityIndex([{...record, url: `/${line}/tx_out`}]).toJSON(),
            },
    };
  });
  return {fetcher, manifest};
}
describe('entity client (SRCH-4)', () => {
  it('loads only the active line, caches by client scope and widens only by opt-in', async () => {
    const {fetcher} = fixture();
    const client = createEntitySearch('/base/ja/', 'ja', fetcher);
    const found = await client.search('13.6', 'tx_out');
    expect(found[0].hits.map((h) => h.line)).toEqual(['13.6']);
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
      '/base/ja/entities/manifest.json',
      `/base/ja/entities/13.6.${hash}.json`,
    ]);
    await client.search('13.6', 'tx_out');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const all = await client.search('13.6', 'tx_out', {widen: true, cap: 1});
    expect(all[0]).toMatchObject({total: 2, hasMore: true});
    expect(all[0].hits[0].line).toBe('13.6');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      cache: 'no-cache',
      signal: expect.any(AbortSignal),
    });
  });
  it('handles empty queries without fetching and refuses unknown lines instead of falling back', async () => {
    const {fetcher} = fixture();
    const client = createEntitySearch('/base/', 'ja', fetcher);
    expect((await client.search('current', '')).every((g) => g.total === 0)).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(client.search('unknown', 'tx')).rejects.toThrow(/Unknown/);
    await expect(client.search('../escape', 'tx')).rejects.toThrow(/version/);
    await expect(client.search('current', 'tx', {cap: 0})).rejects.toThrow(/cap/);
  });
  it('rejects fetch failures, wrong bundle identities, and unsafe manifest paths; failures can retry', async () => {
    const {fetcher, manifest} = fixture();
    fetcher.mockResolvedValueOnce({ok: false, json: async () => ({})});
    const client = createEntitySearch('/base/', 'ja', fetcher);
    await expect(client.search('current', 'tx')).rejects.toThrow(/fetch/);
    expect((await client.search('current', 'tx'))[0].total).toBe(1);
    const other = fixture();
    other.manifest.bundles.current = 'https://evil.test/payload';
    await expect(
      createEntitySearch('/base/', 'ja', other.fetcher).search('current', 'tx'),
    ).rejects.toThrow(/manifest/);
    const wrong = vi.fn(async (url: string) => ({
      ok: true,
      json: async (): Promise<unknown> =>
        url.endsWith('manifest.json')
          ? manifest
          : {schemaVersion: 1, line: 'other', locale: 'ja', index: {}},
    }));
    await expect(createEntitySearch('/base/', 'ja', wrong).search('current', 'tx')).rejects.toThrow(
      /identity/,
    );
    await expect(
      createEntitySearch('/base/', 'en', fetcher).search('current', 'tx'),
    ).rejects.toThrow(/manifest/);
  });
});

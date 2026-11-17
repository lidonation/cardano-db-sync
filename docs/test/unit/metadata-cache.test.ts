import {describe, expect, it} from 'vitest';
import type {Plugin} from '@docusaurus/types';
import {cacheByMetadata} from '../../plugins/metadata';
type Configuration = Parameters<NonNullable<Plugin['configureWebpack']>>[0];
describe('metadata parser participates in persistent cache identity', () => {
  it('keeps the Docusaurus identity, deterministically varies with parser code, and leaves disabled caches disabled', () => {
    const config = (): Configuration => ({
      cache: {type: 'filesystem', version: 'docusaurus-theme-hash'},
    });
    const a = config(),
      b = config(),
      changed = config();
    cacheByMetadata(a, 'parser v1');
    cacheByMetadata(b, 'parser v1');
    cacheByMetadata(changed, 'parser v2');
    expect(a.cache).toEqual(b.cache);
    expect(a.cache).not.toEqual(changed.cache);
    expect(
      a.cache && typeof a.cache === 'object' && a.cache.type === 'filesystem' && a.cache.version,
    ).toMatch(/^docusaurus-theme-hash-metadata-/);
    for (const cache of [false, undefined, {type: 'memory'}] as const) {
      const disabled: Configuration = {cache};
      cacheByMetadata(disabled, 'parser');
      expect(disabled.cache).toBe(cache);
    }
  });
});

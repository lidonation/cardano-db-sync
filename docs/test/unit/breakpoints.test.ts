import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {BREAKPOINTS, atLeast, below} from '../../src/lib/breakpoints';

const source = JSON.parse(
  readFileSync(new URL('../../design/tokens.source.json', import.meta.url), 'utf8'),
);

describe('breakpoints', () => {
  it('mirror breakpoint.* in tokens.source.json', () => {
    const tokens = Object.fromEntries(
      Object.entries(source.base.breakpoint as Record<string, string>).map(([k, v]) => [
        k,
        Number.parseInt(v, 10),
      ]),
    );
    expect(tokens).toEqual({...BREAKPOINTS});
  });

  it('build min and max queries that never overlap', () => {
    expect(atLeast('md')).toBe('(min-width: 1024px)');
    expect(below('md')).toBe('(max-width: 1023px)');
  });
});

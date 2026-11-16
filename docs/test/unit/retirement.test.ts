import {describe, expect, it} from 'vitest';
import {archiveUrl, retiredVersion, retirementTarget} from '../../src/retirement/routes';

const data = {
  lines: [
    {name: 'current', path: '/docs/next'},
    {name: '13.7.0.0', path: '/docs'},
  ],
  latest: {name: '13.7.0.0', path: '/docs'},
};
const live = new Set(['/', '/docs/intro', '/docs/guides', '/docs/guides/docker']);

describe('VER-5/6 retirement policy', () => {
  it('offers the current equivalent for both historical URL forms', () => {
    for (const route of ['/docs/13.3.0.0/guides/docker', '/v1/guides/docker']) {
      expect(retirementTarget(route, live, data)).toBe('/docs/guides/docker');
    }
  });
  it('uses a real ancestor when no same-page equivalent exists', () => {
    expect(retirementTarget('/docs/v1/missing', live, data)).toBe('/');
    expect(retirementTarget('/docs/guides/missing', live, data)).toBe('/docs/guides');
    expect(retirementTarget('/unknown', live, data)).toBe('/');
  });
  it('does not call a live version, current-line typo or ordinary route retired', () => {
    for (const route of ['/docs/next/nope', '/docs/guides/nope', '/ecosystem/nope']) {
      expect(retiredVersion(route, data.lines)).toBeNull();
    }
    const lines = [...data.lines, {name: '13.6.0.5', path: '/docs/13.6.0.5'}];
    expect(retiredVersion('/docs/13.6.0.5/nope', lines)).toBeNull();
    expect(retiredVersion('/v1/guides/nope', lines)?.name).toBe('v1');
  });
  it('links only known git tags, leaving unknown versions at the archive index', () => {
    const repo = 'https://github.com/o/r';
    expect(archiveUrl(repo, '13.3.0.0', ['13.3.0.0'])).toBe(`${repo}/tree/13.3.0.0/doc`);
    expect(archiveUrl(repo, 'v13.3.0.0', ['13.3.0.0'])).toBe(`${repo}/tree/13.3.0.0/doc`);
    expect(archiveUrl(repo, 'v1', ['13.3.0.0'])).toBe(`${repo}/tags`);
    expect(archiveUrl(repo, undefined, [])).toBe(`${repo}/tags`);
    expect(archiveUrl(repo, '../../secret', [])).toBe(`${repo}/tags`);
  });
});

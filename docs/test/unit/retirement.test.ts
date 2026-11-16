import {describe, expect, it} from 'vitest';
import {
  archiveUrl,
  retiredVersion,
  retirementTarget,
  recoveryContext,
} from '../../src/retirement/routes';

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
    for (const route of [
      '/docs/next/nope',
      '/docs/13.7.0.0/nope',
      '/docs/guides/nope',
      '/ecosystem/nope',
    ]) {
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

it('derives version metadata and live routes under the locale base', async () => {
  const {retirementData} = await import('../../plugins/route-manifest/metadata');
  const versions = [
    {
      versionName: 'current',
      path: '/site/ja/docs/next',
      isLast: false,
      docs: [{permalink: '/site/ja/docs/next/intro'}],
    },
    {
      versionName: '13.7.0.0',
      path: '/site/ja/docs',
      isLast: true,
      docs: [{permalink: '/site/ja/docs/intro'}],
    },
  ];
  const result = retirementData(
    versions,
    [{type: 'jsx', source: '@site/src/pages/index.tsx', permalink: '/site/ja/'}],
    '/site/ja/',
    ['13.3.0.0'],
  );
  expect(result.latest).toEqual({name: '13.7.0.0', path: '/docs'});
  expect(result.routes).toEqual(['/', '/docs/intro', '/docs/next/intro']);
  expect(retirementData([], [], '/', []).latest).toEqual({name: 'current', path: '/docs'});
  expect(retirementData([{...versions[0], isLast: false}], [], '/site/ja/', []).latest.name).toBe(
    'current',
  );
});

it('recovers localized unknown paths from the single root 404 in both profiles', () => {
  for (const base of ['/', '/site/']) {
    expect(recoveryContext(`${base}ja/v1/guides/running/`, base, ['ja', 'de'])).toEqual({
      baseUrl: `${base}ja/`,
      route: '/v1/guides/running',
    });
    expect(recoveryContext(`${base}v1/unknown`, base, ['ja'])).toEqual({
      baseUrl: base,
      route: '/v1/unknown',
    });
    expect(recoveryContext('/outside-the-site', base, ['ja'])).toEqual({
      baseUrl: base,
      route: '/outside-the-site',
    });
    expect(recoveryContext(`${base}404.html`, base, ['ja'])).toEqual({
      baseUrl: base,
      route: '/404.html',
    });
  }
});

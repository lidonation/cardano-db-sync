import {describe, expect, it} from 'vitest';
import {sitemapXml, sitemapEntries} from '../../plugins/metadata/sitemap';
import {PROFILES} from '../../config/profiles';
import type {RouteMetadata} from '../../src/metadata/types';
const record: RouteMetadata = {
  type: 'TechArticle',
  title: 'Page',
  description: 'Lead',
  breadcrumbs: [],
  lastmod: '2026-08-01T10:00:00+00:00',
};
const options = {
  profile: PROFILES.prod,
  baseUrl: '/',
  currentLocale: 'en',
  defaultLocale: 'en',
  locales: ['en', 'ja', 'es', 'de', 'vi'],
  pages: {'/docs/v1/page': record, '/docs/v2/page': record, '/': record},
  translations: {'/docs/v1/page': ['en'], '/docs/v2/page': ['en', 'ja']},
};
describe('production sitemap from live published routes (META-4..6,8)', () => {
  it('includes exactly published canonical routes, never redirects or 404, preserving versions', () => {
    const entries = sitemapEntries({
      ...options,
      routesPaths: ['/', '/docs/v1/page', '/docs/v2/page', '/404.html'],
    });
    expect(entries.map((item) => item.loc)).toEqual([
      PROFILES.prod.url + '/',
      PROFILES.prod.url + '/docs/v1/page',
      PROFILES.prod.url + '/docs/v2/page',
    ]);
    expect(entries[1].alternates.map((item) => item.lang)).toEqual(['en', 'x-default']);
    expect(entries[2].alternates.map((item) => item.lang)).toEqual(['en', 'ja', 'x-default']);
    expect(entries[2].lastmod).toBe(record.lastmod);
    expect(sitemapXml(entries)).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  });
  it('lists only real translations in each locale and every locale on shared app routes', () => {
    const entries = sitemapEntries({
      ...options,
      baseUrl: '/ja/',
      currentLocale: 'ja',
      routesPaths: ['/ja/', '/ja/docs/v1/page', '/ja/docs/v2/page'],
    });
    expect(entries.map((item) => item.loc)).toEqual([
      PROFILES.prod.url + '/ja/',
      PROFILES.prod.url + '/ja/docs/v2/page',
    ]);
    expect(entries[0].alternates).toHaveLength(6);
    expect(entries[1].alternates.find((item) => item.lang === 'ja')?.href).toBe(entries[1].loc);
  });
  it('omits sitemaps in preview, escapes XML, and does not fabricate lastmod', () => {
    expect(sitemapEntries({...options, profile: PROFILES.dev, routesPaths: ['/']})).toEqual([]);
    expect(
      sitemapXml([
        {
          loc: 'https://example.test/a?x=1&y=2',
          alternates: [{lang: 'en', href: 'https://example.test/"'}],
        },
      ]),
    ).toContain('&amp;y=2');
    expect(sitemapXml([{loc: 'https://example.test/', alternates: []}])).not.toContain('<lastmod>');
  });
});

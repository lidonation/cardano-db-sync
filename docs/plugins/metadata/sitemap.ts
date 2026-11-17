import type {BuildProfile} from '../../config/profiles';
import type {RouteMetadata} from '../../src/metadata/types';
import {toManifestPath} from '../route-manifest';

export interface SitemapEntry {
  readonly loc: string;
  readonly lastmod?: string;
  readonly alternates: readonly {readonly lang: string; readonly href: string}[];
}
export interface SitemapOptions {
  readonly profile: BuildProfile;
  readonly baseUrl: string;
  readonly currentLocale: string;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly pages: Readonly<Record<string, RouteMetadata>>;
  readonly translations: Readonly<Record<string, readonly string[]>>;
  readonly routesPaths: readonly string[];
}

/** The same public route normalization as the append-only manifest, minus noncanonical fallbacks. */
export function sitemapEntries(options: SitemapOptions): SitemapEntry[] {
  const {profile, baseUrl, currentLocale, defaultLocale, locales, translations, pages} = options;
  if (!profile.indexable) return [];
  const href = (locale: string, route: string) =>
    profile.url + profile.baseUrl + (locale === defaultLocale ? '' : `${locale}/`) + route.slice(1);
  return [
    ...new Set(
      options.routesPaths
        .map((route) => toManifestPath(route, baseUrl))
        .filter((route): route is string => route !== null),
    ),
  ]
    .sort()
    .flatMap((route) => {
      const existing = translations[route] ?? locales;
      if (!existing.includes(currentLocale)) return [];
      return [
        {
          loc: href(currentLocale, route),
          lastmod: pages[route]?.lastmod,
          alternates: [
            ...existing.map((locale) => ({lang: locale, href: href(locale, route)})),
            {lang: 'x-default', href: href(defaultLocale, route)},
          ],
        },
      ];
    });
}
const xml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
export function sitemapXml(entries: readonly SitemapEntry[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.map((entry) => `  <url><loc>${xml(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${xml(entry.lastmod)}</lastmod>` : ''}${entry.alternates.map((item) => `<xhtml:link rel="alternate" hreflang="${xml(item.lang)}" href="${xml(item.href)}"/>`).join('')}</url>`).join('\n')}\n</urlset>\n`;
}

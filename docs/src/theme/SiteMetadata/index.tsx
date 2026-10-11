/**
 * Ejected from @docusaurus/theme-classic 3.10.2 `theme/SiteMetadata` to scope hreflang (META-4,
 * META-8). Only `AlternateLangHeaders` differs from upstream; on a Docusaurus upgrade, diff the
 * rest against the new version.
 */
import React from 'react';

import Head from '@docusaurus/Head';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {usePluginData} from '@docusaurus/useGlobalData';
import {PageMetadata, useThemeConfig} from '@docusaurus/theme-common';
import {DEFAULT_SEARCH_TAG, useAlternatePageUtils} from '@docusaurus/theme-common/internal';
import {useLocation} from '@docusaurus/router';
import {applyTrailingSlash} from '@docusaurus/utils-common';
import SearchMetadata from '@theme/SearchMetadata';

import {PLUGIN_NAME, localePath, pageLocales, type I18nGlobalData} from '../../i18n/pages';

// HTML lang is a BCP 47 tag; Open Graph wants underscores instead of dashes.
const bcp47ToOpenGraphLocale = (code: string) => code.replace('-', '_');

/**
 * hreflang alternates for the locales this page exists in, plus x-default, reciprocal across
 * them (META-4). An untranslated doc is not advertised in the locales it falls back in. None at
 * all on a noindex build (META-8).
 */
function AlternateLangHeaders(): React.JSX.Element | null {
  const {
    siteConfig: {baseUrl},
    i18n: {currentLocale, defaultLocale, localeConfigs, locales},
  } = useDocusaurusContext();
  const data = usePluginData(PLUGIN_NAME) as I18nGlobalData;
  const alternatePageUtils = useAlternatePageUtils();
  const {pathname} = useLocation();
  const currentHtmlLang = localeConfigs[currentLocale]!.htmlLang;
  const existing = pageLocales(localePath(pathname, baseUrl), data, locales);

  return (
    <Head>
      {data.alternates &&
        existing.map((locale) => (
          <link
            key={locale}
            rel="alternate"
            href={alternatePageUtils.createUrl({locale, fullyQualified: true})}
            hrefLang={localeConfigs[locale]!.htmlLang}
          />
        ))}
      {data.alternates && (
        <link
          rel="alternate"
          href={alternatePageUtils.createUrl({locale: defaultLocale, fullyQualified: true})}
          hrefLang="x-default"
        />
      )}
      <meta property="og:locale" content={bcp47ToOpenGraphLocale(currentHtmlLang)} />
      {existing
        .map((locale) => localeConfigs[locale]!.htmlLang)
        .filter((htmlLang) => htmlLang !== currentHtmlLang)
        .map((htmlLang) => (
          <meta
            key={`meta-og-${htmlLang}`}
            property="og:locale:alternate"
            content={bcp47ToOpenGraphLocale(htmlLang)}
          />
        ))}
    </Head>
  );
}

// Default canonical url inferred from current page location pathname.
function useDefaultCanonicalUrl() {
  const {
    siteConfig: {url: siteUrl, baseUrl, trailingSlash},
  } = useDocusaurusContext();
  const {pathname} = useLocation();
  const canonicalPathname = applyTrailingSlash(useBaseUrl(pathname), {trailingSlash, baseUrl});
  return siteUrl + canonicalPathname;
}

function CanonicalUrlHeaders({permalink}: {permalink?: string}) {
  const {
    siteConfig: {url: siteUrl},
  } = useDocusaurusContext();
  const defaultCanonicalUrl = useDefaultCanonicalUrl();
  const canonicalUrl = permalink ? `${siteUrl}${permalink}` : defaultCanonicalUrl;
  return (
    <Head>
      <meta property="og:url" content={canonicalUrl} />
      <link rel="canonical" href={canonicalUrl} />
    </Head>
  );
}

export default function SiteMetadata(): React.JSX.Element {
  const {
    i18n: {currentLocale},
  } = useDocusaurusContext();
  const {metadata, image: defaultImage} = useThemeConfig();
  return (
    <>
      <Head>
        <meta name="twitter:card" content="summary_large_image" />
        {/* The keyboard focus class name need to be applied when SSR so links are outlined when
        JS is disabled */}
        <body />
      </Head>

      {defaultImage && <PageMetadata image={defaultImage} />}

      <CanonicalUrlHeaders />

      <AlternateLangHeaders />

      <SearchMetadata tag={DEFAULT_SEARCH_TAG} locale={currentLocale} />

      {/* A separate <Head> lets react-helmet override the defaults above (twitter:card) rather
      than emit the same meta twice. */}
      <Head>
        {metadata.map((metadatum, i) => (
          <meta key={i} {...metadatum} />
        ))}
      </Head>
    </>
  );
}

/**
 * Based on @docusaurus/theme-classic 3.10.2 `theme/SiteMetadata`. Hreflang and canonical fallbacks
 * honor real translations (META-4/META-8). Read locale, route and translation data once: these
 * headers share the same page identity, and the global chrome must stay within PERF-1 budgets.
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

export default function SiteMetadata(): React.JSX.Element {
  const {
    siteConfig: {url, baseUrl, trailingSlash},
    i18n: {locales, currentLocale, defaultLocale, localeConfigs},
  } = useDocusaurusContext();
  const {pathname} = useLocation();
  const data = usePluginData(PLUGIN_NAME) as I18nGlobalData;
  const existing = pageLocales(localePath(pathname, baseUrl), data, locales);
  const {createUrl} = useAlternatePageUtils();
  const defaultCanonicalPath = applyTrailingSlash(useBaseUrl(pathname), {trailingSlash, baseUrl});
  const canonicalUrl = existing.includes(currentLocale)
    ? url + defaultCanonicalPath
    : createUrl({locale: defaultLocale, fullyQualified: true});
  const {metadata, image: defaultImage} = useThemeConfig();
  const currentHtmlLang = localeConfigs[currentLocale]!.htmlLang;

  return (
    <>
      <Head>
        <meta name="twitter:card" content="summary_large_image" />
        {/* The keyboard focus class must be applied when SSR so links are outlined without JS. */}
        <body />
      </Head>

      {defaultImage && <PageMetadata image={defaultImage} />}

      <Head>
        <meta property="og:url" content={canonicalUrl} />
        <link rel="canonical" href={canonicalUrl} />
        {data.alternates &&
          existing.map((locale) => (
            <link
              key={locale}
              rel="alternate"
              href={createUrl({locale, fullyQualified: true})}
              hrefLang={localeConfigs[locale]!.htmlLang}
            />
          ))}
        {data.alternates && (
          <link
            rel="alternate"
            href={createUrl({locale: defaultLocale, fullyQualified: true})}
            hrefLang="x-default"
          />
        )}
        <meta property="og:locale" content={currentHtmlLang.replace('-', '_')} />
        {existing
          .map((locale) => localeConfigs[locale]!.htmlLang)
          .filter((lang) => lang !== currentHtmlLang)
          .map((lang) => (
            <meta
              key={`meta-og-${lang}`}
              property="og:locale:alternate"
              content={lang.replace('-', '_')}
            />
          ))}
      </Head>

      <SearchMetadata tag={DEFAULT_SEARCH_TAG} locale={currentLocale} />

      {/* A separate Head lets page metadata override the defaults above. */}
      <Head>
        {metadata.map((metadatum, i) => (
          <meta key={i} {...metadatum} />
        ))}
      </Head>
    </>
  );
}

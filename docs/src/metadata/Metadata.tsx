import React from 'react';
import Head from '@docusaurus/Head';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {usePluginData} from '@docusaurus/useGlobalData';
import {useLocation} from '@docusaurus/router';
import {PageMetadata} from '@docusaurus/theme-common';
import {localePath, pageLocales, PLUGIN_NAME, type I18nGlobalData} from '../i18n/pages';
import {serializeJsonLd} from '../faq/jsonld';
import type {ClientBuildProfile} from '../../config/profiles';
import {breadcrumbJsonLd, contentJsonLd, socialImage} from './model';
import {METADATA_PLUGIN, type MetadataData, type ContentMetadata} from './types';

export default function Metadata({
  title,
  description,
  doc,
}: {
  title?: string;
  description?: string;
  doc?: ContentMetadata;
}): React.JSX.Element | null {
  const {
    siteConfig: {url, baseUrl, customFields},
    i18n: {locales, currentLocale, defaultLocale},
  } = useDocusaurusContext();
  const {pathname} = useLocation();
  const data = usePluginData(METADATA_PLUGIN) as MetadataData;
  const i18n = usePluginData(PLUGIN_NAME) as I18nGlobalData;
  const route = localePath(pathname, baseUrl);
  const record = doc ? {...doc, breadcrumbs: []} : data.pages[route];
  if (!record) return null; // 404 and development-only fixture routes are not published content.
  const content = {
    ...record,
    title: title ?? record.title,
    description: description ?? record.description,
  };
  const profile = customFields!.profile as ClientBuildProfile;
  const existing = pageLocales(route, i18n, locales);
  const canonicalBase = existing.includes(currentLocale)
    ? baseUrl
    : `${profile.baseUrl}${defaultLocale === 'en' ? '' : `${defaultLocale}/`}`;
  const canonical = url + canonicalBase + route.slice(1);
  const image = socialImage(content.type, baseUrl);
  const breadcrumbs = record.breadcrumbs.map((item, index) =>
    index === record.breadcrumbs.length - 1 && route !== '/'
      ? {...item, name: content.title}
      : item,
  );
  const json = contentJsonLd(content, canonical, profile.repoUrl);
  return (
    <>
      <PageMetadata image={image} />
      <Head>
        <meta
          property="og:type"
          content={
            content.type === 'TechArticle' || content.type === 'HowTo' ? 'article' : 'website'
          }
        />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:type" content="image/webp" />
        <meta property="og:image:alt" content={content.title} />
        <meta name="twitter:image:alt" content={content.title} />
        {json && (
          <script type="application/ld+json" key="content-jsonld">
            {serializeJsonLd(json)}
          </script>
        )}
        {!doc && (
          <script type="application/ld+json" key="breadcrumb-jsonld">
            {serializeJsonLd(breadcrumbJsonLd(breadcrumbs, url))}
          </script>
        )}
      </Head>
    </>
  );
}

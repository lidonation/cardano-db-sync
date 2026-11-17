import React, {useContext} from 'react';
import routes from '@generated/routes';
import {routePaths, routeExists} from '../data/surfaces';
import {contentType} from './identity';
import {applyTrailingSlash} from '@docusaurus/utils-common';
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
import {MetadataFeed} from './MetadataFeed';

/** Static route tree: walk it once per bundle, like Navbar and Footer, not on every render. */
const PATHS = routePaths(routes);

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
    siteConfig: {url, baseUrl, customFields, trailingSlash, title: siteTitle},
    i18n: {locales, currentLocale},
  } = useDocusaurusContext();
  const {pathname} = useLocation();
  const data = usePluginData(METADATA_PLUGIN) as MetadataData;
  const i18n = usePluginData(PLUGIN_NAME) as I18nGlobalData;
  const feed = useContext(MetadataFeed);
  const route = localePath(pathname, baseUrl);
  if (!doc && !routeExists(PATHS, baseUrl, route)) return null;
  const segments = route.split('/').filter(Boolean);
  const breadcrumbsFromRoutes = [
    {name: siteTitle, path: baseUrl},
    ...segments
      .map((_, i) => `/${segments.slice(0, i + 1).join('/')}`)
      .filter((path) => routeExists(PATHS, baseUrl, path))
      .map((path) => ({name: path.split('/')[1], path: baseUrl + path.slice(1)})),
  ];
  const record = doc
    ? {...doc, breadcrumbs: []}
    : (data.pages[route] ?? {
        type: contentType(route, false),
        title: '',
        description: '',
        breadcrumbs: breadcrumbsFromRoutes,
      });
  const content = {
    ...record,
    ...(record.type === 'DataFeed' && feed ? {feed} : {}),
    title: title ?? record.title,
    description: description ?? record.description,
  };
  const profile = customFields!.profile as ClientBuildProfile;
  const existing = pageLocales(route, i18n, locales);
  const canonicalPath = existing.includes(currentLocale)
    ? pathname
    : profile.baseUrl + route.slice(1);
  const canonical =
    url + applyTrailingSlash(canonicalPath, {baseUrl: profile.baseUrl, trailingSlash});
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
        <meta name="twitter:title" content={content.title} />
        <meta name="twitter:description" content={content.description} />
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

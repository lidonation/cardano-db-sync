import type {Breadcrumb, ContentMetadata, ContentType} from './types';

export {contentType} from './identity';

export const socialImage = (type: ContentType, baseUrl: string): string =>
  `${baseUrl}social/${type}.webp`;

/** Content-specific structured data. FAQ owns its visible, translated Question/Answer artifact. */
export function contentJsonLd(
  data: ContentMetadata,
  url: string,
  repository: string,
): Record<string, unknown> | null {
  if (data.type === 'FAQPage') return null;
  return {
    '@context': 'https://schema.org',
    '@type': data.type,
    url,
    name: data.title,
    description: data.description,
    ...(data.version ? {version: data.version} : {}),
    ...(data.type === 'TechArticle' ? {headline: data.title} : {}),
    ...(data.type === 'HowTo'
      ? {step: data.steps?.map((step) => ({'@type': 'HowToStep', ...step})) ?? []}
      : {}),
    ...(data.type === 'DataFeed' && data.feed
      ? {
          dateModified: data.feed.asOf,
          dataFeedElement: data.feed.entries.map((entry) => ({
            '@type': 'DataFeedItem',
            dateCreated: entry.date,
            item: {'@type': 'CreativeWork', name: entry.title, url: entry.url},
          })),
        }
      : {}),
    ...(data.type === 'Dataset'
      ? {variableMeasured: data.variables?.map((name) => ({'@type': 'PropertyValue', name})) ?? []}
      : {}),
    ...(data.type === 'WebApplication'
      ? {applicationCategory: 'DeveloperApplication', operatingSystem: 'Any'}
      : {}),
    ...(data.type === 'SoftwareSourceCode'
      ? {codeRepository: repository, programmingLanguage: 'Haskell'}
      : {}),
  };
}

export function breadcrumbJsonLd(
  items: readonly Breadcrumb[],
  origin: string,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: origin + item.path,
    })),
  };
}

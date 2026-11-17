/** B21: shared build/SSR contract. Artifacts stay on the build side of this boundary. */
export const METADATA_PLUGIN = 'dbsync-metadata';
export const CONTENT_TYPES = [
  'TechArticle',
  'HowTo',
  'Dataset',
  'FAQPage',
  'DataFeed',
  'WebApplication',
  'SoftwareSourceCode',
  'WebPage',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
export interface Breadcrumb {
  readonly name: string;
  readonly path: string;
}
export interface ContentMetadata {
  readonly type: ContentType;
  readonly title: string;
  readonly description: string;
  readonly steps?: readonly {readonly name: string; readonly text: string}[];
  readonly variables?: readonly string[];
  readonly version?: string;
}
export interface RouteMetadata extends ContentMetadata {
  readonly breadcrumbs: readonly Breadcrumb[];
  readonly lastmod?: string;
}
export interface MetadataData {
  readonly pages: Readonly<Record<string, RouteMetadata>>;
}

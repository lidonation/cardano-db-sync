/** B19 wire contract; labels remain the display layer's responsibility. */
export type EntityGroup = 'tables' | 'guides' | 'docs';
export type EntityKind = 'table' | 'column' | 'guide' | 'doc' | 'config' | 'cli';
export interface EntityFacets {
  variants?: string[];
  columns?: number;
  indexed?: boolean;
  table?: string;
  nullable?: boolean;
  versions?: string[];
}
export interface SearchEntity {
  id: string;
  kind: EntityKind;
  group: EntityGroup;
  identifier: string;
  aliases: string[];
  title: string;
  body: string;
  url: string;
  facets: EntityFacets;
}
export interface EntityBundle {
  schemaVersion: 1;
  line: string;
  locale: string;
  index: object;
}
export interface EntityManifest {
  schemaVersion: 1;
  locale: string;
  /** Paths are relative to the active profile/locale base URL. */
  bundles: Record<string, string>;
}
export interface EntityHit extends Omit<SearchEntity, 'body'> {
  line: string;
  score: number;
  tier: number;
}
export interface EntityResults {
  group: EntityGroup;
  hits: EntityHit[];
  total: number;
  hasMore: boolean;
}

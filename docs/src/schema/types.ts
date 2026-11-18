import type {SchemaArtifact, SchemaColumn} from '../data/schema';
import type {RenameMap} from '../data/schema-renames';
import type {ContentMetadata} from '../metadata/types';

/** B18 build-time contract. Only rendered content crosses into the browser. */
export interface Boundary {
  stageTwo: number;
  stageFour: number;
}
export interface ColumnChange {
  at: Boundary;
  migration: string;
  before: SchemaColumn | null;
  after: SchemaColumn | null;
}
export interface Relationship {
  table: string;
  columns: string[];
  target: string;
  targetColumns: string[];
  variant: 'core' | 'address';
}
export interface ExplorerHistory {
  schemaVersion: 1;
  current: Boundary;
  /** Stage-one domains are replayed in full, as in B08; these are stage-two/four boundaries. */
  changes: Record<string, ColumnChange[]>;
  relationships: Relationship[];
}
export interface ExplorerEntity {
  kind: 'table' | 'column';
  name: string;
  table: string;
  path: string;
  aliases: string[];
  variants: string[];
}
export interface ExplorerDocument {
  html: string;
  metadata: ContentMetadata;
}
export interface ExplorerInput {
  schema: SchemaArtifact;
  renames: RenameMap;
  history: ExplorerHistory;
}

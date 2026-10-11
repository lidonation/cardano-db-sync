/**
 * The committed schema artifact — every db-sync table and column as a fingerprint, with domains
 * resolved transitively (B08: SCH-1, GDE-6).
 *
 * The artifact is produced by `scripts/extract-schema.mjs`, which replays the migrations in
 * `schema/` into a throwaway Postgres 17 and cross-checks every column against the Haskell `DbInfo`
 * records. Nothing here touches a database or the Haskell tree: the site build only reads the
 * committed JSON. The schema explorer (B18) and the guide locks (B12) consume it through this module.
 *
 * Regenerate after changing a migration or a schema record:
 *
 *     cd docs && PGHOST=… PGUSER=… node scripts/extract-schema.mjs
 *
 * `check:schema` verifies the committed file against the same rules (sound shape, every domain
 * resolved, fingerprints matching their columns).
 */
import artifact from '../../generated/schema.json';

/** The tx_out variant a table entry describes. `all` means identical in both. */
export type SchemaVariant = 'all' | 'core' | 'address';

/** A CHECK constraint, attributed to the domain that carries it. */
export interface DomainCheck {
  domain: string;
  definition: string;
}

/**
 * A type resolved down to its concrete base: `outsum → word128type → numeric(39,0)` is
 * `{base: 'numeric(39,0)', domains: ['outsum', 'word128type'], checks: [...]}`.
 */
export interface ResolvedType {
  base: string;
  domains: string[];
  checks: DomainCheck[];
  not_null: boolean;
  enum?: string[];
}

/** One column. `fingerprint` hashes exactly `(name, resolved_type, nullable, default)`. */
export interface SchemaColumn {
  name: string;
  /** The type as declared on the column, before domain resolution. */
  type: string;
  resolved_type: ResolvedType;
  nullable: boolean;
  default: string | null;
  fingerprint: string;
  /** The Haskell record field that maps to this column, when there is one. */
  haskell?: {field: string; sqltype?: string};
}

/** One table (or a view a Haskell record reads from) in one variant. */
export interface SchemaTable {
  name: string;
  variant: SchemaVariant;
  kind: 'table' | 'view';
  haskell: {record: string; file: string} | null;
  columns: SchemaColumn[];
}

/** The committed artifact. */
export interface SchemaArtifact {
  schemaVersion: number;
  postgres: number;
  /** The `schema_version` row a database migrated to this schema holds. */
  dbSchemaVersion: {stage_one: number; stage_two: number; stage_three: number};
  domains: Record<string, ResolvedType>;
  tables: SchemaTable[];
}

/** The artifact version this module understands; `check:schema` enforces it. */
export const SCHEMA_ARTIFACT_VERSION = 1;

const typedArtifact = artifact as SchemaArtifact;

/** The artifact, after rejecting a version this build does not understand. */
export function loadSchema(): SchemaArtifact {
  if (typedArtifact.schemaVersion !== SCHEMA_ARTIFACT_VERSION) {
    throw new Error(
      `schema.json is version ${typedArtifact.schemaVersion}; this build understands ` +
        `${SCHEMA_ARTIFACT_VERSION}. Regenerate it with scripts/extract-schema.mjs.`,
    );
  }
  return typedArtifact;
}

/**
 * A table as one variant sees it. The default `core` variant is what db-sync runs unless
 * `tx_out.use_address_table` is set; a table identical in both variants is returned for either.
 */
export function findTable(
  name: string,
  variant: Exclude<SchemaVariant, 'all'> = 'core',
): SchemaTable | undefined {
  return loadSchema().tables.find(
    (table) => table.name === name && (table.variant === variant || table.variant === 'all'),
  );
}

/** One column of a table, as one variant sees it. */
export function findColumn(
  table: string,
  column: string,
  variant: Exclude<SchemaVariant, 'all'> = 'core',
): SchemaColumn | undefined {
  return findTable(table, variant)?.columns.find((c) => c.name === column);
}

/** A domain resolved to its base type, with its chain and CHECK set. */
export function findDomain(name: string): ResolvedType | undefined {
  return loadSchema().domains[name];
}

/** Every table entry that differs between the two tx_out variants. */
export function variantTables(): SchemaTable[] {
  return loadSchema().tables.filter((table) => table.variant !== 'all');
}

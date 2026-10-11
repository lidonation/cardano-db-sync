/**
 * The committed schema rename map — what B09 extracts from the migration SQL
 * under `schema/` (GDE-9).
 *
 * Without it a rename reads as remove-plus-add: `pool_offline_data` vanishes
 * and `off_chain_pool_data` appears, and a guide that declares the old name
 * fails GDE-2 with a misleading "unknown entity". Former names are also the
 * search aliases (SRCH-5), so an operator searching the old identifier still
 * lands on the table.
 *
 * The artifact is produced by `docs/extractor` (`extract-renames`, driven by
 * the `extract-haddock` workflow) and committed under `generated/`; nothing
 * here reads `schema/` at build time (CON-1). Regenerate locally with:
 *
 *     cd docs/extractor && cabal run extract-renames -- \
 *       --repo-root ../.. --out ../generated/schema-renames.json
 *
 * The shape mirrors `RenameExtract`; `check:renames` verifies the committed
 * file against the same rules.
 */
import artifact from '../../generated/schema-renames.json';

/** What a rename renames. */
export type RenameKind =
  'table' | 'column' | 'constraint' | 'sequence' | 'index' | 'view' | 'type' | 'domain';

/** The migration a rename ran in: `migration-<stage>-<version>-<date>.sql`. */
export interface RenameMigration {
  stage: number;
  version: number;
  file: string;
}

/** One rename statement, in the order the migrations apply it. */
export interface Rename {
  kind: RenameKind;
  /** The owning table as named when the statement ran (columns and constraints). */
  table?: string;
  from: string;
  to: string;
  migration: RenameMigration;
  line: number;
}

/** A name an entity carried until `until` renamed it away. */
export interface FormerName {
  name: string;
  until: RenameMigration;
}

/** A renamed entity: its latest name and every name before it, oldest first. */
export interface RenamedEntity {
  kind: RenameKind;
  /** The owning table's latest name (columns and constraints). */
  table?: string;
  name: string;
  formerNames: FormerName[];
}

/** The committed artifact. */
export interface RenameMap {
  schemaVersion: number;
  source: string;
  renames: Rename[];
  entities: RenamedEntity[];
}

/**
 * A point on the schema axis (SPECIFICATION §8.3): what
 * `SELECT stage_two, stage_four FROM schema_version` returns.
 */
export interface SchemaVersion {
  stageTwo: number;
  stageFour?: number;
}

/** The schema version this module understands; `check:renames` enforces it. */
export const RENAMES_SCHEMA_VERSION = 1;

/**
 * The rename map. Unknown schema versions are rejected here rather than at
 * each consumer.
 */
export function loadRenames(map: RenameMap = artifact as RenameMap): RenameMap {
  if (map.schemaVersion !== RENAMES_SCHEMA_VERSION) {
    throw new Error(
      `schema-renames.json is schema version ${map.schemaVersion}; ` +
        `this build understands ${RENAMES_SCHEMA_VERSION}. Regenerate it with the extractor.`,
    );
  }
  return map;
}

/**
 * Whether a database at `at` has already run the migration. Stages one and
 * three run in full on every start, so their renames have always happened;
 * stages two and four are versioned by the schema axis.
 */
export function hasRun(migration: RenameMigration, at: SchemaVersion): boolean {
  switch (migration.stage) {
    case 2:
      return at.stageTwo >= migration.version;
    case 4:
      return (at.stageFour ?? Number.POSITIVE_INFINITY) >= migration.version;
    default:
      return true;
  }
}

/**
 * The renamed entity a name refers to, by its latest or any former name.
 * Columns and constraints are scoped by table, which may itself be a former
 * table name.
 */
export function findRenamed(
  kind: RenameKind,
  name: string,
  table?: string,
  map?: RenameMap,
): RenamedEntity | undefined {
  const renames = loadRenames(map);
  const owner = table === undefined ? undefined : currentName('table', table, undefined, renames);
  return renames.entities.find(
    (entity) =>
      entity.kind === kind &&
      entity.table === owner &&
      (entity.name === name || entity.formerNames.some((former) => former.name === name)),
  );
}

/**
 * The latest name of an entity known by any of its names — what GDE-2 checks
 * a guide's `requires` against. A name that was never renamed is returned
 * unchanged.
 */
export function currentName(
  kind: RenameKind,
  name: string,
  table?: string,
  map?: RenameMap,
): string {
  return findRenamed(kind, name, table, map)?.name ?? name;
}

/**
 * The name an entity carried in a database at schema version `at`: the
 * oldest name whose renaming migration had not yet run, else the latest.
 */
export function nameAt(
  kind: RenameKind,
  name: string,
  at: SchemaVersion,
  table?: string,
  map?: RenameMap,
): string {
  const entity = findRenamed(kind, name, table, map);
  if (entity === undefined) {
    return name;
  }
  return entity.formerNames.find((former) => !hasRun(former.until, at))?.name ?? entity.name;
}

/** Every former name of an entity, oldest first — the SRCH-5 search aliases. */
export function formerNames(
  kind: RenameKind,
  name: string,
  table?: string,
  map?: RenameMap,
): string[] {
  return findRenamed(kind, name, table, map)?.formerNames.map((former) => former.name) ?? [];
}

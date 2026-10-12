/**
 * What this build documents, counted from the committed artifacts — the landing page's "in this
 * build" strip (B44-a).
 *
 * Every figure is read from a generated file, never typed by hand, so it cannot drift from the
 * schema it describes. Live chain figures (block height, epoch, database size) are not here: they
 * need the chain data job (B23) and belong to the Numbers page, and nothing ships presented as
 * measured that was not measured.
 *
 * Pure, so it is unit-tested against both the real artifacts and hand-made ones.
 */
import {loadRenames, type RenameMap} from './schema-renames';
import {loadSchema, type SchemaArtifact} from './schema';

export interface ReleaseFacts {
  /** Tables in the default (`core`) schema, the one db-sync creates unless configured otherwise. */
  readonly tables: number;
  /** Columns across those tables. */
  readonly columns: number;
  /** The newest versioned migration, as its file names it: `2-0051`. */
  readonly migration: string;
  /** Renamed tables, columns, constraints, indexes and sequences, traced to every former name (GDE-9). */
  readonly renamed: number;
}

export function releaseFacts(
  schema: Pick<SchemaArtifact, 'tables' | 'dbSchemaVersion'> = loadSchema(),
  renames: Pick<RenameMap, 'entities'> = loadRenames(),
): ReleaseFacts {
  const core = schema.tables.filter(
    (table) => table.kind === 'table' && table.variant !== 'address',
  );
  return {
    tables: core.length,
    columns: core.reduce((sum, table) => sum + table.columns.length, 0),
    migration: `2-${String(schema.dbSchemaVersion.stage_two).padStart(4, '0')}`,
    renamed: renames.entities.length,
  };
}

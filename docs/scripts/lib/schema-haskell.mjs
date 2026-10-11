/**
 * B08 — the Haskell side of the schema: every `DbInfo` record in the schema modules, read as the
 * table and columns db-sync itself will write to.
 *
 * The database is the source of truth for types, nullability and defaults (SCH-1, GDE-6). This
 * reader exists to cross-check it: a table or column that one side has and the other does not, or
 * a nullability that disagrees, fails the extraction instead of shipping a schema page that
 * describes a database db-sync never writes.
 *
 * The schema records are deliberately regular (one field per line, `-- sqltype=` hints, explicit
 * `tableName` / `columnNames` overrides inside `instance DbInfo`), so a focused reader is enough.
 * Anything it cannot read fails loudly: an instance with no matching record, a record with no
 * fields, or a field line it does not recognise.
 *
 * Column naming mirrors `fieldToColumnWithType` and `camelToSnake` in
 * cardano-db/src/Cardano/Db/Statement/Types.hs.
 */
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

/** Schema modules, relative to the repository root. Both tx_out variants are listed separately. */
export const SCHEMA_DIRS = {
  shared: 'cardano-db/src/Cardano/Db/Schema/Core',
  core: 'cardano-db/src/Cardano/Db/Schema/Variants/TxOutCore.hs',
  address: 'cardano-db/src/Cardano/Db/Schema/Variants/TxOutAddress.hs',
};

/** The runtime DDL that turns a core database into the address variant. */
export const ADDRESS_VARIANT_SOURCE = 'cardano-db/src/Cardano/Db/Statement/ConsumedTxOut.hs';

/** The bindings in ADDRESS_VARIANT_SOURCE, in the order `updateTxOutAndCreateAddress` runs them. */
export const ADDRESS_VARIANT_BINDINGS = [
  'dropViewsQuery',
  'alterTxOutQuery',
  'alterCollateralTxOutQuery',
  'createAddressTableQuery',
];

/** `camelToSnake` from Cardano.Db.Statement.Types. */
export function camelToSnake(name) {
  if (name.length === 0) return '';
  let out = name[0].toLowerCase();
  for (const c of name.slice(1)) {
    out += c >= 'A' && c <= 'Z' ? `_${c.toLowerCase()}` : c;
  }
  return out;
}

/** `fieldToColumnWithType` from Cardano.Db.Statement.Types: strip the record prefix, then snake. */
export function fieldToColumn(typeName, field) {
  const prefix = typeName[0].toLowerCase() + typeName.slice(1);
  const rest = field.startsWith(prefix) ? field.slice(prefix.length) : null;
  if (rest === null || !/^[A-Z]/.test(rest)) {
    throw new Error(`field '${field}' does not start with the record prefix '${prefix}'`);
  }
  return camelToSnake(rest);
}

/** A Haskell string literal's value. Haskell and JSON agree on the escapes the schema uses. */
function stringLiteral(literal) {
  return JSON.parse(literal);
}

const STRING_LITERAL = /"(?:[^"\\]|\\.)*"/g;

/** The string literals in a bracketed list that starts at or after `from`. */
function stringListAt(source, from, what) {
  const open = source.indexOf('[', from);
  const close = open < 0 ? -1 : source.indexOf(']', open);
  if (open < 0 || close < 0) throw new Error(`${what}: no [ … ] list found`);
  return (source.slice(open, close).match(STRING_LITERAL) ?? []).map(stringLiteral);
}

/**
 * The value of a `name = Text.unlines [ "…", … ]` (or `name = "…"`) binding, as the SQL text the
 * Haskell builds. Fails when the binding is missing or is not built from string literals.
 */
export function readUnlinesBinding(source, name) {
  const match = new RegExp(`^\\s+${name}\\s*=\\s*\\n?\\s*Text\\.unlines\\b`, 'm').exec(source);
  if (match) {
    const lines = stringListAt(source, match.index + match[0].length, name);
    if (lines.length === 0) throw new Error(`${name}: the Text.unlines list is empty`);
    return lines.map((line) => `${line}\n`).join('');
  }
  const single = new RegExp(`^\\s+${name}\\s*=\\s*\\n?\\s*("(?:[^"\\\\]|\\\\.)*")`, 'm').exec(
    source,
  );
  if (single) return stringLiteral(single[1]);
  throw new Error(`${name}: binding not found or not a string literal / Text.unlines list`);
}

/** The address-variant DDL, statement blocks in the order db-sync runs them. */
export function readAddressVariantDdl(repoRoot) {
  const source = readFileSync(path.join(repoRoot, ADDRESS_VARIANT_SOURCE), 'utf8');
  return ADDRESS_VARIANT_BINDINGS.map((name) => readUnlinesBinding(source, name));
}

const FIELD_LINE = /^\s+[{,]\s*([a-z][A-Za-z0-9_']*)\s*::\s*(.+?)\s*(?:--\s*(.*))?$/;

/** Records in one module: `data X = X { f :: T -- hint, … }` (or `newtype`), keyed by type name. */
export function readRecords(source, file) {
  const records = new Map();
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const head =
      /^(?:data|newtype) ([A-Z][A-Za-z0-9_']*) = ([A-Z][A-Za-z0-9_']*)\s*(?:--.*)?$/.exec(lines[i]);
    if (!head || head[1] !== head[2]) continue;
    const typeName = head[1];
    const fields = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (/^\s+}/.test(line)) break;
      if (/^\s*--/.test(line) || line.trim() === '') continue;
      const field = FIELD_LINE.exec(line);
      if (!field) {
        throw new Error(`${file}:${j + 1}: unrecognised field line in ${typeName}: ${line.trim()}`);
      }
      const [, name, type, comment] = field;
      const sqltype = /\bsqltype=([A-Za-z0-9_]+)/.exec(comment ?? '');
      fields.push({
        field: name,
        nullable: /^!?\(?\s*Maybe\b/.test(type),
        ...(sqltype ? {sqltype: sqltype[1]} : {}),
      });
    }
    if (fields.length > 0) records.set(typeName, fields);
  }
  return records;
}

/** `instance DbInfo X where` blocks with their `tableName` / `columnNames` overrides. */
export function readDbInfoInstances(source, file) {
  const instances = [];
  const pattern = /^instance DbInfo ([A-Z][A-Za-z0-9_']*)(?: where)?\s*$/gm;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const start = match.index + match[0].length;
    const next = source.slice(start).search(/^\S/m);
    const body = next < 0 ? source.slice(start) : source.slice(start, start + next);
    const table = /^\s+tableName _ = ("(?:[^"\\]|\\.)*")/m.exec(body);
    const columns = /^\s+columnNames _ =/m.exec(body);
    instances.push({
      type: match[1],
      file,
      tableName: table ? stringLiteral(table[1]) : null,
      columnNames: columns
        ? stringListAt(body, columns.index, `${file}: ${match[1]}.columnNames`)
        : null,
    });
  }
  return instances;
}

function moduleFiles(repoRoot, entry) {
  if (entry.endsWith('.hs')) return [entry];
  return readdirSync(path.join(repoRoot, entry))
    .filter((name) => name.endsWith('.hs'))
    .sort()
    .map((name) => `${entry}/${name}`);
}

/**
 * @typedef {{column: string, field: string, nullable: boolean, sqltype?: string}} HaskellColumn
 * @typedef {{table: string, record: string, file: string, columns: HaskellColumn[]}} HaskellTable
 */

/**
 * Every table the Haskell schema declares for one tx_out variant (`core` or `address`), keyed by
 * table name.
 *
 * @param {string} repoRoot
 * @param {string} variant
 * @returns {Map<string, HaskellTable>}
 */
export function readHaskellTables(repoRoot, variant) {
  if (!(variant in SCHEMA_DIRS) || variant === 'shared') {
    throw new Error(`unknown tx_out variant '${variant}'`);
  }
  const files = [
    ...moduleFiles(repoRoot, SCHEMA_DIRS.shared),
    ...moduleFiles(repoRoot, SCHEMA_DIRS[variant]),
  ];
  const tables = new Map();
  for (const file of files) {
    const source = readFileSync(path.join(repoRoot, file), 'utf8');
    const records = readRecords(source, file);
    for (const instance of readDbInfoInstances(source, file)) {
      const fields = records.get(instance.type);
      if (!fields) {
        throw new Error(
          `${file}: instance DbInfo ${instance.type} has no record in the same module`,
        );
      }
      const table = instance.tableName ?? camelToSnake(instance.type);
      const names =
        instance.columnNames ?? fields.map((f) => fieldToColumn(instance.type, f.field));
      if (names.length !== fields.length) {
        throw new Error(
          `${file}: ${instance.type} lists ${names.length} columnNames for ${fields.length} record fields`,
        );
      }
      if (tables.has(table)) {
        throw new Error(
          `${file}: table ${table} is declared twice (${tables.get(table).record}, ${instance.type})`,
        );
      }
      tables.set(table, {
        table,
        record: instance.type,
        file,
        columns: fields.map((f, i) => ({column: names[i], ...f})),
      });
    }
  }
  return tables;
}

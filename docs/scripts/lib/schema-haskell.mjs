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

/** The index of the first character at or after `i` that is not whitespace or a `--` comment. */
function skipBlank(source, i) {
  for (;;) {
    while (i < source.length && /\s/.test(source[i])) i++;
    if (!source.startsWith('--', i)) return i;
    while (i < source.length && source[i] !== '\n') i++;
  }
}

const excerpt = (source, i) => source.slice(i, i + 40).split('\n')[0];

/**
 * Parse the Haskell list of string literals whose `[` is at `open`. Every item must be a standalone
 * literal: an expression, a concatenation or a bare name fails, so the reader can never replay SQL
 * that differs from what the Haskell builds. `--` comments are skipped, and a `]` inside a literal
 * (`"text[]"`) does not end the list. Returns the items and the index just past the `]`.
 */
function parseListAt(source, open, what) {
  let i = open + 1;
  const items = [];
  for (;;) {
    i = skipBlank(source, i);
    if (source[i] === ']' && items.length === 0) return {items, end: i + 1};
    const literal = /^"(?:[^"\\\n]|\\.)*"/.exec(source.slice(i));
    if (!literal)
      throw new Error(`${what}: list item is not a string literal: ${excerpt(source, i)}`);
    items.push(stringLiteral(literal[0]));
    i = skipBlank(source, i + literal[0].length);
    if (source[i] === ']') return {items, end: i + 1};
    if (source[i] !== ',')
      throw new Error(`${what}: expected , or ] after a list item: ${excerpt(source, i)}`);
    i++;
  }
}

/** The string literals of the first list at or after `from` (used for `columnNames`). */
export function parseStringList(source, from, what) {
  const open = source.indexOf('[', from);
  if (open < 0) throw new Error(`${what}: no [ … ] list found`);
  return parseListAt(source, open, what).items;
}

/**
 * The right-hand side of a top-level or `where`-local binding `name = …`: from after the `=` to the
 * first following non-blank line indented no deeper than the binding itself.
 */
function bindingBody(source, name) {
  const head = new RegExp(`^([ \\t]*)${name}[ \\t]*=(?!=)`, 'm').exec(source);
  if (!head) return null;
  const indent = head[1].length;
  const start = head.index + head[0].length;
  const rest = source.slice(start);
  const lines = rest.split('\n');
  let length = lines[0].length;
  for (const line of lines.slice(1)) {
    if (line.trim() !== '' && line.length - line.trimStart().length <= indent) break;
    length += 1 + line.length;
  }
  return rest.slice(0, length);
}

/**
 * The value of a `name = Text.unlines [ "…", … ]` (or `name = "…"`) binding, as the SQL text the
 * Haskell builds. The whole right-hand side must be exactly that: anything else (a name, a
 * concatenation before or after the list) fails, because replaying it would not be db-sync's SQL.
 */
export function readUnlinesBinding(source, name) {
  const body = bindingBody(source, name);
  if (body === null) throw new Error(`${name}: binding not found`);
  let i = skipBlank(body, 0);
  let value;
  if (body.startsWith('Text.unlines', i)) {
    i = skipBlank(body, i + 'Text.unlines'.length);
    if (body[i] !== '[')
      throw new Error(`${name}: expected [ after Text.unlines: ${excerpt(body, i)}`);
    const {items, end} = parseListAt(body, i, name);
    if (items.length === 0) throw new Error(`${name}: the Text.unlines list is empty`);
    value = items.map((line) => `${line}\n`).join('');
    i = end;
  } else {
    const literal = /^"(?:[^"\\\n]|\\.)*"/.exec(body.slice(i));
    if (!literal) {
      throw new Error(`${name}: not a string literal or a Text.unlines list: ${excerpt(body, i)}`);
    }
    value = stringLiteral(literal[0]);
    i += literal[0].length;
  }
  i = skipBlank(body, i);
  if (i < body.length)
    throw new Error(`${name}: unexpected expression after the SQL: ${excerpt(body, i)}`);
  return value;
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

/**
 * The source with comments (`--`, nested `{- -}`) and string and character literals blanked out,
 * offsets and newlines preserved, so declaration text inside them is never mistaken for code.
 */
export function maskHaskell(source) {
  const out = source.split('');
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('{-', i)) {
      let depth = 0;
      let j = i;
      while (j < source.length) {
        if (source.startsWith('{-', j)) {
          depth++;
          j += 2;
        } else if (source.startsWith('-}', j)) {
          depth--;
          j += 2;
          if (depth === 0) break;
        } else {
          j++;
        }
      }
      blank(i, j);
      i = j;
    } else if (/^-{2,}(?![-!#$%&*+./<=>?@\\^|~:])/.test(source.slice(i, i + 80))) {
      const end = source.indexOf('\n', i);
      const j = end < 0 ? source.length : end;
      blank(i, j);
      i = j;
    } else if (source[i] === '"') {
      const literal = /^"(?:[^"\\\n]|\\.)*"?/.exec(source.slice(i));
      blank(i, i + literal[0].length);
      i += literal[0].length;
    } else if (source[i] === "'" && !/[A-Za-z0-9_']/.test(source[i - 1] ?? '')) {
      const literal = /^'(?:[^'\\\n]|\\.)'/.exec(source.slice(i));
      const length = literal ? literal[0].length : 1;
      blank(i, i + length);
      i += length;
    } else {
      i++;
    }
  }
  return out.join('');
}

/**
 * `instance DbInfo X where` blocks with their `tableName` / `columnNames` overrides. Every line that
 * declares a DbInfo instance must be readable: one the reader cannot parse fails the run instead of
 * dropping a table out of the cross-check.
 */
export function readDbInfoInstances(source, file) {
  const instances = [];
  // Every instance head that names DbInfo, even one split across lines or with a context. A head
  // never crosses `where`, a plain `=` (as in `type instance Key X = XId`) or a blank line.
  const masked = maskHaskell(source);
  const declared = [
    ...masked.matchAll(
      /\binstance\b(?:(?!\bwhere\b|\binstance\b|=(?!>)|\n[ \t]*\n)[\s\S])*?\bDbInfo\b/g,
    ),
  ].map((m) => m.index);
  const parsed = new Set();
  const pattern = /^instance DbInfo ([A-Z][A-Za-z0-9_']*)(?:\s+where)?\s*(?:--.*)?$/gm;
  let match;
  // Heads are matched on the masked source (never inside a comment); bodies are read from the
  // original, at the same offsets, so string literals keep their text.
  while ((match = pattern.exec(masked)) !== null) {
    parsed.add(match.index);
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
        ? parseStringList(body, columns.index, `${file}: ${match[1]}.columnNames`)
        : null,
    });
  }
  const unread = declared.filter((index) => !parsed.has(index));
  if (unread.length > 0) {
    const heads = unread.map((index) =>
      source
        .slice(index, index + 60)
        .replace(/\s+/g, ' ')
        .trim(),
    );
    throw new Error(`${file}: DbInfo instance(s) the reader cannot parse: ${heads.join(' | ')}`);
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
      // columnNames describes SQL/encoder order, which need not be record declaration order.
      // Associate by the same naming rule as DbInfo's default. Unknown aliases require an
      // explicit reader extension, never a positional guess that can silently rotate docs/types.
      const byColumn = new Map(fields.map((f) => [fieldToColumn(instance.type, f.field), f]));
      if (new Set(names).size !== names.length || names.some((name) => !byColumn.has(name))) {
        throw new Error(
          `${file}: ${instance.type} cannot associate columnNames with record fields`,
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
        columns: names.map((column) => ({column, ...byColumn.get(column)})),
      });
    }
  }
  return tables;
}

import releases from '../../generated/versions.json';
import type {SchemaTable} from '../../src/data/schema';
import type {GuideLocks} from '../../src/data/guide-locks.mjs';
import {guidesForTable, variantsForGuide, versionsForGuide} from '../../src/data/guide-locks.mjs';
import type {
  ColumnChange,
  ExplorerDocument,
  ExplorerEntity,
  ExplorerInput,
  Relationship,
} from '../../src/schema/types';

export const tablePath = (name: string, variant: string = 'core'): string =>
  `/schema/${variant === 'address' ? 'address/' : ''}${name}`;
export const columnAnchor = (name: string): string => `column-${name}`;
const esc = (value: unknown): string =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
const pad = (value: number): string => String(value).padStart(4, '0');
const tuple = (at: {stageTwo: number; stageFour: number}): string =>
  `(${pad(at.stageTwo)}, ${pad(at.stageFour)})`;
function aliases(
  input: ExplorerInput,
  kind: 'table' | 'column',
  name: string,
  table?: string,
): string[] {
  return (
    input.renames.entities
      .find((e) => e.kind === kind && e.name === name && e.table === table)
      ?.formerNames.map((f) => f.name) ?? []
  );
}
/** The one route/entity model B19 consumes; no second explorer-only index. */
export function entityIndex(input: ExplorerInput): ExplorerEntity[] {
  return input.schema.tables.flatMap((table) => {
    const variants = table.variant === 'all' ? ['core', 'address'] : [table.variant];
    const route = tablePath(table.name, table.variant);
    return [
      {
        kind: 'table' as const,
        name: table.name,
        table: table.name,
        path: route,
        aliases: aliases(input, 'table', table.name),
        variants,
      },
      ...table.columns.map((column) => ({
        kind: 'column' as const,
        name: column.name,
        table: table.name,
        path: `${route}#${columnAnchor(column.name)}`,
        aliases: aliases(input, 'column', column.name, table.name),
        variants,
      })),
    ];
  });
}
export function changeSummary(change: ColumnChange): string {
  const {before, after} = change;
  if (!before) return 'First recorded';
  if (!after) return 'Dropped';
  const changes: string[] = [];
  if (before.name !== after.name) changes.push(`Renamed from ${before.name} to ${after.name}`);
  if (before.nullable !== after.nullable) changes.push(after.nullable ? 'Nullable' : 'NOT NULL');
  if (before.default !== after.default)
    changes.push(`Default changed to ${after.default ?? 'no default'}`);
  if (JSON.stringify(before.resolved_type.checks) !== JSON.stringify(after.resolved_type.checks))
    changes.push('CHECK constraints changed');
  if (
    JSON.stringify({...before.resolved_type, checks: []}) !==
    JSON.stringify({...after.resolved_type, checks: []})
  )
    changes.push(`Resolved type changed to ${after.resolved_type.base}`);
  return changes.join('; ') || 'Fingerprint changed';
}
function historyList(events: readonly ColumnChange[]): string {
  return `<ol>${events.map((event) => `<li>${esc(changeSummary(event))} — ${event.migration.startsWith('runtime:') ? 'runtime address-table conversion at extracted schema' : `schema ${tuple(event.at)}`} (<code>${esc(event.migration)}</code>)</li>`).join('')}</ol>`;
}
function link(base: string, route: string, label: string): string {
  return `<a href="${esc(base + route.slice(1))}"><code translate="no">${esc(label)}</code></a>`;
}
function tableFor(input: ExplorerInput, name: string, variant: string): SchemaTable | undefined {
  return input.schema.tables.find(
    (t) => t.name === name && (t.variant === 'all' || t.variant === variant),
  );
}
function relationRows(input: ExplorerInput, relations: Relationship[], base: string): string {
  return relations
    .map((r) => {
      const source = tableFor(input, r.table, r.variant)!,
        target = tableFor(input, r.target, r.variant)!;
      return `<tr><th scope="row">${link(base, tablePath(r.table, source.variant) + '#' + columnAnchor(r.columns[0]), `${r.table}.${r.columns.join(', ')}`)}</th><td>${link(base, tablePath(r.target, target.variant) + '#' + columnAnchor(r.targetColumns[0]), `${r.target}.${r.targetColumns.join(', ')}`)}</td><td>${r.kind === 'foreign-key' ? 'Database foreign key' : 'Haskell typed key (not enforced by SQL)'}</td><td>${r.variant}</td></tr>`;
    })
    .join('');
}
/** A deterministic grid of the extracted relations, with equivalent linked rows below it. */
function erd(input: ExplorerInput, variant: 'core' | 'address'): string {
  const tables = input.schema.tables.filter((t) => t.variant === 'all' || t.variant === variant);
  const relations = input.history.relationships.filter((r) => r.variant === variant);
  const width = 1200,
    height = Math.ceil(tables.length / 4) * 92 + 24;
  const positions = new Map(
    tables.map((t, i) => [t.name, {x: (i % 4) * 300 + 8, y: Math.floor(i / 4) * 92 + 12}]),
  );
  return `<svg class="schema-erd dbs-type-mono" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="erd-${variant}-title erd-${variant}-description"><title id="erd-${variant}-title">${variant} schema relationships</title><desc id="erd-${variant}-description">${tables.length} tables and views. Lines connect Haskell typed keys or enforced foreign keys to their target. Each box names a relation. The relationship table below lists every source, target and enforcement status; no relationship is inferred from a column name.</desc>${relations
    .map((r) => {
      const a = positions.get(r.table)!,
        b = positions.get(r.target)!;
      return `<path class="schema-edge" d="M${a.x + 140},${a.y + 44} L${b.x + 140},${b.y}" ><title>${esc(r.table + '.' + r.columns.join(', ') + ' → ' + r.target + '.' + r.targetColumns.join(', '))}</title></path>`;
    })
    .join('')}${tables
    .map((t) => {
      const p = positions.get(t.name)!;
      return `<g><rect class="schema-node" x="${p.x}" y="${p.y}" width="280" height="44"/><text class="schema-node-label" x="${p.x + 8}" y="${p.y + 27}">${esc(t.name)}</text></g>`;
    })
    .join('')}</svg>`;
}
export function buildDocuments(
  input: ExplorerInput,
  locks: GuideLocks,
  base: string,
): Record<string, ExplorerDocument> {
  for (const table of input.schema.tables) {
    if (
      !/^[a-z][a-z0-9_]*$/.test(table.name) ||
      table.columns.some((column) => !/^[a-z][a-z0-9_]*$/.test(column.name))
    )
      throw new Error('Schema route requires SQL identifiers');
  }
  if (
    input.history.schemaVersion !== 1 ||
    input.history.current.stageTwo !== input.schema.dbSchemaVersion.stage_two
  )
    throw new Error('Schema explorer history is stale; regenerate it');
  for (const r of input.history.relationships) {
    const a = tableFor(input, r.table, r.variant),
      b = tableFor(input, r.target, r.variant);
    if (
      !a ||
      !b ||
      !r.columns.every((c) => a.columns.some((col) => col.name === c)) ||
      !r.targetColumns.every((c) => b.columns.some((col) => col.name === c))
    )
      throw new Error(`Invalid schema relationship ${r.table} → ${r.target}`);
  }
  const pages: Record<string, ExplorerDocument> = {};
  const entities = entityIndex(input);
  const version = tuple(input.history.current);
  for (const table of input.schema.tables) {
    const variant = table.variant === 'all' ? 'core' : table.variant;
    const route = tablePath(table.name, table.variant);
    const names = aliases(input, 'table', table.name);
    const guides = guidesForTable(locks, table.name).filter(
      (guide) =>
        versionsForGuide(locks, guide).includes('current') &&
        variantsForGuide(locks, guide).current?.some(
          (supported) => table.variant === 'all' || supported === variant,
        ),
    );
    const rows = table.columns
      .map((column) => {
        const events = input.history.changes[`${variant}:${table.name}.${column.name}`];
        if (!events?.length || events.at(-1)?.after?.fingerprint !== column.fingerprint)
          throw new Error(`Stale column history ${variant}:${table.name}.${column.name}`);
        const former = aliases(input, 'column', column.name, table.name);
        return `<tr id="${columnAnchor(column.name)}"><th scope="row">${former.map((name) => `<span id="${columnAnchor(name)}"></span>`).join('')}<code translate="no">${esc(column.name)}</code></th><td><code>${esc(column.resolved_type.base)}</code>${column.resolved_type.domains.length ? `<p>Domain chain: <code>${esc(column.resolved_type.domains.join(' → '))}</code></p>` : ''}${column.resolved_type.checks.map((check) => `<p><code>${esc(check.definition)}</code></p>`).join('')}</td><td>${column.nullable ? 'Yes' : 'No'}</td><td><code>${esc(column.default ?? 'No default')}</code></td><td>${historyList(events)}</td></tr>`;
      })
      .join('');
    const removed = Object.entries(input.history.changes).filter(
      ([key, events]) =>
        key.startsWith(`${variant}:${table.name}.`) && events.at(-1)?.after === null,
    );
    const renames =
      input.renames.entities.find((e) => e.kind === 'table' && e.name === table.name)
        ?.formerNames ?? [];
    const description = `Columns, resolved types, change history and guide references for ${table.name}, ${table.variant === 'all' ? 'core and address' : table.variant} variant, schema (stage_two, stage_four) = ${version}.`;
    pages[route] = {
      metadata: {
        type: 'Dataset',
        title: table.name,
        description,
        variables: table.columns.map((c) => c.name),
      },
      html: `<h1><code translate="no">${esc(table.name)}</code></h1><p>${esc(description)}</p><p>${link(base, '/schema', 'All schema tables')} · ${esc(table.kind)} · variant: ${table.variant === 'all' ? 'core and address' : table.variant}</p>${names.length ? `<h2>Former names</h2><ul>${renames.map((f) => `<li><code>${esc(f.name)}</code> renamed to <code>${esc(table.name)}</code> by <code>${esc(f.until.file)}</code></li>`).join('')}</ul>` : ''}<h2>Columns</h2><div data-schema-scroll="" tabindex="0" role="region" aria-label="Schema data table"><table class="dbs-type-mono"><caption>${esc(table.name)} columns — schema ${version}</caption><thead><tr><th scope="col">Column</th><th scope="col">Resolved type and checks</th><th scope="col">Nullable</th><th scope="col">Default</th><th scope="col">Change history</th></tr></thead><tbody>${rows}</tbody></table></div>${removed.length ? `<h2>Dropped columns</h2>${removed.map(([key, events]) => `<h3><code>${esc(key.split('.')[1])}</code></h3>${historyList(events)}`).join('')}` : ''}<h2>Guides that use this table</h2>${guides.length ? `<ul>${guides.map((guide) => `<li>${link(base, '/' + guide.replace(/\.md$/, ''), guide.split('/').at(-1)!.replace(/\.md$/, ''))}</li>`).join('')}</ul>` : '<p>No current guide declares this table for this variant.</p>'}<p>${link(base, '/schema#release-boundaries', 'Tag-derived release boundaries')} give the independent release context. History records observed stage-two/four migration boundaries. Stage-one domains are replayed in full, as in the schema extractor; their earlier definitions are not reconstructed. Runtime address-table conversion is labeled separately.</p>`,
    };
  }
  const releaseGroups = new Map<string, string[]>();
  for (const release of releases.versions) {
    const boundary = `(${release.stage_two}, ${release.stage_four})`;
    releaseGroups.set(boundary, [...(releaseGroups.get(boundary) ?? []), release.tag]);
  }
  pages['/schema'] = {
    metadata: {
      type: 'WebPage',
      title: 'Schema',
      description: `Extracted tables, columns and relationships at schema ${version}.`,
    },
    html: `<h1>Schema</h1><p>Extracted schema (stage_two, stage_four) = ${version}. Choose a table for column types, migration history and guides. Core is the default; address uses <code>tx_out.use_address_table</code>.</p><ul>${entities
      .filter((e) => e.kind === 'table')
      .map((e) => `<li>${link(base, e.path, e.name)} — ${e.variants.join(', ')}</li>`)
      .join(
        '',
      )}</ul><h2 id="release-boundaries">Release boundaries</h2><p>These tuples come from B11’s tag-derived version artifact, not migration filename dates. They describe released schemas, not a claim that today’s columns existed unchanged in those releases. The current page describes the extracted working tree.</p><div data-schema-scroll="" tabindex="0" role="region" aria-label="Release schema boundaries"><table><caption>Released db-sync schema boundaries</caption><thead><tr><th scope="col">Schema (stage_two, stage_four)</th><th scope="col">db-sync releases</th></tr></thead><tbody>${[...releaseGroups].map(([boundary, tags]) => `<tr><th scope="row">${boundary}</th><td>${tags.map(esc).join(', ')}</td></tr>`).join('')}</tbody></table></div><h2>Entity relationship diagrams</h2><p>Lines represent database foreign keys or typed Haskell key references, not inferred column-name matches. Haskell typed keys are logical joins, not SQL-enforced constraints. Every relationship has a linked text equivalent below.</p>${erd(input, 'core')}${erd(input, 'address')}<div data-schema-scroll="" tabindex="0" role="region" aria-label="Schema data table"><table class="dbs-type-mono" data-relationships=""><caption>Schema relationships in both variants</caption><thead><tr><th scope="col">Source</th><th scope="col">Target</th><th scope="col">Evidence</th><th scope="col">Variant</th></tr></thead><tbody>${relationRows(input, input.history.relationships, base)}</tbody></table></div>`,
  };
  return pages;
}

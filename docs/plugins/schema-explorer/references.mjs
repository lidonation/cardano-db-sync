/** The guide's existing lock declaration is also its forward schema navigation (GDE-5). */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalName} from '../../scripts/lib/schema-explorer.mjs';
const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (name) => JSON.parse(readFileSync(path.join(docs, 'generated', name), 'utf8'));
const schema = read('schema.json'),
  locks = read('guide-locks.json'),
  renames = read('schema-renames.json');
export function references(guide, data = {schema, locks, renames}) {
  const variants = data.locks.variants?.[guide]?.current ?? [];
  if (!data.locks.ranges?.[guide]?.includes('current')) return [];
  const links = new Map();
  for (const key of Object.keys(data.locks.guides?.[guide] ?? {})) {
    const [kind, name] = key.split(':');
    if (!['tables', 'columns'].includes(kind)) continue;
    const [oldTable, oldColumn] = name.split('.');
    const table = canonicalName(data.renames, 'table', oldTable);
    const column = oldColumn && canonicalName(data.renames, 'column', oldColumn, table);
    for (const variant of variants) {
      const entry = data.schema.tables.find(
        (t) => t.name === table && (t.variant === 'all' || t.variant === variant),
      );
      if (!entry || (column && !entry.columns.some((c) => c.name === column))) continue;
      // Forward navigation is table-level (GDE-5); column anchors remain in the shared index.
      const url = `/schema/${entry.variant === 'address' ? 'address/' : ''}${table}`;
      links.set(url, {url, label: `${table}${entry.variant !== 'all' ? ` (${variant})` : ''}`});
    }
  }
  return [...links.values()];
}
export default function schemaReferences() {
  return (tree, file) => {
    const relative = path.relative(docs, file.path ?? '').replaceAll(path.sep, '/');
    if (!/^docs\/guides\/[^/]+\.md$/.test(relative)) return;
    const links = references(relative);
    if (!links.length) return;
    tree.children.push(
      {type: 'heading', depth: 2, children: [{type: 'text', value: 'Schema references'}]},
      {
        type: 'list',
        ordered: false,
        spread: false,
        children: links.map(({url, label}) => ({
          type: 'listItem',
          spread: false,
          children: [
            {
              type: 'paragraph',
              children: [{type: 'link', url, children: [{type: 'inlineCode', value: label}]}],
            },
          ],
        })),
      },
    );
  };
}

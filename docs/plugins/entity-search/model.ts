import {createHash} from 'node:crypto';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {entityIndex} from '../schema-explorer/model';
import {createEntityIndex} from '../../src/search/engine';
import {versionSegment} from '../../src/search/version';
import type {EntityBundle, EntityManifest, SearchEntity} from '../../src/search/entities';
import type {ExplorerInput} from '../../src/schema/types';
import type {GuideLocks} from '../../src/data/guide-locks.mjs';
import config from '../../generated/config-schema.json';
import annotations from '../../generated/haddock-annotations.json';

export interface EntityDoc {
  id: string;
  title: string;
  description: string;
  permalink: string;
  frontMatter: {requires?: {config?: string[]}};
  /** Source is read only to identify documented CLI destinations, not to index full prose. */
  sourceText?: string;
}
export interface EntityVersion {
  versionName: string;
  docs: readonly EntityDoc[];
}
/** Use the extracted config tree, not regex guesses about keys in prose. */
function configNames(shape: {keys?: {name: string; shape: object}[]}, prefix = ''): string[] {
  return (shape.keys ?? []).flatMap((key) => {
    const name = prefix + key.name;
    return [name, ...configNames(key.shape, name + '.')];
  });
}
const options = new Set(configNames(config.config));
// Only flags whose own annotation starts with the identifier; exclude legacy switches in prose.
const flags = [
  ...new Set(
    annotations.files.flatMap((file) =>
      file.annotations.flatMap((annotation) => {
        const match = /^@(--[a-z0-9-]+)(?:[ @])/.exec(annotation.doc);
        return match ? [match[1]] : [];
      }),
    ),
  ),
].sort();

/** One model for every published docs line; no guessed release or schema-version arithmetic. */
export function buildRecords(
  versions: readonly EntityVersion[],
  input: ExplorerInput,
  locks: GuideLocks,
  baseUrl: string,
): Record<string, SearchEntity[]> {
  return Object.fromEntries(
    versions.map((version) => {
      const line = versionSegment(version.versionName);
      const records: SearchEntity[] = [];
      for (const doc of version.docs) {
        const guide = doc.id.startsWith('guides/');
        const key = `docs/${doc.id}.md`;
        const supported = locks.ranges?.[key];
        if (guide && supported && !supported.includes(line)) continue;
        records.push({
          id: `${guide ? 'guide' : 'doc'}:${doc.id}`,
          identifier: '',
          aliases: [],
          kind: guide ? 'guide' : 'doc',
          group: guide ? 'guides' : 'docs',
          title: doc.title,
          // Tier 1 holds descriptions, not a duplicate full-text index (Pagefind owns Tier 2).
          body: doc.description,
          url: doc.permalink,
          facets: guide
            ? {versions: supported ?? [line], variants: locks.variants?.[key]?.[line] ?? []}
            : {},
        });
        // A current extraction cannot vouch for a historical config/CLI parser.
        if (line !== 'current') continue;
        for (const name of doc.frontMatter.requires?.config ?? []) {
          if (!options.has(name)) throw new Error(`Unknown extracted config option: ${name}`);
          records.push({
            id: `config:${name}:${doc.id}`,
            identifier: name,
            aliases: [],
            kind: 'config',
            group: 'docs',
            title: name,
            body: doc.description,
            url: doc.permalink,
            facets: {},
          });
        }
        for (const name of flags) {
          // Whole-flag boundary: --config-file is not documentation for --config.
          if (!doc.sourceText?.match(new RegExp(`(^|[^\\w-])${name}(?![\\w-])`))) continue;
          records.push({
            id: `cli:${name}:${doc.id}`,
            identifier: name,
            aliases: [],
            kind: 'cli',
            group: 'docs',
            title: name,
            body: doc.description,
            url: doc.permalink,
            facets: {},
          });
        }
      }
      if (line === 'current') {
        for (const entity of entityIndex(input)) {
          const table = input.schema.tables.find(
            (t) =>
              t.name === entity.table &&
              (t.variant === 'all' || entity.variants.includes(t.variant)),
          )!;
          const column =
            entity.kind === 'column'
              ? table.columns.find((c) => c.name === entity.name)!
              : undefined;
          records.push({
            id: `${entity.kind}:${entity.path}`,
            identifier: entity.name,
            aliases:
              entity.kind === 'column'
                ? [`${entity.table}.${entity.name}`, ...entity.aliases]
                : entity.aliases,
            kind: entity.kind,
            group: 'tables',
            title: entity.name,
            body: '',
            url: baseUrl + entity.path.slice(1),
            facets: {
              variants: entity.variants,
              ...(column
                ? {table: entity.table, nullable: column.nullable}
                : {columns: table.columns.length}),
            },
          });
        }
      }
      return [line, records];
    }),
  );
}
/** Publish only content-addressed payloads; the tiny stable manifest selects their current names. */
export async function emitBundles(
  outDir: string,
  locale: string,
  records: Record<string, readonly SearchEntity[]>,
): Promise<EntityManifest> {
  const lines = Object.keys(records).sort().map(versionSegment);
  const directory = path.join(outDir, 'entities');
  await rm(directory, {recursive: true, force: true});
  await mkdir(directory, {recursive: true});
  const manifest: EntityManifest = {schemaVersion: 1, locale, bundles: {}};
  for (const line of lines) {
    const bundle: EntityBundle = {
      schemaVersion: 1,
      line,
      locale,
      index: createEntityIndex(records[line]).toJSON(),
    };
    const bytes = JSON.stringify(bundle) + '\n';
    const digest = createHash('sha256').update(bytes).digest('hex');
    const file = `entities/${line}.${digest}.json`;
    await writeFile(path.join(outDir, file), bytes);
    manifest.bundles[line] = file;
  }
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest) + '\n');
  return manifest;
}

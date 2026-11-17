import {execFileSync} from 'node:child_process';
import {maskHaskell} from '../../scripts/lib/schema-haskell.mjs';
import {validateFeed} from '../../src/updates/model';
import type {UpdateEntry, UpdatesFeed} from '../../src/updates/types';

/** A bounded subscription history, independently retained for each kind. */
export const ENTRIES_PER_KIND = 50;
const NUMERIC_RELEASE = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2,3}$/;
const HASKELL = /^(?:cardano-db|cardano-db-sync)\/(?:src|app)\/.*\.hs$/;
const PROSE = /^(?:doc\/.*\.md|docs\/docs\/.*\.mdx?|Readme\.md)$/i;
const MIGRATION = /^schema\/migration-\d+-\d+-\d+\.sql$/;
const PATHS = [
  'schema',
  'doc',
  'docs/docs',
  'Readme.md',
  ':(glob)cardano-db/src/**/*.hs',
  ':(glob)cardano-db-sync/src/**/*.hs',
  ':(glob)cardano-db-sync/app/**/*.hs',
];

/** Only Haddock blocks, including continuation lines and inline field docs; not code edits. */
export function haddockText(source: string): string {
  return [
    ...maskHaskell(source, {preserveComments: true}).matchAll(
      /^[\t ]*(?:--[\t ]*[|^*$][^\n]*(?:\n[\t ]*--[^\n]*)*|\{-[\t ]*[|^][\s\S]*?-\})|--[\t ]*\^[^\n]*/gm,
    ),
  ]
    .map((match) => match[0].trim())
    .join('\n');
}

/** Read the checked-out history, without a network call or executing repository code. */
export function readUpdates(directory: string, limit = ENTRIES_PER_KIND): UpdatesFeed {
  if (!Number.isInteger(limit) || limit < 1 || limit > ENTRIES_PER_KIND)
    throw new Error('Invalid updates retention');
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  if (git('rev-parse', '--is-shallow-repository').trim() !== 'false')
    throw new Error(
      'Updates require full history and tags; fetch with fetch-depth: 0 (shallow checkout).',
    );
  const remote = git('remote', 'get-url', 'origin').trim();
  const identity =
    /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote);
  if (!identity) throw new Error('Updates require a GitHub origin remote without credentials.');
  const repository = `https://github.com/${identity[1]}`;
  const head = git('show', '-s', '--format=%cI', 'HEAD').trim();
  const date = (timestamp: string) => {
    const instant = new Date(timestamp);
    if (!Number.isFinite(instant.getTime())) throw new Error('Invalid git date');
    return instant.toISOString().slice(0, 10);
  };
  const entries: UpdateEntry[] = [];
  const counts = {release: 0, schema: 0, docs: 0};
  const add = (entry: UpdateEntry) => {
    if (counts[entry.kind] < limit) {
      entries.push(entry);
      counts[entry.kind]++;
    }
  };
  const tags = git(
    'tag',
    '--format=%(refname:strip=2)%00%(creatordate:iso-strict)%00%(objecttype)%00%(*objecttype)',
  );
  const releases: UpdateEntry[] = tags
    .trim()
    .split('\n')
    .filter(Boolean)
    .flatMap((record) => {
      const [tag, timestamp, type, peeled] = record.split('\0');
      if (
        !NUMERIC_RELEASE.test(tag) ||
        !(type === 'commit' || (type === 'tag' && peeled === 'commit'))
      )
        return [];
      return [
        {
          id: `release:${tag}`,
          kind: 'release' as const,
          date: date(timestamp),
          title: `Release ${tag}`,
          url: `${repository}/tree/${encodeURIComponent(tag)}`,
        },
      ];
    });
  const order = (a: UpdateEntry, b: UpdateEntry) =>
    b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
  releases.sort(order).forEach(add);
  // NUL-framed fields and paths: titles and filenames may contain newlines. UPDATE cannot be
  // a path under PATHS, and the three header fields following it are consumed unconditionally.
  const tokens = git(
    'log',
    '--first-parent',
    '--full-history',
    '--diff-merges=first-parent',
    '--no-renames',
    '--raw',
    '--no-abbrev',
    '-z',
    '--format=UPDATE%x00%H%x00%cI%x00%s',
    'HEAD',
    '--',
    ...PATHS,
  ).split('\0');
  const comments = new Map<string, string>();
  const documentation = (blob: string) => {
    if (/^0+$/.test(blob)) return '';
    if (!comments.has(blob)) comments.set(blob, haddockText(git('show', blob)));
    return comments.get(blob)!;
  };
  for (let i = 0; i < tokens.length;) {
    if (!tokens[i]) {
      i++;
      continue;
    }
    if (tokens[i++] !== 'UPDATE') throw new Error('Invalid updates git record');
    const [sha, timestamp, title] = tokens.slice(i, i + 3);
    i += 3;
    if (!/^[a-f0-9]{40,64}$/.test(sha) || title === undefined)
      throw new Error('Invalid updates commit');
    const files: {name: string; before: string; after: string}[] = [];
    while (i < tokens.length && tokens[i] !== 'UPDATE') {
      const raw = tokens[i++].replace(/^\n/, '');
      if (!raw) continue;
      const match = /^:[0-7]{6} [0-7]{6} ([a-f0-9]{40,64}) ([a-f0-9]{40,64}) [AMDT]$/.exec(raw);
      if (!match || tokens[i] === undefined) throw new Error('Invalid updates change record');
      files.push({name: tokens[i++], before: match[1], after: match[2]});
    }
    const entry = {date: date(timestamp), title, url: `${repository}/commit/${sha}`};
    if (files.some((file) => MIGRATION.test(file.name)))
      add({...entry, id: `schema:${sha}`, kind: 'schema'});
    if (
      counts.docs < limit &&
      (files.some((file) => PROSE.test(file.name)) ||
        files.some(
          (file) =>
            HASKELL.test(file.name) && documentation(file.before) !== documentation(file.after),
        ))
    )
      add({...entry, id: `docs:${sha}`, kind: 'docs'});
  }
  entries.sort(order);
  const asOf = entries.reduce(
    (latest, entry) => (entry.date > latest ? entry.date : latest),
    date(head),
  );
  return validateFeed({asOf, entries});
}

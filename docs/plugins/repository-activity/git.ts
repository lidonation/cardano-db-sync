import {execFileSync} from 'node:child_process';

export type Language = 'haskell' | 'sql' | 'nix' | 'cabal' | 'docs';
export type DailyLines = {date: string} & Record<Language, number>;
export interface GitHistory {
  commits: {sha: string; date: string; subject: string; author: string}[];
  authors: {name: string; email: string; commits: number; sha: string}[];
  firstCommit: string | null;
  dailyLines: DailyLines[];
}

function language(file: string): Language | undefined {
  // numstat C-quotes paths containing non-ASCII or control characters. Only the
  // ASCII extension is needed here; keep escapes inside the filename untouched.
  if (file.startsWith('"') && file.endsWith('"')) file = file.slice(1, -1);
  if (/\.l?hs$/i.test(file)) return 'haskell';
  if (/\.sql$/i.test(file)) return 'sql';
  if (/\.nix$/i.test(file)) return 'nix';
  if (/\.cabal$/i.test(file)) return 'cabal';
  if (/\.(md|mdx|rst)$/i.test(file)) return 'docs';
  return undefined;
}

/** Read from a full local checkout; author email stays in the build process, never client data. */
export function readHistory(directory: string, run?: (...args: string[]) => string): GitHistory {
  const git =
    run ??
    ((...args: string[]) =>
      execFileSync('git', args, {
        cwd: directory,
        encoding: 'utf8',
        maxBuffer: 100 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }));
  if (git('rev-parse', '--is-shallow-repository').trim() !== 'false')
    throw new Error('Shallow history');
  try {
    git('rev-parse', '--verify', 'HEAD');
  } catch (error) {
    if (git('for-each-ref', '--count=1', '--format=%(objectname)').trim() === '') {
      return {commits: [], authors: [], firstCommit: null, dailyLines: []};
    }
    throw error;
  }
  const text = git(
    'log',
    '--no-renames',
    '--numstat',
    '--format=%x1e%H%x00%cI%x00%aN%x00%aE%x00%s',
  );
  // A first-parent diff includes changes made during merge conflict resolution without
  // double-counting the merged branch. The separate full walk preserves all authors.
  const mainline = git(
    'log',
    '--first-parent',
    '--no-renames',
    '--numstat',
    '--format=%x1e%H%x00%cI%x00%aN%x00%aE%x00%s',
  );
  if (!text.startsWith('\x1e') || !mainline.startsWith('\x1e'))
    throw new Error('Malformed git log');
  const commits: GitHistory['commits'] = [];
  const authors = new Map<string, GitHistory['authors'][number]>();
  const days = new Map<string, DailyLines>();
  const records = [
    ...text
      .split('\x1e')
      .slice(1)
      .map((record) => ({record, series: false})),
    ...mainline
      .split('\x1e')
      .slice(1)
      .map((record) => ({record, series: true})),
  ];
  for (const {record, series} of records) {
    const newline = record.indexOf('\n');
    if (newline < 0) throw new Error('Malformed git record');
    const fields = record.slice(0, newline).split('\0');
    if (fields.length !== 5) throw new Error('Malformed git header');
    const [sha, timestamp, name, email, subject] = fields;
    const instant = new Date(timestamp);
    if (
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha) ||
      !Number.isFinite(instant.getTime()) ||
      !name ||
      !email
    )
      throw new Error('Malformed git commit');
    const date = instant.toISOString().slice(0, 10);
    if (!series) {
      commits.push({sha, date, subject, author: name});
      if (!/\[bot\]$/i.test(name) && !/\[bot\]@/i.test(email)) {
        const key = email.toLowerCase();
        const author = authors.get(key) ?? {name, email, commits: 0, sha};
        author.commits++;
        authors.set(key, author);
      }
      continue;
    }
    const day = days.get(date) ?? {date, haskell: 0, sql: 0, nix: 0, cabal: 0, docs: 0};
    for (const line of record
      .slice(newline + 1)
      .split('\n')
      .filter(Boolean)) {
      const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!match) throw new Error('Malformed numstat');
      const kind = language(match[3]);
      if (kind && match[1] !== '-' && match[2] !== '-')
        day[kind] += Number(match[1]) - Number(match[2]);
    }
    days.set(date, day);
  }
  return {
    commits,
    authors: [...authors.values()],
    firstCommit: commits.reduce<string | null>(
      (first, commit) => (first === null || commit.date < first ? commit.date : first),
      null,
    ),
    dailyLines: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

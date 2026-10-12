import {readFileSync} from 'node:fs';
import path from 'node:path';

/**
 * The release history the Ecosystem page's facts strip shows (B44-b), counted from the committed
 * `cardano-db-sync/CHANGELOG.md` rather than git history: CI checks out shallow clones, and a
 * committed file counts the same everywhere it is built.
 */
export interface ReleaseHistory {
  /** Released versions: every `## <version>` heading, never `## Unreleased`. */
  readonly releases: number;
  /** The newest released version, as its heading names it. */
  readonly latest: string;
  /** The year of the oldest dated release (`## 1.0.0 -- November 2019`). */
  readonly since: number;
}

const RELEASE = /^## (\d+(?:\.\d+)+)(?:\s+--\s+.*?(\d{4}))?\s*$/gm;

export function releaseHistory(changelog: string): ReleaseHistory {
  const releases = [...changelog.matchAll(RELEASE)];
  const years = releases.flatMap((match) => (match[2] ? [Number(match[2])] : []));
  if (releases.length === 0 || years.length === 0) {
    throw new Error('CHANGELOG.md: no dated release headings (`## 1.0.0 -- November 2019`)');
  }
  return {releases: releases.length, latest: releases[0][1], since: Math.min(...years)};
}

/**
 * The release history of the db-sync package in this checkout. The path is resolved from the site
 * directory, which every docs script runs in: Docusaurus loads its config as CommonJS, where
 * `import.meta` is not available.
 */
export function loadReleaseHistory(
  file = path.resolve(process.cwd(), '..', 'cardano-db-sync', 'CHANGELOG.md'),
): ReleaseHistory {
  return releaseHistory(readFileSync(file, 'utf8'));
}

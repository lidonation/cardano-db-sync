import type {RepositoryData} from './types';

/** All figures use the snapshot's build date, including when served from cache. */
export function activityMetrics(data: RepositoryData) {
  const built = new Date(data.builtAt);
  const date = built.toISOString().slice(0, 10);
  const yearAgo = new Date(built);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const cutoff = yearAgo.toISOString().slice(0, 10);
  let years: number | null = null;
  if (data.firstCommit !== null) {
    const first = new Date(`${data.firstCommit}T00:00:00Z`);
    years = built.getUTCFullYear() - first.getUTCFullYear();
    if (date.slice(5) < data.firstCommit.slice(5)) years--;
    years = Math.max(0, years);
  }
  return {
    commits: data.commits.length,
    pastYear: data.commits.filter((commit) => commit.date >= cutoff && commit.date <= date).length,
    lines: data.dailyLines.reduce(
      (sum, row) => sum + row.haskell + row.sql + row.nix + row.cabal + row.docs,
      0,
    ),
    contributors: data.contributors.length,
    years,
  };
}

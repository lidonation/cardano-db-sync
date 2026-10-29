import type {RepositoryData} from '../../src/repository-activity/types';

const date = (s: unknown): s is string =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
const obj = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === 'string' && x.length <= 500;

/** Validate and reconstruct cache entries; extra fields, including any private data, are discarded. */
export function parseCache(json: string): RepositoryData {
  const value: unknown = JSON.parse(json);
  if (
    !obj(value) ||
    value.version !== 1 ||
    typeof value.builtAt !== 'string' ||
    !Number.isFinite(Date.parse(value.builtAt)) ||
    !(value.firstCommit === null || date(value.firstCommit)) ||
    !Array.isArray(value.commits) ||
    !Array.isArray(value.contributors) ||
    !(value.coreTeam === undefined || Array.isArray(value.coreTeam)) ||
    !Array.isArray(value.dailyLines) ||
    !Array.isArray(value.countries) ||
    !integer(value.unknownCountries) ||
    value.unknownCountries < 0
  )
    throw new Error('Invalid repository cache');
  const commits = value.commits.map((c: unknown) => {
    if (
      !obj(c) ||
      typeof c.sha !== 'string' ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(c.sha) ||
      !date(c.date) ||
      !text(c.subject) ||
      !text(c.author)
    )
      throw new Error('Invalid cached commit');
    return {sha: c.sha, date: c.date, subject: c.subject, author: c.author};
  });
  const parseContributor = (p: unknown) => {
    if (
      !obj(p) ||
      typeof p.login !== 'string' ||
      !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(p.login) ||
      !text(p.name) ||
      !integer(p.commits) ||
      p.commits < 0 ||
      !(
        p.avatar === null ||
        (typeof p.avatar === 'string' &&
          /^\/repository-avatars\/[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(p.avatar))
      )
    )
      throw new Error('Invalid cached contributor');
    return {login: p.login, name: p.name, commits: p.commits, avatar: p.avatar};
  };
  const contributors = value.contributors.map(parseContributor);
  const coreTeam = (value.coreTeam ?? []).map(parseContributor);
  const dailyLines = value.dailyLines.map((d: unknown) => {
    if (
      !obj(d) ||
      !date(d.date) ||
      !integer(d.haskell) ||
      !integer(d.sql) ||
      !integer(d.nix) ||
      !integer(d.cabal) ||
      !integer(d.docs)
    )
      throw new Error('Invalid cached series');
    return {date: d.date, haskell: d.haskell, sql: d.sql, nix: d.nix, cabal: d.cabal, docs: d.docs};
  });
  const countries = value.countries.map((c: unknown) => {
    if (!obj(c) || !text(c.country) || !c.country || !integer(c.count) || c.count <= 0)
      throw new Error('Invalid cached country');
    return {country: c.country, count: c.count};
  });
  if (
    countries.reduce((sum, country) => sum + country.count, value.unknownCountries) !==
      contributors.length ||
    new Set(countries.map((country) => country.country)).size !== countries.length ||
    new Set(contributors.map((person) => person.login.toLowerCase())).size !==
      contributors.length ||
    (commits.length === 0
      ? value.firstCommit !== null
      : value.firstCommit !==
        commits.reduce(
          (first, commit) => (commit.date < first ? commit.date : first),
          commits[0].date,
        ))
  )
    throw new Error('Inconsistent repository cache');
  return {
    version: 1,
    builtAt: value.builtAt,
    firstCommit: value.firstCommit,
    commits,
    contributors,
    coreTeam,
    dailyLines,
    countries,
    unknownCountries: value.unknownCountries,
  };
}

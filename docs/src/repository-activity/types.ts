/** Public build artifact: never include contributor email addresses or profile locations. */
export type Language = 'haskell' | 'sql' | 'nix' | 'cabal' | 'docs';
export type DailyLines = {date: string} & Record<Language, number>;
export interface Contributor {
  login: string;
  name: string;
  commits: number;
  avatar: string | null;
}
export interface RepositoryData {
  version: 1;
  builtAt: string;
  commits: {sha: string; date: string; subject: string; author: string}[];
  contributors: Contributor[];
  coreTeam: Contributor[];
  firstCommit: string | null;
  dailyLines: DailyLines[];
  countries: {country: string; count: number}[];
  unknownCountries: number;
}
export type RepositorySnapshotState =
  {status: 'available'; data: RepositoryData} | {status: 'unavailable'};
/** Compact page data; full history is available to later build-time consumers. */
export interface RepositorySummary {
  builtAt: string;
  contributors: Contributor[];
  coreTeam: Contributor[];
  countries: {country: string; count: number}[];
  unknownCountries: number;
  metrics: {
    commits: number;
    pastYear: number;
    lines: number;
    contributors: number;
    years: number | null;
  };
}
export type RepositoryState =
  {status: 'available'; data: RepositorySummary} | {status: 'unavailable'};

/** Minimal public commit feed; never sends author or contributor profiles to the client. */
export type CommitFeedState =
  | {status: 'unavailable'}
  | {
      status: 'available';
      data: {asOf: string; entries: {id: string; date: string; subject: string}[]};
    };

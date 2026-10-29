import {chartData} from '../../src/ecosystem/chart-data';
import type {
  RepositoryData,
  RepositorySnapshotState,
  RepositoryState,
} from '../../src/repository-activity/types';
import {aggregateCountries} from './countries';
import {activityMetrics} from '../../src/repository-activity/metrics';
import type {GitHistory} from './git';

export interface Profile {
  login: string;
  name: string | null;
  avatarUrl: string;
  location: string | null;
}
const LOGIN = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;

export async function enrichHistory(
  history: GitHistory,
  profiles: readonly (Profile | null)[],
  builtAt: string,
  avatar: (profile: Profile) => Promise<string | null>,
  coreProfiles: readonly (Profile | null)[] = [],
): Promise<RepositoryData> {
  if (profiles.length !== history.authors.length || !Number.isFinite(Date.parse(builtAt)))
    throw new Error('Incomplete repository profile data');
  const people = new Map<string, {profile: Profile; commits: number}>();
  profiles.forEach((profile, index) => {
    if (profile === null) return;
    if (
      !LOGIN.test(profile.login) ||
      typeof profile.avatarUrl !== 'string' ||
      (profile.name !== null && typeof profile.name !== 'string') ||
      (profile.location !== null && typeof profile.location !== 'string')
    )
      throw new Error('Malformed profile');
    const key = profile.login.toLowerCase();
    const current = people.get(key);
    if (current) current.commits += history.authors[index].commits;
    else people.set(key, {profile, commits: history.authors[index].commits});
  });
  const entries = [...people.values()];
  const contributors = await Promise.all(
    entries.map(async ({profile, commits}) => ({
      login: profile.login,
      name: profile.name || profile.login,
      commits,
      avatar: await avatar(profile),
    })),
  );
  contributors.sort((a, b) => b.commits - a.commits || a.login.localeCompare(b.login));
  const coreTeam = await Promise.all(
    coreProfiles
      .filter((profile): profile is Profile => profile !== null)
      .map(async (profile) => {
        if (
          !LOGIN.test(profile.login) ||
          typeof profile.avatarUrl !== 'string' ||
          (profile.name !== null && typeof profile.name !== 'string')
        )
          throw new Error('Malformed core profile');
        return (
          contributors.find(
            (person) => person.login.toLowerCase() === profile.login.toLowerCase(),
          ) ?? {
            login: profile.login,
            name: profile.name || profile.login,
            commits: 0,
            avatar: await avatar(profile),
          }
        );
      }),
  );
  return {
    version: 1,
    builtAt,
    commits: history.commits,
    contributors,
    coreTeam,
    firstCommit: history.firstCommit,
    dailyLines: history.dailyLines,
    ...aggregateCountries(entries.map(({profile}) => profile.location)),
  };
}

/** Both a missing cache and a corrupt cache must leave the build usable. */
export async function resolveActivity(
  fresh: () => Promise<RepositoryData>,
  cached: () => Promise<RepositoryData | null>,
): Promise<RepositorySnapshotState> {
  try {
    return {status: 'available', data: await fresh()};
  } catch {
    try {
      const data = await cached();
      if (data !== null) return {status: 'available', data};
    } catch {
      /* No valid cache. */
    }
    return {status: 'unavailable'};
  }
}

/** The page only needs totals; charts and commit lists can import the full build data separately. */
export function summarizeActivity(state: RepositorySnapshotState): RepositoryState {
  if (state.status === 'unavailable') return state;
  const {builtAt, contributors, coreTeam, countries, unknownCountries} = state.data;
  return {
    status: 'available',
    data: {
      builtAt,
      charts: chartData(state.data),
      contributors,
      coreTeam,
      countries,
      unknownCountries,
      metrics: activityMetrics(state.data),
    },
  };
}

import type {Profile} from './data';

/** One build-time GraphQL request. Input SHAs come from the verified local checkout. */
export async function readProfiles(
  shas: readonly string[],
  token: string,
  send: typeof fetch = fetch,
  coreLogins: readonly string[] = [],
): Promise<(Profile | null)[]> {
  if (shas.some((sha) => !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)))
    throw new Error('Invalid commit ID');
  if (coreLogins.some((login) => !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login)))
    throw new Error('Invalid core login');
  if (!token) throw new Error('Missing GitHub token');
  if (!shas.length && !coreLogins.length) return [];
  const fields = shas
    .map(
      (sha, i) =>
        `c${i}: object(expression: "${sha}") { ... on Commit { author { user { login name avatarUrl(size: 92) location } } } }`,
    )
    .join('\n');
  const coreFields = coreLogins
    .map((login, i) => `u${i}: user(login: "${login}") { login name avatarUrl(size: 92) location }`)
    .join('\n');
  const query = `query { repository(owner: "IntersectMBO", name: "cardano-db-sync") { ${fields || '__typename'} } ${coreFields} }`;
  const response = await send('https://api.github.com/graphql', {
    method: 'POST',
    headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
    body: JSON.stringify({query}),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub profile request failed (${response.status})`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !('data' in payload))
    throw new Error('Malformed GitHub response');
  const data = (payload as {data?: Record<string, unknown>}).data;
  if ('errors' in payload) {
    const errors = (payload as {errors?: unknown}).errors;
    const missingCoreOnly =
      Array.isArray(errors) &&
      errors.length > 0 &&
      errors.every((error: unknown) => {
        if (!error || typeof error !== 'object' || !('path' in error)) return false;
        const path = (error as {path: unknown}).path;
        if (!Array.isArray(path) || path.length !== 1 || typeof path[0] !== 'string') return false;
        const index = /^u(\d+)$/.exec(path[0]);
        return index !== null && Number(index[1]) < coreLogins.length && data?.[path[0]] === null;
      });
    if (!missingCoreOnly) throw new Error('GitHub returned incomplete profile data');
  }
  const repository = data?.repository;
  if (!repository || typeof repository !== 'object') throw new Error('Missing repository data');
  const parseProfile = (user: unknown): Profile | null => {
    if (user === null) return null;
    if (!user || typeof user !== 'object') throw new Error('Malformed contributor');
    const p = user as Record<string, unknown>;
    if (
      typeof p.login !== 'string' ||
      typeof p.avatarUrl !== 'string' ||
      !(typeof p.name === 'string' || p.name === null) ||
      !(typeof p.location === 'string' || p.location === null)
    )
      throw new Error('Malformed contributor profile');
    return {login: p.login, avatarUrl: p.avatarUrl, name: p.name, location: p.location};
  };
  const authors = shas.map((_, i) => {
    const commit = (repository as Record<string, unknown>)[`c${i}`] as
      {author?: {user?: unknown}} | undefined;
    if (!commit || !commit.author || !('user' in commit.author))
      throw new Error('Missing commit author');
    return parseProfile(commit.author.user);
  });
  const core = coreLogins.map((login, i) => {
    if (!data || !Object.hasOwn(data, `u${i}`)) throw new Error('Missing core profile');
    const profile = parseProfile(data[`u${i}`]);
    if (profile && profile.login.toLowerCase() !== login.toLowerCase())
      throw new Error('Mismatched core profile');
    return profile;
  });
  return [...authors, ...core];
}

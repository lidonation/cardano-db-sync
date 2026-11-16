/** Browser-free URL policy shared by generated redirects and the path-aware 404. */
export interface DocsLine {
  readonly name: string;
  /** Locale-relative route prefix, e.g. /docs or /docs/next. */
  readonly path: string;
}

export interface RetirementData {
  readonly routes: readonly string[];
  readonly lines: readonly DocsLine[];
  readonly latest: DocsLine;
  readonly tags: readonly string[];
}

export const RETIREMENT_PLUGIN = 'dbsync-route-manifest';

/** The closest ancestor of a missing route that is published, falling back to the site root. */
export function nearestLiveAncestor(route: string, live: ReadonlySet<string>): string {
  const segments = route.split('/').filter(Boolean);
  while (segments.length > 0) {
    segments.pop();
    const candidate = `/${segments.join('/')}`;
    if (live.has(candidate)) return candidate;
  }
  return '/';
}

/** Only recognize numeric release namespaces, never arbitrary first path segments. */
export function retiredVersion(
  route: string,
  lines: readonly DocsLine[],
): {
  name: string;
  page: string;
} | null {
  if (
    lines.some(
      (line) => line.path !== '/docs' && (route === line.path || route.startsWith(`${line.path}/`)),
    )
  )
    return null;
  const match = /^\/(?:docs\/)?(v?\d+(?:\.\d+)*)(?:\/(.*))?$/.exec(route);
  if (!match || lines.some((line) => line.name.replace(/^v/, '') === match[1].replace(/^v/, '')))
    return null;
  return {name: match[1], page: match[2] ?? ''};
}

/** VER-5: prefer the same page in the latest line, otherwise the original nearest live ancestor. */
export function retirementTarget(
  route: string,
  live: ReadonlySet<string>,
  data?: Pick<RetirementData, 'lines' | 'latest'>,
): string {
  const version = data && retiredVersion(route, data.lines);
  if (version && data) {
    const equivalent = `${data.latest.path}/${version.page}`.replace(/\/$/, '');
    if (live.has(equivalent)) return equivalent;
  }
  return nearestLiveAncestor(route, live);
}

/** Never guess a git tag from URL input: a tag link must come from the extracted release list. */
export function archiveUrl(
  repoUrl: string,
  version: string | undefined,
  tags: readonly string[],
): string {
  const name = version?.replace(/^v/, '');
  const tag = tags.find(
    (candidate) => candidate === version || candidate.replace(/^v/, '') === name,
  );
  return tag ? `${repoUrl}/tree/${encodeURIComponent(tag)}/doc` : `${repoUrl}/tags`;
}

/** Pages serves the root 404 even for a localized URL. Recover the requested locale prefix,
 * rather than assuming the language of that static fallback is the requested language. */
export function recoveryContext(
  pathname: string,
  baseUrl: string,
  locales: readonly string[],
): {baseUrl: string; route: string} {
  const relative = pathname.startsWith(baseUrl)
    ? pathname.slice(baseUrl.length)
    : pathname.replace(/^\/+/, '');
  const [first, ...rest] = relative.split('/');
  const localized = locales.includes(first);
  return {
    baseUrl: localized ? `${baseUrl}${first}/` : baseUrl,
    route: `/${(localized ? rest.join('/') : relative).replace(/\/+$/, '')}`,
  };
}

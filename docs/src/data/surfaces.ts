/**
 * The site's surfaces and where each lives — one list, so a page that links to a surface links to
 * the same path every other page does.
 *
 * Most surfaces are built by later items (the schema explorer, the survey, Numbers, …). A link to
 * one is rendered only once its route exists in the build (`routeExists`), so pages can carry
 * every designed link from the start and the links appear as each surface lands — never a dead
 * link, and no edit to the linking page. An item that builds a surface at a different path changes
 * it here.
 */
export const SURFACES = {
  docs: '/docs/intro',
  guides: '/docs/guides',
  schema: '/schema',
  numbers: '/numbers',
  survey: '/survey',
  ecosystem: '/ecosystem',
  config: '/config',
  faq: '/faq',
  updates: '/updates',
} as const;

export type Surface = keyof typeof SURFACES;

/** A route as Docusaurus' route table holds it: a path, and child routes under layouts. */
export interface RouteNode {
  readonly path?: string | readonly string[];
  readonly routes?: readonly RouteNode[];
}

const trim = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/** Every concrete path in a route tree. */
export function routePaths(routes: readonly RouteNode[]): Set<string> {
  const paths = new Set<string>();
  const visit = (nodes: readonly RouteNode[]) => {
    for (const node of nodes) {
      for (const path of typeof node.path === 'string' ? [node.path] : (node.path ?? [])) {
        paths.add(trim(path));
      }
      if (node.routes) visit(node.routes);
    }
  };
  visit(routes);
  return paths;
}

/**
 * Whether `path` (site-relative, as `<Link to>` takes it) is served: the route itself, or a
 * section index under it. `baseUrl` is the site's base, which the route table includes.
 */
export function routeExists(paths: ReadonlySet<string>, baseUrl: string, path: string): boolean {
  const full = trim(`${baseUrl.replace(/\/+$/, '')}${path}`);
  return paths.has(full);
}

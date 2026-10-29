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
  installation: '/docs/guides/installation',
  schema: '/schema',
  numbers: '/numbers',
  survey: '/survey',
  surveyResults: '/survey/results',
  ecosystem: '/ecosystem',
  roadmap: '/ecosystem#roadmap',
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
  const full = trim(`${baseUrl.replace(/\/+$/, '')}${path.split('#')[0]}`);
  return paths.has(full);
}

/** Ordered designed navigation. Labels pass through Docusaurus' config translation pipeline. */
export const NAVBAR_MENU = [
  {label: 'Docs', href: SURFACES.docs},
  {label: 'Guides', href: SURFACES.guides},
  {label: 'Schema', href: SURFACES.schema},
  {label: 'Numbers', href: SURFACES.numbers},
  {label: 'Survey', href: SURFACES.survey},
  {label: 'Ecosystem', href: SURFACES.ecosystem},
] as const;

/** External destinations are completed from the active build profile in the config. */
export const FOOTER_MENU: readonly {
  readonly title: string;
  readonly items: readonly {readonly label: string; readonly href: string}[];
}[] = [
  {
    title: 'Docs',
    items: [
      {label: 'Introduction', href: SURFACES.docs},
      {label: 'Guides', href: SURFACES.guides},
      {label: 'Installation', href: SURFACES.installation},
      {label: 'Configuration', href: SURFACES.config},
      {label: 'Schema', href: SURFACES.schema},
    ],
  },
  {
    title: 'Project',
    items: [
      {label: 'GitHub', href: 'repository'},
      {label: 'Releases', href: 'repository/releases'},
      {label: 'Issues', href: 'repository/issues'},
      {label: 'Updates', href: SURFACES.updates},
      {label: 'Roadmap', href: SURFACES.roadmap},
    ],
  },
  {
    title: 'Community',
    items: [
      {label: 'Discord', href: 'https://discord.com/invite/inter-sect'},
      {label: 'Survey', href: SURFACES.survey},
      {label: 'Survey results', href: SURFACES.surveyResults},
      {label: 'Ecosystem', href: SURFACES.ecosystem},
      {label: 'FAQ', href: SURFACES.faq},
    ],
  },
] as const;

/** Local destinations need a built route; external links do not depend on this build. */
export function gateMenu<T extends {readonly href: string}>(
  items: readonly T[],
  paths: ReadonlySet<string>,
  baseUrl: string,
): T[] {
  return items.filter(
    (item) => !item.href.startsWith('/') || routeExists(paths, baseUrl, item.href),
  );
}

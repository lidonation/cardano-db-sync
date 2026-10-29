/**
 * NAV-1 — the navbar's sections and their active state, derived from the navbar config and the
 * current route, never from a hand-written list of slugs: adding a doc to a sidebar makes its
 * section active with no code change.
 *
 * Pure, so the derivation is unit-tested without a Docusaurus build.
 */

/** The navbar item shapes this site uses (a subset of Docusaurus' `NavbarItem`). */
export interface NavbarItemConfig {
  readonly type?: string;
  readonly label?: string;
  readonly sidebarId?: string;
  readonly docId?: string;
  readonly to?: string;
  readonly href?: string;
  readonly activeBasePath?: string;
}

/** What the derivation needs to know about the docs plugin's current state. */
export interface DocsState {
  /** Link path of each sidebar in the active version, by sidebar id. */
  readonly sidebarLinks: Readonly<Record<string, string | undefined>>;
  /** Path of each doc in the active version, by doc id. */
  readonly docPaths: Readonly<Record<string, string | undefined>>;
  /** The sidebar destination label supplied by the docs plugin. */
  readonly sidebarLabels?: Readonly<Record<string, string | undefined>>;
  /** The sidebar the current page belongs to, if it is a doc. */
  readonly activeSidebar?: string;
  /** The current page's doc id, if it is a doc. */
  readonly activeDocId?: string;
}

/** Resolve each item across active, preferred, then latest versions, as the stock navbar does. */
export function resolveDocsState(
  versions: readonly {
    readonly sidebars?: Readonly<
      Record<string, {readonly link?: {readonly path: string; readonly label?: string}}>
    >;
    readonly docs: readonly {readonly id: string; readonly path: string}[];
  }[],
  activeDoc?: {readonly id: string; readonly sidebar?: string},
): DocsState {
  const sidebarLinks: Record<string, string | undefined> = {};
  const docPaths: Record<string, string | undefined> = {};
  const sidebarLabels: Record<string, string | undefined> = {};
  for (const version of versions) {
    for (const [id, sidebar] of Object.entries(version.sidebars ?? {})) {
      sidebarLinks[id] ??= sidebar.link?.path;
      if (sidebar.link?.label) sidebarLabels[id] ??= sidebar.link.label;
    }
    for (const doc of version.docs) docPaths[doc.id] ??= doc.path;
  }
  return {
    sidebarLinks,
    sidebarLabels,
    docPaths,
    activeSidebar: activeDoc?.sidebar,
    activeDocId: activeDoc?.id,
  };
}

export interface DerivedNav {
  readonly links: readonly {
    readonly label: string;
    readonly href: string;
    readonly active: boolean;
  }[];
  /** The repository link, shown as the GitHub control. */
  readonly github?: string;
  /** Items on the bar down to 768px, in the drawer below (DF-7): the version selector. */
  readonly actions: readonly NavbarItemConfig[];
  /** Items on the bar from 1280px, in the drawer below (DF-7): the locale selector. */
  readonly preferences: readonly NavbarItemConfig[];
}

const withSlash = (path: string): string => (path.endsWith('/') ? path : `${path}/`);

/** Whether `pathname` is `base` or below it. */
export function isUnder(pathname: string, base: string): boolean {
  return pathname === base || withSlash(pathname).startsWith(withSlash(base));
}

/**
 * Sections from the navbar config. `baseUrl` prefixes site-relative `to` paths, as `<Link>` does.
 */
export function deriveNav(
  items: readonly NavbarItemConfig[],
  pathname: string,
  baseUrl: string,
  docs: DocsState,
): DerivedNav {
  const links: {label: string; href: string; active: boolean}[] = [];
  const actions: NavbarItemConfig[] = [];
  const preferences: NavbarItemConfig[] = [];
  let github: string | undefined;
  for (const item of items) {
    switch (item.type) {
      case 'docSidebar': {
        const href = item.sidebarId ? docs.sidebarLinks[item.sidebarId] : undefined;
        if (href) {
          links.push({
            label: item.label || docs.sidebarLabels?.[item.sidebarId!] || item.sidebarId!,
            href,
            active: docs.activeSidebar !== undefined && docs.activeSidebar === item.sidebarId,
          });
        }
        break;
      }
      case 'doc': {
        const href = item.docId ? docs.docPaths[item.docId] : undefined;
        if (href) {
          links.push({
            label: item.label || item.docId!,
            href,
            active: docs.activeDocId === item.docId,
          });
        }
        break;
      }
      case 'docsVersionDropdown':
        actions.push(item);
        break;
      case 'localeDropdown':
        preferences.push(item);
        break;
      default:
        if (item.href) {
          github = github ?? item.href;
        } else if (item.to) {
          const path = (value: string) =>
            value.startsWith(baseUrl) ? value : `${baseUrl}${value.replace(/^\//, '')}`;
          const href = path(item.to);
          const base = path(item.activeBasePath ?? item.to).split(/[?#]/)[0]!;
          links.push({label: item.label || item.to, href, active: isUnder(pathname, base)});
        }
    }
  }
  return {links, github, actions, preferences};
}

/** Hide the version control when no choice exists. */
export function showVersionSelector(versions: readonly unknown[]): boolean {
  return versions.length > 1;
}

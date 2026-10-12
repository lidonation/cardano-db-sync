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
  /** The sidebar the current page belongs to, if it is a doc. */
  readonly activeSidebar?: string;
  /** The current page's doc id, if it is a doc. */
  readonly activeDocId?: string;
}

export interface DerivedNav {
  readonly links: readonly {
    readonly label: string;
    readonly href: string;
    readonly active: boolean;
  }[];
  /** The repository link, shown as the GitHub control. */
  readonly github?: string;
  /** Items handed to the stock renderer: the locale dropdown until B30 replaces it. */
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
  const preferences: NavbarItemConfig[] = [];
  let github: string | undefined;
  for (const item of items) {
    switch (item.type) {
      case 'docSidebar': {
        const href = item.sidebarId ? docs.sidebarLinks[item.sidebarId] : undefined;
        if (href) {
          links.push({
            label: item.label ?? '',
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
            label: item.label ?? '',
            href,
            active: docs.activeDocId === item.docId,
          });
        }
        break;
      }
      case 'localeDropdown':
      case 'docsVersionDropdown':
        preferences.push(item);
        break;
      default:
        if (item.href) {
          github = github ?? item.href;
        } else if (item.to) {
          const site = baseUrl.replace(/\/$/, '');
          const base = `${site}/${(item.activeBasePath ?? item.to).replace(/^\//, '')}`;
          links.push({label: item.label ?? '', href: item.to, active: isUnder(pathname, base)});
        }
    }
  }
  return {links, github, preferences};
}

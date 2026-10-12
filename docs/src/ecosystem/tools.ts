/**
 * The ecosystem page's tools (B44-b): downstream consumers and community tooling built on
 * db-sync, grounded in `doc/community-tools.md`'s territory and restructured as an app page
 * rather than a doc copy. Copy is rewritten for the page; the doc stays canonical for the
 * migration (B13–B17).
 *
 * Every entry carries the two links a db-sync operator needs: the tool itself and the SQL it
 * runs against the schema. Pure data, so the unit suite holds every link well-formed without
 * fetching anyone else's site (check:links covers internal links; external origins are never
 * fetched by a gate).
 */

export interface EcosystemTool {
  /** Short name, unique across the page. */
  readonly name: string;
  /** Who builds it, shown under the name. */
  readonly org: string;
  /** What it does with db-sync data, one or two sentences. */
  readonly description: string;
  /** The tool's home page; the card links here. */
  readonly website: string;
  /** Where its source lives. */
  readonly repository: string;
  /** The SQL it runs against the db-sync schema, for operators to read. */
  readonly queries: string;
  /** Label for the queries link, naming what it points at (CONTENT-5). */
  readonly queriesLabel: string;
}

export const ECOSYSTEM_TOOLS: readonly EcosystemTool[] = [
  {
    name: 'Koios',
    org: 'Cardano community',
    description:
      'A lightweight, open-source REST API over the Cardano chain. Its query layer is a library of SQL against the db-sync schema, free to read and reuse.',
    website: 'https://koios.rest/',
    repository: 'https://github.com/cardano-community/koios-artifacts',
    queries: 'https://github.com/cardano-community/koios-artifacts/tree/main/files/grest/rpc',
    queriesLabel: 'Koios SQL queries',
  },
  {
    name: 'Blockfrost',
    org: 'Blockfrost',
    description:
      'Managed Cardano APIs for developers who would rather not run their own nodes. Its backend reads the chain through db-sync and publishes the SQL it runs.',
    website: 'https://blockfrost.io/',
    repository: 'https://github.com/blockfrost/blockfrost-backend-ryo',
    queries: 'https://github.com/blockfrost/blockfrost-backend-ryo/tree/master/src/sql',
    queriesLabel: 'Blockfrost SQL queries',
  },
  {
    name: 'GovTool',
    org: 'Intersect',
    description:
      'The governance platform where ada holders create and vote on proposals. Its backend stores governance actions with SQL written against the db-sync schema.',
    website: 'https://gov.tools/',
    repository: 'https://github.com/IntersectMBO/govtool',
    queries: 'https://github.com/IntersectMBO/govtool/tree/develop/govtool/backend/sql',
    queriesLabel: 'GovTool SQL queries',
  },
];

/** The list view or its named empty state (B44 DoD): a page that says nothing when there is no data yet is a broken state, not a blank one. */
export type ToolsView =
  {readonly kind: 'list'; readonly tools: readonly EcosystemTool[]} | {readonly kind: 'empty'};

export function toolsView(tools: readonly EcosystemTool[]): ToolsView {
  return tools.length > 0 ? {kind: 'list', tools} : {kind: 'empty'};
}

/** Hosts a tool link is expected on; anything else fails the data test, not the network. */
const KNOWN_HOSTS = [
  'koios.rest',
  'blockfrost.io',
  'gov.tools',
  'github.com',
  'discord.com',
] as const;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Why a tool entry cannot ship, or null when it is well-formed. */
export function toolProblem(tool: EcosystemTool): string | null {
  if (!tool.name.trim() || !tool.org.trim() || !tool.description.trim()) {
    return 'name, org and description must be non-empty';
  }
  for (const [key, url] of [
    ['website', tool.website],
    ['repository', tool.repository],
    ['queries', tool.queries],
  ] as const) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return `${key} is not a URL: ${url}`;
    }
    if (parsed.protocol !== 'https:') {
      return `${key} must be https: ${url}`;
    }
    const host = hostOf(url);
    if (host === null || !KNOWN_HOSTS.some((known) => host === known)) {
      return `${key} is on an unknown host: ${url}`;
    }
  }
  if (!tool.queriesLabel.trim()) {
    return 'queriesLabel must name the link (CONTENT-5)';
  }
  return null;
}

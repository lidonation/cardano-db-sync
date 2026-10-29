import {DISCORD_URL, REPO_URL} from '../data/links';
import type {PageMessage} from '../i18n/pageTranslator';

/**
 * The Ecosystem page's tools and teams (B44-b). Each entry is public and was checked against its
 * source: the repository's `doc/community-tools.md`, the project's own README or docs, or a db-sync
 * issue its team opened. The design's drafts also listed cf-explorer (archived, and built on
 * LedgerSync), cardano-rosetta (archived; its successor reads Yaci Store) and two teams with no
 * public evidence; they are left out rather than shown on an unchecked claim.
 *
 * Every URL here is fetched by `scripts/check-external-links.mjs`, on pull requests that change
 * this file and weekly.
 */

/** Built on db-sync's database, or an alternative indexer for narrower needs. */
export type ToolKind = 'built-on' | 'alternative';

export interface Tool {
  readonly name: string;
  readonly org: string;
  readonly kind: ToolKind;
  readonly url: string;
  readonly website?: string;
  readonly sql?: string;
  readonly description: string;
}

export interface Team {
  readonly name: string;
  readonly evidence: string;
  readonly url: string;
}

type Translate = (message: PageMessage) => string;

/** Named, recoverable empty state for the tool grid. */
export function toolsView(items: readonly Tool[], translate: Translate) {
  return items.length
    ? {kind: 'list' as const}
    : {
        kind: 'empty' as const,
        message: translate({
          id: 'ecosystem.tools.empty',
          message: 'No ecosystem tools are listed yet.',
        }),
        action: translate({
          id: 'ecosystem.tools.empty.action',
          message: 'Tell us about a tool on Discord',
        }),
        href: DISCORD_URL,
      };
}

export function tools(translate: Translate): readonly Tool[] {
  return [
    {
      name: 'cardano-smash-server',
      org: translate({
        id: 'ecosystem.tool.smash.org',
        message: 'IntersectMBO · ships in this repo',
      }),
      kind: 'built-on',
      url: `${REPO_URL}/tree/master/cardano-smash-server`,
      description: translate({
        id: 'ecosystem.tool.smash',
        message: 'Stake pool metadata server (SMASH), reading the database db-sync writes.',
      }),
    },
    {
      name: 'cardano-graphql',
      org: 'Cardano Foundation',
      kind: 'built-on',
      url: 'https://github.com/cardano-foundation/cardano-graphql',
      description: translate({
        id: 'ecosystem.tool.graphql',
        message: 'GraphQL API served from the db-sync schema.',
      }),
    },
    {
      name: 'Koios',
      org: 'cardano-community',
      kind: 'built-on',
      url: 'https://github.com/cardano-community/koios-artifacts',
      website: 'https://koios.rest/',
      sql: 'https://github.com/cardano-community/koios-artifacts/tree/main/files/grest/rpc',
      description: translate({
        id: 'ecosystem.tool.koios',
        message: 'Decentralised, community-run REST API whose queries run against db-sync.',
      }),
    },
    {
      name: 'blockfrost-backend-ryo',
      org: 'Blockfrost',
      kind: 'built-on',
      url: 'https://github.com/blockfrost/blockfrost-backend-ryo',
      website: 'https://blockfrost.io/',
      sql: 'https://github.com/blockfrost/blockfrost-backend-ryo/tree/master/src/sql',
      description: translate({
        id: 'ecosystem.tool.blockfrost',
        message: 'Run-your-own Blockfrost API, queried from a db-sync database.',
      }),
    },
    {
      name: 'GovTool',
      org: 'IntersectMBO',
      kind: 'built-on',
      url: 'https://github.com/IntersectMBO/govtool',
      website: 'https://gov.tools/',
      sql: 'https://github.com/IntersectMBO/govtool/blob/main/govtool/govtool-provider-dbsync/src/governance/dreps/sql.ts',
      description: translate({
        id: 'ecosystem.tool.govtool',
        message: 'On-chain governance platform; its backend can read chain data from db-sync.',
      }),
    },
    {
      name: 'pg_cardano',
      org: 'Fell-x27',
      kind: 'built-on',
      url: 'https://github.com/Fell-x27/pg_cardano',
      description: translate({
        id: 'ecosystem.tool.pgcardano',
        message:
          'PostgreSQL extension with bech32, CBOR and crypto helpers for db-sync’s binary columns.',
      }),
    },
    {
      name: 'carp',
      org: 'dcSpark',
      kind: 'alternative',
      url: 'https://github.com/dcSpark/carp',
      description: translate({
        id: 'ecosystem.tool.carp',
        message: 'Modular indexer with a PostgreSQL backend, built as an alternative to db-sync.',
      }),
    },
    {
      name: 'kupo',
      org: 'CardanoSolutions',
      kind: 'alternative',
      url: 'https://github.com/CardanoSolutions/kupo',
      description: translate({
        id: 'ecosystem.tool.kupo',
        message: 'Lightweight, configurable chain index for narrower use cases.',
      }),
    },
  ];
}

export function teams(translate: Translate): readonly Team[] {
  return [
    {
      name: 'Blockfrost',
      evidence: translate({id: 'ecosystem.team.blockfrost', message: 'RYO backend · issue #1686'}),
      url: `${REPO_URL}/issues/1686`,
    },
    {
      name: 'Koios',
      evidence: translate({id: 'ecosystem.team.koios', message: 'listed in community tools'}),
      url: `${REPO_URL}/blob/master/doc/community-tools.md`,
    },
    {
      name: 'Intersect',
      evidence: translate({id: 'ecosystem.team.intersect', message: 'GovTool backend'}),
      url: 'https://github.com/IntersectMBO/govtool',
    },
    {
      name: 'Cardano Foundation',
      evidence: translate({id: 'ecosystem.team.cf', message: 'maintains cardano-graphql'}),
      url: 'https://github.com/cardano-foundation/cardano-graphql',
    },
    {
      name: 'Midnight',
      evidence: translate({id: 'ecosystem.team.midnight', message: 'node setup requires db-sync'}),
      url: 'https://docs.midnight.network/nodes/cardano-db-sync',
    },
  ];
}

/** Curated core-team logins; membership and optional roles are editorial, counts are measured. */
export const CORE_TEAM = [
  {login: 'erikd'},
  {login: 'kderme'},
  {login: 'sgillespie'},
  {login: 'Cmdv'},
  {login: 'ArturWieczorek'},
  {login: 'profd2004', role: 'Community Maintainer'},
] as const;

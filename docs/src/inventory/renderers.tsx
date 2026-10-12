import React, {type ReactNode} from 'react';

import Avatar from '../components/Avatar';
import Button, {type ButtonVariant} from '../components/Button';
import {
  ChoiceCard,
  DataOptionCard,
  OptionCard,
  QueryCard,
  SampleQueryCard,
  StatCard,
  TeamCard,
  ToolCard,
  UseCaseCard,
} from '../components/Card';
import CodeCopy from '../components/CodeCopy';
import Footer from '../components/Footer';
import KeyCap from '../components/KeyCap';
import Metric from '../components/Metric';
import {NavbarFull, NavbarMinimal} from '../components/Navbar';
import Pagination from '../components/Pagination';
import SearchResult, {
  SearchResultsEmpty,
  SearchResultsError,
  SearchResultsLoading,
} from '../components/SearchResult';
import {SectionCross, SectionDivider} from '../components/Section';
import Tabs from '../components/Tabs';
import Tag from '../components/Tag';
import ThemeSwitcher from '../components/ThemeSwitcher';
import type {InteractionState, State} from '../components/shared/states';

/**
 * How the inventory draws each definition in each state. Sample content is the design's own (the
 * Penpot mains and the B47 state boards), so what is audited is what will ship.
 */
type Render = (state: State, key: string) => ReactNode;

const pinned = (state: State): InteractionState | undefined =>
  state === 'hover' || state === 'pressed' || state === 'focus' ? state : undefined;

const NAV = [
  {label: 'Docs', href: '/docs/'},
  {label: 'Schema', href: '/docs/schema'},
  {label: 'Numbers', href: '/numbers'},
  {label: 'Survey', href: '/survey'},
  {label: 'Ecosystem', href: '/ecosystem'},
];

/** A one-colour hexagon portrait, inline so the inventory needs no network. */
const PORTRAIT =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 92 106"><circle cx="46" cy="40" r="18"/><path d="M14 106c4-26 18-38 32-38s28 12 32 38z"/></svg>',
  );

const button =
  (variant: ButtonVariant, label: string): Render =>
  (state) => (
    <Button
      variant={variant}
      demo={pinned(state)}
      disabled={state === 'disabled'}
      loading={state === 'loading'}
      error={
        state === 'error' ? 'Couldn’t save. Check your connection, then try again.' : undefined
      }
    >
      {label}
    </Button>
  );

/** The data states every data-holding card shares. */
const data = (state: State) => ({
  status:
    state === 'loading'
      ? ('loading' as const)
      : state === 'error'
        ? ('error' as const)
        : state === 'empty'
          ? ('empty' as const)
          : ('ready' as const),
  errorMessage: 'This list couldn’t load. Check your connection, then retry.',
  onRetry: () => undefined,
  emptyMessage: 'Nothing here yet. Entries appear once they are published.',
  demo: pinned(state),
});

const select = (state: State, key: string, message = 'Choose at least one to continue.') => ({
  ...data(state),
  name: key,
  value: key,
  defaultChecked: state === 'selected',
  disabled: state === 'disabled',
  error: state === 'error' ? message : undefined,
  status: data(state).status === 'error' ? ('ready' as const) : data(state).status,
});

const TABS = (state: State) => {
  const panel = (text: string) => ({
    content: <p>{text}</p>,
    status:
      state === 'loading'
        ? ('loading' as const)
        : state === 'error'
          ? ('error' as const)
          : ('ready' as const),
    errorMessage: 'These updates couldn’t load. Check your connection, then retry.',
    onRetry: () => undefined,
  });
  return [
    {id: 'week', label: 'Week', ...panel('3 merged pull requests this week.')},
    {id: 'month', label: 'Month', ...panel('14 merged pull requests this month.')},
    {id: 'total', label: 'Total', ...panel('3,171 commits since 2020.')},
    {id: 'custom', label: 'Custom', disabled: state === 'disabled', ...panel('Pick a range.')},
  ];
};

export const RENDER: Readonly<Record<string, Render>> = {
  'Navbar / Full': (state) => (
    <NavbarFull
      homeHref="/"
      links={NAV.map((link) => ({
        ...link,
        active: state === 'selected' && link.label === 'Schema',
      }))}
      githubHref="https://github.com/IntersectMBO/cardano-db-sync"
      onSearch={() => undefined}
      defaultMenuOpen={state === 'selected'}
      demo={pinned(state) && {href: '/docs/schema', state: pinned(state) as InteractionState}}
      actions={<ThemeSwitcher />}
    />
  ),
  'Navbar / Minimal': (state) => (
    <NavbarMinimal
      homeHref="/"
      exit={{label: 'Save & exit', href: '/survey'}}
      demo={pinned(state)}
    />
  ),
  'Button / Primary': button('primary', 'Get started'),
  'Button / Secondary': button('secondary', 'Secondary'),
  'Button / Ghost': button('ghost', 'View schema'),
  'Button / Danger': button('danger', 'Delete'),
  'Button / Disabled': (state) => (
    <Button disabled demo={pinned(state)}>
      Disabled
    </Button>
  ),
  'Card / Tool': (state) => (
    <ToolCard
      name="cardano-graphql"
      org="Cardano Foundation · GraphQL layer"
      description="A GraphQL API over the db-sync schema."
      href="https://github.com/cardano-foundation/cardano-graphql"
      {...data(state)}
    />
  ),
  'Card / Team': (state) => (
    <TeamCard
      name="Blockfrost"
      evidence="issue #1686"
      href="https://blockfrost.io"
      {...data(state)}
    />
  ),
  'Card / Use case': (state) => (
    <UseCaseCard
      title="Block explorers"
      description="Full history, every table, joined in SQL."
      href="/docs/"
      {...data(state)}
    />
  ),
  'Card / Query': (state) => (
    <QueryCard
      question="What is the latest block?"
      sql={'SELECT block_no, time\nFROM block\nORDER BY id DESC LIMIT 1;'}
      linkLabel="Run against the schema docs"
      href="/docs/schema"
      {...data(state)}
      copyable
    />
  ),
  'Card / Sample query': (state) => (
    <SampleQueryCard
      returns="Unspent outputs for an address"
      sql="SELECT * FROM tx_out WHERE consumed_by_tx_id IS NULL;"
      {...data(state)}
    />
  ),
  'Card / Stat': (state) => (
    <StatCard
      label="Sync progress"
      value="100.00%"
      fraction={1}
      detail="tip 12,801,442 · epoch 639"
      {...data(state)}
    />
  ),
  'Card / Choice': (state, key) => (
    <ChoiceCard
      label="Wallet / UTxO"
      description="Balances and unspent outputs"
      {...select(state, key)}
    />
  ),
  'Card / Option': (state, key) => (
    <OptionCard
      label="Operator"
      description="I run db-sync"
      {...select(state, key, 'Choose one to continue.')}
    />
  ),
  'Card / Data option': (state, key) => (
    <DataOptionCard
      label="Multi-assets"
      configKey="multi_asset"
      tables="ma_tx_out · ma_tx_mint"
      {...select(state, key)}
    />
  ),
  'Chip / Filter': (state) => (
    <Tabs
      label="Updates period"
      items={state === 'empty' ? [] : TABS(state)}
      defaultSelected={state === 'selected' ? 'month' : 'week'}
      demo={pinned(state) && {tab: 'total', state: pinned(state) as InteractionState}}
    />
  ),
  'Chip / Tag': () => (
    <span className="inventory-row">
      <Tag>12 columns</Tag>
      <Tag>indexed</Tag>
    </span>
  ),
  'Section / Divider': () => <SectionDivider />,
  'Section / Cross': () => <SectionCross />,
  'Key / Cap': () => (
    <span className="inventory-row">
      <KeyCap>esc</KeyCap>
      <KeyCap>⌘K</KeyCap>
      <KeyCap enter />
    </span>
  ),
  'Search / Result': (state, key) =>
    state === 'loading' ? (
      <SearchResultsLoading />
    ) : state === 'error' ? (
      <SearchResultsError onRetry={() => undefined} />
    ) : state === 'empty' ? (
      <SearchResultsEmpty query="txo" />
    ) : (
      <ul role="listbox" aria-label="Search results" className="inventory-list">
        <SearchResult
          id={`${key}-option`}
          title="tx_out"
          meta="table · core"
          selected={state === 'selected'}
          disabled={state === 'disabled'}
          demo={pinned(state)}
        />
      </ul>
    ),
  'Pagination / Prev-Next': (state) => (
    <Pagination
      previous={state === 'empty' ? undefined : {href: '/docs/install', title: 'Installation'}}
      next={{href: '/docs/config', title: 'Configuration'}}
      demo={pinned(state) && {side: 'next', state: pinned(state) as InteractionState}}
    />
  ),
  'Code / Copy': (state) => (
    <CodeCopy
      text="docker compose up -d"
      disabled={state === 'disabled'}
      demo={pinned(state)}
      state={
        state === 'selected'
          ? 'copied'
          : state === 'loading'
            ? 'copying'
            : state === 'error'
              ? 'failed'
              : undefined
      }
    />
  ),
  'Avatar / Hexagon': (state) => (
    <Avatar
      name="Kostas Dermentzis"
      href="https://github.com/kderme"
      src={
        state === 'empty' ? undefined : state === 'error' ? '/__inventory-missing.png' : PORTRAIT
      }
      loading={state === 'loading'}
      demo={pinned(state)}
    />
  ),
  'Footer / Navy': (state) => (
    <Footer
      meta="Apache-2.0 · IntersectMBO · v13.7.x"
      columns={[
        {
          heading: 'Docs',
          links: [
            {label: 'Installation', href: '/docs/install'},
            {label: 'Schema', href: '/docs/schema'},
          ],
        },
        {heading: 'Project', links: [{label: 'Roadmap', href: '/roadmap'}]},
        {heading: 'Community', links: [{label: 'Survey', href: '/survey'}]},
      ]}
      note="Built by 69 people across 20+ countries."
      demo={pinned(state) && {href: '/docs/schema', state: pinned(state) as InteractionState}}
    />
  ),
  'Metric / Dark': (state) => (
    <Metric
      value="12,801,442"
      label="block height"
      status={data(state).status}
      errorMessage="The live figures couldn’t load. Retry, or check back next epoch."
      onRetry={() => undefined}
      emptyMessage="No figures yet: the first refresh lands with the next epoch."
    />
  ),
};

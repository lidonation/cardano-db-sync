import React, {type ReactNode} from 'react';

import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import Button from '../components/Button';
import {QueryCard, UseCaseCard} from '../components/Card';
import CodeCopy from '../components/CodeCopy';
import Metric from '../components/Metric';
import Icon from '../components/shared/Icon';
import {DISCORD_URL, REPO_URL} from '../data/links';
import type {ReleaseFacts} from '../data/release-facts';
import {QUICKSTART_COMMANDS} from '../data/quickstart';
import {SAMPLE_QUERIES} from '../data/sample-queries';
import {SURFACES} from '../data/surfaces';

import {faqItems} from './faq';
import HeroGraphic from './HeroGraphic';
import Eyebrow from './Eyebrow';
import useSurface from './useSurface';
import useLandingTranslate from './useLandingTranslate';
import styles from './styles.module.css';

const DOCKER = 'docker compose up -d && docker compose logs -f';

/** A text link with a trailing arrow, rendered only when it has somewhere to go. */
function MoreLink({href, children}: {readonly href?: string; readonly children: ReactNode}) {
  if (!href) return null;
  return (
    <Link className={styles.more} to={href}>
      {children}
      <Icon name="arrow-right" size={12} className={styles.directional} />
    </Link>
  );
}

function Hero(): React.JSX.Element {
  const translate = useLandingTranslate();
  return (
    <section className={styles.hero} aria-labelledby="landing-title">
      <div className={styles.heroText}>
        <Eyebrow>
          {translate({
            id: 'landing.hero.eyebrow',
            message: 'open source · apache-2.0 · by intersect',
            description: 'Landing hero eyebrow',
          })}
        </Eyebrow>
        <h1 id="landing-title" className={styles.title}>
          <span className={styles.titleLine}>
            {translate({id: 'landing.hero.title1', message: 'Follow the chain.'})}
          </span>{' '}
          <span className={styles.titleAccent}>
            {translate({id: 'landing.hero.title2', message: 'Query it in SQL.'})}
          </span>
        </h1>
        <p className={styles.lead}>
          {translate({
            id: 'landing.hero.lead',
            message:
              'Cardano DB Sync mirrors every block, transaction and ledger event on the Cardano chain into a normalized PostgreSQL schema. It is the data backbone behind explorers, wallets and analytics across the ecosystem.',
          })}
        </p>
        <div className={styles.actions}>
          <Button variant="primary" size="md" href={SURFACES.docs}>
            {translate({id: 'landing.cta.docs', message: 'Read the docs'})}
          </Button>
          <Button variant="secondary" size="md" href={REPO_URL}>
            {translate({id: 'landing.cta.github', message: 'View on GitHub'})}
          </Button>
        </div>
        <div className={styles.command}>
          <pre className={styles.commandText}>
            <code>
              <span aria-hidden="true" className={styles.prompt}>
                ${' '}
              </span>
              {DOCKER}
            </code>
          </pre>
          <CodeCopy text={DOCKER} />
        </div>
      </div>
      <HeroGraphic />
    </section>
  );
}

function Facts(): React.JSX.Element {
  const translate = useLandingTranslate();
  const facts = useDocusaurusContext().siteConfig.customFields?.releaseFacts as ReleaseFacts;
  const surface = useSurface();
  const items = [
    {
      value: facts.tables.toLocaleString('en'),
      label: translate({id: 'landing.facts.tables', message: 'tables in the default schema'}),
    },
    {
      value: facts.columns.toLocaleString('en'),
      label: translate({id: 'landing.facts.columns', message: 'columns across those tables'}),
    },
    {
      value: facts.migration,
      label: translate({id: 'landing.facts.migration', message: 'latest schema migration'}),
    },
    {
      value: facts.renamed.toLocaleString('en'),
      label: translate({id: 'landing.facts.renamed', message: 'renames traced to former names'}),
    },
  ];
  return (
    <section className={styles.dark} aria-labelledby="landing-facts">
      <div className={styles.inner}>
        <div className={styles.headRow}>
          <h2 id="landing-facts" className={styles.eyebrow}>
            <span aria-hidden="true">//{' '}</span>
            {translate({
              id: 'landing.facts.eyebrow',
              message: 'in this build',
              description: 'Heading of the strip of facts counted from the documented schema',
            })}
          </h2>
          <MoreLink href={surface('numbers')}>
            {translate({id: 'landing.facts.numbers', message: 'View the numbers'})}
          </MoreLink>
        </div>
        <ul className={styles.facts}>
          {items.map((item) => (
            <li key={item.label}>
              <Metric value={item.value} label={item.label} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Pipeline(): React.JSX.Element {
  const translate = useLandingTranslate();
  const steps = [
    {
      name: 'cardano-node',
      body: translate({id: 'landing.how.node', message: 'your local node, following the network'}),
    },
    {
      name: 'cardano-db-sync',
      body: translate({
        id: 'landing.how.dbsync',
        message: 'reads blocks and ledger events via the socket',
      }),
    },
    {
      name: 'PostgreSQL',
      body: translate({id: 'landing.how.postgres', message: 'normalized, indexed, SQL-queryable'}),
    },
    {
      name: translate({id: 'landing.how.app.name', message: 'your application'}),
      body: translate({id: 'landing.how.app', message: 'explorers · wallets · analytics · dApps'}),
    },
  ];
  return (
    <section className={styles.section} aria-labelledby="landing-how">
      <div className={styles.inner}>
        <Eyebrow>{translate({id: 'landing.how.eyebrow', message: 'how it works'})}</Eyebrow>
        <h2 id="landing-how" className={styles.heading}>
          {translate({id: 'landing.how.title', message: 'How it works'})}
        </h2>
        <p className={styles.intro}>
          {translate({
            id: 'landing.how.intro',
            message:
              'One process follows your local node and keeps a relational mirror of the chain.',
          })}
        </p>
        <ol className={styles.pipeline}>
          {steps.map((step, index) => (
            <li key={step.name} className={styles.stage}>
              <span className={styles.stageName}>{step.name}</span>
              <span className={styles.stageBody}>{step.body}</span>
              {index < steps.length - 1 && (
                <Icon name="arrow-right" size={16} className={styles.stageArrow} />
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function UseCases(): React.JSX.Element {
  const translate = useLandingTranslate();
  const surface = useSurface();
  const cases = [
    [
      translate({id: 'landing.use.explorers', message: 'Block explorers'}),
      translate({
        id: 'landing.use.explorers.body',
        message: 'Serve blocks, transactions and addresses straight from indexed tables.',
      }),
    ],
    [
      translate({id: 'landing.use.wallets', message: 'Wallet backends'}),
      translate({
        id: 'landing.use.wallets.body',
        message: 'Track UTxOs, balances and transaction history for any set of addresses.',
      }),
    ],
    [
      translate({id: 'landing.use.analytics', message: 'Analytics and BI'}),
      translate({
        id: 'landing.use.analytics.body',
        message: 'Point Grafana, Metabase or a notebook at real chain data.',
      }),
    ],
    [
      translate({id: 'landing.use.dapps', message: 'DeFi and dApps'}),
      translate({
        id: 'landing.use.dapps.body',
        message: 'Index scripts, datums and redeemers for protocol state.',
      }),
    ],
    [
      translate({id: 'landing.use.staking', message: 'Staking and pools'}),
      translate({
        id: 'landing.use.staking.body',
        message: 'Pools, delegations and rewards, every epoch, every lovelace.',
      }),
    ],
    [
      translate({id: 'landing.use.governance', message: 'Governance data'}),
      translate({
        id: 'landing.use.governance.body',
        message: 'DReps, votes and proposals from the Conway era onward.',
      }),
    ],
  ];
  return (
    <section className={styles.section} aria-labelledby="landing-use">
      <div className={styles.inner}>
        <Eyebrow>{translate({id: 'landing.use.eyebrow', message: 'use cases'})}</Eyebrow>
        <div className={styles.headRow}>
          <h2 id="landing-use" className={styles.heading}>
            {translate({
              id: 'landing.use.title',
              message: 'Built for everything that reads the chain',
            })}
          </h2>
          {surface('config') && (
            <Button variant="primary" size="md" href={surface('config')}>
              {translate({id: 'landing.cta.config', message: 'Build your config'})}
            </Button>
          )}
        </div>
        <ul className={styles.cards}>
          {cases.map(([title, body]) => (
            <li key={title}>
              <UseCaseCard title={title} description={body} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Queries(): React.JSX.Element {
  const translate = useLandingTranslate();
  const surface = useSurface();
  const schema = surface('schema');
  const run = translate({id: 'landing.queries.run', message: 'Read about these tables'});
  const queries = [
    [translate({id: 'landing.queries.tip', message: 'Where is the tip?'}), SAMPLE_QUERIES.tip],
    [
      translate({id: 'landing.queries.balance', message: 'Balance of an address'}),
      SAMPLE_QUERIES.balance,
    ],
    [
      translate({id: 'landing.queries.rewards', message: 'Latest recorded rewards'}),
      SAMPLE_QUERIES.rewards,
    ],
  ];
  return (
    <section className={styles.section} aria-labelledby="landing-queries">
      <div className={styles.inner}>
        <Eyebrow>{translate({id: 'landing.queries.eyebrow', message: 'sample queries'})}</Eyebrow>
        <div className={styles.headRow}>
          <h2 id="landing-queries" className={styles.heading}>
            {translate({id: 'landing.queries.title', message: 'Your chain, one query away'})}
          </h2>
          <MoreLink href={schema}>
            {translate({id: 'landing.queries.schema', message: 'Explore the full schema'})}
          </MoreLink>
        </div>
        <ul className={styles.cards}>
          {queries.map(([question, sql]) => (
            <li key={question}>
              <QueryCard question={question} sql={sql} href={schema} linkLabel={run} copyable />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Quickstart(): React.JSX.Element {
  const translate = useLandingTranslate();
  const steps = [
    {
      title: translate({id: 'landing.quick.restore', message: 'Restore a snapshot'}),
      body: translate({
        id: 'landing.quick.restore.body',
        message:
          'Skip genesis: download the latest state snapshot and restore it into PostgreSQL with its ledger state.',
      }),
      command: QUICKSTART_COMMANDS.restore,
    },
    {
      title: translate({id: 'landing.quick.run', message: 'Point it at your node'}),
      body: translate({
        id: 'landing.quick.run.body',
        message: 'Run db-sync against your local cardano-node socket and config.',
      }),
      command: QUICKSTART_COMMANDS.run,
    },
    {
      title: translate({id: 'landing.quick.query', message: 'Query away'}),
      body: translate({
        id: 'landing.quick.query.body',
        message: 'Watch it catch up to the tip, then connect any SQL client.',
      }),
      command: QUICKSTART_COMMANDS.query,
    },
  ];
  return (
    <section className={styles.dark} aria-labelledby="landing-quick">
      <div className={styles.inner}>
        <Eyebrow>{translate({id: 'landing.quick.eyebrow', message: 'quickstart'})}</Eyebrow>
        <h2 id="landing-quick" className={styles.heading}>
          {translate({id: 'landing.quick.title', message: 'Up and running in three steps'})}
        </h2>
        <p className={styles.intro}>
          {translate({
            id: 'landing.quick.prerequisites',
            message:
              'These mainnet examples run from the repository root. Install the db-sync binary, configure config/pgpass-mainnet, create an empty database, and replace path/to/snapshot.tgz and path/to/node.socket with your paths. Use a snapshot compatible with your release and configuration.',
          })}
        </p>
        <ol className={styles.steps}>
          {steps.map((step, index) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.stepNumber} aria-hidden="true">
                {index + 1}
              </span>
              <div className={styles.stepText}>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepBody}>{step.body}</p>
              </div>
              <div className={styles.command}>
                <pre className={styles.commandText}>
                  <code>
                    <span aria-hidden="true" className={styles.prompt}>
                      ${' '}
                    </span>
                    {step.command}
                  </code>
                </pre>
                <CodeCopy text={step.command} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Faq(): React.JSX.Element {
  const translate = useLandingTranslate();
  const surface = useSurface();
  return (
    <section className={styles.section} aria-labelledby="landing-faq">
      <div className={styles.inner}>
        <Eyebrow>{translate({id: 'landing.faq.eyebrow', message: 'faq'})}</Eyebrow>
        <div className={styles.headRow}>
          <h2 id="landing-faq" className={styles.heading}>
            {translate({id: 'landing.faq.title', message: 'Frequently asked questions'})}
          </h2>
          <MoreLink href={surface('faq')}>
            {translate({id: 'landing.faq.all', message: 'All questions'})}
          </MoreLink>
        </div>
        <div className={styles.faq}>
          {faqItems(translate).map((item, index) => (
            <details key={item.question} className={styles.faqItem} open={index === 0}>
              <summary className={styles.faqQuestion}>
                <span>{item.question}</span>
                <Icon name="plus" size={16} className={styles.faqPlus} />
                <Icon name="minus" size={16} className={styles.faqMinus} />
              </summary>
              <p className={styles.faqAnswer}>{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Community(): React.JSX.Element {
  const translate = useLandingTranslate();
  const surface = useSurface();
  return (
    <section className={styles.warm} aria-labelledby="landing-community">
      <div className={styles.inner}>
        <Eyebrow>{translate({id: 'landing.community.eyebrow', message: 'community'})}</Eyebrow>
        <h2 id="landing-community" className={styles.heading}>
          {translate({
            id: 'landing.community.title',
            message: 'Run by the community, for the community',
          })}
        </h2>
        <p className={styles.intro}>
          {translate({
            id: 'landing.community.body',
            message:
              'Report issues, shape the roadmap in the annual survey, or get help on Discord.',
          })}
        </p>
        <div className={styles.actions}>
          <Button variant="primary" size="md" href={SURFACES.docs}>
            {translate({id: 'landing.cta.docs', message: 'Read the docs'})}
          </Button>
          {surface('survey') && (
            <Button variant="secondary" size="md" href={surface('survey')}>
              {translate({id: 'landing.cta.survey', message: 'Take the survey'})}
            </Button>
          )}
          <Button variant="ghost" size="md" href={`${REPO_URL}/issues`}>
            {translate({id: 'landing.cta.issues', message: 'Report an issue'})}
          </Button>
          <Link className={styles.more} to={DISCORD_URL}>
            {translate({id: 'landing.cta.discord', message: 'Discord #db-sync'})}
            <Icon name="external" size={12} />
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * B44-a — the landing page, after the design's `Landing · 1440` and its B47 tiers: what DB Sync
 * is, what this build documents, and the ways in. A section links to a surface only once that
 * surface exists (`useSurface`).
 */
export default function Landing(): React.JSX.Element {
  return (
    <div className={styles.landing}>
      <Hero />
      <Facts />
      <Pipeline />
      <UseCases />
      <Queries />
      <Quickstart />
      <Faq />
      <Community />
    </div>
  );
}

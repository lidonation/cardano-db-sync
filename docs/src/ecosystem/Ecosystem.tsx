import React from 'react';

import codeTranslations from '@generated/codeTranslations';
import Link from '@docusaurus/Link';
import {translate} from '@docusaurus/Translate';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import Button from '../components/Button';
import {TeamCard, ToolCard} from '../components/Card';
import Metric from '../components/Metric';
import Tag from '../components/Tag';
import Icon from '../components/shared/Icon';
import {DISCORD_URL, REPO_URL} from '../data/links';
import type {ReleaseHistory} from '../data/release-history';
import {SURFACES} from '../data/surfaces';
import {pageTranslator} from '../i18n/pageTranslator';
import Eyebrow from '../landing/Eyebrow';
import useSurface from '../landing/useSurface';
import styles from '../landing/styles.module.css';

import {teams, tools, toolsView, type Tool} from './entries';
import {ECOSYSTEM_IDS} from './ids';

const NEW_ISSUE = `${REPO_URL}/issues/new/choose`;
const GOOD_FIRST_ISSUES = `${REPO_URL}/issues?q=is%3Aopen+label%3A%22good+first+issue%22`;

/** The translate function for this page: English throughout when a string is missing (A11Y-18). */
function useEcosystemTranslate() {
  const {
    i18n: {currentLocale, defaultLocale},
  } = useDocusaurusContext();
  return pageTranslator(ECOSYSTEM_IDS, codeTranslations, currentLocale, defaultLocale, translate);
}

/** A single grid, with alternatives marked and an actionable empty state. */
export function ToolGrid({
  items,
  t,
}: {
  readonly items: readonly Tool[];
  readonly t: ReturnType<typeof useEcosystemTranslate>;
}): React.JSX.Element {
  const view = toolsView(items, t);
  if (view.kind === 'empty')
    return (
      <div>
        <p>{view.message}</p>
        <Link className={styles.more} to={view.href}>
          {view.action}
        </Link>
      </div>
    );
  return (
    <ul className={styles.cards}>
      {items.map((tool) => (
        <li key={tool.name}>
          <ToolCard
            name={tool.name}
            org={
              <>
                {tool.org} {tool.kind === 'alternative' && <Tag>ALT</Tag>}
              </>
            }
            description={tool.description}
            links={[
              ...(tool.website
                ? [
                    {
                      href: tool.website,
                      label: `${tool.name} ${t({id: 'ecosystem.links.website', message: 'website'})}`,
                    },
                  ]
                : []),
              {
                href: tool.url,
                label: `${tool.name} ${t({id: 'ecosystem.links.repository', message: 'repository'})}`,
              },
              ...(tool.sql
                ? [
                    {
                      href: tool.sql,
                      label: `${tool.name} ${t({id: 'ecosystem.links.sql', message: 'SQL'})}`,
                    },
                  ]
                : []),
            ]}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * B44-b — the Ecosystem page, after the design's `Ecosystem` board: the tools built on db-sync,
 * the teams that run it in production, and the ways to join in. The design's contributor,
 * activity and roadmap sections need live repository data and are not built here.
 */
export default function Ecosystem(): React.JSX.Element {
  const t = useEcosystemTranslate();
  const surface = useSurface();
  const history = useDocusaurusContext().siteConfig.customFields?.releaseHistory as ReleaseHistory;
  const allTools = tools(t);
  const builtOn = allTools.filter((tool) => tool.kind === 'built-on');
  const allTeams = teams(t);
  const tellUs = surface('survey') ?? NEW_ISSUE;
  const facts = [
    {
      value: history.releases.toLocaleString('en'),
      label: t({id: 'ecosystem.facts.releases', message: 'releases in the changelog'}),
    },
    {
      value: history.latest,
      label: t({id: 'ecosystem.facts.latest', message: 'latest release'}),
    },
    {
      value: String(history.since),
      label: t({id: 'ecosystem.facts.since', message: 'year of the first release'}),
    },
    {
      value: builtOn.length.toLocaleString('en'),
      label: t({id: 'ecosystem.facts.tools', message: 'tools built on db-sync listed here'}),
    },
  ];
  return (
    <div className={styles.landing}>
      <section className={styles.section} aria-labelledby="ecosystem-title">
        <div className={styles.inner}>
          <Eyebrow>{t({id: 'ecosystem.eyebrow', message: 'the ecosystem'})}</Eyebrow>
          <h1 id="ecosystem-title" className={styles.heading}>
            {t({id: 'ecosystem.title', message: 'Depended on by the chain'})}
          </h1>
          <p className={styles.intro}>
            {t({
              id: 'ecosystem.intro',
              message:
                'Cardano DB Sync is the bridge between the live chain and relational data. The projects listed below use its database for explorers, APIs and governance tools. Other indexers can also serve Cardano data in SQL.',
            })}
          </p>
        </div>
      </section>

      <section className={styles.dark} aria-labelledby="ecosystem-facts">
        <div className={styles.inner}>
          <h2 id="ecosystem-facts" className={styles.eyebrow}>
            <span aria-hidden="true">// </span>
            {t({
              id: 'ecosystem.facts.eyebrow',
              message: 'in this build',
              description: 'Heading of the strip of facts counted from the changelog and this page',
            })}
          </h2>
          <ul className={styles.facts}>
            {facts.map((fact) => (
              <li key={fact.label}>
                <Metric value={fact.value} label={fact.label} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="ecosystem-tools">
        <div className={styles.inner}>
          <Eyebrow>
            {t({id: 'ecosystem.tools.eyebrow', message: 'related ecosystem tools'})}
          </Eyebrow>
          <h2 id="ecosystem-tools" className={styles.heading}>
            {t({id: 'ecosystem.tools.title', message: 'Built on top or with the schema'})}
          </h2>
          <p className={styles.intro}>
            {t({
              id: 'ecosystem.tools.intro',
              message:
                'DB Sync is infrastructure other infrastructure stands on. These projects read its database, extend its schema or wrap it in an API. ALT marks alternative indexers.',
            })}
          </p>
          <ToolGrid items={allTools} t={t} />
          <div className={styles.actions}>
            <Button variant="primary" size="md" href={tellUs}>
              {t({id: 'ecosystem.tools.cta', message: 'Tell us what you’re building'})}
            </Button>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="ecosystem-alternatives">
        <div className={styles.inner}>
          <Eyebrow>{t({id: 'ecosystem.alternatives.eyebrow', message: 'alternatives'})}</Eyebrow>
          <h2 id="ecosystem-alternatives" className={styles.heading}>
            {t({id: 'ecosystem.alternatives.title', message: 'For narrower needs'})}
          </h2>
          <p className={styles.intro}>
            {t({
              id: 'ecosystem.alternatives.intro',
              message:
                'Indexers that do not use db-sync, for when a full relational mirror is more than you need.',
            })}
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="ecosystem-teams">
        <div className={styles.inner}>
          <Eyebrow>
            {t({id: 'ecosystem.teams.eyebrow', message: 'teams building with db sync'})}
          </Eyebrow>
          <h2 id="ecosystem-teams" className={styles.heading}>
            {t({id: 'ecosystem.teams.title', message: 'Teams building with db-sync'})}
          </h2>
          <p className={styles.intro}>
            {t({
              id: 'ecosystem.teams.intro',
              message:
                'Each team is linked to a public record of its work with db-sync. These sources do not establish where or how it deploys it.',
            })}
          </p>
          <ul className={styles.cards}>
            {allTeams.map((team) => (
              <li key={team.name}>
                <TeamCard name={team.name} evidence={team.evidence} href={team.url} />
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button variant="secondary" size="md" href={tellUs}>
              {t({id: 'ecosystem.teams.cta', message: 'Add your team to this list'})}
            </Button>
          </div>
        </div>
      </section>

      <section className={styles.warm} aria-labelledby="ecosystem-join">
        <div className={styles.inner}>
          <Eyebrow>{t({id: 'ecosystem.join.eyebrow', message: 'join in'})}</Eyebrow>
          <h2 id="ecosystem-join" className={styles.heading}>
            {t({id: 'ecosystem.join.title', message: 'Good first issues are labelled and waiting'})}
          </h2>
          <p className={styles.intro}>
            {t({
              id: 'ecosystem.join.body',
              message: 'Pick up a ticket, improve the docs, or tell us what db-sync is missing.',
            })}
          </p>
          <div className={styles.actions}>
            <Button variant="primary" size="md" href={GOOD_FIRST_ISSUES}>
              {t({id: 'ecosystem.join.issues', message: 'Good first issues'})}
            </Button>
            <Button variant="ghost" size="md" href={SURFACES.docs}>
              {t({id: 'ecosystem.join.docs', message: 'Read the docs'})}
            </Button>
            <Link className={styles.more} to={DISCORD_URL}>
              {t({id: 'ecosystem.join.discord', message: 'Discord #db-sync'})}
              <Icon name="external" size={12} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

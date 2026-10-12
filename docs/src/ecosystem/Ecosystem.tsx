import React from 'react';

import Link from '@docusaurus/Link';

import Button from '../components/Button';
import {ToolCard} from '../components/Card';
import Icon from '../components/shared/Icon';
import {REPO_URL} from '../landing/Landing';

import {ECOSYSTEM_TOOLS, toolsView, type EcosystemTool} from './tools';
import useEcosystemTranslate from './useEcosystemTranslate';
import styles from './styles.module.css';

/** The `// section` label above a heading. The slashes are decoration. */
function Eyebrow({children}: {readonly children: React.ReactNode}): React.JSX.Element {
  return (
    <p className={styles.eyebrow}>
      <span aria-hidden="true">{'// '}</span>
      {children}
    </p>
  );
}

/** One tool: its card links to the tool itself; the repository and its SQL follow as named links. */
function Tool({tool}: {readonly tool: EcosystemTool}): React.JSX.Element {
  const translate = useEcosystemTranslate();
  return (
    <li className={styles.tool}>
      <ToolCard
        name={tool.name}
        org={tool.org}
        description={tool.description}
        href={tool.website}
      />
      <p className={styles.links}>
        <Link className={styles.more} to={tool.repository}>
          {translate({id: 'ecosystem.links.repository', message: 'Repository'})}
          <Icon name="external" size={12} />
        </Link>
        <Link className={styles.more} to={tool.queries}>
          {tool.queriesLabel}
          <Icon name="external" size={12} />
        </Link>
      </p>
    </li>
  );
}

/**
 * B44-b — the ecosystem page: the tools built on db-sync, each with the SQL it runs, and the
 * way to add one. No charts, so A11Y-26's table alternative has nothing to attach to; the
 * named empty state below is the B44 DoD's, shown when the list has nothing yet.
 */
export default function Ecosystem({
  tools = ECOSYSTEM_TOOLS,
}: {
  readonly tools?: readonly EcosystemTool[];
}): React.JSX.Element {
  const translate = useEcosystemTranslate();
  const view = toolsView(tools);
  return (
    <div className={styles.ecosystem}>
      <section className={styles.section} aria-labelledby="ecosystem-title">
        <div className={styles.inner}>
          <Eyebrow>{translate({id: 'ecosystem.hero.eyebrow', message: 'ecosystem'})}</Eyebrow>
          <h1 id="ecosystem-title" className={styles.title}>
            {translate({id: 'ecosystem.hero.title', message: 'Built on DB Sync'})}
          </h1>
          <p className={styles.intro}>
            {translate({
              id: 'ecosystem.hero.intro',
              message:
                'Explorers, APIs and governance platforms read the chain through db-sync. Each tool below links to the SQL it runs, so operators can read exactly what the chain is asked.',
            })}
          </p>
        </div>
      </section>
      <section className={styles.section} aria-labelledby="ecosystem-tools">
        <div className={styles.inner}>
          <Eyebrow>{translate({id: 'ecosystem.tools.eyebrow', message: 'tools'})}</Eyebrow>
          <h2 id="ecosystem-tools" className={styles.heading}>
            {translate({id: 'ecosystem.tools.title', message: 'Tools around db-sync'})}
          </h2>
          <p className={styles.intro}>
            {translate({
              id: 'ecosystem.tools.sql',
              message: 'Every tool links to the SQL it runs against the schema.',
            })}
          </p>
          {view.kind === 'list' ? (
            <ul className={styles.tools}>
              {view.tools.map((tool) => (
                <Tool key={tool.name} tool={tool} />
              ))}
            </ul>
          ) : (
            <div className={styles.empty}>
              <h3 className={styles.emptyTitle}>
                {translate({id: 'ecosystem.empty.title', message: 'No tools listed yet'})}
              </h3>
              <p className={styles.emptyBody}>
                {translate({
                  id: 'ecosystem.empty.body',
                  message:
                    'The list is empty. Ask on Discord or check back after the next release.',
                })}
              </p>
              <Link className={styles.more} to="https://discord.com/invite/inter-sect">
                {translate({id: 'ecosystem.empty.discord', message: 'Discord #db-sync'})}
                <Icon name="external" size={12} />
              </Link>
            </div>
          )}
        </div>
      </section>
      <section className={styles.warm} aria-labelledby="ecosystem-add">
        <div className={styles.inner}>
          <h2 id="ecosystem-add" className={styles.heading}>
            {translate({id: 'ecosystem.add.title', message: 'Add your tool'})}
          </h2>
          <p className={styles.intro}>
            {translate({
              id: 'ecosystem.add.body',
              message:
                'Built something on db-sync? Open an issue with its name, description and links.',
            })}
          </p>
          <div className={styles.actions}>
            <Button variant="primary" size="md" href={`${REPO_URL}/issues`}>
              {translate({id: 'ecosystem.add.issues', message: 'Propose a tool'})}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

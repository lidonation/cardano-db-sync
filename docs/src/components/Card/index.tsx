import React, {type ReactNode} from 'react';

import Link from '@docusaurus/Link';

import CodeCopy from '../CodeCopy';
import Icon from '../shared/Icon';
import {Skeleton} from '../shared/Status';

import Frame, {CardSkeleton, type CardDataProps} from './Frame';
import styles from './styles.module.css';

export type {CardDataProps} from './Frame';

/** `Card / Tool` — an ecosystem tool: its name as code, who runs it, one line on what it does. */
export function ToolCard({
  name,
  org,
  description,
  href,
  ...data
}: CardDataProps & {
  readonly name: string;
  readonly org: ReactNode;
  readonly description: ReactNode;
  readonly href?: string;
}): React.JSX.Element {
  return (
    <Frame kind="Tool" href={href} skeleton={<CardSkeleton />} {...data}>
      <span className={styles.toolName}>
        <code>{name}</code>
        {href && <Icon name="external" size={12} />}
      </span>
      <span className={styles.meta}>{org}</span>
      <span className={styles.body}>{description}</span>
    </Frame>
  );
}

/** `Card / Team` — a team building with DB Sync, and the public evidence that it does. */
export function TeamCard({
  name,
  evidence,
  href,
  ...data
}: CardDataProps & {
  readonly name: ReactNode;
  readonly evidence: ReactNode;
  readonly href?: string;
}): React.JSX.Element {
  return (
    <Frame kind="Team" href={href} skeleton={<CardSkeleton icon />} {...data}>
      <Icon name="hexagon" size={24} className={styles.mark} />
      <span className={styles.title}>{name}</span>
      <span className={styles.evidence}>{evidence}</span>
    </Frame>
  );
}

/** `Card / Use case` — an audience and what it does with the data. */
export function UseCaseCard({
  icon,
  title,
  description,
  href,
  ...data
}: CardDataProps & {
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly href?: string;
}): React.JSX.Element {
  return (
    <Frame kind="Use case" href={href} skeleton={<CardSkeleton icon />} {...data}>
      <span className={styles.icon}>{icon ?? <Icon name="hexagon" size={32} />}</span>
      <span className={styles.heading}>{title}</span>
      <span className={styles.body}>{description}</span>
    </Frame>
  );
}

/** `Card / Query` — the question a query answers, the SQL, and where to read more. */
export function QueryCard({
  question,
  sql,
  linkLabel,
  href,
  copyable = false,
  ...data
}: CardDataProps & {
  readonly question: ReactNode;
  readonly sql: string;
  readonly linkLabel?: ReactNode;
  /** Where to read more; without it the card has no link. */
  readonly href?: string;
  /** Offers the SQL to the clipboard from the band. */
  readonly copyable?: boolean;
}): React.JSX.Element {
  return (
    <Frame
      kind="Query"
      className={styles.banded}
      skeleton={
        <>
          <Skeleton size="line-short" />
          <Skeleton size="block" />
        </>
      }
      {...data}
    >
      <span className={styles.band}>
        {question}
        {copyable && <CodeCopy text={sql} />}
      </span>
      <pre className={styles.sql}>
        <code>{sql}</code>
      </pre>
      {href && (
        <Link className={styles.inlineLink} to={href}>
          {linkLabel}
          <Icon name="arrow-right" size={12} className={styles.directional} />
        </Link>
      )}
    </Frame>
  );
}

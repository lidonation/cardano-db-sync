import React, {type ReactNode} from 'react';
import {Skeleton} from '../shared/Status';
import Frame, {type CardDataProps} from './Frame';
import styles from './styles.module.css';

/** `Card / Sample query` — the config builder's result: what a query returns, in one line of SQL. */
export function SampleQueryCard({
  returns,
  sql,
  ...data
}: CardDataProps & {
  readonly returns: ReactNode;
  readonly sql: string;
}): React.JSX.Element {
  return (
    <Frame
      kind="Sample query"
      className={styles.banded}
      skeleton={
        <>
          <Skeleton size="line-short" />
          <Skeleton size="line" />
        </>
      }
      {...data}
    >
      <span className={styles.band}>{returns}</span>
      <pre className={styles.sql}>
        <code className="dbs-type-mono">{sql}</code>
      </pre>
    </Frame>
  );
}

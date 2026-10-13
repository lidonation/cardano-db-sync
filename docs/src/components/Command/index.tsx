import React from 'react';
import CodeCopy from '../CodeCopy';
import styles from './styles.module.css';

/** Shared, wrapping command with a plain clipboard control. */
export default function Command({
  text,
  surface = 'code',
}: {
  readonly text: string;
  readonly surface?: 'code' | 'raised';
}): React.JSX.Element {
  return (
    <div className={styles.command} data-surface={surface} data-dbs-component="Command">
      <pre className={`dbs-type-mono ${styles.text}`}>
        <code>
          <span aria-hidden="true">$ </span>
          {text}
        </code>
      </pre>
      <CodeCopy text={text} variant="plain" />
    </div>
  );
}

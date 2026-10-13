import React from 'react';

import styles from './wordmark.module.css';

/** The logo mark and "Cardano DB Sync" — "Cardano" light, "DB Sync" bold — in one text run. */
export default function Wordmark({
  className = '',
}: {
  readonly className?: string;
}): React.JSX.Element {
  return (
    <span className={`${styles.wordmark} ${className || 'dbs-type-wordmark'}`}>
      <span>
        Cardano <strong className={styles.strong}>DB Sync</strong>
      </span>
    </span>
  );
}

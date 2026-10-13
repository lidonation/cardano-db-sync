import React from 'react';

import Icon from './Icon';

import styles from './wordmark.module.css';

/** The logo mark and "Cardano DB Sync" — "Cardano" light, "DB Sync" bold — in one text run. */
export default function Wordmark({
  className = '',
}: {
  readonly className?: string;
}): React.JSX.Element {
  return (
    <span className={`${styles.wordmark} ${className || 'dbs-type-wordmark'}`}>
      <Icon name="logo" size={24} className={styles.mark} />
      <span>
        Cardano <strong className={styles.strong}>DB Sync</strong>
      </span>
    </span>
  );
}

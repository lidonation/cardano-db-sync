import React from 'react';

import Icon from './Icon';

import styles from './wordmark.module.css';

/** The logo mark and "Cardano DB Sync" — "Cardano" light, "DB Sync" bold — in one text run. */
export default function Wordmark(): React.JSX.Element {
  return (
    <span className={styles.wordmark}>
      <Icon name="logo" size={24} className={styles.mark} />
      <span>
        Cardano <strong className={styles.strong}>DB Sync</strong>
      </span>
    </span>
  );
}

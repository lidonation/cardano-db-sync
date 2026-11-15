import React from 'react';

import styles from './wordmark.module.css';

/** The designed wordmark, with the optional navbar hexagon-and-dot mark (Penpot rev1551). */
export default function Wordmark({
  className = '',
  mark = false,
}: {
  readonly className?: string;
  /** Full and minimal navbars use the mark; the footer remains text-only. */
  readonly mark?: boolean;
}): React.JSX.Element {
  return (
    <span className={`${styles.wordmark} ${className || 'dbs-type-wordmark'}`}>
      {mark && (
        <svg className={styles.mark} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 2 21 7v10l-9 5-9-5V7Z" fill="none" />
          <circle cx="12" cy="12" r="2.5" stroke="none" />
        </svg>
      )}
      <span>
        Cardano <strong className={styles.strong}>DB Sync</strong>
      </span>
    </span>
  );
}

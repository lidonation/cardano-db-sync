import React from 'react';

import {translate} from '@docusaurus/Translate';

import styles from './retry.module.css';

/** The recovery control inside an error message (CONTENT-5): a text button that names its action. */
export default function Retry({onClick}: {readonly onClick?: () => void}): React.JSX.Element {
  return (
    <button type="button" className={styles.retry} onClick={onClick}>
      {translate({
        id: 'components.retry',
        message: 'Retry',
        description: 'Button that repeats a request that failed',
      })}
    </button>
  );
}

/** "Loading <what>…" for the visually hidden busy announcement. */
export function loadingLabel(): string {
  return translate({
    id: 'components.loading',
    message: 'Loading…',
    description: 'Announced while a component waits for its data',
  });
}

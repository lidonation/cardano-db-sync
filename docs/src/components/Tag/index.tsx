import React, {type ReactNode} from 'react';

import styles from './styles.module.css';

/**
 * `Chip / Tag` — a fact about an entity, not a control: "12 columns", "indexed". It has no
 * interaction states because it does nothing; it is rendered from data, so it is either present or
 * absent and has no loading, error or empty state of its own (its card has those).
 */
export default function Tag({children}: {readonly children: ReactNode}): React.JSX.Element {
  return (
    <span className={styles.tag} data-dbs-component="Chip / Tag">
      {children}
    </span>
  );
}

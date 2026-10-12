import React from 'react';

import styles from './styles.module.css';

/**
 * `Section / Divider` — the hairline above every section, with a cross where it meets each content
 * rail (the design's Pest-style line geometry). `Section / Cross` is the cross alone, for band
 * edges. Both are decoration: hidden from assistive technology, with no states.
 */
export function SectionDivider(): React.JSX.Element {
  return (
    <div className={styles.divider} aria-hidden="true" data-dbs-component="Section / Divider">
      <span className={styles.cross} data-edge="start" />
      <span className={styles.cross} data-edge="end" />
    </div>
  );
}

export function SectionCross(): React.JSX.Element {
  return <span className={styles.cross} aria-hidden="true" data-dbs-component="Section / Cross" />;
}

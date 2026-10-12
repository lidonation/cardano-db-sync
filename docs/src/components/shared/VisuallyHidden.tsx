import React, {type ReactNode} from 'react';

import styles from './visually-hidden.module.css';

/** Text for assistive technology only, without loading unrelated status styles. */
export function VisuallyHidden({children}: {children: ReactNode}): React.JSX.Element {
  return <span className={styles.visuallyHidden}>{children}</span>;
}

import React, {type ReactNode} from 'react';

import styles from './styles.module.css';

/** The `// section` label above a heading. The slashes are decoration. */
export default function Eyebrow({children}: {readonly children: ReactNode}): React.JSX.Element {
  return (
    <p className={styles.eyebrow}>
      <span aria-hidden="true">//{' '}</span>
      {children}
    </p>
  );
}

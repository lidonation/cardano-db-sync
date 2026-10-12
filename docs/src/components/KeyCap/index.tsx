import React, {type ReactNode} from 'react';

import {translate} from '@docusaurus/Translate';

import Icon from '../shared/Icon';
import {VisuallyHidden} from '../shared/VisuallyHidden';

import styles from './styles.module.css';

/**
 * `Key / Cap` — a keyboard key, as `<kbd>`. Named keys with a symbol (Enter) are drawn, not typed
 * as a unicode glyph (CONTENT-2), and carry their name for assistive technology. A key cap is
 * static text: no interaction or data states.
 */
export default function KeyCap({
  children,
  enter = false,
}: {
  readonly children?: ReactNode;
  /** Draw the Enter key. */
  readonly enter?: boolean;
}): React.JSX.Element {
  return (
    <kbd className={styles.cap} data-dbs-component="Key / Cap">
      {enter ? (
        <>
          <Icon name="enter" size={12} />
          <VisuallyHidden>
            {translate({
              id: 'components.key.enter',
              message: 'Enter',
              description: 'Name of the Enter key',
            })}
          </VisuallyHidden>
        </>
      ) : (
        children
      )}
    </kbd>
  );
}

import React, {type ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Icon from '../shared/Icon';
import styles from './styles.module.css';

/** A route-gated text link with an arrow in the reading direction. */
export default function TextLink({
  href,
  children,
  size = 'label',
  tone = 'accent',
}: {
  readonly href?: string;
  readonly children: ReactNode;
  readonly size?: 'label' | 'label-sm';
  readonly tone?: 'accent' | 'prompt';
}): React.JSX.Element | null {
  if (!href) return null;
  return (
    <Link className={`dbs-type-${size} ${styles.link}`} data-tone={tone} to={href}>
      {children}
      <Icon name="arrow-right" size={12} className={styles.arrow} />
    </Link>
  );
}

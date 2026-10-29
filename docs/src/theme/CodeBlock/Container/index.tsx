import React, {type HTMLAttributes, type ReactNode} from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

/** The classic container derives inline Prism CSS variables, forbidden by SEC-2. */
export default function CodeBlockContainer({
  as: As,
  style,
  className,
  ...props
}: {as: 'div' | 'pre'} & HTMLAttributes<HTMLElement>): ReactNode {
  // Do not forward an inline style: site tokens in the stylesheet own these values.
  void style;
  return <As {...props} className={clsx(className, styles.container, 'theme-code-block')} />;
}

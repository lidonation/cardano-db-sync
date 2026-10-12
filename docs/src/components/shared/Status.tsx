import React, {type ReactNode} from 'react';

import Icon from './Icon';

import styles from './shared.module.css';

/** Text for assistive technology only. */
export function VisuallyHidden({children}: {children: ReactNode}): React.JSX.Element {
  return <span className={styles.visuallyHidden}>{children}</span>;
}

/** Skeleton sizes. Fixed classes, because the CSP forbids inline styles (SEC-2). */
export type SkeletonSize = 'icon' | 'avatar' | 'title' | 'line' | 'line-short' | 'value' | 'block';

/**
 * A loading placeholder block (DF-4). Decorative: the container that shows skeletons carries
 * `aria-busy` and a visually hidden "Loading …" line, so the wait is announced once.
 */
export function Skeleton({
  size,
  shape = 'block',
}: {
  readonly size: SkeletonSize;
  readonly shape?: 'block' | 'hexagon';
}): React.JSX.Element {
  return (
    <span
      className={[styles.skeleton, shape === 'hexagon' ? styles.hexagon : ''].join(' ').trim()}
      data-size={size}
      aria-hidden="true"
    />
  );
}

/**
 * An error beside the thing it is about (DF-4, CONTENT-5): an alert glyph and words, never colour
 * alone (FLOOR-6). The message names the problem and the recovery; `action` is the recovery
 * control when there is one (a Retry button).
 */
export function ErrorMessage({
  id,
  children,
  action,
  live = false,
}: {
  readonly id?: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
  /** Announce on appearance — for errors that arrive after an action, not on first render. */
  readonly live?: boolean;
}): React.JSX.Element {
  return (
    <p id={id} className={styles.error} role={live ? 'alert' : undefined}>
      <Icon name="alert" size={12} className={styles.errorIcon} />
      <span>{children}</span>
      {action}
    </p>
  );
}

/** Nothing to show yet (DF-4, CONTENT-5): says what is missing and what will fill it. */
export function EmptyState({
  children,
  framed = true,
}: {
  readonly children: ReactNode;
  readonly framed?: boolean;
}): React.JSX.Element {
  return <p className={framed ? `${styles.empty} ${styles.framed}` : styles.empty}>{children}</p>;
}

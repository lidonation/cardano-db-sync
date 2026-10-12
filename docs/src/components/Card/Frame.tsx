import React, {type ReactNode} from 'react';

import Link from '@docusaurus/Link';

import Retry, {loadingLabel} from '../shared/Retry';
import {EmptyState, ErrorMessage, Skeleton, VisuallyHidden} from '../shared/Status';
import {demoAttributes, type DataStatus, type InteractionState} from '../shared/states';

import styles from './styles.module.css';

/** What every card that shows data can be told about that data (DF-4). */
export interface CardDataProps {
  readonly status?: DataStatus;
  /** Names the problem and the recovery (CONTENT-5). */
  readonly errorMessage?: ReactNode;
  readonly onRetry?: () => void;
  /** Says what is missing and what will fill it (CONTENT-5). */
  readonly emptyMessage?: ReactNode;
  readonly demo?: InteractionState;
}

export type CardKind =
  | 'Tool'
  | 'Team'
  | 'Use case'
  | 'Query'
  | 'Sample query'
  | 'Stat'
  | 'Choice'
  | 'Option'
  | 'Data option';

/**
 * The shared card frame: a flat surface, a 1px boundary, square corners, no shadow. A card with an
 * `href` is one link — its boundary is `border.interactive` (FLOOR-3) and it has hover, pressed
 * and focus states. Loading, error and empty replace the body and keep the card's footprint, so a
 * grid of cards does not jump when data arrives.
 */
export default function Frame({
  kind,
  href,
  status = 'ready',
  errorMessage,
  onRetry,
  emptyMessage,
  demo,
  skeleton,
  className,
  children,
}: CardDataProps & {
  readonly kind: CardKind;
  readonly href?: string;
  /** The loading layout: skeleton blocks in the shape of the content. */
  readonly skeleton: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  const attributes = {
    className: [styles.card, className].filter(Boolean).join(' '),
    'data-kind': kind,
    'data-dbs-component': `Card / ${kind}`,
    ...demoAttributes(demo),
  };
  if (status === 'loading') {
    return (
      <div {...attributes} aria-busy="true" data-status="loading">
        <VisuallyHidden>{loadingLabel()}</VisuallyHidden>
        {skeleton}
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div {...attributes} data-status="error">
        <ErrorMessage action={onRetry ? <Retry onClick={onRetry} /> : undefined}>
          {errorMessage}
        </ErrorMessage>
      </div>
    );
  }
  if (status === 'empty') {
    return (
      <div {...attributes} data-status="empty">
        <EmptyState framed={false}>{emptyMessage}</EmptyState>
      </div>
    );
  }
  if (href) {
    return (
      <Link {...attributes} to={href} data-link="">
        {children}
      </Link>
    );
  }
  return <div {...attributes}>{children}</div>;
}

/** The common skeleton: an icon, a title and two lines. */
export function CardSkeleton({icon = false}: {readonly icon?: boolean}): React.JSX.Element {
  return (
    <>
      {icon && <Skeleton size="icon" />}
      <Skeleton size="title" />
      <Skeleton size="line" />
      <Skeleton size="line-short" />
    </>
  );
}

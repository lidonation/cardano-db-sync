import React, {type ReactNode} from 'react';

import Retry, {loadingLabel} from '../shared/Retry';
import {ErrorMessage, Skeleton, VisuallyHidden} from '../shared/Status';
import type {DataStatus} from '../shared/states';

import styles from './styles.module.css';

/**
 * `Metric` (was `Metric / Dark`, THM-6) — one live figure and what it measures: block height,
 * epoch, sync progress. Themed by token, so it reads on any surface the page puts it on rather
 * than carrying a dark backing of its own. Figures use tabular numerals (FLOOR-7) so a refreshing
 * strip does not jitter. It is not interactive; its states are the data's: loading, error (with a
 * retry), and empty before the first figure exists.
 */
export default function Metric({
  value,
  label,
  status = 'ready',
  errorMessage,
  onRetry,
  emptyMessage,
}: {
  readonly value?: ReactNode;
  readonly label: ReactNode;
  readonly status?: DataStatus;
  readonly errorMessage?: ReactNode;
  readonly onRetry?: () => void;
  readonly emptyMessage?: ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={styles.metric}
      data-dbs-component="Metric"
      data-status={status}
      aria-busy={status === 'loading' || undefined}
    >
      {status === 'loading' ? (
        <>
          <VisuallyHidden>{loadingLabel()}</VisuallyHidden>
          <Skeleton size="value" />
        </>
      ) : status === 'error' ? (
        <ErrorMessage action={onRetry ? <Retry onClick={onRetry} /> : undefined}>
          {errorMessage}
        </ErrorMessage>
      ) : status === 'empty' ? (
        <span className={styles.empty}>{emptyMessage}</span>
      ) : (
        <span className={styles.value}>{value}</span>
      )}
      <span className={styles.label}>{label}</span>
    </div>
  );
}

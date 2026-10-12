import React, {type ReactNode} from 'react';

import {translate} from '@docusaurus/Translate';

import Icon from '../shared/Icon';
import Retry from '../shared/Retry';
import {ErrorMessage, Skeleton, VisuallyHidden, loadingLabel} from '../shared/Status';
import {demoAttributes, type InteractionState} from '../shared/states';

import styles from './styles.module.css';

export interface SearchResultProps {
  readonly id: string;
  readonly title: ReactNode;
  /** Where the result lives: "table · core", "guide". */
  readonly meta: ReactNode;
  /** The active option (`aria-activedescendant` points here, SRCH-6). */
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly onSelect?: () => void;
  readonly demo?: InteractionState;
}

/**
 * `Search / Result` — one option in the ⌘K listbox. Focus stays in the search input
 * (SRCH-6), so the row is `role="option"` and the active one is marked by `aria-selected`,
 * painted as an accent fill with an Enter key drawn at the end (shape as well as colour,
 * FLOOR-6). Loading, error and empty replace the listbox, so they are separate exports below.
 */
export default function SearchResult({
  id,
  title,
  meta,
  selected = false,
  disabled = false,
  onSelect,
  demo,
}: SearchResultProps): React.JSX.Element {
  return (
    <li
      id={id}
      className={styles.row}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onSelect}
      data-dbs-component="Search / Result"
      {...demoAttributes(demo)}
    >
      <Icon name="hexagon" size={16} className={styles.icon} />
      <span className={styles.title}>{title}</span>
      <span className={styles.meta}>{meta}</span>
      <span className={styles.enter} aria-hidden="true">
        <Icon name="enter" size={12} />
      </span>
    </li>
  );
}

/** The list is waiting for results (DF-4). */
export function SearchResultsLoading(): React.JSX.Element {
  return (
    <div
      className={styles.state}
      aria-busy="true"
      data-dbs-component="Search / Result"
      data-status="loading"
    >
      <VisuallyHidden>{loadingLabel()}</VisuallyHidden>
      <Skeleton size="line" />
      <Skeleton size="line-short" />
    </div>
  );
}

/** The search failed: say so and offer the retry (DF-4, CONTENT-5). */
export function SearchResultsError({onRetry}: {readonly onRetry?: () => void}): React.JSX.Element {
  return (
    <div className={styles.state} data-dbs-component="Search / Result" data-status="error">
      <ErrorMessage action={onRetry ? <Retry onClick={onRetry} /> : undefined} live>
        {translate({
          id: 'components.search.error',
          message: 'Search could not load its index. Check your connection, then retry.',
          description: 'Search failed to load',
        })}
      </ErrorMessage>
    </div>
  );
}

/** No result for a query — distinct from the pre-query empty state (DF-4). */
export function SearchResultsEmpty({query}: {readonly query: string}): React.JSX.Element {
  return (
    <div
      className={styles.state}
      role="status"
      data-dbs-component="Search / Result"
      data-status="empty"
    >
      <span className={styles.title}>
        {translate(
          {
            id: 'components.search.empty',
            message: 'No results for “{query}”',
            description: 'Search found nothing for the query',
          },
          {query},
        )}
      </span>
      <span className={styles.hint}>
        {translate({
          id: 'components.search.emptyHint',
          message: 'Try a table or column name, such as tx_out.',
          description: 'Suggestion after a search with no results',
        })}
      </span>
    </div>
  );
}

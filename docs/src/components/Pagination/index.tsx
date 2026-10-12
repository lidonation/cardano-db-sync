import React, {type ReactNode} from 'react';

import Link from '@docusaurus/Link';
import {translate} from '@docusaurus/Translate';

import Icon from '../shared/Icon';
import {demoAttributes, type InteractionState} from '../shared/states';

import styles from './styles.module.css';

export interface PageLink {
  readonly href: string;
  readonly title: ReactNode;
}

/**
 * `Pagination / Prev-Next` — the previous and next page, as two link cards in a `nav`. A missing
 * side (the first or last page) leaves its cell empty rather than drawing a dead card, which is
 * this component's empty state; with neither side the component renders nothing. Arrows point the
 * reading direction (DF-8). Loading and error do not apply: the links come from route data at
 * build time.
 */
export default function Pagination({
  previous,
  next,
  demo,
}: {
  readonly previous?: PageLink;
  readonly next?: PageLink;
  /** Pins an interaction state on one side, for the inventory. */
  readonly demo?: {readonly side: 'previous' | 'next'; readonly state: InteractionState};
}): React.JSX.Element | null {
  if (!previous && !next) {
    return null;
  }
  return (
    <nav
      className={styles.pager}
      aria-label={translate({
        id: 'components.pagination.label',
        message: 'Previous and next page',
        description: 'Accessible name of the previous/next page navigation',
      })}
      data-dbs-component="Pagination / Prev-Next"
    >
      {previous ? (
        <Link
          className={styles.card}
          to={previous.href}
          rel="prev"
          data-side="previous"
          {...demoAttributes(demo?.side === 'previous' ? demo.state : undefined)}
        >
          <span className={styles.kicker}>
            <Icon name="arrow-left" size={12} className={styles.arrow} />
            {translate({
              id: 'components.pagination.previous',
              message: 'Previous',
              description: 'Pager kicker',
            })}
          </span>
          <span className={styles.title}>{previous.title}</span>
        </Link>
      ) : (
        <span className={styles.gap} data-side="previous" />
      )}
      {next ? (
        <Link
          className={styles.card}
          to={next.href}
          rel="next"
          data-side="next"
          {...demoAttributes(demo?.side === 'next' ? demo.state : undefined)}
        >
          <span className={styles.kicker}>
            {translate({
              id: 'components.pagination.next',
              message: 'Next',
              description: 'Pager kicker',
            })}
            <Icon name="arrow-right" size={12} className={styles.arrow} />
          </span>
          <span className={styles.title}>{next.title}</span>
        </Link>
      ) : (
        <span className={styles.gap} data-side="next" />
      )}
    </nav>
  );
}

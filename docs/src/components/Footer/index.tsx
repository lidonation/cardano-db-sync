import React, {type ReactNode} from 'react';

import routes from '@generated/routes';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {gateMenu, routePaths} from '../../data/surfaces';

import Link from '@docusaurus/Link';
import {translate} from '@docusaurus/Translate';

import Wordmark from '../shared/Wordmark';
import {demoAttributes, type InteractionState} from '../shared/states';

import styles from './styles.module.css';

export interface FooterColumn {
  readonly heading: ReactNode;
  readonly links: readonly {readonly label: ReactNode; readonly href: string}[];
}

/**
 * `Footer` (the design's `Footer / Navy`) — correctly theme-invariant (THM-6): it binds
 * `brand.intersect-navy` in every palette, as the Infima footer does, and sets its text in the
 * invariant `code.text` roles that are measured against that navy. Links have hover and focus
 * states; it holds build-time data only, so loading, error and empty do not apply — a column with
 * no links is not rendered.
 */
const PATHS = routePaths(routes);

export default function Footer({
  meta,
  columns,
  note,
  demo,
}: {
  /** The line under the wordmark: licence, owner, version. */
  readonly meta: ReactNode;
  readonly columns: readonly FooterColumn[];
  /** The bottom line. */
  readonly note?: ReactNode;
  /** Pins an interaction state on the link with this `href`, for the inventory. */
  readonly demo?: {readonly href: string; readonly state: InteractionState};
}): React.JSX.Element {
  const baseUrl = useBaseUrl('/');
  const builtColumns = columns.map((column) => ({
    ...column,
    links: gateMenu(column.links, PATHS, baseUrl),
  }));
  return (
    <footer className={styles.footer} data-dbs-component="Footer">
      <div className={styles.brand}>
        <Wordmark className={styles.brandWordmark} />
        <span className={styles.meta}>{meta}</span>
      </div>
      <nav
        className={styles.columns}
        aria-label={translate({
          id: 'components.footer.label',
          message: 'Footer',
          description: 'Accessible name of the footer navigation',
        })}
      >
        {builtColumns
          .filter((column) => column.links.length > 0)
          .map((column, index) => (
            <div key={index} className={styles.column}>
              <span className={styles.heading}>{column.heading}</span>
              <ul className={styles.links}>
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      className={styles.link}
                      to={link.href}
                      {...demoAttributes(demo?.href === link.href ? demo.state : undefined)}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </nav>
      {note && <p className={styles.note}>{note}</p>}
    </footer>
  );
}

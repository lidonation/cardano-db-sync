import React from 'react';

import Link from '@docusaurus/Link';
import {useLocation} from '@docusaurus/router';
import {isActiveSidebarItem} from '@docusaurus/plugin-content-docs/client';
import type {PropSidebarItem} from '@docusaurus/plugin-content-docs';

import styles from './styles.module.css';

/**
 * The docs sidebar as 44px rows (NAV-4, DF-6) under `// group` headings, as DF-7 draws it. The
 * current page is derived from the route by Docusaurus' own `isActiveSidebarItem` (NAV-1): adding
 * a doc to the sidebar makes it highlight with no code change. It is marked with `aria-current`
 * and a bar on the reading-start edge as well as colour (FLOOR-6, DF-8).
 */
export default function SidebarList({
  items,
  onNavigate,
}: {
  readonly items: readonly PropSidebarItem[];
  /** Called when a link is followed (the disclosure closes on it). */
  readonly onNavigate?: () => void;
}): React.JSX.Element {
  const {pathname} = useLocation();
  return (
    <ul className={styles.list}>
      {items.map((item, index) => {
        if (item.type === 'category') {
          return (
            <li key={index} className={styles.group}>
              {item.href ? (
                <Link
                  className={styles.groupLink}
                  to={item.href}
                  aria-current={item.href === pathname ? 'page' : undefined}
                  onClick={onNavigate}
                >
                  <span aria-hidden="true">//{'\u00a0'}</span>
                  {item.label}
                </Link>
              ) : (
                <span className={styles.groupHeading}>
                  <span aria-hidden="true">//{'\u00a0'}</span>
                  {item.label}
                </span>
              )}
              <SidebarList items={item.items} onNavigate={onNavigate} />
            </li>
          );
        }
        if (item.type === 'link') {
          const active = isActiveSidebarItem(item, pathname);
          return (
            <li key={index}>
              <Link
                className={styles.row}
                to={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={onNavigate}
              >
                {item.label}
              </Link>
            </li>
          );
        }
        return null;
      })}
    </ul>
  );
}

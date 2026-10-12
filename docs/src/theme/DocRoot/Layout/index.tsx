import React, {type ReactNode} from 'react';

import {translate} from '@docusaurus/Translate';
import {useDocsSidebar} from '@docusaurus/plugin-content-docs/client';
import BackToTopButton from '@theme/BackToTopButton';
import type {Props} from '@theme/DocRoot/Layout';

import SidebarList from '../../DocLayout/SidebarList';

import styles from '../../DocLayout/styles.module.css';

/**
 * B34 — the docs page frame, per DF-7: the sidebar column (240px at 1024 and up, 200px from 768)
 * beside the main column, on the tier's grid margins; below 768px the sidebar is not a column at
 * all but the "On this section" disclosure at the top of the content (DocItem/Layout).
 */
export default function DocRootLayout({children}: Props): ReactNode {
  const sidebar = useDocsSidebar();
  return (
    <div className={styles.root} data-sidebar={sidebar ? '' : undefined}>
      <BackToTopButton />
      {sidebar && (
        <nav
          className={styles.sidebar}
          aria-label={translate({
            id: 'docs.sidebar.label',
            message: 'Docs',
            description: 'Accessible name of the docs sidebar navigation',
          })}
        >
          <SidebarList items={sidebar.items} />
        </nav>
      )}
      <main className={styles.main}>{children}</main>
    </div>
  );
}

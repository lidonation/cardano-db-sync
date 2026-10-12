import React, {type ReactNode} from 'react';

import {useLocation} from '@docusaurus/router';
import {translate} from '@docusaurus/Translate';
import {isActiveSidebarItem, useDocsSidebar} from '@docusaurus/plugin-content-docs/client';
import BackToTopButton from '@theme/BackToTopButton';
import type {Props} from '@theme/DocRoot/Layout';

import Disclosure from '../../DocLayout/Disclosure';
import {currentSection} from '../../DocLayout/sections';
import SidebarList from '../../DocLayout/SidebarList';

import styles from '../../DocLayout/styles.module.css';

/**
 * B34 — the docs page frame, per DF-7: the sidebar column (240px at 1024 and up, 200px from 768)
 * beside the main column, on the tier's grid margins; below 768px the sidebar is not a column at
 * all but the "On this section" disclosure at the top of this shared layout, including category pages.
 */
export default function DocRootLayout({children}: Props): ReactNode {
  const sidebar = useDocsSidebar();
  const {pathname} = useLocation();
  const section = sidebar
    ? currentSection(sidebar.items, (item) => isActiveSidebarItem(item, pathname))
    : null;
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
      <main className={styles.main}>
        {sidebar && section && (
          <Disclosure
            key={pathname}
            className={styles.sectionDisclosure}
            tone="sunken"
            kicker={translate({
              id: 'docs.section.kicker',
              message: 'On this section:',
              description: 'Leading words of the narrow-screen docs sidebar disclosure',
            })}
            label={
              section.label ??
              translate({
                id: 'docs.section.all',
                message: 'Docs',
                description: 'Section disclosure label when the sidebar has no sections',
              })
            }
          >
            {(close) => <SidebarList items={sidebar.items} onNavigate={close} />}
          </Disclosure>
        )}
        {children}
      </main>
    </div>
  );
}

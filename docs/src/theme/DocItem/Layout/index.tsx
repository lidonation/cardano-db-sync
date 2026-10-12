import React, {type ReactNode} from 'react';

import {translate} from '@docusaurus/Translate';
import {useThemeConfig} from '@docusaurus/theme-common';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import ContentVisibility from '@theme/ContentVisibility';
import DocBreadcrumbs from '@theme/DocBreadcrumbs';
import DocItemContent from '@theme/DocItem/Content';
import DocItemFooter from '@theme/DocItem/Footer';
import DocItemPaginator from '@theme/DocItem/Paginator';
import DocVersionBadge from '@theme/DocVersionBadge';
import DocVersionBanner from '@theme/DocVersionBanner';
import TOCItems from '@theme/TOCItems';
import type {Props} from '@theme/DocItem/Layout';

import Disclosure from '../../DocLayout/Disclosure';

import styles from '../../DocLayout/styles.module.css';

/**
 * B34 — one doc, per DF-7:
 *   - 1280px and up: the content beside the "On this page" column (the TOC);
 *   - below 1280px: the TOC is an "On this page" disclosure at the top of the content;
 *   - below 768px: the sidebar is an "On this section" disclosure above it (NAV-2).
 * The article keeps a 65–75ch reading measure (CONTENT-3). Every TOC entry is a 44px row (NAV-4).
 */
export default function DocItemLayout({children}: Props): ReactNode {
  const {metadata, frontMatter, toc} = useDoc();
  const {tableOfContents} = useThemeConfig();
  const minHeadingLevel = frontMatter.toc_min_heading_level ?? tableOfContents.minHeadingLevel;
  const maxHeadingLevel = frontMatter.toc_max_heading_level ?? tableOfContents.maxHeadingLevel;
  const hasToc =
    !frontMatter.hide_table_of_contents &&
    toc.some(({level}) => level >= minHeadingLevel && level <= maxHeadingLevel);
  const onThisPage = translate({
    id: 'docs.toc.label',
    message: 'On this page',
    description: 'Heading and disclosure label of the table of contents',
  });
  const tocItems = (close?: () => void) => (
    <div onClick={close}>
      <TOCItems
        toc={toc}
        minHeadingLevel={minHeadingLevel}
        maxHeadingLevel={maxHeadingLevel}
        className={styles.tocList}
        linkClassName={close ? styles.tocMobileLink : styles.tocLink}
        linkActiveClassName={styles.tocLinkActive}
      />
    </div>
  );
  return (
    <div className={styles.doc} data-toc={hasToc ? '' : undefined}>
      <div className={styles.content}>
        <ContentVisibility metadata={metadata} />
        <DocVersionBanner />
        {hasToc && (
          <Disclosure className={styles.pageDisclosure} label={onThisPage}>
            {(close) => tocItems(close)}
          </Disclosure>
        )}
        <article className={styles.article}>
          <DocBreadcrumbs />
          <DocVersionBadge />
          <DocItemContent>{children}</DocItemContent>
          <DocItemFooter />
        </article>
        <DocItemPaginator />
      </div>
      {hasToc && (
        <aside className={styles.toc} aria-label={onThisPage}>
          <p className={styles.tocHeading}>
            <span aria-hidden="true">//{'\u00a0'}</span>
            {onThisPage}
          </p>
          {tocItems()}
        </aside>
      )}
    </div>
  );
}

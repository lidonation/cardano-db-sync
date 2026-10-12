import React, {type ReactNode} from 'react';

import {translate} from '@docusaurus/Translate';
import {useThemeConfig} from '@docusaurus/theme-common';

import Footer from '../../components/Footer';

interface FooterLinkConfig {
  readonly label?: string;
  readonly to?: string;
  readonly href?: string;
}

interface FooterColumnConfig {
  readonly title?: string | null;
  readonly items: readonly FooterLinkConfig[];
}

/**
 * B34 — the site footer is the B29 `Footer` (the design's `Footer / Navy`), fed from
 * `themeConfig.footer`: each link column becomes a footer column, the copyright the bottom line.
 * Columns stack below 768px (DF-7).
 */
export default function SiteFooter(): ReactNode {
  const {footer} = useThemeConfig();
  if (!footer) {
    return null;
  }
  const columns = ((footer.links ?? []) as readonly FooterColumnConfig[])
    .filter((column) => 'items' in column)
    .map((column) => ({
      heading: column.title ?? '',
      links: column.items
        .map((item) => ({label: item.label ?? '', href: item.to ?? item.href ?? ''}))
        .filter((link) => link.href !== ''),
    }));
  return (
    <Footer
      meta={translate({
        id: 'footer.meta',
        message: 'Apache-2.0 · Intersect',
        description: 'Licence and owner line under the footer wordmark',
      })}
      columns={columns}
      note={footer.copyright}
    />
  );
}

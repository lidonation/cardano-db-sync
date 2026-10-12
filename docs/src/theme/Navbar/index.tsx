import React, {type ReactNode} from 'react';

import {useLocation} from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {useThemeConfig} from '@docusaurus/theme-common';
import {
  useActiveDocContext,
  useDocsVersionCandidates,
} from '@docusaurus/plugin-content-docs/client';
import NavbarColorModeToggle from '@theme/Navbar/ColorModeToggle';
import NavbarItem from '@theme/NavbarItem';

import {NavbarFull} from '../../components/Navbar';

import {deriveNav, resolveDocsState, type NavbarItemConfig} from './items';
import styles from './styles.module.css';

/**
 * B34 — the site navbar is the B29 `Navbar / Full`, fed from `themeConfig.navbar.items` so the
 * active section is derived from the route (NAV-1), and laid out per DF-7: links at 1280 and up, a
 * Menu drawer below. It stays pinned under the top of the viewport at 72px.
 *
 * The locale dropdown and the colour-mode toggle keep working in the preferences slot until B30
 * builds their designed replacements; search joins when B31 provides something to open. The navbar
 * is remounted per route, so the drawer closes after a navigation.
 */
export default function Navbar(): ReactNode {
  const {
    navbar: {items},
    colorMode: {disableSwitch},
  } = useThemeConfig();
  const {pathname} = useLocation();
  const baseUrl = useBaseUrl('/');
  // The version the stock navbar items link into: the active one, else the preferred, else latest.
  const versions = useDocsVersionCandidates(undefined);
  const {activeDoc} = useActiveDocContext(undefined);
  const nav = deriveNav(
    items as NavbarItemConfig[],
    pathname,
    baseUrl,
    resolveDocsState(versions, activeDoc),
  );
  const preferences: ReactNode = (
    <>
      {nav.preferences.map((item, index) => (
        <NavbarItem key={index} {...(item as React.ComponentProps<typeof NavbarItem>)} />
      ))}
      {!disableSwitch && <NavbarColorModeToggle className={styles.colorMode} />}
    </>
  );
  return (
    // `navbar` is the hook the stock theme measures (TOC highlighting, scroll anchoring).
    <div className={`navbar ${styles.sticky}`}>
      <NavbarFull
        key={pathname}
        homeHref="/"
        links={nav.links}
        githubHref={nav.github}
        preferences={preferences}
      />
    </div>
  );
}

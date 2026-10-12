import React, {useEffect, type ReactNode} from 'react';

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
  useEffect(() => {
    const navbar = document.querySelector<HTMLElement>('.navbar');
    if (!navbar) return;
    // SEC-2: edit the already-loaded same-origin stylesheet through CSSOM. A style attribute
    // or inline style element would not survive the production Content-Security-Policy.
    const sheet = Array.from(document.styleSheets).find(
      (candidate) => !candidate.href || new URL(candidate.href).origin === location.origin,
    );
    if (!sheet) return;
    const index = sheet.insertRule(':root {}', sheet.cssRules.length);
    const rule = sheet.cssRules[index] as CSSStyleRule;
    const update = () => {
      // offsetHeight is in layout pixels, so CSS page zoom does not multiply the clearance twice.
      const bar = navbar.querySelector<HTMLElement>('[data-dbs-component="Navbar / Full"]')
        ?.firstElementChild as HTMLElement | null;
      const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      rule.style.setProperty('--dbs-navbar-block-size', `${navbar.offsetHeight}px`);
      rule.style.setProperty(
        '--dbs-navbar-bar-size',
        `${bar?.offsetHeight ?? navbar.offsetHeight}px`,
      );
      // The preview banner sits above the navbar until it scrolls away. Reserve the actual
      // visible space, not a drawer extending one banner-height beyond the viewport.
      rule.style.setProperty(
        '--dbs-navbar-top',
        `${Math.max(0, navbar.getBoundingClientRect().top / zoom)}px`,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(navbar);
    window.addEventListener('scroll', update, {passive: true});
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', update);
      const current = Array.from(sheet.cssRules).indexOf(rule);
      if (current !== -1) sheet.deleteRule(current);
    };
  }, []);

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

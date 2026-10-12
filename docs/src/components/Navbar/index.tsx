import React, {useId, useState, type ReactNode} from 'react';

import clsx from 'clsx';

import Link from '@docusaurus/Link';
import {translate} from '@docusaurus/Translate';

import KeyCap from '../KeyCap';
import Icon from '../shared/Icon';
import {VisuallyHidden} from '../shared/Status';
import Wordmark from '../shared/Wordmark';
import {demoAttributes, type InteractionState} from '../shared/states';

import styles from './styles.module.css';

/** An interaction state pinned on the link with this `href`. */
export interface LinkDemo {
  readonly href: string;
  readonly state: InteractionState;
}

export interface NavLink {
  readonly label: ReactNode;
  readonly href: string;
  /** The current section: `aria-current` plus an underline bar, never colour alone (FLOOR-6). */
  readonly active?: boolean;
}

/**
 * `Navbar / Full` — wordmark, the five sections, the search trigger, GitHub and a slot for the
 * theme, locale and version controls (B30 fills it). Below 1280px — the DF-7 md and sm tiers — the
 * sections move into a disclosure behind a Menu button (NAV-2): collapsed by default,
 * keyboard-operable, its state announced by `aria-expanded`. Below 768px the search trigger becomes
 * a 44px icon button.
 * Every row is at least 44px (NAV-4). It renders route data known at build time, so it has no
 * loading, error or empty state; links have hover, pressed, focus and active (selected) states.
 */
export function NavbarFull({
  homeHref,
  links,
  githubHref,
  onSearch,
  actions,
  defaultMenuOpen = false,
  demo,
}: {
  readonly homeHref: string;
  readonly links: readonly NavLink[];
  readonly githubHref: string;
  readonly onSearch?: () => void;
  readonly actions?: ReactNode;
  /** Starts with the narrow-screen menu open, for the inventory. */
  readonly defaultMenuOpen?: boolean;
  /** Pins an interaction state on one link, for the inventory. */
  readonly demo?: LinkDemo;
}): React.JSX.Element {
  const menuId = useId();
  const [open, setOpen] = useState(defaultMenuOpen);
  const searchLabel = translate({
    id: 'components.navbar.search',
    message: 'Search docs',
    description: 'Search trigger in the navbar',
  });
  const sections = translate({
    id: 'components.navbar.sections',
    message: 'Sections',
    description: 'Accessible name of the main site navigation',
  });
  const linkList = (
    <ul className={styles.links}>
      {links.map((link) => (
        <li key={link.href}>
          <Link
            className={styles.link}
            to={link.href}
            aria-current={link.active ? 'page' : undefined}
            {...demoAttributes(demo?.href === link.href ? demo.state : undefined)}
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
  return (
    <header className={styles.navbar} data-dbs-component="Navbar / Full">
      <div className={styles.bar}>
        <Link className={styles.home} to={homeHref}>
          <Wordmark />
        </Link>
        <nav className={styles.wide} aria-label={sections}>
          {linkList}
        </nav>
        <div className={styles.tools}>
          <button type="button" className={styles.search} onClick={onSearch}>
            <KeyCap>⌘K</KeyCap>
            <span className={styles.searchText}>{searchLabel}</span>
            <Icon name="search" size={16} className={styles.searchIcon} />
            <span className={styles.searchName}>
              <VisuallyHidden>{searchLabel}</VisuallyHidden>
            </span>
          </button>
          <Link className={styles.github} to={githubHref}>
            <Icon name="github" size={16} />
            <span className={styles.githubText}>GitHub</span>
          </Link>
          {actions}
          <button
            type="button"
            className={styles.menu}
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen(!open)}
          >
            <Icon name={open ? 'close' : 'menu'} size={16} />
            <span className={styles.menuText}>
              {translate({
                id: 'components.navbar.menu',
                message: 'Menu',
                description: 'Narrow-screen menu button',
              })}
            </span>
          </button>
        </div>
      </div>
      <nav id={menuId} className={styles.drawer} aria-label={sections} hidden={!open}>
        {linkList}
        <Link className={clsx(styles.link, styles.drawerGithub)} to={githubHref}>
          GitHub
        </Link>
      </nav>
    </header>
  );
}

/**
 * `Navbar / Minimal` — the survey and config builder chrome: the wordmark and one way out
 * ("Save & exit", "Start over"). Same states as the full navbar's links; no data states.
 */
export function NavbarMinimal({
  homeHref,
  exit,
  demo,
}: {
  readonly homeHref: string;
  readonly exit: {readonly label: ReactNode; readonly href: string};
  readonly demo?: InteractionState;
}): React.JSX.Element {
  return (
    <header className={styles.navbar} data-dbs-component="Navbar / Minimal">
      <div className={styles.bar}>
        <Link className={styles.home} to={homeHref}>
          <Wordmark />
        </Link>
        <Link className={styles.link} to={exit.href} {...demoAttributes(demo)}>
          {exit.label}
        </Link>
      </div>
    </header>
  );
}

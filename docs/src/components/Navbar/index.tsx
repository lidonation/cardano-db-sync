import React, {useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode} from 'react';

import clsx from 'clsx';

import Link from '@docusaurus/Link';
import {translate} from '@docusaurus/Translate';

import {atLeast} from '../../lib/breakpoints';

import KeyCap from '../KeyCap';
import Icon from '../shared/Icon';
import {VisuallyHidden} from '../shared/VisuallyHidden';
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
 * `Navbar / Full` — wordmark, the sections, the search trigger, GitHub and two slots for the
 * controls B30 builds. Below 1280px — the DF-7 md and sm tiers — the sections and the
 * `preferences` (locale, theme) move into a drawer behind a Menu button (NAV-2): collapsed by
 * default, keyboard-operable, its state announced by `aria-expanded`; opening it moves focus into
 * it, and Esc closes it and returns focus to the Menu button. `actions` (the version selector) stay
 * in the bar down to 768px and move into the drawer below it, where the search trigger becomes a
 * 44px icon button. The search trigger appears only once search exists to open (B31).
 * Every row is at least 44px (NAV-4). It renders route data known at build time, so it has no
 * loading, error or empty state; links have hover, pressed, focus and active (selected) states.
 */
export function NavbarFull({
  homeHref,
  links,
  githubHref,
  onSearch,
  actions,
  preferences,
  defaultMenuOpen = false,
  demo,
}: {
  readonly homeHref: string;
  readonly links: readonly NavLink[];
  /** The repository; without it there is no GitHub link. */
  readonly githubHref?: string;
  /** Opens search; without it there is no search trigger. */
  readonly onSearch?: () => void;
  /** In the bar down to 768px, in the drawer below (DF-7: the version selector). */
  readonly actions?: ReactNode;
  /** In the bar at 1280px and up, in the drawer below (DF-7: locale and theme). */
  readonly preferences?: ReactNode;
  /** Starts with the narrow-screen menu open, for the inventory. */
  readonly defaultMenuOpen?: boolean;
  /** Pins an interaction state on one link, for the inventory. */
  readonly demo?: LinkDemo;
}): React.JSX.Element {
  const menuId = useId();
  const [open, setOpen] = useState(defaultMenuOpen);
  const menuButton = useRef<HTMLButtonElement>(null);
  const home = useRef<HTMLAnchorElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const opened = useRef(false);
  const barActions = useRef<HTMLDivElement>(null);
  const drawerActions = useRef<HTMLDivElement>(null);
  // Keep the last focus target when CSS hides it before a media-query listener runs.
  const lastFocus = useRef<Element | null>(null);
  useEffect(() => {
    lastFocus.current = document.activeElement;
    const remember = (event: FocusEvent) => {
      lastFocus.current = event.target instanceof Element ? event.target : null;
    };
    const leaveControl = (event: PointerEvent) => {
      // Clicking page text intentionally leaves the control, even when focus falls back to body.
      if (
        event.target instanceof Node &&
        !barActions.current?.contains(event.target) &&
        !drawer.current?.contains(event.target) &&
        !menuButton.current?.contains(event.target)
      )
        lastFocus.current = null;
    };
    document.addEventListener('focusin', remember);
    document.addEventListener('pointerdown', leaveControl);
    return () => {
      document.removeEventListener('focusin', remember);
      document.removeEventListener('pointerdown', leaveControl);
    };
  }, []);
  useEffect(() => {
    const onBar = window.matchMedia(atLeast('sm'));
    const moveActionFocus = () => {
      const active = document.activeElement;
      const focused = active === document.body || active === null ? lastFocus.current : active;
      const source = onBar.matches ? drawerActions.current : barActions.current;
      if (!focused || !source?.contains(focused)) return;
      const target = onBar.matches ? barActions.current : drawerActions.current;
      // Match the control's position so a multi-control actions slot keeps its focus order.
      const controls = Array.from(source.querySelectorAll<HTMLElement>('a, button, select, input'));
      const index = controls.findIndex(
        (control) => control === focused || control.contains(focused),
      );
      const replacement = target?.querySelectorAll<HTMLElement>('a, button, select, input')[index];
      if (replacement?.getClientRects().length && !replacement.matches(':disabled')) {
        replacement.focus();
      } else {
        // The drawer stays collapsed until the user opens it.
        menuButton.current?.focus();
      }
    };
    onBar.addEventListener('change', moveActionFocus);
    return () => onBar.removeEventListener('change', moveActionFocus);
  }, []);
  // Opening moves focus into the drawer; the first open from the inventory's pinned state does not.
  useEffect(() => {
    if (open && opened.current) {
      Array.from(drawer.current?.querySelectorAll<HTMLElement>('a, button, select, input') ?? [])
        .find((element) => element.getClientRects().length > 0 && !element.matches(':disabled'))
        ?.focus();
    }
    opened.current = true;
  }, [open]);
  useEffect(() => {
    const wide = window.matchMedia(atLeast('lg'));
    const closeOnWide = () => {
      if (wide.matches && open) {
        // At 1280 the open drawer is hidden by CSS before this listener runs, and the browser may
        // already have dropped focus from inside it to <body>: that counts as focus in the drawer.
        const active = document.activeElement;
        const focused = active === null || active === document.body ? lastFocus.current : active;
        if (focused && (drawer.current?.contains(focused) || focused === menuButton.current))
          home.current?.focus();
        setOpen(false);
      }
    };
    closeOnWide();
    wide.addEventListener('change', closeOnWide);
    return () => wide.removeEventListener('change', closeOnWide);
  }, [open]);
  const onDrawerKey = (event: KeyboardEvent<HTMLElement>) => {
    // A nested menu gets first refusal: its Escape returns to its own trigger.
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      setOpen(false);
      menuButton.current?.focus();
    }
  };
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
    <header
      className={styles.navbar}
      data-dbs-component="Navbar / Full"
      onBlur={(event) => {
        // Close for a real move into the page. A null target can be CSS hiding a control
        // during a breakpoint change; the media listeners still need the open drawer to
        // hand focus to its replacement.
        if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget))
          setOpen(false);
      }}
    >
      <div className={styles.bar}>
        <Link ref={home} className={styles.home} to={homeHref}>
          <Wordmark />
        </Link>
        <nav className={styles.wide} aria-label={sections}>
          {linkList}
        </nav>
        <div className={styles.tools}>
          {onSearch && (
            <button type="button" className={styles.search} onClick={onSearch}>
              <KeyCap>⌘K</KeyCap>
              <span className={styles.searchText}>{searchLabel}</span>
              <Icon name="search" size={16} className={styles.searchIcon} />
              <span className={styles.searchName}>
                <VisuallyHidden>{searchLabel}</VisuallyHidden>
              </span>
            </button>
          )}
          {actions && (
            <div ref={barActions} className={styles.actions}>
              {actions}
            </div>
          )}
          {githubHref && (
            <Link className={styles.github} to={githubHref}>
              <Icon name="github" size={16} />
              <VisuallyHidden>GitHub</VisuallyHidden>
              <span className={styles.githubText} aria-hidden="true">
                GitHub
              </span>
            </Link>
          )}
          {preferences && <div className={styles.preferences}>{preferences}</div>}
          <button
            ref={menuButton}
            type="button"
            className={styles.menu}
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen(!open)}
          >
            <Icon name={open ? 'close' : 'menu'} size={16} />
            <VisuallyHidden>
              {translate({
                id: 'components.navbar.menu',
                message: 'Menu',
                description: 'Narrow-screen menu button',
              })}
            </VisuallyHidden>
            <span className={styles.menuText} aria-hidden="true">
              {translate({
                id: 'components.navbar.menu',
                message: 'Menu',
                description: 'Narrow-screen menu button',
              })}
            </span>
          </button>
        </div>
      </div>
      <nav
        ref={drawer}
        id={menuId}
        className={styles.drawer}
        aria-label={sections}
        hidden={!open}
        onKeyDown={onDrawerKey}
      >
        {linkList}
        {githubHref && (
          <Link className={clsx(styles.link, styles.drawerGithub)} to={githubHref}>
            GitHub
          </Link>
        )}
        {actions && (
          <div ref={drawerActions} className={styles.drawerActions}>
            {actions}
          </div>
        )}
        {preferences && <div className={styles.drawerPreferences}>{preferences}</div>}
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

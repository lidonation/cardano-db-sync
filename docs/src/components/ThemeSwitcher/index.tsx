import React, {useEffect, useId, useRef, useState} from 'react';

import {translate} from '@docusaurus/Translate';

import {
  PALETTES,
  PALETTE_LABELS,
  applyPalette,
  getStoredPalette,
  resolveInitialPalette,
  type Palette,
} from '../../lib/palette';

import {nextMenuIndex} from './keyboard';
import styles from './styles.module.css';

/**
 * `Theme switcher` (B30) — the four palettes as a menu button (THM-1, TOK-2, A11Y-29).
 *
 * One control, two attributes: choosing a palette writes `data-theme` (light/dark, for
 * Infima) and `data-dbs-palette` (light/dark/cream/navy, for our tokens) and persists
 * both, so cream renders on light Infima and navy on dark (§14.2). The button names the
 * current palette, and each option carries `aria-checked`, so the announced state is the
 * palette — never an ambiguous light/dark alone.
 *
 * Keyboard: Enter/Space/ArrowDown opens; ArrowUp/ArrowDown move and wrap; Home/End jump;
 * Escape closes and returns focus; Tab leaves and closes. Every row is 44px (DF-6/NAV-4)
 * with the global focus ring (FLOOR-4). The checkmark glyph pairs the colour cue (FLOOR-6).
 */
export default function ThemeSwitcher(): React.JSX.Element {
  const [palette, setPalette] = useState<Palette>('light');
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const menuId = useId();

  // Resolve after mount so server and client render the same default (no hydration
  // mismatch): the palette bootstrap already set the attributes before paint.
  useEffect(() => {
    const stored = getStoredPalette(window.localStorage);
    const current = document.documentElement.getAttribute('data-theme');
    setPalette(resolveInitialPalette(stored, current));
  }, []);

  useEffect(() => {
    if (open) {
      itemRefs.current[PALETTES.indexOf(palette)]?.focus();
      setFocusIndex(PALETTES.indexOf(palette));
    }
  }, [open, palette]);

  const label = translate({
    id: 'components.themeSwitcher.label',
    message: 'Theme',
    description: 'Label of the theme switcher menu button',
  });
  const currentName = PALETTE_LABELS[palette];
  const buttonName = translate(
    {
      id: 'components.themeSwitcher.button',
      message: 'Theme: {current}. Change theme',
      description: 'Accessible name of the theme switcher, naming the current palette',
    },
    {current: currentName},
  );

  const choose = (next: Palette) => {
    setPalette(next);
    applyPalette(next, document.documentElement, window.localStorage);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onButtonKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (event: React.KeyboardEvent, index: number) => {
    const next = nextMenuIndex(event.key, index, PALETTES.length);
    if (next !== null) {
      event.preventDefault();
      setFocusIndex(next);
      itemRefs.current[next]?.focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(PALETTES[index]);
    }
  };

  return (
    <div className={styles.switcher} data-dbs-component="Theme switcher">
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={buttonName}
        onClick={() => setOpen(!open)}
        onKeyDown={onButtonKeyDown}
      >
        <span aria-hidden="true" className={styles.dot} data-palette={palette} />
        <span className={styles.buttonText}>{label}</span>
        <span className={styles.current}>{currentName}</span>
      </button>
      {open && (
        <ul id={menuId} role="menu" className={styles.menu} aria-label={buttonName}>
          {PALETTES.map((name, index) => {
            const checked = name === palette;
            return (
              <li
                key={name}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={focusIndex === index ? 0 : -1}
                className={styles.option}
                data-checked={checked || undefined}
                onClick={() => choose(name)}
                onKeyDown={(event) => onMenuKeyDown(event, index)}
              >
                <span aria-hidden="true" className={styles.check}>
                  {checked ? '✓' : ''}
                </span>
                <span>{PALETTE_LABELS[name]}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

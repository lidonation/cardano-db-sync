import React, {useEffect, useId, useRef, useState} from 'react';

import {translate} from '@docusaurus/Translate';

import {
  PALETTES,
  applyPalette,
  getBrowserPaletteStorage,
  resolveEffectivePalette,
  getStoredPalette,
  paletteToTheme,
  PALETTE_STORAGE_KEY,
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
export default function ThemeSwitcher({
  onChangeTheme,
}: {
  readonly onChangeTheme?: (theme: 'light' | 'dark') => void;
}): React.JSX.Element {
  const [palette, setPalette] = useState<Palette>('light');
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const switcherRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const menuId = useId();

  // Read the effective attributes, including a query override. Observe the shared
  // document so the desktop, mobile and inventory instances announce one state.
  useEffect(() => {
    const root = document.documentElement;
    const storage = getBrowserPaletteStorage(window);
    const sync = () => {
      const current = resolveEffectivePalette(root, storage);
      const theme = root.getAttribute('data-theme');
      const next =
        paletteToTheme(current) === theme ? current : theme === 'dark' ? 'dark' : 'light';
      if (root.getAttribute('data-dbs-palette') !== next) {
        root.setAttribute('data-dbs-palette', next);
      }
      setPalette(next);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, {attributes: true, attributeFilter: ['data-theme', 'data-dbs-palette']});
    const onStorage = (event: StorageEvent) => {
      if (event.key !== PALETTE_STORAGE_KEY && event.key !== null) return;
      const next = getStoredPalette(storage);
      if (next) {
        onChangeTheme?.(paletteToTheme(next));
        applyPalette(next, root, storage);
      } else {
        root.setAttribute(
          'data-dbs-palette',
          root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
        );
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      observer.disconnect();
      window.removeEventListener('storage', onStorage);
    };
  }, [onChangeTheme]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (!switcherRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
    };
  }, [open]);

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
  const names: Record<Palette, string> = {
    light: translate({
      id: 'components.themeSwitcher.light',
      message: 'Light',
      description: 'Light palette name',
    }),
    dark: translate({
      id: 'components.themeSwitcher.dark',
      message: 'Dark',
      description: 'Dark palette name',
    }),
    cream: translate({
      id: 'components.themeSwitcher.cream',
      message: 'Cream',
      description: 'Cream palette name',
    }),
    navy: translate({
      id: 'components.themeSwitcher.navy',
      message: 'Navy',
      description: 'Navy palette name',
    }),
  };
  const currentName = names[palette];
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
    onChangeTheme?.(paletteToTheme(next));
    applyPalette(next, document.documentElement, getBrowserPaletteStorage(window));
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
      // Keep the browser's forward Tab order anchored to a node that survives closing.
      buttonRef.current?.focus();
      if (event.shiftKey) event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(PALETTES[index]);
    }
  };

  return (
    <div ref={switcherRef} className={styles.switcher} data-dbs-component="Theme switcher">
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={buttonName}
        onClick={() => setOpen(!open)}
        onKeyDown={onButtonKeyDown}
      >
        <span className={styles.buttonText}>{label}</span>
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
                <span>{names[name]}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

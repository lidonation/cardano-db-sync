import React, {useEffect, useState} from 'react';

import Head from '@docusaurus/Head';

import {INVENTORY, codeName, shownStates} from '../components/inventory';

import {RENDER} from './renderers';
import styles from './styles.module.css';

import {PALETTES, paletteToTheme} from '../lib/palette';

/** Definitions drawn at full page width in the design. */
const WIDE = new Set(['Navbar / Full', 'Navbar / Minimal', 'Section / Divider', 'Footer / Navy']);

/**
 * The component inventory (B29) — every definition in every state it ships, on one page, for the
 * browser suite (`test/browser`) and for review. It is a development tool, not part of the site:
 * the `inventory` plugin adds its route only under `docusaurus start` with `DBS_INVENTORY=1`, and
 * refuses a production build, so it never enters the route manifest (VER-5) or a deploy.
 *
 * The palette buttons set both attributes the way B30's switcher does (`data-theme` for
 * Infima, `data-dbs-palette` for our tokens); the browser suite sets them directly.
 */
export default function InventoryPage(): React.JSX.Element {
  const [palette, setPalette] = useState<(typeof PALETTES)[number]>();
  useEffect(() => {
    if (palette) {
      // Both attributes, like the switcher (THM-1): the Infima family and the palette.
      document.documentElement.setAttribute('data-theme', paletteToTheme(palette));
      document.documentElement.setAttribute('data-dbs-palette', palette);
    }
  }, [palette]);
  return (
    <main id="inventory" className={styles.page}>
      <Head>
        <title>Component inventory</title>
        <meta name="robots" content="noindex" />
      </Head>
      <h1 className={styles.title}>Component inventory</h1>
      <p className={styles.intro}>
        {INVENTORY.length} definitions, every state each one ships. Palette:{' '}
        {PALETTES.map((name) => (
          <button
            key={name}
            type="button"
            className={styles.palette}
            aria-pressed={palette === name}
            onClick={() => setPalette(name)}
          >
            {name}
          </button>
        ))}
      </p>
      {INVENTORY.map((entry) => {
        const render = RENDER[entry.design];
        return (
          <section
            key={entry.design}
            className={styles.entry}
            data-inventory-entry={entry.design}
            aria-label={entry.design}
          >
            <h2 className={styles.name}>
              {codeName(entry)}
              {codeName(entry) !== entry.design && (
                <span className={styles.was}> (design: {entry.design})</span>
              )}
            </h2>
            <p className={styles.usage}>
              <code>{entry.usage}</code>
              {entry.invariant && <span className={styles.was}> · theme-invariant (THM-6)</span>}
            </p>
            <div className={WIDE.has(entry.design) ? styles.wide : styles.grid}>
              {shownStates(entry).map((state) => (
                <div key={state} className={styles.cell} data-inventory-state={state}>
                  <span className={styles.state}>{state}</span>
                  {render(state, `${entry.design}-${state}`.replace(/[^a-z0-9]+/gi, '-'))}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}

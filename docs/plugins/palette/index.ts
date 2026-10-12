import type {LoadContext, Plugin} from '@docusaurus/types';

import {PALETTE_BOOTSTRAP} from '../../src/lib/palette';

/**
 * THM-1 — the palette bootstrap, inline before paint.
 *
 * Docusaurus' own theme script restores `data-theme` (light/dark) from its `theme`
 * key. This second inline script runs after it, in `preBodyTags`, and restores
 * `data-dbs-palette` (light/dark/cream/navy): the stored palette wins and repairs
 * both attributes, otherwise the palette follows the theme Docusaurus just set.
 * Both run before first paint, so a returning visitor never flashes the wrong
 * family. The SEC-3 gate hashes this script from the exact bytes each page ships,
 * like Docusaurus' own bootstrap.
 */
export function paletteTags() {
  return {
    preBodyTags: [
      {
        tagName: 'script',
        attributes: {type: 'text/javascript'},
        innerHTML: PALETTE_BOOTSTRAP,
      },
    ],
  };
}

export default function palettePlugin(_context: LoadContext): Plugin {
  return {
    name: 'dbsync-palette',
    injectHtmlTags: paletteTags,
  };
}

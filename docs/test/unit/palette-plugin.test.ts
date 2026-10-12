import {createRequire} from 'node:module';

import {describe, expect, it} from 'vitest';

import palettePlugin, {paletteTags} from '../../plugins/palette';
import {PALETTE_BOOTSTRAP} from '../../src/lib/palette';

describe('palette plugin (THM-1)', () => {
  it('is named and injects exactly the palette bootstrap after the framework bootstrap before paint', () => {
    expect(palettePlugin({} as never).name).toBe('dbsync-palette');
    const tags = paletteTags();
    expect(tags.preBodyTags).toHaveLength(1);
    expect(tags.preBodyTags[0].tagName).toBe('script');
    expect(tags.preBodyTags[0].innerHTML).toBe(PALETTE_BOOTSTRAP);
  });

  it('exposes the injection through the plugin hook', () => {
    const plugin = palettePlugin({} as never);
    expect(plugin.injectHtmlTags).toBe(paletteTags);
  });
});

const require = createRequire(import.meta.url);
const {getThemeInlineScript} = require('@docusaurus/theme-classic/lib/inlineScripts');
const {minify} = require('html-minifier-terser');

describe('framework and palette bootstrap integration', () => {
  it('keeps the exact allowlisted palette bytes after HTML minification', async () => {
    const html = `<script>${PALETTE_BOOTSTRAP}</script>`;
    expect(await minify(html, {minifyJS: true})).toBe(html);
  });

  it('bootstraps a system palette when access to storage itself is denied', () => {
    const browser = Object.defineProperty(
      {
        location: {search: ''},
        matchMedia: () => ({matches: true}),
      },
      'localStorage',
      {
        get() {
          throw new Error('SecurityError');
        },
      },
    );
    const attrs = new Map<string, string>();
    new Function('window', 'document', PALETTE_BOOTSTRAP)(browser, {
      documentElement: {setAttribute: (name: string, value: string) => attrs.set(name, value)},
    });
    expect(attrs.get('data-theme')).toBe('dark');
    expect(attrs.get('data-dbs-palette')).toBe('dark');
    expect(attrs.get('data-theme-choice')).toBe('system');
  });

  it('repairs framework attributes after its bootstrap for stored and query palettes', () => {
    const framework = getThemeInlineScript({
      colorMode: {disableSwitch: false, defaultMode: 'light', respectPrefersColorScheme: true},
      siteStorage: {type: 'localStorage', namespace: ''},
    });
    const run = new Function('window', 'document', `${framework};${PALETTE_BOOTSTRAP}`);
    for (const [stored, query, expected, expectedTheme] of [
      ['navy', '', 'navy', 'dark'],
      ['cream', '', 'cream', 'light'],
      ['cream', 'navy', 'navy', 'dark'],
      ['navy', 'cream', 'cream', 'light'],
      ['cream', 'dark', 'dark', 'dark'],
      ['navy', 'light', 'light', 'light'],
      ['constructor', 'toString', 'light', 'light'],
    ]) {
      const attrs = new Map<string, string>();
      run(
        {
          localStorage: {getItem: (key: string) => (key === 'dbs-palette' ? stored : 'light')},
          location: {search: query ? `?docusaurus-theme=${query}` : ''},
          matchMedia: () => ({matches: false}),
        },
        {documentElement: {setAttribute: (name: string, value: string) => attrs.set(name, value)}},
      );
      expect(attrs.get('data-dbs-palette')).toBe(expected);
      expect(attrs.get('data-theme')).toBe(expectedTheme);
      expect(attrs.get('data-theme-choice')).toBe(expectedTheme);
    }
  });
});

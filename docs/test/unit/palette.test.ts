import {describe, expect, it} from 'vitest';

import {
  PALETTES,
  PALETTE_BOOTSTRAP,
  PALETTE_LABELS,
  PALETTE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  applyPalette,
  attributesFor,
  getStoredPalette,
  getBrowserPaletteStorage,
  resolveEffectivePalette,
  isPalette,
  paletteToTheme,
  resolveInitialPalette,
} from '../../src/lib/palette';

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

function fakeDocument(initial: Record<string, string> = {}) {
  const attrs = new Map(Object.entries(initial));
  return {
    attrs,
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, value: string) => {
      attrs.set(name, value);
    },
  };
}

describe('palettes (THM-1, TOK-2)', () => {
  it('offers exactly the four palettes, each labelled', () => {
    expect([...PALETTES]).toEqual(['light', 'dark', 'cream', 'navy']);
    for (const palette of PALETTES) {
      expect(PALETTE_LABELS[palette]).toMatch(/\S/);
    }
  });

  it('maps cream to light Infima and navy to dark Infima (§14.2)', () => {
    expect(paletteToTheme('light')).toBe('light');
    expect(paletteToTheme('cream')).toBe('light');
    expect(paletteToTheme('dark')).toBe('dark');
    expect(paletteToTheme('navy')).toBe('dark');
  });

  it('exposes both attributes per palette', () => {
    expect(attributesFor('cream')).toEqual({theme: 'light', palette: 'cream'});
    expect(attributesFor('navy')).toEqual({theme: 'dark', palette: 'navy'});
  });

  it('accepts only the four names', () => {
    expect(isPalette('cream')).toBe(true);
    for (const bad of ['', 'LIGHT', 'sepia', 'dark ', null, undefined, 42]) {
      expect(isPalette(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('persistence (TOK-2)', () => {
  it('reads the stored palette, ignoring corrupt values and throwing storage', () => {
    expect(getStoredPalette(fakeStorage({'dbs-palette': 'navy'}))).toBe('navy');
    expect(getStoredPalette(fakeStorage({'dbs-palette': 'sepia'}))).toBeUndefined();
    expect(getStoredPalette(fakeStorage())).toBeUndefined();
    expect(
      getStoredPalette({
        getItem: () => {
          throw new Error('private mode');
        },
      }),
    ).toBeUndefined();
    expect(PALETTE_STORAGE_KEY).toBe('dbs-palette');
    expect(THEME_STORAGE_KEY).toBe('theme');
  });

  it('writes both attributes and persists both keys', () => {
    const doc = fakeDocument();
    const storage = fakeStorage();
    applyPalette('navy', doc, storage);
    expect(doc.attrs.get('data-theme')).toBe('dark');
    expect(doc.attrs.get('data-dbs-palette')).toBe('navy');
    expect(doc.attrs.get('data-theme-choice')).toBe('dark');
    expect(storage.store.get('dbs-palette')).toBe('navy');
    expect(storage.store.get('theme')).toBe('dark');
  });

  it('writes the light family for cream', () => {
    const doc = fakeDocument();
    const storage = fakeStorage();
    applyPalette('cream', doc, storage);
    expect(doc.attrs.get('data-theme')).toBe('light');
    expect(doc.attrs.get('data-dbs-palette')).toBe('cream');
    expect(storage.store.get('theme')).toBe('light');
  });

  it('still applies the attributes when storage throws', () => {
    const doc = fakeDocument();
    applyPalette('dark', doc, {
      setItem: () => {
        throw new Error('private mode');
      },
    });
    expect(doc.attrs.get('data-theme')).toBe('dark');
    expect(doc.attrs.get('data-dbs-palette')).toBe('dark');
  });
});

describe('initial palette (no flash of wrong theme)', () => {
  it('prefers the stored palette over the document theme', () => {
    expect(resolveInitialPalette('cream', 'dark')).toBe('cream');
    expect(resolveInitialPalette('navy', 'light')).toBe('navy');
  });

  it('follows the document theme without a stored palette, defaulting to light', () => {
    expect(resolveInitialPalette(undefined, 'dark')).toBe('dark');
    expect(resolveInitialPalette(undefined, 'light')).toBe('light');
    expect(resolveInitialPalette(undefined, null)).toBe('light');
    expect(resolveInitialPalette(undefined, 'cream')).toBe('light');
  });
});

describe('palette bootstrap (SEC-3)', () => {
  it('is a single inline script the CSP gate recognises as a colour-mode bootstrap', () => {
    expect(PALETTE_BOOTSTRAP).not.toContain('\n');
    expect(PALETTE_BOOTSTRAP).toContain('dbs-palette');
    expect(PALETTE_BOOTSTRAP).toContain('data-dbs-palette');
    expect(PALETTE_BOOTSTRAP).toContain('data-theme');
    expect(PALETTE_BOOTSTRAP).toContain('localStorage.getItem("dbs-palette")');
  });

  function runBootstrap({
    palette,
    theme,
    search = '',
    systemDark = false,
  }: {
    palette?: string;
    theme?: string;
    search?: string;
    systemDark?: boolean;
  }) {
    const run = new Function(
      'window',
      'document',
      `${PALETTE_BOOTSTRAP};return {palette: document.documentElement.getAttribute("data-dbs-palette"),` +
        ` theme: document.documentElement.getAttribute("data-theme")}`,
    ) as (window: unknown, document: unknown) => {palette: string | null; theme: string | null};
    const doc = fakeDocument();
    const store: Record<string, string> = {};
    if (palette !== undefined) store['dbs-palette'] = palette;
    if (theme !== undefined) store['theme'] = theme;
    const window = {
      localStorage: fakeStorage(store),
      location: {search},
      matchMedia: () => ({matches: systemDark}),
    };
    return run(window, {documentElement: doc});
  }

  it('restores a stored palette over any stored theme', () => {
    expect(runBootstrap({palette: 'navy', theme: 'light'})).toEqual({
      palette: 'navy',
      theme: 'dark',
    });
    expect(runBootstrap({palette: 'cream'})).toEqual({palette: 'cream', theme: 'light'});
  });

  it('follows the stored theme or the OS without a stored palette', () => {
    expect(runBootstrap({theme: 'dark'})).toEqual({palette: 'dark', theme: 'dark'});
    expect(runBootstrap({})).toEqual({palette: 'light', theme: 'light'});
    expect(runBootstrap({systemDark: true})).toEqual({palette: 'dark', theme: 'dark'});
  });

  it('honours each valid query override over storage', () => {
    for (const palette of PALETTES) {
      expect(
        runBootstrap({palette: 'cream', theme: 'light', search: `?docusaurus-theme=${palette}`}),
      ).toEqual({palette, theme: paletteToTheme(palette)});
    }
  });

  it('rejects inherited object property names in query and storage', () => {
    for (const bad of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(runBootstrap({palette: bad, search: `?docusaurus-theme=${bad}`})).toEqual({
        palette: 'light',
        theme: 'light',
      });
    }
  });

  it('ignores a corrupt stored value', () => {
    expect(runBootstrap({palette: 'sepia'})).toEqual({palette: 'light', theme: 'light'});
  });
});

describe('effective palette and unavailable browser storage', () => {
  it('guards a denied localStorage getter and supplies no-op storage', () => {
    const browser = Object.defineProperty({}, 'localStorage', {
      get() {
        throw new Error('SecurityError');
      },
    }) as Window;
    const storage = getBrowserPaletteStorage(browser);
    expect(storage.getItem('dbs-palette')).toBeNull();
    expect(() => storage.setItem('dbs-palette', 'navy')).not.toThrow();
    const doc = fakeDocument();
    applyPalette('navy', doc, storage);
    expect(doc.attrs.get('data-dbs-palette')).toBe('navy');
  });

  it('prefers the effective query-selected palette over storage', () => {
    expect(
      resolveEffectivePalette(
        fakeDocument({'data-dbs-palette': 'navy', 'data-theme': 'dark'}),
        fakeStorage({'dbs-palette': 'cream'}),
      ),
    ).toBe('navy');
    expect(
      resolveEffectivePalette(
        fakeDocument({'data-dbs-palette': 'bad', 'data-theme': 'dark'}),
        fakeStorage(),
      ),
    ).toBe('dark');
  });
});

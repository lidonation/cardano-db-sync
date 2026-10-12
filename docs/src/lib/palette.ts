/**
 * The four colour palettes (THM-1, TOK-2).
 *
 * `data-theme` ∈ {light, dark} drives Infima alone; `data-dbs-palette` ∈
 * {light, dark, cream, navy} drives our tokens (§14.2). Cream renders on light
 * Infima and navy on dark Infima, so a dark palette never gets light
 * Docusaurus-owned surfaces. The switcher writes and persists both attributes;
 * this module is the browser-free half (mapping, storage, bootstrap script).
 * The React hook lives with the switcher and is audited in a browser.
 */

/** Every palette the switcher offers, in menu order. */
export const PALETTES = ['light', 'dark', 'cream', 'navy'] as const;

export type Palette = (typeof PALETTES)[number];

/** The Infima theme each palette renders on. */
export type InfimaTheme = 'light' | 'dark';

/** Accessible label per palette, announced by the switcher (A11Y-29). */
export const PALETTE_LABELS: Readonly<Record<Palette, string>> = Object.freeze({
  light: 'Light',
  dark: 'Dark',
  cream: 'Cream',
  navy: 'Navy',
});

/** `localStorage` key the palette persists under. Docusaurus keeps `theme`. */
export const PALETTE_STORAGE_KEY = 'dbs-palette';

/** The Docusaurus theme key, whose bootstrap restores `data-theme` before paint. */
export const THEME_STORAGE_KEY = 'theme';

/** True for exactly the four palette names. Anything else falls back to light/dark. */
export function isPalette(value: unknown): value is Palette {
  return value === 'light' || value === 'dark' || value === 'cream' || value === 'navy';
}

/**
 * The Infima theme a palette needs: cream is a light palette, navy a dark one.
 * This mapping is what keeps `data-theme` from fighting the framework (TOK-2, §14.2).
 */
export function paletteToTheme(palette: Palette): InfimaTheme {
  return palette === 'dark' || palette === 'navy' ? 'dark' : 'light';
}

/** Both attributes the switcher writes for a palette (THM-1). */
export function attributesFor(palette: Palette): {
  readonly theme: InfimaTheme;
  readonly palette: Palette;
} {
  return {theme: paletteToTheme(palette), palette};
}

/** Minimal storage surface, so tests can pass a fake. */
export interface PaletteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Minimal document surface the switcher writes to, so tests can pass a fake. */
export interface PaletteDocument {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

/**
 * The persisted palette, or undefined when nothing valid was stored. Never throws:
 * private-mode storage reads throw, and a corrupt value is not a palette.
 */
export function getStoredPalette(storage: Pick<PaletteStorage, 'getItem'>): Palette | undefined {
  try {
    const raw = storage.getItem(PALETTE_STORAGE_KEY);
    return isPalette(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Apply a palette: set both attributes and persist both keys. The mapped theme goes
 * into Docusaurus' own key so its bootstrap restores the right Infima family before
 * paint even before the palette bootstrap runs. Never throws (private mode).
 */
export function applyPalette(
  palette: Palette,
  documentElement: Pick<PaletteDocument, 'setAttribute'>,
  storage: Pick<PaletteStorage, 'setItem'>,
): void {
  const {theme} = attributesFor(palette);
  try {
    documentElement.setAttribute('data-theme', theme);
    documentElement.setAttribute('data-dbs-palette', palette);
    documentElement.setAttribute('data-theme-choice', theme);
    storage.setItem(PALETTE_STORAGE_KEY, palette);
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // A palette that cannot persist still applies for this page view.
    try {
      documentElement.setAttribute('data-theme', theme);
      documentElement.setAttribute('data-dbs-palette', palette);
    } catch {
      // No DOM (unit tests importing the module) — nothing to set.
    }
  }
}

/**
 * The palette a fresh visit starts on: the stored one when valid, otherwise the
 * Infima theme already on the document (which the Docusaurus bootstrap set from its
 * own key or the OS preference), mapped to its palette. Cream and navy are only ever
 * chosen explicitly; the system only ever yields light or dark.
 */
export function resolveInitialPalette(
  stored: Palette | undefined,
  currentTheme: string | null,
): Palette {
  if (stored !== undefined) {
    return stored;
  }
  return currentTheme === 'dark' ? 'dark' : 'light';
}

/**
 * The inline bootstrap that runs before paint (injected by the palette plugin into
 * `<head>` alongside Docusaurus' own theme script). It is self-contained — it reads the
 * query string, both storage keys and the OS preference itself — so it sets the right
 * pair no matter which of the two scripts runs first. Stored palette wins and repairs
 * all three attributes; otherwise the palette follows the resolved Infima theme, so a
 * new visitor never flashes the wrong family. Contains `dbs-palette`,
 * `data-dbs-palette` and `data-theme` so the SEC-3 gate recognises it as a
 * colour-mode bootstrap alongside Docusaurus'.
 */
export const PALETTE_BOOTSTRAP =
  '(function(){try{var p=null,t=null,q=null;try{p=window.localStorage.getItem("dbs-palette")}catch(e){}' +
  'try{t=window.localStorage.getItem("theme")}catch(e){}' +
  'try{q=new URLSearchParams(window.location.search).get("docusaurus-theme")}catch(e){}' +
  'var v={light:1,dark:1,cream:1,navy:1};' +
  'if(q&&v[q]){p=q}' +
  'if(p&&v[p]){var m=(p==="dark"||p==="navy")?"dark":"light";' +
  'document.documentElement.setAttribute("data-theme",m);' +
  'document.documentElement.setAttribute("data-dbs-palette",p);' +
  'document.documentElement.setAttribute("data-theme-choice",m)}' +
  'else{var s=(t==="dark"||t==="light")?t:((window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light");' +
  'var c=(t==="dark"||t==="light")?t:"system";' +
  'document.documentElement.setAttribute("data-theme",s);' +
  'document.documentElement.setAttribute("data-dbs-palette",s);' +
  'document.documentElement.setAttribute("data-theme-choice",c)}}catch(e){}})();';

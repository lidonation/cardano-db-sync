import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {LoadContext, Plugin} from '@docusaurus/types';

/** The webpack config Docusaurus hands `configureWebpack`. */
type Configuration = Parameters<NonNullable<Plugin['configureWebpack']>>[0];

/**
 * SEC-1..SEC-3, SEC-8 — the Content-Security-Policy every page carries.
 *
 * SEC-1: GitHub Pages sets no headers, so the policy is a `<meta http-equiv>` in each page. That
 * form ignores `frame-ancestors`, `sandbox` and `report-uri`/`report-to` and cannot be report-only,
 * so none of them appear here: there is no clickjacking protection on this host, by decision.
 *
 * SEC-2: every asset is same-origin, fonts included, which is what lets the policy be this strict.
 *
 * SEC-3: the only inline script is Docusaurus' colour-mode bootstrap. It is hashed after the
 * build, from the exact bytes each page ships; nonces need a server and static hosting has none.
 * Any other inline script fails the build.
 *
 * SEC-8: the policy is chosen per route. Every route gets the strict policy; only the survey route
 * may ever carry the extension-scheme allowance a wallet might need (SEC-7), and only once that
 * allowance is granted below. Nothing else can loosen it.
 */

export type Directives = Readonly<Record<string, readonly string[]>>;

/** SEC-2's policy, verbatim. */
export const STRICT_DIRECTIVES: Directives = Object.freeze({
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
});

/** The one route that may carry a relaxed policy (SEC-8), relative to `baseUrl`. */
export const SURVEY_ROUTE = '/survey';

/** The only sources a survey relaxation may add to `script-src` (SEC-8). */
export const EXTENSION_SCHEMES: readonly string[] = ['chrome-extension:', 'moz-extension:'];

/**
 * Extension schemes granted to the survey route's `script-src`. Empty until SEC-7's per-wallet
 * check shows a supported wallet injects through a page-context script load. Adding one is a
 * decision recorded against SEC-7, not a fix for a console error.
 */
export const SURVEY_SCRIPT_RELAXATION: readonly string[] = [];

/** Directives a meta-delivered policy ignores (SEC-1). Writing one would only pretend. */
const META_IGNORED = ['frame-ancestors', 'sandbox', 'report-uri', 'report-to'];

export function isSurveyRoute(route: string): boolean {
  return route === SURVEY_ROUTE || route.startsWith(`${SURVEY_ROUTE}/`);
}

export interface PolicyOptions {
  /** `'sha256-…'` sources for the page's inline scripts. */
  readonly scriptHashes?: readonly string[];
  /** Override for {@link SURVEY_SCRIPT_RELAXATION}; tests only. */
  readonly surveyRelaxation?: readonly string[];
}

/** The policy for a route (`/`, `/docs/intro`, …, relative to `baseUrl`). */
export function policyFor(route: string, options: PolicyOptions = {}): Directives {
  const relaxation = options.surveyRelaxation ?? SURVEY_SCRIPT_RELAXATION;
  for (const source of relaxation) {
    if (!EXTENSION_SCHEMES.includes(source)) {
      throw new Error(
        `SEC-8: "${source}" is not an extension scheme. The survey route may only add ` +
          `${EXTENSION_SCHEMES.join(' or ')} to script-src.`,
      );
    }
  }
  const scriptSrc = [
    ...STRICT_DIRECTIVES['script-src'],
    ...(options.scriptHashes ?? []),
    ...(isSurveyRoute(route) ? relaxation : []),
  ];
  return {...STRICT_DIRECTIVES, 'script-src': scriptSrc};
}

export function serializePolicy(directives: Directives): string {
  for (const name of Object.keys(directives)) {
    if (META_IGNORED.includes(name)) {
      throw new Error(`SEC-1: ${name} is ignored in a <meta> policy and must not be written.`);
    }
  }
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

export function cspMetaTag(directives: Directives): string {
  return `<meta http-equiv="Content-Security-Policy" content="${serializePolicy(directives)}">`;
}

/** CSP source for a script body: `'sha256-<base64>'` of its exact UTF-8 bytes. */
export function hashSource(code: string): string {
  return `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`;
}

/** Script types a browser executes. Anything else (`application/ld+json`) is a data block. */
const EXECUTABLE_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module']);

/** Inline scripts a browser would execute, with their exact bodies. */
export function inlineScripts(html: string): string[] {
  const scripts: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1];
    if (/\ssrc\s*=/i.test(attrs)) {
      continue;
    }
    const type = /\stype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1].toLowerCase() ?? '';
    if (EXECUTABLE_TYPES.has(type)) {
      scripts.push(match[2]);
    }
  }
  return scripts;
}

/** Docusaurus' colour-mode bootstrap: reads the stored theme and sets `data-theme` before paint. */
export function isColourModeBootstrap(code: string): boolean {
  return code.includes('localStorage.getItem("theme")') && code.includes('"data-theme"');
}

/**
 * Docusaurus' icon sprite hides itself with an inline style, which `style-src 'self'` refuses
 * (and logs). custom.css hides it instead, so the attribute is dropped.
 */
const SPRITE_STYLE = /<svg style="display: none;">(?=<defs>)/;

/**
 * Put the route's policy into a built page, first in `<head>` after the charset, so it governs
 * every script and stylesheet that follows. Throws on any inline script but the bootstrap (SEC-3)
 * and on a page that already carries a policy. Also drops the icon sprite's inline style.
 */
export function applyPolicy(html: string, route: string, file: string): string {
  if (/http-equiv=["']?Content-Security-Policy/i.test(html)) {
    throw new Error(`${file}: already carries a Content-Security-Policy.`);
  }
  const scripts = inlineScripts(html);
  const stray = scripts.filter((code) => !isColourModeBootstrap(code));
  if (stray.length > 0) {
    throw new Error(
      `SEC-3: ${file} has ${stray.length} inline script(s) besides the colour-mode bootstrap. ` +
        `Ship it as a same-origin file instead: ${stray[0].slice(0, 80)}…`,
    );
  }
  const tag = cspMetaTag(policyFor(route, {scriptHashes: [...new Set(scripts.map(hashSource))]}));
  const charset = /<meta charset=["']?utf-8["']?\s*\/?>/i.exec(html);
  if (!charset) {
    throw new Error(`${file}: no <meta charset> to place the policy after.`);
  }
  const at = charset.index + charset[0].length;
  return `${html.slice(0, at)}\n${tag}${html.slice(at)}`.replace(
    SPRITE_STYLE,
    '<svg aria-hidden="true">',
  );
}

/** Where Docusaurus wrote a route (`<baseUrl>docs/intro` → `docs/intro/index.html`). */
export function routeFile(route: string, baseUrl: string): {route: string; file: string} | null {
  if (!route.startsWith(baseUrl)) {
    return null;
  }
  const rest = route.slice(baseUrl.length).replace(/\/+$/, '');
  if (rest.endsWith('.html')) {
    return {route: `/${rest}`, file: rest};
  }
  return {route: `/${rest}`, file: rest === '' ? 'index.html' : `${rest}/index.html`};
}

/** Apply the policy to every page Docusaurus rendered. Redirect stubs carry their own. */
export async function applyPolicies(
  outDir: string,
  routesPaths: readonly string[],
  baseUrl: string,
): Promise<string[]> {
  const pages = new Map<string, string>();
  for (const routePath of routesPaths) {
    const page = routeFile(routePath, baseUrl);
    if (page !== null) {
      pages.set(page.file, page.route);
    }
  }
  for (const [file, route] of pages) {
    const full = path.join(outDir, file);
    await fs.writeFile(full, applyPolicy(await fs.readFile(full, 'utf8'), route, file), 'utf8');
  }
  return [...pages.keys()].sort();
}

/** Matches Docusaurus' font rule (`/\.(?:woff2?|eot|ttf|otf)$/i`). */
const FONT_FILE = 'font.woff2';

/**
 * SEC-2: `font-src 'self'` allows no `data:` URIs, but Docusaurus' url-loader inlines any font
 * under 10 KB as one, and the browser then refuses it. Turn inlining off for fonts so every font
 * ships as a same-origin file. Returns how many font loaders it changed; zero means Docusaurus
 * changed its rule and this needs revisiting, so the build fails rather than shipping blocked fonts.
 */
export function emitFontsAsFiles(config: Configuration): number {
  let changed = 0;
  for (const rule of config.module?.rules ?? []) {
    const r = rule as {test?: unknown; use?: unknown};
    if (!(r.test instanceof RegExp) || !r.test.test(FONT_FILE)) {
      continue;
    }
    for (const use of Array.isArray(r.use) ? r.use : []) {
      const loader = use as {loader?: string; options?: Record<string, unknown>};
      if (loader.loader?.includes('url-loader') && loader.options) {
        loader.options.limit = false;
        changed += 1;
      }
    }
  }
  if (changed === 0) {
    throw new Error('SEC-2: no font url-loader found to stop inlining fonts as data: URIs.');
  }
  return changed;
}

export default function securityPlugin(context: LoadContext): Plugin {
  return {
    name: 'dbsync-security',
    configureWebpack(config) {
      emitFontsAsFiles(config);
      return {};
    },
    async postBuild({outDir, routesPaths}) {
      // The locale's base, so routes are locale-relative and `/survey` is the survey in every locale.
      await applyPolicies(outDir, routesPaths, context.baseUrl);
    },
  };
}

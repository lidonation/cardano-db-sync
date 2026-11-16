import fs from 'node:fs/promises';
import path from 'node:path';

import type {HtmlTagObject, LoadContext, Plugin} from '@docusaurus/types';

import {isRootBuild, localesDefaultFirst} from '../../config/i18n';
import {resolveProfile, type BuildProfile} from '../../config/profiles';

/** The webpack config Docusaurus hands `configureWebpack`. */
type Configuration = Parameters<NonNullable<Plugin['configureWebpack']>>[0];

/**
 * ENV-3 — a non-production build serves `noindex` on every page and never blocks crawling.
 *
 * The two halves are one rule. A crawler only reads `noindex` on a page it is allowed to fetch;
 * a `robots.txt` that disallows the preview hides the directive and leaves the URLs free to be
 * indexed from links elsewhere. So the preview is crawlable and says `noindex`; production is
 * crawlable and says nothing.
 *
 * Docusaurus' own `noIndex` option is not used: it also adds `nofollow`, and it is site-wide
 * config rather than a profile value.
 */

export const ROBOTS_FILE = 'robots.txt';

/** The `noindex` directive every non-production page carries. */
export const NOINDEX_META: HtmlTagObject = {
  tagName: 'meta',
  attributes: {name: 'robots', content: 'noindex'},
};

/** {@link NOINDEX_META} as markup, for pages the build writes by hand (B04 redirect stubs). */
export const NOINDEX_HTML = '<meta name="robots" content="noindex">';

/** Head tags for every page: `noindex` when the profile may not be indexed, otherwise none. */
export function environmentHeadTags(profile: BuildProfile): HtmlTagObject[] {
  return profile.indexable ? [] : [NOINDEX_META];
}

/**
 * `robots.txt` for the build: crawling allowed for every agent under every profile. An indexable
 * build also points at its sitemaps, one per locale: the default locale's at the base, each other
 * locale's under its own prefix. The file is written by the build, so a `robots.txt` that reaches
 * `static/` cannot add a `Disallow`. (Under a subpath crawlers read the host's root `robots.txt`,
 * not this one; the `noindex` meta is what holds there.)
 *
 * @param locales The site's locales, default first.
 */
export function robotsTxt(profile: BuildProfile, locales: readonly string[] = ['en']): string {
  const lines = ['User-agent: *', 'Allow: /'];
  if (profile.indexable) {
    lines.push('');
    locales.forEach((locale, i) => {
      lines.push(
        `Sitemap: ${profile.url}${profile.baseUrl}${i === 0 ? '' : `${locale}/`}sitemap.xml`,
      );
    });
  }
  return `${lines.join('\n')}\n`;
}

export async function emitRobots(
  outDir: string,
  profile: BuildProfile,
  locales?: readonly string[],
): Promise<void> {
  await fs.writeFile(path.join(outDir, ROBOTS_FILE), robotsTxt(profile, locales), 'utf8');
}

/** Set by `npm run start:all-locales` on every per-locale `docusaurus start` it runs. */
export const ALL_LOCALES_ENV_VAR = 'DOCS_DEV_ALL_LOCALES';

/**
 * ENV-1: Docusaurus names webpack's filesystem cache by bundle, mode and locale only, and the
 * profile comes from the environment rather than the config file, so a dev build followed by a
 * prod build reused dev's compiled CSS, its subpath asset URLs included. Each profile gets
 * a cache of its own.
 */
export function cacheByProfile(
  config: Configuration,
  profile: BuildProfile,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (config.cache && typeof config.cache === 'object' && config.cache.type === 'filesystem') {
    // The all-locales runner's servers read their own generated files, and may run beside a
    // plain `npm start`; they must not share (or race on) its cache.
    const runner = env[ALL_LOCALES_ENV_VAR] === '1' ? '-all-locales' : '';
    config.cache.name = `${config.cache.name ?? 'default'}-${profile.name}${runner}`;
  }
}

/**
 * `npm run start:all-locales` serves one dev server per locale behind a single origin. Each
 * server's hot-reload socket defaults to `/ws`, which the shared origin cannot tell apart, so
 * under that runner the socket moves under the locale's own base URL (`/ja/ws`), where the proxy
 * routes it like any other page of that locale. A plain `npm start` keeps the stock socket.
 */
export function localeDevSocket(
  baseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Configuration {
  if (env[ALL_LOCALES_ENV_VAR] !== '1') return {};
  const socketPath = `${baseUrl}ws`;
  // Docusaurus merges a plugin's `devServer` into the dev server config; webpack's own
  // Configuration type does not declare the key.
  return {
    devServer: {
      client: {webSocketURL: {pathname: socketPath}},
      webSocketServer: {type: 'ws', options: {path: socketPath}},
    },
  } as Configuration;
}

export default function environmentPlugin(context: LoadContext): Plugin {
  const profile = resolveProfile();

  return {
    name: 'dbsync-environment',
    configureWebpack(config, isServer) {
      cacheByProfile(config, profile);
      return isServer ? {} : localeDevSocket(context.baseUrl);
    },
    injectHtmlTags() {
      return {headTags: environmentHeadTags(profile)};
    },
    async postBuild({outDir}) {
      if (isRootBuild(context)) {
        await emitRobots(outDir, profile, localesDefaultFirst(context));
      }
    },
  };
}

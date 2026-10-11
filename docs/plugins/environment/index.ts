import fs from 'node:fs/promises';
import path from 'node:path';

import type {HtmlTagObject, LoadContext, Plugin} from '@docusaurus/types';

import {resolveProfile, type BuildProfile} from '../../config/profiles';

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
 * build also points at its sitemap. The file is written by the build, so a `robots.txt` that
 * reaches `static/` cannot add a `Disallow`. (Under a subpath crawlers read the host's root
 * `robots.txt`, not this one; the `noindex` meta is what holds there.)
 */
export function robotsTxt(profile: BuildProfile): string {
  const lines = ['User-agent: *', 'Allow: /'];
  if (profile.indexable) {
    lines.push('', `Sitemap: ${profile.url}${profile.baseUrl}sitemap.xml`);
  }
  return `${lines.join('\n')}\n`;
}

export async function emitRobots(outDir: string, profile: BuildProfile): Promise<void> {
  await fs.writeFile(path.join(outDir, ROBOTS_FILE), robotsTxt(profile), 'utf8');
}

export default function environmentPlugin(_context: LoadContext): Plugin {
  const profile = resolveProfile();

  return {
    name: 'dbsync-environment',
    injectHtmlTags() {
      return {headTags: environmentHeadTags(profile)};
    },
    async postBuild({outDir}) {
      await emitRobots(outDir, profile);
    },
  };
}

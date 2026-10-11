import {existsSync} from 'node:fs';
import path from 'node:path';

import type {LoadContext, Plugin} from '@docusaurus/types';

import {resolveProfile} from '../../config/profiles';
import {PLUGIN_NAME, localePath, type I18nGlobalData} from '../../src/i18n/pages';

export {PLUGIN_NAME};

/**
 * META-4 / META-8 / A11Y-18 — which locales each page really exists in.
 *
 * Docusaurus builds every page in every locale, falling back to the English source where no
 * translation exists. Those fallbacks are English pages under `/ja/…`, so they must not be
 * advertised as Japanese: hreflang alternates name only the locales a page is translated into
 * (META-4), and untranslated content is marked `lang="en"` (A11Y-18).
 *
 * A doc exists in a locale when its translation is on disk under
 * `i18n/<locale>/docusaurus-plugin-content-docs/<version>/`. Pages that are not docs (the home
 * page, 404) are built from UI strings, and exist in every locale. This plugin works the doc map
 * out once per build and hands it to the theme as global data; `src/theme/SiteMetadata` reads it.
 *
 * Preview builds are `noindex`, so they emit no hreflang at all (META-8).
 */

/** The parts of the docs plugin's loaded content this plugin needs. */
export interface DocsContent {
  readonly loadedVersions: readonly {
    readonly versionName: string;
    readonly contentPath: string;
    readonly docs: readonly {readonly source: string; readonly permalink: string}[];
  }[];
}

type I18nContext = Pick<LoadContext, 'siteDir' | 'baseUrl' | 'i18n'>;

/**
 * Where a docs version's translations live under `i18n/<locale>/`. Docusaurus' own layout for the
 * default docs plugin: `current` for the unreleased line, `version-<name>` for each release line.
 */
export function versionTranslationDir(versionName: string): string {
  return path.join(
    'docusaurus-plugin-content-docs',
    versionName === 'current' ? 'current' : `version-${versionName}`,
  );
}

/** `@site/docs/intro.md` → absolute path. */
function sourcePath(source: string, siteDir: string): string {
  return source.startsWith('@site/') ? path.join(siteDir, source.slice('@site/'.length)) : source;
}

/** The locales each doc exists in, keyed by locale-relative path. */
export function docLocales(
  content: DocsContent,
  context: I18nContext,
  exists: (file: string) => boolean = existsSync,
): Record<string, string[]> {
  const {siteDir, baseUrl, i18n} = context;
  const docs: Record<string, string[]> = {};
  for (const version of content.loadedVersions) {
    const versionDir = versionTranslationDir(version.versionName);
    const localized = path.join(siteDir, 'i18n', i18n.currentLocale, versionDir);
    for (const doc of version.docs) {
      // The current locale's build loads a doc from its translation when there is one.
      const file = sourcePath(doc.source, siteDir);
      const from = path.relative(localized, file).startsWith('..')
        ? version.contentPath
        : localized;
      const relative = path.relative(from, file);
      docs[localePath(doc.permalink, baseUrl)] = i18n.locales.filter(
        (locale) =>
          locale === i18n.defaultLocale ||
          exists(path.join(siteDir, 'i18n', locale, versionDir, relative)),
      );
    }
  }
  return docs;
}

export default function i18nPlugin(context: LoadContext): Plugin {
  const profile = resolveProfile();

  return {
    name: PLUGIN_NAME,
    async allContentLoaded({allContent, actions}) {
      const docs = allContent['docusaurus-plugin-content-docs']?.default as DocsContent | undefined;
      const data: I18nGlobalData = {
        alternates: profile.indexable,
        docs: docs ? docLocales(docs, context) : {},
      };
      actions.setGlobalData(data);
    },
  };
}

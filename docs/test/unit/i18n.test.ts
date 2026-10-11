import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {DEFAULT_LOCALE, I18N, LOCALES, LOCALE_CONFIGS} from '../../config/i18n';
import i18nPlugin, {docLocales, versionTranslationDir} from '../../plugins/i18n';
import {
  PLUGIN_NAME,
  fallbackLang,
  isTranslatedDoc,
  localePath,
  pageLocales,
} from '../../src/i18n/pages';
import {IDENTIFIER_ATTRIBUTES} from '../../src/i18n/identifier';
import {surveyLabelId} from '../../src/survey/labelIds';
import type {LoadContext} from '@docusaurus/types';

const SITE = '/site';

async function withProfile<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.DOCS_PROFILE;
  process.env.DOCS_PROFILE = name;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.DOCS_PROFILE;
    } else {
      process.env.DOCS_PROFILE = previous;
    }
  }
}

const content = {
  loadedVersions: [
    {
      versionName: 'current',
      contentPath: `${SITE}/docs`,
      docs: [
        {source: '@site/docs/intro.md', permalink: '/b/ja/docs/intro'},
        {
          source: '@site/i18n/ja/docusaurus-plugin-content-docs/current/guides/restore.md',
          permalink: '/b/ja/docs/guides/restore',
        },
      ],
    },
    {
      versionName: '13.6',
      contentPath: `${SITE}/versioned_docs/version-13.6`,
      docs: [
        {source: '@site/versioned_docs/version-13.6/intro.md', permalink: '/b/ja/docs/13.6/intro'},
      ],
    },
  ],
};

const context = {
  siteDir: SITE,
  baseUrl: '/b/ja/',
  i18n: {currentLocale: 'ja', defaultLocale: 'en', locales: ['en', 'ja', 'de']},
} as unknown as LoadContext;

/** Translations on disk: restore in ja and de, the 13.6 intro frozen in de. */
const onDisk = new Set(
  [
    'i18n/ja/docusaurus-plugin-content-docs/current/guides/restore.md',
    'i18n/de/docusaurus-plugin-content-docs/current/guides/restore.md',
    'i18n/de/docusaurus-plugin-content-docs/version-13.6/intro.md',
  ].map((f) => path.join(SITE, f)),
);

describe('the locale set (§2, A11Y-18)', () => {
  it('is the five settled locales, English first and default', () => {
    expect(LOCALES).toEqual(['en', 'ja', 'es', 'de', 'vi']);
    expect(DEFAULT_LOCALE).toBe('en');
    expect(I18N).toMatchObject({defaultLocale: 'en', locales: [...LOCALES]});
  });

  it('gives every locale its own html lang, left to right (DF-8 dormant)', () => {
    for (const locale of LOCALES) {
      expect(LOCALE_CONFIGS[locale]).toMatchObject({htmlLang: locale, direction: 'ltr'});
    }
  });
});

describe('which locales a doc exists in (META-4)', () => {
  it('names the translation directory of each version', () => {
    expect(versionTranslationDir('current')).toBe(
      path.join('docusaurus-plugin-content-docs', 'current'),
    );
    expect(versionTranslationDir('13.6')).toBe(
      path.join('docusaurus-plugin-content-docs', 'version-13.6'),
    );
  });

  it('counts a locale only where the translation is on disk, the default always', () => {
    expect(docLocales(content, context, (f) => onDisk.has(f))).toEqual({
      '/docs/intro': ['en'],
      '/docs/guides/restore': ['en', 'ja', 'de'],
      '/docs/13.6/intro': ['en', 'de'],
    });
  });

  it('publishes the map as global data, with hreflang off on a noindex build (META-8)', async () => {
    for (const [profile, alternates] of [
      ['dev', false],
      ['prod', true],
    ] as const) {
      const set: unknown[] = [];
      await withProfile(profile, async () => {
        const plugin = i18nPlugin(context);
        expect(plugin.name).toBe(PLUGIN_NAME);
        await plugin.allContentLoaded?.({
          allContent: {'docusaurus-plugin-content-docs': {default: {loadedVersions: []}}},
          actions: {setGlobalData: (d: unknown) => set.push(d)},
        } as unknown as Parameters<NonNullable<typeof plugin.allContentLoaded>>[0]);
      });
      expect(set).toEqual([{alternates, docs: {}}]);
    }
  });

  it('treats a site without the docs plugin as having no docs', async () => {
    const set: unknown[] = [];
    await withProfile('prod', async () => {
      await i18nPlugin(context).allContentLoaded?.({
        allContent: {},
        actions: {setGlobalData: (d: unknown) => set.push(d)},
      } as unknown as Parameters<
        NonNullable<ReturnType<typeof i18nPlugin>['allContentLoaded']>
      >[0]);
    });
    expect(set).toMatchObject([{docs: {}}]);
  });
});

describe('page helpers', () => {
  const data = {alternates: true, docs: {'/docs/intro': ['en'], '/docs/a': ['en', 'ja']}};

  it('makes paths locale-relative', () => {
    expect(localePath('/b/ja/docs/intro/', '/b/ja/')).toBe('/docs/intro');
    expect(localePath('/b/ja/', '/b/ja/')).toBe('/');
    expect(localePath('/elsewhere', '/b/ja/')).toBe('/elsewhere');
  });

  it('gives a doc its translations and any other page every locale', () => {
    expect(pageLocales('/docs/a', data, LOCALES)).toEqual(['en', 'ja']);
    expect(pageLocales('/', data, LOCALES)).toEqual(LOCALES);
  });

  it('tells a translated doc from an English fallback (A11Y-18)', () => {
    expect(isTranslatedDoc('@site/docs/intro.md', 'en', 'en')).toBe(true);
    expect(isTranslatedDoc('@site/docs/intro.md', 'ja', 'en')).toBe(false);
    expect(
      isTranslatedDoc('@site/i18n/ja/docusaurus-plugin-content-docs/current/intro.md', 'ja', 'en'),
    ).toBe(true);
    expect(
      isTranslatedDoc('@site/i18n/de/docusaurus-plugin-content-docs/current/intro.md', 'ja', 'en'),
    ).toBe(false);
  });

  it('marks UI strings English when any of them fell back (A11Y-18)', () => {
    const ja = {'banner.label': 'プレビュー'};
    expect(fallbackLang(['banner.label'], ja, 'ja', 'en')).toBeUndefined();
    expect(fallbackLang(['banner.label', 'banner.link'], ja, 'ja', 'en')).toBe('en');
    expect(fallbackLang(['banner.link'], {}, 'en', 'en')).toBeUndefined();
  });
});

describe('identifiers are marked once (A11Y-18)', () => {
  it('as English that is never translated', () => {
    expect(IDENTIFIER_ATTRIBUTES).toEqual({lang: 'en', translate: 'no'});
  });
});

describe('survey labels key off indices (SUR-5)', () => {
  it('builds ids from the question and option index, never the text', () => {
    expect(surveyLabelId(3)).toBe('survey.question.3');
    expect(surveyLabelId(3, 2)).toBe('survey.question.3.option.2');
    expect(surveyLabelId(0, 0)).toBe('survey.question.0.option.0');
  });

  it.each([
    [-1, undefined],
    [1.5, undefined],
    [2, -1],
    [2, Number.NaN],
  ])('rejects question %s option %s', (question, option) => {
    expect(() => surveyLabelId(question, option)).toThrow(/SUR-5/);
  });
});

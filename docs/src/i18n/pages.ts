/**
 * Which locales a page exists in (META-4, A11Y-18). Shared by `plugins/i18n`, which works the
 * doc map out at build time, and the theme, which reads it. No Node imports: this ships to the
 * browser.
 */

export const PLUGIN_NAME = 'dbsync-i18n';

/** Global data the theme reads. Paths are locale-relative (`/docs/intro`). */
export interface I18nGlobalData {
  /** False on a noindex build: no hreflang at all (META-8). */
  readonly alternates: boolean;
  /** Every doc page, with the locales it is translated into (the default locale always). */
  readonly docs: Readonly<Record<string, readonly string[]>>;
}

/** A permalink relative to the locale's base, without a trailing slash (`/docs/intro`, `/`). */
export function localePath(permalink: string, baseUrl: string): string {
  const rest = permalink.startsWith(baseUrl) ? permalink.slice(baseUrl.length) : permalink;
  return `/${rest.replace(/^\/+|\/+$/g, '')}`;
}

/** The locales a page exists in: a doc's translations, or every locale for a non-doc page. */
export function pageLocales(
  pathname: string,
  data: I18nGlobalData,
  locales: readonly string[],
): readonly string[] {
  return data.docs[pathname] ?? locales;
}

/**
 * Whether a doc page renders its translation: in a non-default locale, Docusaurus loads the doc
 * from `@site/i18n/<locale>/…` when a translation exists and from the English source otherwise.
 */
export function isTranslatedDoc(source: string, locale: string, defaultLocale: string): boolean {
  return locale === defaultLocale || source.startsWith(`@site/i18n/${locale}/`);
}

/**
 * The `lang` an element holding UI strings needs (A11Y-18): `en` when the locale is not the
 * default and any of the strings fell back to English because the locale has no translation for
 * it, otherwise none (the element inherits the page's language).
 */
export function fallbackLang(
  ids: readonly string[],
  translations: Readonly<Record<string, string>>,
  locale: string,
  defaultLocale: string,
): 'en' | undefined {
  return locale !== defaultLocale && ids.some((id) => !(id in translations)) ? 'en' : undefined;
}

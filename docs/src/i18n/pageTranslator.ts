import {fallbackLang} from './pages';

export interface PageMessage {
  readonly id: string;
  readonly message: string;
  readonly description?: string;
}

/** An incomplete page uses its English messages consistently with its lang=en marker. */
export function pageTranslator(
  ids: readonly string[],
  translations: Readonly<Record<string, string>>,
  locale: string,
  defaultLocale: string,
  localize: (message: PageMessage) => string,
): (message: PageMessage) => string {
  return fallbackLang(ids, translations, locale, defaultLocale) ? ({message}) => message : localize;
}

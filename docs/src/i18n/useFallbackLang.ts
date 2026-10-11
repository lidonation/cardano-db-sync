import codeTranslations from '@generated/codeTranslations';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import {fallbackLang} from './pages';

/**
 * `lang` for an element whose UI strings are `ids` (A11Y-18): `en` when this locale has no
 * translation for one of them, so the English fallback is announced as English.
 */
export default function useFallbackLang(ids: readonly string[]): 'en' | undefined {
  const {
    i18n: {currentLocale, defaultLocale},
  } = useDocusaurusContext();
  return fallbackLang(ids, codeTranslations, currentLocale, defaultLocale);
}

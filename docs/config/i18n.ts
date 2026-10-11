import type {I18nLocaleConfig} from '@docusaurus/types';

/**
 * The launch locales (SPECIFICATION §2, settled 2026-08-21): English plus the four the Cardano
 * ecosystem already sustains through Crowdin.
 *
 * §21 revisit trigger: the set rests on translation capacity (cardano.org ships JA / DE / VI via
 * Crowdin), not on an operator census. Revisit if evidence shows db-sync operators are distributed
 * differently. Every locale is left-to-right; DF-8's mirroring rules stay dormant until an RTL
 * locale joins, and adding one means working through them first.
 */
export const DEFAULT_LOCALE = 'en';

export const LOCALES = ['en', 'ja', 'es', 'de', 'vi'] as const;

export type Locale = (typeof LOCALES)[number];

type LocaleConfig = Pick<I18nLocaleConfig, 'label' | 'htmlLang' | 'direction'>;

export const LOCALE_CONFIGS: Readonly<Record<Locale, LocaleConfig>> = Object.freeze({
  en: {label: 'English', htmlLang: 'en', direction: 'ltr'},
  ja: {label: '日本語', htmlLang: 'ja', direction: 'ltr'},
  es: {label: 'Español', htmlLang: 'es', direction: 'ltr'},
  de: {label: 'Deutsch', htmlLang: 'de', direction: 'ltr'},
  vi: {label: 'Tiếng Việt', htmlLang: 'vi', direction: 'ltr'},
});

/** The `i18n` block of the Docusaurus config. */
export const I18N = {
  defaultLocale: DEFAULT_LOCALE,
  locales: [...LOCALES],
  localeConfigs: {...LOCALE_CONFIGS},
};

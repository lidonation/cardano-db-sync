import codeTranslations from '@generated/codeTranslations';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {pageTranslator} from '../i18n/pageTranslator';
import {NUMBERS_IDS} from './ids';
import {messages, localizedNumbersMessages} from './messages';

export default function useNumbersTranslate() {
  const {
    i18n: {currentLocale, defaultLocale},
  } = useDocusaurusContext();
  const localized = localizedNumbersMessages();
  const byId = Object.fromEntries(
    Object.entries(messages).map(([key, definition]) => [
      definition.id,
      localized[key as keyof typeof localized],
    ]),
  );
  return pageTranslator(
    NUMBERS_IDS,
    codeTranslations,
    currentLocale,
    defaultLocale,
    (message) => byId[message.id] ?? message.message,
  );
}

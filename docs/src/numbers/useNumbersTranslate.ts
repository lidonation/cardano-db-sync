import codeTranslations from '@generated/codeTranslations';
import {translate} from '@docusaurus/Translate';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {pageTranslator} from '../i18n/pageTranslator';
import {NUMBERS_IDS} from './ids';

export default function useNumbersTranslate() {
  const {
    i18n: {currentLocale, defaultLocale},
  } = useDocusaurusContext();
  return pageTranslator(NUMBERS_IDS, codeTranslations, currentLocale, defaultLocale, translate);
}

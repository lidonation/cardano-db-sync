import codeTranslations from '@generated/codeTranslations';
import {translate} from '@docusaurus/Translate';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import {pageTranslator} from '../i18n/pageTranslator';

import {ECOSYSTEM_IDS} from './ids';

export default function useEcosystemTranslate() {
  const {
    i18n: {currentLocale, defaultLocale},
  } = useDocusaurusContext();
  return pageTranslator(ECOSYSTEM_IDS, codeTranslations, currentLocale, defaultLocale, translate);
}

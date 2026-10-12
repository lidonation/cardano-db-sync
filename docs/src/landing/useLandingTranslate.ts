import codeTranslations from '@generated/codeTranslations';
import {translate} from '@docusaurus/Translate';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import {pageTranslator} from '../i18n/pageTranslator';

import {LANDING_IDS} from './ids';

export default function useLandingTranslate() {
  const {
    i18n: {currentLocale, defaultLocale},
  } = useDocusaurusContext();
  return pageTranslator(LANDING_IDS, codeTranslations, currentLocale, defaultLocale, translate);
}

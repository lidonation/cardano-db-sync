import codeTranslations from '@generated/codeTranslations';
import {translate} from '@docusaurus/Translate';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import {pageTranslator} from '../i18n/pageTranslator';

import {DASHBOARD_IDS} from './ids';

/** The translate function for this page: English throughout when a string is missing (A11Y-18). */
export default function useDashboardTranslate() {
  const {
    i18n: {currentLocale, defaultLocale},
  } = useDocusaurusContext();
  return pageTranslator(DASHBOARD_IDS, codeTranslations, currentLocale, defaultLocale, translate);
}

import codeTranslations from '@generated/codeTranslations';
import {translate as localize} from '@docusaurus/Translate';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import {pageTranslator} from '../i18n/pageTranslator';

export const UPDATES_IDS = [
  'updates.title',
  'updates.description',
  'updates.period',
  'updates.week',
  'updates.month',
  'updates.total',
  'updates.custom',
  'updates.count',
  'updates.unavailable',
  'updates.unavailable.body',
  'updates.firstRelease',
  'updates.noResults',
  'updates.from',
  'updates.to',
  'updates.utc',
  'updates.range.required',
  'updates.range.invalid',
  'updates.range.reversed',
] as const;

export default function useUpdatesMessages() {
  const {
    i18n: {currentLocale, defaultLocale},
  } = useDocusaurusContext();
  const translate = pageTranslator(
    UPDATES_IDS,
    codeTranslations,
    currentLocale,
    defaultLocale,
    localize,
  );
  return {
    title: translate({id: 'updates.title', message: 'Updates'}),
    description: translate({
      id: 'updates.description',
      message: 'Release, schema and documentation changes to Cardano DB Sync.',
    }),
    period: translate({id: 'updates.period', message: 'Update period'}),
    week: translate({id: 'updates.week', message: 'Week'}),
    month: translate({id: 'updates.month', message: 'Month'}),
    total: translate({id: 'updates.total', message: 'Total'}),
    custom: translate({id: 'updates.custom', message: 'Custom'}),
    count: translate({id: 'updates.count', message: 'updates'}),
    unavailable: translate({id: 'updates.unavailable', message: 'Unavailable'}),
    unavailableBody: translate({
      id: 'updates.unavailable.body',
      message:
        'The Updates feed is not available yet. The git-history source (B22) has not been published.',
    }),
    firstRelease: translate({
      id: 'updates.firstRelease',
      message: 'No updates yet. This feed is awaiting its first release.',
    }),
    noResults: translate({id: 'updates.noResults', message: 'No updates in this date selection.'}),
    from: translate({id: 'updates.from', message: 'From'}),
    to: translate({id: 'updates.to', message: 'To'}),
    utc: translate({id: 'updates.utc', message: 'Dates are inclusive and use UTC.'}),
    required: translate({
      id: 'updates.range.required',
      message: 'Choose both a From date and a To date.',
    }),
    invalid: translate({id: 'updates.range.invalid', message: 'Enter valid dates.'}),
    reversed: translate({
      id: 'updates.range.reversed',
      message: 'The To date must be on or after the From date.',
    }),
  };
}

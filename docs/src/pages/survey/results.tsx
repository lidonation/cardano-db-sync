import React from 'react';

import Layout from '@theme/Layout';

import {MAIN_CONTENT_ID} from '../../lib/accessibility';
import useFallbackLang from '../../i18n/useFallbackLang';

import DashboardView from '@generated/survey-results/default/view';
import {DASHBOARD_IDS} from '../../survey-results/ids';
import resolved from '@generated/survey-results/default/resolved.json';
import useDashboardTranslate from '../../survey-results/useDashboardTranslate';

/** The survey results dashboard (B44-f). CON-11: an app-like surface, a React page. */
export default function SurveyResults(): React.JSX.Element {
  const lang = useFallbackLang(DASHBOARD_IDS);
  const t = useDashboardTranslate();
  return (
    <Layout
      title={t({id: 'results.meta.title', message: 'Survey results'})}
      description={t({
        id: 'results.meta.description',
        message:
          'Tallied results of the Cardano DB Sync operator survey: exact counts per option, with response-time validation and interim standing stated.',
      })}
    >
      <main id={MAIN_CONTENT_ID} tabIndex={-1} lang={lang}>
        <DashboardView resolved={resolved} t={t} />
      </main>
    </Layout>
  );
}

import React from 'react';

import Layout from '@theme/Layout';

import Ecosystem from '../ecosystem/Ecosystem';
import {ECOSYSTEM_IDS} from '../ecosystem/ids';
import useEcosystemTranslate from '../ecosystem/useEcosystemTranslate';
import useFallbackLang from '../i18n/useFallbackLang';

/**
 * The ecosystem page (B44-b). CON-11: app-like surfaces are React pages under `src/pages/`,
 * not MDX documents; the sections live in `src/ecosystem/`. A11Y-18: a locale that has not
 * translated every ecosystem string shows the page in English and marks it as English.
 */
export default function EcosystemPage(): React.JSX.Element {
  const translate = useEcosystemTranslate();
  const lang = useFallbackLang(ECOSYSTEM_IDS);
  return (
    <Layout
      title={translate({id: 'ecosystem.meta.title', message: 'Ecosystem'})}
      description={translate({
        id: 'ecosystem.meta.description',
        message:
          'Explorers, APIs and governance platforms built on Cardano DB Sync, each linking to the SQL it runs.',
      })}
    >
      <main lang={lang}>
        <Ecosystem />
      </main>
    </Layout>
  );
}

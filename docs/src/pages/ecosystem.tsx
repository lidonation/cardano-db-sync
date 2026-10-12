import React from 'react';

import Layout from '@theme/Layout';
import {translate} from '@docusaurus/Translate';

import Ecosystem from '../ecosystem/Ecosystem';
import {ECOSYSTEM_IDS} from '../ecosystem/ids';
import useFallbackLang from '../i18n/useFallbackLang';
import {MAIN_CONTENT_ID} from '../lib/accessibility';

/** The Ecosystem page (B44-b). CON-11: an app-like surface, a React page; content in `src/ecosystem/`. */
export default function EcosystemPage(): React.JSX.Element {
  const lang = useFallbackLang(ECOSYSTEM_IDS);
  return (
    <Layout
      title={translate({id: 'ecosystem.meta.title', message: 'Ecosystem'})}
      description={translate({
        id: 'ecosystem.meta.description',
        message:
          'The tools built on Cardano DB Sync and the teams that run it in production, each linked to its source.',
      })}
    >
      <main id={MAIN_CONTENT_ID} tabIndex={-1} lang={lang}>
        <Ecosystem />
      </main>
    </Layout>
  );
}

import React from 'react';

import Layout from '@theme/Layout';

import FaqPage from '../faq/FaqPage';
import useFaqTranslate from '../faq/useFaqTranslate';
import {FAQ_IDS} from '../faq/ids';
import useFallbackLang from '../i18n/useFallbackLang';

/** The FAQ page (B44-c). CON-11: an app-like surface, a React page; the content is in `src/faq/`. */
export default function Faq(): React.JSX.Element {
  const lang = useFallbackLang(FAQ_IDS);
  const t = useFaqTranslate();
  return (
    <Layout
      title={t({id: 'faq.meta.title', message: 'Frequently asked questions'})}
      description={t({
        id: 'faq.meta.description',
        message:
          'Answers to common questions about running, syncing and upgrading Cardano DB Sync, with links to the full guides.',
      })}
    >
      <main lang={lang}>
        <FaqPage />
      </main>
    </Layout>
  );
}

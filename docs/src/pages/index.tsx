import React from 'react';

import Layout from '@theme/Layout';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import useFallbackLang from '../i18n/useFallbackLang';
import Landing from '../landing/Landing';
import {LANDING_IDS} from '../landing/ids';

/**
 * The landing page (B44-a). CON-11: app-like surfaces are React pages under `src/pages/`, not MDX
 * documents; the sections live in `src/landing/`. A11Y-18: a locale that has not translated every
 * landing string shows the page in English and marks it as English.
 */
export default function Home(): React.JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  const lang = useFallbackLang(LANDING_IDS);
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <main lang={lang}>
        <Landing />
      </main>
    </Layout>
  );
}

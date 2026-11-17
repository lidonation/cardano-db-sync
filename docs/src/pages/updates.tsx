import React from 'react';

import Layout from '@theme/Layout';
import Head from '@docusaurus/Head';
import useBuildEnvironment from '../lib/useBuildEnvironment';

import useFallbackLang from '../i18n/useFallbackLang';
import {MAIN_CONTENT_ID} from '../lib/accessibility';
import {updatesFeed} from '../updates/feed';
import useUpdatesMessages, {UPDATES_IDS} from '../updates/messages';
import Updates from '../updates/Updates';
import styles from '../updates/styles.module.css';

export default function UpdatesPage(): React.JSX.Element {
  const messages = useUpdatesMessages();
  const {profile} = useBuildEnvironment();
  const lang = useFallbackLang(UPDATES_IDS);
  return (
    <Layout title={messages.title} description={messages.description}>
      <Head>
        <link
          rel="alternate"
          type="application/rss+xml"
          title="Cardano DB Sync updates (RSS)"
          href={`${profile.baseUrl}updates/rss.xml`}
        />
        <link
          rel="alternate"
          type="application/atom+xml"
          title="Cardano DB Sync updates (Atom)"
          href={`${profile.baseUrl}updates/atom.xml`}
        />
      </Head>
      <main id={MAIN_CONTENT_ID} tabIndex={-1} lang={lang} className={styles.page}>
        <h1 className={styles.heading}>{messages.title}</h1>
        <Updates feed={updatesFeed} />
      </main>
    </Layout>
  );
}

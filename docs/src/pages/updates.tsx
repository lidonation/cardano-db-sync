import React from 'react';

import Layout from '@theme/Layout';

import useFallbackLang from '../i18n/useFallbackLang';
import {updatesFeed} from '../updates/feed';
import useUpdatesMessages, {UPDATES_IDS} from '../updates/messages';
import Updates from '../updates/Updates';
import styles from '../updates/styles.module.css';

export default function UpdatesPage(): React.JSX.Element {
  const messages = useUpdatesMessages();
  const lang = useFallbackLang(UPDATES_IDS);
  return (
    <Layout title={messages.title} description={messages.description}>
      <main lang={lang} className={styles.page}>
        <h1 className={styles.heading}>{messages.title}</h1>
        <Updates feed={updatesFeed} />
      </main>
    </Layout>
  );
}

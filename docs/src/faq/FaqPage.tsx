import React, {useEffect} from 'react';

import codeTranslations from '@generated/codeTranslations';
import Head from '@docusaurus/Head';
import Link from '@docusaurus/Link';
import {translate} from '@docusaurus/Translate';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import Icon from '../components/shared/Icon';
import {pageTranslator} from '../i18n/pageTranslator';
import useBuildEnvironment from '../lib/useBuildEnvironment';
import styles from '../landing/styles.module.css';

import {FAQ_IDS} from './ids';
import {faqPageJsonLd, serializeJsonLd} from './jsonld';
import {faqSections, guideUrl} from './questions';

/** The translate function for this page: English throughout when a string is missing (A11Y-18). */
function useFaqTranslate() {
  const {
    i18n: {currentLocale, defaultLocale},
  } = useDocusaurusContext();
  return pageTranslator(FAQ_IDS, codeTranslations, currentLocale, defaultLocale, translate);
}

/**
 * B44-c — the FAQ page: every question, grouped by task, each answer linking the guide that covers
 * it in full, and the same questions as FAQPage JSON-LD (META-2). An address with a question's
 * anchor (`/faq#rollback`) opens that answer.
 */
export default function FaqPage(): React.JSX.Element {
  const t = useFaqTranslate();
  const {profile} = useBuildEnvironment();
  const sections = faqSections(t);
  const readGuide = t({
    id: 'faq.guide',
    message: 'Read the guide',
    description: 'Link from an FAQ answer to the documentation guide that covers it in full',
  });
  useEffect(() => {
    const target = window.location.hash.slice(1);
    const item = target ? document.getElementById(target) : null;
    if (item instanceof HTMLDetailsElement) item.open = true;
  }, []);
  return (
    <div className={styles.landing}>
      <Head>
        <script type="application/ld+json">{serializeJsonLd(faqPageJsonLd(sections))}</script>
      </Head>
      <section className={styles.section} aria-labelledby="faq-title">
        <div className={styles.inner}>
          <p className={styles.eyebrow}>
            <span aria-hidden="true">//{' '}</span>
            {t({id: 'faq.eyebrow', message: 'faq'})}
          </p>
          <h1 id="faq-title" className={styles.heading}>
            {t({id: 'faq.title', message: 'Frequently asked questions'})}
          </h1>
          <p className={styles.intro}>
            {t({
              id: 'faq.intro',
              message:
                'Answers to what operators ask most about running, syncing and upgrading DB Sync. Where a guide covers an answer in full, the answer links it.',
            })}
          </p>
        </div>
      </section>
      {sections.map((section) => (
        <section key={section.id} className={styles.section} aria-labelledby={`faq-${section.id}`}>
          <div className={styles.inner}>
            <h2 id={`faq-${section.id}`} className={styles.heading}>
              {section.title}
            </h2>
            <div className={styles.faq}>
              {section.items.map((item) => (
                <details key={item.key} id={item.key} className={styles.faqItem}>
                  <summary className={styles.faqQuestion}>
                    <span>{item.question}</span>
                    <Icon name="plus" size={16} className={styles.faqPlus} />
                    <Icon name="minus" size={16} className={styles.faqMinus} />
                  </summary>
                  <p className={styles.faqAnswer}>{item.answer}</p>
                  {item.guide && (
                    <p className={styles.faqAnswer}>
                      <Link className={styles.more} to={guideUrl(profile.repoUrl, item.guide)}>
                        {readGuide}
                        <Icon name="external" size={12} />
                      </Link>
                    </p>
                  )}
                </details>
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

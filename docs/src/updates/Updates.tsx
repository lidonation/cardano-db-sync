import React, {useId, useState} from 'react';

import Tabs from '../components/Tabs';
import {EmptyState, ErrorMessage} from '../components/shared/Status';
import useFallbackLang from '../i18n/useFallbackLang';

import useUpdatesMessages, {UPDATES_IDS} from './messages';
import {rangeError, selectEntries} from './model';
import type {DateRange, Period, UpdatesFeed} from './types';
import styles from './styles.module.css';

const PERIODS: readonly Period[] = ['week', 'month', 'total', 'custom'];

/** B44-d: the approved Updates panel, using the shared A11Y-28 chip tab pattern. */
export default function Updates({feed}: {readonly feed: UpdatesFeed | null}): React.JSX.Element {
  const messages = useUpdatesMessages();
  const lang = useFallbackLang(UPDATES_IDS);
  const base = useId();
  const [period, setPeriod] = useState<Period>('week');
  const [range, setRange] = useState<DateRange>({from: '', to: ''});
  const error = rangeError(range);
  const entries = feed ? selectEntries(feed, period, range) : [];
  const selectionError = feed !== null && period === 'custom' ? error : null;
  const metric =
    feed === null
      ? messages.unavailable
      : selectionError
        ? messages[selectionError]
        : String(entries.length);

  const content = (selected: Period) => {
    if (selected !== period) return null;
    const rows = entries;
    return (
      <>
        {selected === 'custom' && (
          <div className={styles.range}>
            <div className={styles.fields}>
              {(['from', 'to'] as const).map((endpoint) => (
                <label key={endpoint} htmlFor={`${base}-${endpoint}`}>
                  {messages[endpoint]}
                  <input
                    id={`${base}-${endpoint}`}
                    type="date"
                    value={range[endpoint]}
                    aria-invalid={(error !== null && error !== 'required') || undefined}
                    aria-describedby={`${base}-utc${error ? ` ${base}-error` : ''}`}
                    onChange={(event) =>
                      setRange({...range, [endpoint]: event.currentTarget.value})
                    }
                  />
                </label>
              ))}
            </div>
            <p id={`${base}-utc`} className={styles.helper}>
              {messages.utc}
            </p>
            {error === 'required' ? (
              <p id={`${base}-error`} className={styles.helper}>
                {messages.required}
              </p>
            ) : error ? (
              <ErrorMessage id={`${base}-error`} live>
                {messages[error]}
              </ErrorMessage>
            ) : null}
          </div>
        )}
        {feed === null ? (
          <EmptyState framed={false}>{messages.unavailableBody}</EmptyState>
        ) : feed.entries.length === 0 ? (
          <EmptyState framed={false}>{messages.firstRelease}</EmptyState>
        ) : selected === 'custom' && error ? null : rows.length === 0 ? (
          <EmptyState framed={false}>{messages.noResults}</EmptyState>
        ) : (
          <ul className={styles.entries}>
            {rows.map((entry) => (
              <li key={entry.id} className={styles.entry}>
                <div className={styles.entryMeta}>
                  <span className={styles.identifier} title={entry.id} lang="en">
                    {entry.id.slice(0, 7)}
                  </span>
                  <time dateTime={entry.date}>{entry.date}</time>
                </div>
                <a className={styles.subject} href={entry.url}>
                  {entry.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  };

  return (
    <section className={styles.panel} aria-label={messages.title} lang={lang}>
      <div className={styles.metric} role="status" aria-live="polite" aria-atomic="true">
        <span className={selectionError ? styles.label : styles.count}>{metric}</span>{' '}
        <span className={styles.label}>
          {selectionError ? messages[period] : `${messages.count} · ${messages[period]}`}
        </span>
      </div>
      <Tabs
        label={messages.period}
        appearance="chip"
        defaultSelected="week"
        onSelect={(id) => setPeriod(id as Period)}
        items={PERIODS.map((id) => ({id, label: messages[id], content: content(id)}))}
      />
    </section>
  );
}

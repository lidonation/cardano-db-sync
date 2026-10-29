import React, {useEffect, useState} from 'react';
import commitFeedUrl from '@generated/repository-activity/default/commits.json?commit-feed';
import Tabs from '../components/Tabs';
import {EmptyState} from '../components/shared/Status';
import {REPO_URL} from '../data/links';
import type {PageMessage} from '../i18n/pageTranslator';
import type {CommitFeedState} from '../repository-activity/types';
import DateRangeFields from '../updates/DateRangeFields';
import useUpdatesMessages from '../updates/messages';
import {rangeError, selectDatedEntries} from '../updates/model';
import type {DateRange, Period} from '../updates/types';
import styles from '../updates/styles.module.css';
import {parseCommitFeed} from './commitFeed';
import {ECOSYSTEM_IDS} from './ids';

const PERIODS: readonly Period[] = ['week', 'month', 'total', 'custom'];
const LIMIT = 8;
type Translate = (message: PageMessage) => string;

/** The complete history is loaded on demand, separately from the initial page bundle. */
export default function CommitActivity({t}: {t: Translate}) {
  const [state, setState] = useState<CommitFeedState | null>(null);
  const [period, setPeriod] = useState<Period>('month');
  const [range, setRange] = useState<DateRange>({from: '', to: ''});
  const messages = useUpdatesMessages(ECOSYSTEM_IDS);
  useEffect(() => {
    const controller = new AbortController();
    fetch(commitFeedUrl, {signal: controller.signal})
      .then((response) => {
        if (!response.ok) throw new Error('Commit feed unavailable');
        return response.json() as Promise<unknown>;
      })
      .then((data) => {
        if (!controller.signal.aborted) setState(parseCommitFeed(data));
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({status: 'unavailable'});
      });
    return () => controller.abort();
  }, []);
  const feed = state?.status === 'available' ? state.data : null;
  const error = period === 'custom' ? rangeError(range) : null;
  const entries = feed ? selectDatedEntries(feed, period, range) : [];
  const title = t({id: 'ecosystem.commit.title', message: 'Commit activity'});
  const periodLabel = {
    week: t({id: 'ecosystem.commit.lastWeek', message: 'last week'}),
    month: t({id: 'ecosystem.commit.lastMonth', message: 'last month'}),
    total: t({id: 'ecosystem.commit.allTime', message: 'all time'}),
    custom: t({id: 'ecosystem.commit.customRange', message: 'in this range'}),
  }[period];
  const content = (selected: Period) =>
    selected !== period ? null : (
      <>
        {selected === 'custom' && (
          <DateRangeFields range={range} onChange={setRange} messages={messages} />
        )}
        {state === null ? (
          <p>{t({id: 'ecosystem.commit.loading', message: 'Loading commit activity…'})}</p>
        ) : state.status === 'unavailable' ? (
          <EmptyState framed={false}>
            {t({
              id: 'ecosystem.commit.unavailable',
              message: 'Commit activity is unavailable in this build.',
            })}
          </EmptyState>
        ) : error ? null : feed?.entries.length === 0 ? (
          <EmptyState framed={false}>
            {t({id: 'ecosystem.commit.noCommits', message: 'No commits yet in this snapshot.'})}
          </EmptyState>
        ) : entries.length === 0 ? (
          <EmptyState framed={false}>
            {t({id: 'ecosystem.commit.empty', message: 'No commits in this date selection.'})}
          </EmptyState>
        ) : (
          <ul className={styles.entries}>
            {entries.slice(0, LIMIT).map((entry) => (
              <li className={styles.entry} key={entry.id}>
                <div className={styles.entryMeta}>
                  <a
                    className={`${styles.identifier} ${styles.subject}`}
                    href={`${REPO_URL}/commit/${entry.id}`}
                  >
                    {entry.id.slice(0, 8)}
                  </a>
                  <time dateTime={entry.date}>{entry.date}</time>
                </div>
                <span className="dbs-type-body-sm">{entry.subject}</span>
              </li>
            ))}
          </ul>
        )}
        <a className={styles.subject} href={`${REPO_URL}/commits/master/`}>
          {t({id: 'ecosystem.commit.history', message: 'View full commit history on GitHub'})}
        </a>
      </>
    );
  return (
    <section className={styles.panel} aria-label={title}>
      <div className={styles.metric} role="status" aria-live="polite" aria-atomic="true">
        <span className={error ? styles.label : styles.count}>
          {state === null
            ? '…'
            : state.status === 'unavailable'
              ? messages.unavailable
              : error
                ? messages[error]
                : `${entries.length} ${messages.count}`}
        </span>
        <span className={styles.label}>
          {periodLabel}
          {entries.length > LIMIT
            ? ` · ${t({id: 'ecosystem.commit.showing', message: 'Showing the latest eight'})}`
            : ''}
        </span>
      </div>
      <Tabs
        label={messages.period}
        appearance="chip"
        defaultSelected="month"
        onSelect={(id) => setPeriod(id as Period)}
        items={PERIODS.map((id) => ({id, label: messages[id], content: content(id)}))}
      />
    </section>
  );
}

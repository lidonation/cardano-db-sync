import React from 'react';
import Metric from '../components/Metric';
import Frame from '../components/Card/Frame';
import Layout from '@theme/Layout';
import {MAIN_CONTENT_ID} from '../lib/accessibility';
import useBuildEnvironment from '../lib/useBuildEnvironment';
import useFallbackLang from '../i18n/useFallbackLang';
import {committedNumbersState, formatNumber, formatUtc, numbersForNetwork} from './data';
import type {CardanoNetwork, NumbersState} from './types';
import {NUMBERS_IDS} from './ids';
import {messages} from './messages';
import useNumbersTranslate from './useNumbersTranslate';
import styles from './styles.module.css';
import {growthPoints} from './plot';

export default function NumbersPage({
  state,
  network,
}: {
  state?: NumbersState;
  network?: CardanoNetwork;
}): React.JSX.Element {
  const build = useBuildEnvironment();
  const activeNetwork = network ?? build.profile.network;
  const current = numbersForNetwork(state ?? committedNumbersState(activeNetwork), activeNetwork);
  const t = useNumbersTranslate();
  const lang = useFallbackLang(NUMBERS_IDS);
  const title = `${t(messages.title)} · ${t(messages[activeNetwork])}`;
  const snapshot = current.status === 'unavailable' ? null : current.snapshot;
  const storage = snapshot?.storage;
  const growth = growthPoints(storage?.growth ?? []);
  const metrics = snapshot
    ? [
        [t(messages.block), formatNumber(snapshot.blockHeight)],
        [t(messages.epoch), formatNumber(snapshot.epoch)],
        [t(messages.transactions), formatNumber(snapshot.transactions)],
        [t(messages.blocks), formatNumber(snapshot.blocksThisEpoch)],
        [t(messages.boundary), formatUtc(snapshot.nextBoundary)],
      ]
    : [];
  return (
    <Layout title={title} description={t(messages.intro)}>
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className={styles.page} lang={lang}>
        <div>
          <header className={styles.hero}>
            <p className={styles.kicker}>{t(messages.facts)}</p>
            <h1 className="dbs-type-heading-lg">{title}</h1>
            <p>{t(messages.intro)}</p>
            <p>
              {t(activeNetwork === 'preview' ? messages.cadencePreview : messages.cadenceMainnet)}
            </p>
          </header>
          {current.status === 'unavailable' ? (
            <p className={styles.notice}>{t(messages[current.reason])}</p>
          ) : (
            snapshot && (
              <>
                {current.status === 'stale' && <p className={styles.notice}>{t(messages.stale)}</p>}
                <ul className={styles.metrics}>
                  {metrics.map(([label, value]) => (
                    <li key={label}>
                      <Metric
                        label={label}
                        value={
                          <span
                            className={
                              label === t(messages.boundary) ? styles.dateValue : styles.metricValue
                            }
                          >
                            {value}
                          </span>
                        }
                      />
                    </li>
                  ))}
                </ul>
                <section className={styles.section} aria-labelledby="numbers-epoch-title">
                  <h2 className="dbs-type-heading-md" id="numbers-epoch-title">
                    {t(messages.facts)}
                  </h2>
                  <dl className={styles.provenance}>
                    <Frame kind="Stat" skeleton={null} className={styles.card}>
                      <dt>{t(messages.updated)}</dt>
                      <dd>{formatUtc(snapshot.updatedAt)}</dd>
                    </Frame>
                    <Frame kind="Stat" skeleton={null} className={styles.card}>
                      <dt>{t(messages.source)}</dt>
                      <dd>{snapshot.source}</dd>
                    </Frame>
                    <Frame kind="Stat" skeleton={null} className={styles.card}>
                      <dt>{t(messages.boundary)}</dt>
                      <dd>{formatUtc(snapshot.nextBoundary)}</dd>
                    </Frame>
                  </dl>
                </section>
                <section className={styles.section} aria-labelledby="numbers-storage-title">
                  <p className={styles.kicker}>{t(messages.modelled)}</p>
                  <h2 className="dbs-type-heading-md" id="numbers-storage-title">
                    {t(messages.storage)}
                  </h2>
                  {!storage ? (
                    <p>{t(messages.modelMissing)}</p>
                  ) : (
                    <>
                      <p>
                        <strong>{t(messages.methodology)}:</strong> {storage.methodology}
                      </p>
                      <p>
                        <strong>{t(messages.configuration)}:</strong>{' '}
                        <code>{storage.configuration}</code>
                      </p>

                      <div className={styles.storage}>
                        <Frame kind="Stat" skeleton={null} className={styles.card}>
                          <h3 className="dbs-type-title">{t(messages.growth)}</h3>
                          <p>{t(messages.modelled)}</p>
                          <p id="numbers-growth-summary">
                            {growth.length === 0
                              ? t(messages.growthEmpty)
                              : t(messages.growthSummary)
                                  .replace('{count}', formatNumber(growth.length))
                                  .replace('{firstEpoch}', formatNumber(growth[0].epoch))
                                  .replace('{firstGB}', formatNumber(growth[0].gigabytes))
                                  .replace('{lastEpoch}', formatNumber(growth.at(-1)!.epoch))
                                  .replace('{lastGB}', formatNumber(growth.at(-1)!.gigabytes))}
                          </p>
                          {growth.length > 0 && (
                            <svg
                              className={styles.chart}
                              viewBox="0 0 600 180"
                              role="img"
                              aria-labelledby="numbers-growth-summary"
                            >
                              <polyline
                                className={styles.line}
                                points={growth.map((point) => `${point.x},${point.y}`).join(' ')}
                              />
                              {growth.map((point) => (
                                <circle
                                  key={point.epoch}
                                  className={styles.point}
                                  cx={point.x}
                                  cy={point.y}
                                  r="4"
                                />
                              ))}
                            </svg>
                          )}
                          <details className={styles.alternative}>
                            <summary>{t(messages.growthData)}</summary>
                            <div className={styles.tableWrap}>
                              <table>
                                <caption>
                                  {t(messages.growthCaption)} · {t(messages.modelled)}
                                </caption>
                                <thead>
                                  <tr>
                                    <th scope="col">{t(messages.epoch)}</th>
                                    <th scope="col">{t(messages.growthSize)}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {growth.map((point) => (
                                    <tr key={point.epoch}>
                                      <th scope="row">{formatNumber(point.epoch)}</th>
                                      <td>{formatNumber(point.gigabytes)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        </Frame>
                        <Frame kind="Stat" skeleton={null} className={styles.card}>
                          <p className={styles.kicker}>{t(messages.modelled)}</p>
                          <dl>
                            <dt>{t(messages.database)}</dt>
                            <dd className={styles.value}>{formatNumber(storage.databaseGB)}</dd>
                            <dt>{t(messages.cost)}</dt>
                            <dd className={styles.value}>{formatNumber(storage.monthlyCostUSD)}</dd>
                          </dl>
                          {storage.tables.length === 0 && <p>{t(messages.tablesEmpty)}</p>}
                          <div className={styles.tableWrap}>
                            <table>
                              <caption>
                                {t(messages.tables)} · {t(messages.modelled)}
                              </caption>
                              <thead>
                                <tr>
                                  <th scope="col">{t(messages.table)}</th>
                                  <th scope="col">{t(messages.size)}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {storage.tables.map((row) => (
                                  <tr key={row.name}>
                                    <th scope="row">
                                      <code>{row.name}</code>
                                    </th>
                                    <td>{formatNumber(row.gigabytes)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </Frame>
                      </div>
                    </>
                  )}
                </section>
                <section className={styles.section} aria-labelledby="numbers-recent-title">
                  <h2 className="dbs-type-heading-md" id="numbers-recent-title">
                    {t(messages.recent)}
                  </h2>
                  {snapshot.recentEpochs.length === 0 && <p>{t(messages.epochsEmpty)}</p>}
                  <div className={styles.tableWrap}>
                    <table>
                      <caption>{t(messages.recentCaption)}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{t(messages.epoch)}</th>
                          <th scope="col">{t(messages.blocksColumn)}</th>
                          <th scope="col">{t(messages.transactionsColumn)}</th>
                          <th scope="col">{t(messages.boundaryColumn)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.recentEpochs.map((row) => (
                          <tr key={row.epoch}>
                            <th scope="row">{formatNumber(row.epoch)}</th>
                            <td>{formatNumber(row.blocks)}</td>
                            <td>{formatNumber(row.transactions)}</td>
                            <td>{formatUtc(row.boundary)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )
          )}
        </div>
      </main>
    </Layout>
  );
}

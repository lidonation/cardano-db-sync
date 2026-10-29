import React from 'react';
import Chart, {ChartGraphic} from '../components/Chart';
import {linearScale} from '../components/Chart/scale';
import Tabs from '../components/Tabs';
import type {PageMessage} from '../i18n/pageTranslator';
import Eyebrow from '../landing/Eyebrow';
import layout from '../landing/styles.module.css';
import type {ActivityCharts as Charts, Range} from './chart-data';
import {selectSeries} from './chart-data';
import styles from './charts.module.css';

type Translate = (message: PageMessage) => string;
const number = (value: number) => value.toLocaleString('en');

function CodeChart({
  data,
  range,
  label,
  t,
}: {
  data: Charts;
  range: Range;
  label: string;
  t: Translate;
}) {
  const points = selectSeries(data, range);
  const id = `code-summary-${range}`;
  const max = Math.max(1, ...points.map((point) => point.value));
  const min = Math.min(0, ...points.map((point) => point.value));
  const baseline = linearScale(0, min, max, 160, 20);
  const width = 560 / points.length;
  const summary = t({
    id: 'ecosystem.chart.code.summary',
    message:
      '{count} points over {range}; latest total {total} net lines, change {change} from {first} to {last} UTC.',
  })
    .replace('{count}', String(points.length))
    .replace('{range}', label)
    .replace('{total}', number(points.at(-1)?.value ?? 0))
    .replace('{change}', number((points.at(-1)?.value ?? 0) - (points[0]?.value ?? 0)))
    .replace('{first}', points[0]?.date ?? '')
    .replace('{last}', points.at(-1)?.date ?? '');
  return (
    <Chart
      summaryId={id}
      summary={summary}
      graphic={
        <ChartGraphic className={styles.graph} viewBox="0 0 600 200" summaryId={id}>
          <text className={styles.axisLabel} x="580" y="15" textAnchor="end">
            {number(points.at(-1)?.value ?? 0)}
          </text>
          {points.map((point, index) => {
            const y = linearScale(point.value, min, max, 160, 20);
            return (
              <rect
                key={point.date}
                className={styles.bar}
                x={20 + index * width}
                y={Math.min(y, baseline)}
                width={width * 0.8}
                height={Math.abs(baseline - y)}
              />
            );
          })}
          {points.map(
            (point, index) =>
              (range !== '30d' || index % 5 === 0 || index === points.length - 1) && (
                <text key={point.date} className={styles.axisLabel} x={20 + index * width} y="185">
                  {range === '12m' ? point.date.slice(5, 7) : point.date.slice(5)}
                </text>
              ),
          )}
        </ChartGraphic>
      }
      table={
        <details className={styles.alternative}>
          <summary>{t({id: 'ecosystem.chart.data', message: 'View chart data'})}</summary>
          <div className={styles.tableWrap}>
            <table>
              <caption>
                {t({id: 'ecosystem.chart.code.table', message: 'Net lines of code over time'})} ·{' '}
                {label}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t({id: 'ecosystem.chart.date', message: 'Date (UTC)'})}</th>
                  <th scope="col">{t({id: 'ecosystem.chart.lines', message: 'Net lines'})}</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.date}>
                    <th scope="row">{point.date}</th>
                    <td>{number(point.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      }
    />
  );
}

export default function ActivityCharts({data, t}: {data: Charts; t: Translate}) {
  const ranges: {id: Range; label: string}[] = [
    {id: '12m', label: t({id: 'ecosystem.chart.range.year', message: '12 months'})},
    {id: '30d', label: t({id: 'ecosystem.chart.range.month', message: '30 days'})},
    {id: '7d', label: t({id: 'ecosystem.chart.range.week', message: '7 days'})},
  ];
  const total = data.weeks.reduce((sum, week) => sum + week.total, 0);
  const first = data.weeks[0].days[0].date;
  const last = data.weeks.at(-1)!.days.at(-1)!.date;
  const summary = t({
    id: 'ecosystem.chart.activity.summary',
    message: '{count} commits over 52 weeks, {first} to {last} UTC, on upstream master.',
  })
    .replace('{count}', number(total))
    .replace('{first}', first)
    .replace('{last}', last);
  return (
    <>
      <section className={layout.section} aria-labelledby="ecosystem-code-title">
        <div className={layout.inner}>
          <Eyebrow>{t({id: 'ecosystem.chart.code.eyebrow', message: 'code over time'})}</Eyebrow>
          <h2 id="ecosystem-code-title" className={layout.heading}>
            {t({id: 'ecosystem.chart.code.title', message: '{count} lines of code so far'}).replace(
              '{count}',
              number(data.daily.at(-1)?.value ?? 0),
            )}
          </h2>
          <p>
            {t({
              id: 'ecosystem.chart.code.basis',
              message: 'Net lines across Haskell, SQL, Nix, cabal and docs.',
            })}
          </p>
          <Tabs
            label={t({id: 'ecosystem.chart.range.label', message: 'Code chart range'})}
            defaultSelected="12m"
            items={ranges.map(({id, label}) => ({
              id,
              label,
              content: <CodeChart data={data} range={id} label={label} t={t} />,
            }))}
          />
        </div>
      </section>
      <section className={layout.section} aria-labelledby="ecosystem-activity-title">
        <div className={layout.inner}>
          <Eyebrow>
            {t({id: 'ecosystem.chart.activity.eyebrow', message: 'contribution activity'})}
          </Eyebrow>
          <h2 id="ecosystem-activity-title" className={layout.heading}>
            {t({id: 'ecosystem.chart.activity.title', message: 'Commit activity'})}
          </h2>
          <Chart
            summaryId="activity-summary"
            summary={summary}
            graphic={
              <>
                <ChartGraphic
                  className={styles.graph}
                  viewBox="0 0 572 77"
                  summaryId="activity-summary"
                >
                  {data.weeks.flatMap((week, index) =>
                    week.days.map((day, row) => (
                      <rect
                        key={day.date}
                        className={
                          styles[
                            `level${day.count === 0 ? 0 : day.count === 1 ? 1 : day.count < 4 ? 2 : 3}`
                          ]
                        }
                        x={index * 11}
                        y={row * 11}
                        width="9"
                        height="9"
                        data-week={index}
                        data-count={day.count}
                      >
                        <title>
                          {day.date}: {day.count} commits
                        </title>
                      </rect>
                    )),
                  )}
                </ChartGraphic>
                <ul
                  className={styles.legend}
                  aria-label={t({id: 'ecosystem.chart.legend', message: 'Commits per day legend'})}
                >
                  {[
                    ['0', 0],
                    ['1', 1],
                    ['2–3', 2],
                    ['4+', 3],
                  ].map(([label, level]) => (
                    <li key={label}>
                      <span
                        className={`${styles.swatch} ${styles[`level${level}`]}`}
                        aria-hidden="true"
                      />
                      {label}
                    </li>
                  ))}
                </ul>
              </>
            }
            table={
              <details className={styles.alternative}>
                <summary>{t({id: 'ecosystem.chart.data', message: 'View chart data'})}</summary>
                <div className={styles.tableWrap}>
                  <table>
                    <caption>
                      {t({
                        id: 'ecosystem.chart.activity.table',
                        message: 'Commits per seven-day week (UTC)',
                      })}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">
                          {t({id: 'ecosystem.chart.week', message: 'Week (UTC)'})}
                        </th>
                        <th scope="col">
                          {t({id: 'ecosystem.chart.commits', message: 'Commits'})}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.weeks.map((week) => (
                        <tr key={week.days[0].date}>
                          <th scope="row">
                            {week.days[0].date} – {week.days[6].date}
                          </th>
                          <td>{week.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            }
          />
        </div>
      </section>
    </>
  );
}

import React from 'react';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import Button from '../components/Button';
import type {PageMessage} from '../i18n/pageTranslator';
import type {RoadmapState} from '../roadmap/types';
import {releaseTrack} from '../roadmap/releases';
import Eyebrow from '../landing/Eyebrow';
import layout from '../landing/styles.module.css';
import styles from './roadmap.module.css';

type Translate = (message: PageMessage) => string;
export function Roadmap({
  state,
  contributors,
  issueUrl,
  t,
}: {
  state: RoadmapState;
  contributors: number | null;
  issueUrl: string;
  t: Translate;
}): React.JSX.Element {
  useBrokenLinks().collectAnchor('roadmap');
  const releases = state.status === 'available' ? releaseTrack(state.data.releases) : [];
  return (
    <section className={layout.section} aria-labelledby="roadmap">
      <div className={layout.inner}>
        <Eyebrow>{t({id: 'ecosystem.roadmap.eyebrow', message: 'the roadmap'})}</Eyebrow>
        <h2 id="roadmap" className={layout.heading}>
          {contributors === null
            ? t({id: 'ecosystem.roadmap.title', message: 'The next contributor slot is open'})
            : t({
                id: 'ecosystem.roadmap.titleCount',
                message: 'Built by {count} contributors. The next slot is open.',
              }).replace('{count}', String(contributors))}
        </h2>
        <p className={layout.intro}>
          {t({
            id: 'ecosystem.roadmap.intro',
            message: 'Issues are triaged weekly. Help shape what comes next.',
          })}
        </p>
        {state.status === 'unavailable' ? (
          <p>
            {t({
              id: 'ecosystem.roadmap.unavailable',
              message: 'Roadmap data is unavailable in this build.',
            })}
          </p>
        ) : (
          <>
            <h3>{t({id: 'ecosystem.roadmap.status', message: 'Ticket status'})}</h3>
            <p>
              {t({
                id: 'ecosystem.roadmap.tracked',
                message: '{count} tracked items across the db-sync project.',
              }).replace(
                '{count}',
                String(
                  state.data.statuses.todo +
                    state.data.statuses.inProgress +
                    state.data.statuses.done,
                ),
              )}
            </p>
            <dl className={styles.statuses}>
              <div>
                <dt>{t({id: 'ecosystem.roadmap.todo', message: 'To do'})}</dt>
                <dd>{state.data.statuses.todo}</dd>
              </div>
              <div>
                <dt>{t({id: 'ecosystem.roadmap.inProgress', message: 'In progress'})}</dt>
                <dd>{state.data.statuses.inProgress}</dd>
              </div>
              <div>
                <dt>{t({id: 'ecosystem.roadmap.done', message: 'Done'})}</dt>
                <dd>{state.data.statuses.done}</dd>
              </div>
            </dl>
            <h3>{t({id: 'ecosystem.roadmap.priorities', message: 'Upcoming priorities'})}</h3>
            <p>
              {t({
                id: 'ecosystem.roadmap.summary',
                message:
                  'The project tracks performance objectives and planned releases. Progress counts items marked Done or Released.',
              })}
            </p>
            {state.data.objectives.length > 0 && (
              <p>
                {t({
                  id: 'ecosystem.roadmap.objectiveSummary',
                  message:
                    '{done} of {total} tracked performance items are done across {count} objectives.',
                })
                  .replace(
                    '{done}',
                    String(
                      state.data.objectives.reduce((sum, objective) => sum + objective.done, 0),
                    ),
                  )
                  .replace(
                    '{total}',
                    String(
                      state.data.objectives.reduce((sum, objective) => sum + objective.total, 0),
                    ),
                  )
                  .replace('{count}', String(state.data.objectives.length))}
              </p>
            )}
            {releases.length > 0 && (
              <div>
                <p>{t({id: 'ecosystem.roadmap.releases', message: 'Planned releases:'})}</p>
                <ol
                  className={styles.releases}
                  aria-label={t({id: 'ecosystem.roadmap.releases', message: 'Planned releases:'})}
                >
                  {releases.map((release) => (
                    <li key={release}>{release}</li>
                  ))}
                </ol>
              </div>
            )}
            {state.data.objectives.length === 0 ? (
              <p>
                {t({
                  id: 'ecosystem.roadmap.empty',
                  message: 'No performance objectives are currently tracked.',
                })}
              </p>
            ) : (
              <>
                <ul className={styles.objectives}>
                  {state.data.objectives.map((objective) => (
                    <li key={objective.name}>
                      <strong>{objective.name}</strong>{' '}
                      <span>
                        {t({
                          id: 'ecosystem.roadmap.progress',
                          message: '{done} of {total} done ({percent}%)',
                        })
                          .replace('{done}', String(objective.done))
                          .replace('{total}', String(objective.total))
                          .replace(
                            '{percent}',
                            String(Math.round((objective.done / objective.total) * 100)),
                          )}
                      </span>
                      <progress
                        aria-label={`${objective.name}: ${t({id: 'ecosystem.roadmap.progressLabel', message: '{done} of {total} done'}).replace('{done}', String(objective.done)).replace('{total}', String(objective.total))}`}
                        max={objective.total}
                        value={objective.done}
                      />
                    </li>
                  ))}
                </ul>
                <table>
                  <caption>
                    {t({id: 'ecosystem.roadmap.table', message: 'Performance objective progress'})}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">
                        {t({id: 'ecosystem.roadmap.objective', message: 'Objective'})}
                      </th>
                      <th scope="col">{t({id: 'ecosystem.roadmap.done', message: 'Done'})}</th>
                      <th scope="col">{t({id: 'ecosystem.roadmap.total', message: 'Total'})}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.objectives.map((o) => (
                      <tr key={o.name}>
                        <th scope="row">{o.name}</th>
                        <td>{o.done}</td>
                        <td>{o.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            <p>
              {t({id: 'ecosystem.roadmap.date', message: 'Data snapshot:'})}{' '}
              <time dateTime={state.data.builtAt}>{state.data.builtAt.slice(0, 10)} UTC</time>
            </p>
          </>
        )}
        <p>
          {t({
            id: 'ecosystem.roadmap.unlabelled',
            message:
              'Tickets without a performance objective, including bugs, docs and integration work, are not listed among priorities.',
          })}
        </p>
        <Button variant="ghost" size="md" href={issueUrl}>
          {t({id: 'ecosystem.roadmap.create', message: 'Create a ticket'})}
        </Button>
      </div>
    </section>
  );
}

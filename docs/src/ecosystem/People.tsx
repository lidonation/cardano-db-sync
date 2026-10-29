import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Avatar from '../components/Avatar';
import Metric from '../components/Metric';
import type {PageMessage} from '../i18n/pageTranslator';
import type {Contributor, RepositoryState} from '../repository-activity/types';
import {COUNTRY_POINTS} from '../repository-activity/world';
import Eyebrow from '../landing/Eyebrow';
import layout from '../landing/styles.module.css';
import {CORE_TEAM} from './entries';
import styles from './people.module.css';

type Translate = (message: PageMessage) => string;
function Face({person, core = false}: {person: Contributor; core?: boolean}) {
  const src = useBaseUrl(person.avatar ?? '');
  return (
    <Avatar
      name={person.name}
      src={person.avatar ? src : undefined}
      size={core ? 'core' : 'contributor'}
    />
  );
}

export function RepositoryFacts({state, t}: {state: RepositoryState; t: Translate}) {
  if (state.status === 'unavailable')
    return (
      <p>
        {t({
          id: 'ecosystem.activity.unavailable',
          message: 'Repository activity data is unavailable in this build.',
        })}
      </p>
    );
  const data = state.data;
  const m = data.metrics;
  const facts = [
    [m.commits, t({id: 'ecosystem.activity.commits', message: 'commits all time'})],
    [m.pastYear, t({id: 'ecosystem.activity.year', message: 'commits in the past year'})],
    [m.lines, t({id: 'ecosystem.activity.lines', message: 'lines of code'})],
    [m.contributors, t({id: 'ecosystem.activity.contributors', message: 'contributors'})],
    [m.years, t({id: 'ecosystem.activity.years', message: 'years since the first commit'})],
  ] as const;
  return (
    <>
      <p>
        {t({
          id: 'ecosystem.activity.basis',
          message: 'Commits on upstream master; GitHub contributors, excluding bots.',
        })}
      </p>
      <ul className={styles.facts}>
        {facts.map(([value, label]) => (
          <li key={label}>
            <Metric value={value === null ? '—' : value.toLocaleString('en')} label={label} />
          </li>
        ))}
      </ul>
      <p>
        {t({id: 'ecosystem.activity.built', message: 'Data built:'})}{' '}
        <time dateTime={data.builtAt}>{data.builtAt.slice(0, 10)} UTC</time>
      </p>
      {m.commits === 0 && (
        <p>
          {t({
            id: 'ecosystem.activity.empty',
            message: 'No repository commits are available in this snapshot.',
          })}
        </p>
      )}
    </>
  );
}

export function RepositoryPeople({state, t}: {state: RepositoryState; t: Translate}) {
  if (state.status === 'unavailable') return null;
  const data = state.data;
  const core = CORE_TEAM.map((entry) => {
    const person = data.coreTeam.find(
      (contributor) => contributor.login.toLowerCase() === entry.login.toLowerCase(),
    ) ??
      data.contributors.find(
        (contributor) => contributor.login.toLowerCase() === entry.login.toLowerCase(),
      ) ?? {login: entry.login, name: entry.login, commits: 0, avatar: null};
    return {person, role: 'role' in entry ? entry.role : undefined};
  });
  const coreLogins = new Set(core.map(({person}) => person.login.toLowerCase()));
  const others = data.contributors.filter((person) => !coreLogins.has(person.login.toLowerCase()));
  const knownCountries = data.countries.length;
  return (
    <>
      <section className={layout.section} aria-labelledby="ecosystem-origins">
        <div className={layout.inner}>
          <Eyebrow>{t({id: 'ecosystem.origins.eyebrow', message: 'commit origins'})}</Eyebrow>
          <h2 id="ecosystem-origins" className={layout.heading}>
            {t({id: 'ecosystem.origins.title', message: 'A community across the world'})}
          </h2>
          <p id="ecosystem-origins-summary" className={layout.intro}>
            {t({
              id: 'ecosystem.origins.summary',
              message:
                '{countries} countries · {people} contributors. Countries come from public GitHub profile locations; {unknown} are unknown.',
            })
              .replace('{countries}', String(knownCountries))
              .replace('{people}', String(data.contributors.length))
              .replace('{unknown}', String(data.unknownCountries))}
          </p>
          <div className={styles.map} aria-hidden="true">
            <span className={styles.land} />
            <svg className={styles.mapDots} viewBox="0 0 720 360" focusable="false">
              {data.countries.map(({country}) => {
                const point = Object.hasOwn(COUNTRY_POINTS, country)
                  ? COUNTRY_POINTS[country]
                  : undefined;
                return point ? (
                  <circle className={styles.dot} key={country} cx={point[0]} cy={point[1]} r="3" />
                ) : null;
              })}
            </svg>
          </div>
          <table className={styles.table} aria-describedby="ecosystem-origins-summary">
            <caption>
              {t({id: 'ecosystem.origins.table', message: 'Contributors by country'})}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t({id: 'ecosystem.origins.country', message: 'Country'})}</th>
                <th scope="col">{t({id: 'ecosystem.origins.count', message: 'Contributors'})}</th>
              </tr>
            </thead>
            <tbody>
              {data.countries.map(({country, count}) => (
                <tr key={country}>
                  <th scope="row">{country}</th>
                  <td>{count}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">{t({id: 'ecosystem.origins.unknown', message: 'Unknown'})}</th>
                <td>{data.unknownCountries}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className={layout.section} aria-labelledby="ecosystem-people">
        <div className={layout.inner}>
          <Eyebrow>{t({id: 'ecosystem.people.eyebrow', message: 'the people'})}</Eyebrow>
          <h2 id="ecosystem-people" className={layout.heading}>
            {t({id: 'ecosystem.people.title', message: 'The Core Team'})}
          </h2>
          {data.contributors.length === 0 ? (
            <p>
              {t({
                id: 'ecosystem.people.empty',
                message: 'No contributors are available in this snapshot.',
              })}
            </p>
          ) : (
            <>
              <h3>{t({id: 'ecosystem.people.core', message: 'Core team'})}</h3>
              <ul className={`${styles.people} ${styles.core}`}>
                {core.map(({person, role}) => (
                  <li key={person.login}>
                    <Face person={person} core />
                    <strong>{person.login}</strong>
                    {role && (
                      <span>
                        {t({id: 'ecosystem.people.maintainer', message: 'Community Maintainer'})}
                      </span>
                    )}
                    {(!role || person.commits > 0) && (
                      <span>
                        {person.commits.toLocaleString('en')}{' '}
                        {t({id: 'ecosystem.people.commits', message: 'commits'})}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <h3>
                {t({
                  id: 'ecosystem.people.more',
                  message: '{count} more people have landed a commit.',
                }).replace('{count}', String(others.length))}
              </h3>
              <ul className={styles.people}>
                {others.map((person) => (
                  <li key={person.login}>
                    <Face person={person} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </>
  );
}

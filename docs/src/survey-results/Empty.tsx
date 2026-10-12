import React from 'react';
import landing from '../landing/styles.module.css';
import Intro from './Intro';
import type {DashboardViewProps} from './Dashboard';

export function EmptySection({t}: Pick<DashboardViewProps, 't'>): React.JSX.Element {
  return React.createElement(
    'section',
    {className: landing.section, 'aria-labelledby': 'results-empty'},
    React.createElement(
      'div',
      {className: landing.inner},
      React.createElement(
        'h2',
        {id: 'results-empty', className: landing.heading},
        t({id: 'results.empty.title', message: 'Pre-tally: no results yet'}),
      ),
      React.createElement(
        'p',
        {className: landing.intro},
        t({
          id: 'results.empty.body',
          message:
            'The tally has not run yet, so there is nothing to show. This page will list the results once responses are tallied.',
        }),
      ),
    ),
  );
}

export default function EmptyDashboard(props: DashboardViewProps): React.JSX.Element {
  return React.createElement(
    'div',
    {className: landing.landing},
    React.createElement(Intro, props),
    React.createElement(EmptySection, {t: props.t}),
  );
}

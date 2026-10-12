import React from 'react';
import landing from '../landing/styles.module.css';
import type {DashboardViewProps} from './Dashboard';
import {interpolateMessage} from './messages';

export default function Intro({resolved, t}: DashboardViewProps): React.JSX.Element {
  const message = (entry: Parameters<typeof t>[0], values: Record<string, string | number>) =>
    interpolateMessage(t(entry), values);
  const basis = message(
    {
      id: 'results.basis.message',
      message:
        'These counts use response-time validation only. They will be re-verified canonically at tally time, when epoch {epoch} ends.',
    },
    {epoch: resolved.endEpoch},
  );
  const interim = t({
    id: 'results.interim.message',
    message:
      'Every figure on this page is an interim tally, and stays interim: results are never final.',
  });
  return React.createElement(
    'section',
    {className: landing.section, 'aria-labelledby': 'results-title'},
    React.createElement(
      'div',
      {className: landing.inner},
      React.createElement(
        'p',
        {className: landing.eyebrow},
        React.createElement('span', {'aria-hidden': 'true'}, '// '),
        t({id: 'results.eyebrow', message: 'results'}),
      ),
      React.createElement(
        'h1',
        {id: 'results-title', className: landing.heading},
        t({id: 'results.title', message: 'Survey results'}),
      ),
      React.createElement(
        'p',
        {className: landing.intro},
        t({
          id: 'results.intro',
          message:
            'How operators run Cardano DB Sync, as tallied from survey responses. Counts are exact; bars show each share.',
        }),
      ),
      React.createElement('p', {className: landing.intro}, basis),
      React.createElement('p', {className: landing.intro}, interim),
    ),
  );
}

import React from 'react';

import landing from '../landing/styles.module.css';

import dash from './styles.module.css';
import type {ResolvedAggregate} from './types';

/**
 * B44-f — the survey results dashboard, render half. Pure: resolved data plus a translate
 * function, so it renders under vitest node with the identity fallback. The page
 * (`pages/survey/results`) wires the locale hook, the manifest and the aggregate.
 *
 * Written with `createElement` (no JSX): the shared tsconfig preserves JSX for the
 * Docusaurus Babel build, and unit tests must import a transform-free view.
 */
export type DashboardTranslate = (message: {
  readonly id: string;
  readonly message: string;
}) => string;

export interface DashboardViewProps {
  readonly resolved: ResolvedAggregate;
  readonly t: DashboardTranslate;
}

/** An option's share of its question total as a 5% width bucket class, 0–100. */
export function widthBucket(share: number): number {
  if (!Number.isFinite(share) || share <= 0) return 0;
  return Math.min(100, Math.round(share * 20) * 5);
}

/** Every bucket class, named statically so the build keeps each one (PERF-1). */
const WIDTH_CLASS: Record<number, string> = {
  0: dash.w0,
  5: dash.w5,
  10: dash.w10,
  15: dash.w15,
  20: dash.w20,
  25: dash.w25,
  30: dash.w30,
  35: dash.w35,
  40: dash.w40,
  45: dash.w45,
  50: dash.w50,
  55: dash.w55,
  60: dash.w60,
  65: dash.w65,
  70: dash.w70,
  75: dash.w75,
  80: dash.w80,
  85: dash.w85,
  90: dash.w90,
  95: dash.w95,
  100: dash.w100,
};

export default function DashboardView({resolved, t}: DashboardViewProps): React.JSX.Element {
  const basis = t({
    id: 'results.basis.message',
    message: `These counts use response-time validation only. They will be re-verified canonically at tally time, when epoch ${resolved.endEpoch} ends.`,
  });
  const interim = t({
    id: 'results.interim.message',
    message:
      'Every figure on this page is an interim tally, and stays interim: results are never final.',
  });
  return React.createElement(
    'div',
    {className: landing.landing},
    React.createElement(
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
    ),
    resolved.questions.length === 0
      ? React.createElement(
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
        )
      : resolved.questions.map((question) => {
          const total = question.options.reduce((sum, option) => sum + option.count, 0);
          const sectionId = `results-question-${question.question}`;
          const responses = total === 1 ? '1 response' : `${total} responses`;
          const options =
            question.options.length === 1 ? '1 option' : `${question.options.length} options`;
          const summary = `${responses} counted across ${options}.`;
          return React.createElement(
            'section',
            {key: question.question, className: landing.section, 'aria-labelledby': sectionId},
            React.createElement(
              'div',
              {className: landing.inner},
              React.createElement(
                'h2',
                {id: sectionId, className: landing.heading},
                question.label,
              ),
              React.createElement(
                'div',
                {className: dash.bars, 'aria-hidden': 'true'},
                question.options.map((option) =>
                  React.createElement(
                    'div',
                    {key: option.option},
                    React.createElement('span', null, option.label),
                    ' ',
                    React.createElement('span', null, option.count),
                    React.createElement(
                      'div',
                      {className: dash.bar},
                      React.createElement('div', {
                        className: `${dash.fill} ${WIDTH_CLASS[widthBucket(total === 0 ? 0 : option.count / total)]}`,
                      }),
                    ),
                  ),
                ),
              ),
              React.createElement(
                'table',
                null,
                React.createElement(
                  'caption',
                  null,
                  t({id: 'results.question.table.caption', message: 'Responses by option'}),
                ),
                React.createElement(
                  'thead',
                  null,
                  React.createElement(
                    'tr',
                    null,
                    React.createElement(
                      'th',
                      {scope: 'col'},
                      t({id: 'results.question.table.option', message: 'Option'}),
                    ),
                    React.createElement(
                      'th',
                      {scope: 'col'},
                      t({id: 'results.question.table.count', message: 'Count'}),
                    ),
                  ),
                ),
                React.createElement(
                  'tbody',
                  null,
                  question.options.map((option) =>
                    React.createElement(
                      'tr',
                      {key: option.option},
                      React.createElement('th', {scope: 'row'}, option.label),
                      React.createElement('td', null, option.count),
                    ),
                  ),
                ),
              ),
              React.createElement(
                'p',
                {className: landing.intro},
                t({id: 'results.question.summary', message: summary}),
              ),
              question.history && question.history.length > 0
                ? React.createElement(
                    'div',
                    null,
                    React.createElement(
                      'h3',
                      null,
                      t({id: 'results.history.heading', message: 'History'}),
                    ),
                    React.createElement(
                      'p',
                      {className: landing.intro},
                      t({
                        id: 'results.history.note',
                        message: 'This history is derived, never a CIP-179 tally.',
                      }),
                    ),
                    React.createElement(
                      'table',
                      null,
                      React.createElement(
                        'tbody',
                        null,
                        question.history.map((point) =>
                          React.createElement(
                            'tr',
                            {key: point.epoch},
                            React.createElement('th', {scope: 'row'}, `Epoch ${point.epoch}`),
                            point.counts.map((count, index) =>
                              React.createElement('td', {key: `${point.epoch}-${index}`}, count),
                            ),
                          ),
                        ),
                      ),
                    ),
                  )
                : null,
            ),
          );
        }),
    resolved.editorialMerge
      ? React.createElement(
          'section',
          {className: landing.section},
          React.createElement(
            'div',
            {className: landing.inner},
            React.createElement(
              'p',
              {className: landing.intro},
              t({
                id: 'results.merge.note',
                message:
                  'Merged counts are an editorial view: a newer option absorbs the counts of the older options it replaces. The absorbed options stay named in the tables.',
              }),
            ),
          ),
        )
      : null,
    resolved.closed.length > 0
      ? React.createElement(
          'section',
          {className: landing.section, 'aria-labelledby': 'results-closed'},
          React.createElement(
            'div',
            {className: landing.inner},
            React.createElement(
              'h2',
              {id: 'results-closed', className: landing.heading},
              t({id: 'results.closed.heading', message: 'Closed questions'}),
            ),
            React.createElement(
              'p',
              {className: landing.intro},
              t({
                id: 'results.closed.note',
                message:
                  'These options were superseded and are reported separately. Their counts were never merged into another option.',
              }),
            ),
            React.createElement(
              'ul',
              null,
              resolved.closed.map((item) =>
                React.createElement(
                  'li',
                  {
                    key: `${item.question}-${item.supersededBy.question}-${item.supersededBy.option}`,
                  },
                  `${item.label} — ${item.options.map((option) => `${option.label}: ${option.count}`).join(', ')} — Superseded by question ${item.supersededBy.question}, option ${item.supersededBy.option}`,
                ),
              ),
            ),
          ),
        )
      : null,
    resolved.freeText.length > 0
      ? React.createElement(
          'section',
          {className: landing.section, 'aria-labelledby': 'results-freetext'},
          React.createElement(
            'div',
            {className: landing.inner},
            React.createElement(
              'h2',
              {id: 'results-freetext', className: landing.heading},
              t({id: 'results.freeText.heading', message: 'What respondents wrote'}),
            ),
            React.createElement(
              'p',
              {className: landing.intro},
              t({
                id: 'results.freeText.note',
                message: 'Only responses that passed review are shown.',
              }),
            ),
            React.createElement(
              'ul',
              null,
              resolved.freeText.map((item) => React.createElement('li', {key: item.id}, item.text)),
            ),
          ),
        )
      : null,
  );
}

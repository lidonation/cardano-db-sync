/**
 * Every UI string id the survey results dashboard renders, for its A11Y-18 language marking:
 * a locale missing any of them shows English, announced as English.
 * `test/unit/survey-results.test.ts` holds this list equal to the ids the page uses.
 */
export const DASHBOARD_IDS = [
  'results.basis.message',
  'results.closed.heading',
  'results.closed.note',
  'results.empty.body',
  'results.empty.title',
  'results.eyebrow',
  'results.freeText.heading',
  'results.freeText.note',
  'results.history.heading',
  'results.history.note',
  'results.interim.message',
  'results.intro',
  'results.merge.note',
  'results.meta.description',
  'results.meta.title',
  'results.question.summary',
  'results.question.table.caption',
  'results.question.table.count',
  'results.question.table.option',
  'results.title',
] as const;

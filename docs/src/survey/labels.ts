import {translate} from '@docusaurus/Translate';

import {surveyLabelId} from './labelIds';

export {surveyLabelId};

/** A label in the current locale, falling back to the English presentation text. */
export function surveyLabel(english: string, question: number, option?: number): string {
  return translate({
    id: surveyLabelId(question, option),
    message: english,
    description: 'Survey label, keyed by its on-chain index (SUR-5)',
  });
}

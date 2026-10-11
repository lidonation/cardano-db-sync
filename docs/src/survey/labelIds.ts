/**
 * SUR-5 — survey labels are translated by question and option **index**, never by English text.
 *
 * On chain the survey holds structure and option counts; responses carry indices. The English
 * presentation JSON is hash-anchored, and every other locale's labels come from Docusaurus i18n
 * under ids built from those same indices. An edit to the English copy changes no id, so no
 * translation is orphaned and no answer is mislabelled. Indices are the interlingua (as SRCH-5).
 */

function assertIndex(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`SUR-5: ${name} index must be a non-negative integer, got ${value}`);
  }
}

/** The translation id of a question's label, or of one of its options. */
export function surveyLabelId(question: number, option?: number): string {
  assertIndex('question', question);
  if (option === undefined) {
    return `survey.question.${question}`;
  }
  assertIndex('option', option);
  return `survey.question.${question}.option.${option}`;
}

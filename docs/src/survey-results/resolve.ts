/**
 * B44-f — pure resolution helpers over the locked render contracts (`./types`).
 * No chain reads, no tallying, no wallet: subsumption resolution (SUR-26/27/28),
 * the pre-tally predicate, and the SUR-7 moderation filter.
 */
import type {
  Aggregate,
  FreeTextItem,
  IndexedRef,
  ResolvedAggregate,
  SubsumptionEdge,
  SurveyManifest,
} from './types';
import {END_EPOCH} from './types';

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function refKey(ref: IndexedRef): string {
  return `${ref.question}.${ref.option}`;
}

/** Every reason the manifest cannot be trusted, as readable lines. Empty means sound. */
export function validateManifest(manifest: SurveyManifest): string[] {
  const problems: string[] = [];
  if (manifest.endEpoch !== END_EPOCH) {
    problems.push(`SUR-15: endEpoch must be ${END_EPOCH}, got ${manifest.endEpoch}`);
  }
  for (const edge of manifest.subsumptions) {
    if (!isNonNegativeInt(edge.newer.question) || !isNonNegativeInt(edge.newer.option)) {
      problems.push(
        `SUR-26: newer index must be non-negative integers, got ${edge.newer.question}.${edge.newer.option}`,
      );
    }
    if (!isNonNegativeInt(edge.older.question) || !isNonNegativeInt(edge.older.option)) {
      problems.push(
        `SUR-26: older index must be non-negative integers, got ${edge.older.question}.${edge.older.option}`,
      );
    }
    if (edge.kind !== 'replaces' && edge.kind !== 'supersedes') {
      problems.push(`SUR-28: unknown subsumption kind, got ${(edge as {kind: unknown}).kind}`);
    }
  }
  // SUR-27 — the reverse direction is derived: an older end that is also a newer end
  // elsewhere closes a cycle (A absorbs B absorbs A), which has no meaning to render.
  const newerEnds = new Set(manifest.subsumptions.map((edge) => refKey(edge.newer)));
  for (const edge of manifest.subsumptions) {
    if (newerEnds.has(refKey(edge.older))) {
      problems.push(
        `SUR-27: subsumption cycle through ${refKey(edge.older)}: an absorbed option cannot absorb another`,
      );
    }
  }
  return problems;
}

/** True when no tally has run yet: the page renders its named pre-tally empty state. */
export function isPreTally(aggregate: Aggregate): boolean {
  return aggregate.questions.length === 0;
}

/** SUR-7 — the free-text items that passed review. Unreviewed items never reach the page. */
export function moderatedFreeText(aggregate: Aggregate): FreeTextItem[] {
  return aggregate.freeText.filter((item) => item.moderated);
}

/**
 * Apply the manifest's subsumption edges to an aggregate (SUR-28): `replaces` folds the
 * older option's count into its absorber as a labelled editorial merge; `supersedes`
 * closes the older option for separate reporting. Pure: inputs are never mutated.
 * Edges naming options the aggregate does not carry are skipped: the page renders what
 * the tally produced, and `validateManifest` reports dangling edges at check time.
 */
export function resolveAggregate(
  manifest: SurveyManifest,
  aggregate: Aggregate,
): ResolvedAggregate {
  const optionsByQuestion = new Map<number, Map<number, {label: string; count: number}>>();
  const questionMeta = new Map<
    number,
    {label: string; history: Aggregate['questions'][number]['history']}
  >();
  for (const question of aggregate.questions) {
    questionMeta.set(question.question, {label: question.label, history: question.history});
    const options = new Map<number, {label: string; count: number}>();
    for (const option of question.options) {
      options.set(option.option, {label: option.label, count: option.count});
    }
    optionsByQuestion.set(question.question, options);
  }
  const findOption = (ref: IndexedRef) => optionsByQuestion.get(ref.question)?.get(ref.option);

  const absorbed = new Map<
    string,
    {question: number; option: number; label: string; count: number}[]
  >();
  const closed = new Map<string, {label: string; count: number}>();
  let editorialMerge = false;

  const absorb = (edge: SubsumptionEdge) => {
    const target = findOption(edge.newer);
    const source = findOption(edge.older);
    if (!target || !source) return;
    if (edge.kind === 'replaces') {
      const list = absorbed.get(refKey(edge.newer)) ?? [];
      list.push({
        question: edge.older.question,
        option: edge.older.option,
        label: source.label,
        count: source.count,
      });
      absorbed.set(refKey(edge.newer), list);
      target.count += source.count;
      optionsByQuestion.get(edge.older.question)?.delete(edge.older.option);
      editorialMerge = true;
    } else {
      closed.set(refKey(edge.older), {label: source.label, count: source.count});
      optionsByQuestion.get(edge.older.question)?.delete(edge.older.option);
    }
  };
  for (const edge of manifest.subsumptions) absorb(edge);

  const questions = [...optionsByQuestion.entries()]
    .filter(([, options]) => options.size > 0)
    .map(([question, options]) => {
      const meta = questionMeta.get(question) ?? {
        label: `Question ${question}`,
        history: undefined,
      };
      const source = aggregate.questions.find((item) => item.question === question);
      const historyOptions = source?.options
        .slice()
        .sort((a, b) => a.option - b.option)
        .map((item) => item.label);
      return {
        question,
        label: meta.label,
        options: [...options.entries()].map(([option, entry]) => {
          const from = absorbed.get(`${question}.${option}`);
          return from
            ? {option, label: entry.label, count: entry.count, absorbedFrom: from}
            : {option, label: entry.label, count: entry.count};
        }),
        ...(meta.history ? {history: meta.history, historyOptions} : {}),
      };
    });

  const closedQuestions = [...closed.entries()].map(([key, entry]) => {
    const [questionText] = key.split('.');
    const question = Number(questionText);
    const edge = manifest.subsumptions.find(
      (candidate) => refKey(candidate.older) === key && candidate.kind === 'supersedes',
    )!;
    return {
      question,
      label: questionMeta.get(question)?.label ?? `Question ${question}`,
      options: [{option: Number(key.split('.')[1]), label: entry.label, count: entry.count}],
      supersededBy: edge.newer,
    };
  });

  return {
    surveyRef: aggregate.surveyRef,
    tallyBasis: aggregate.tallyBasis,
    interim: aggregate.interim,
    endEpoch: aggregate.endEpoch,
    questions,
    closed: closedQuestions,
    editorialMerge,
    freeText: moderatedFreeText(aggregate),
    generatedAt: aggregate.generatedAt,
  };
}

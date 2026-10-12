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
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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
  const graph = new Map<string, string[]>();
  for (const edge of manifest.subsumptions) {
    const key = refKey(edge.newer);
    graph.set(key, [...(graph.get(key) ?? []), refKey(edge.older)]);
  }
  const active = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (active.has(key)) {
      problems.push('SUR-27: subsumption cycle through ' + key);
      return;
    }
    if (visited.has(key)) return;
    active.add(key);
    for (const child of graph.get(key) ?? []) visit(child);
    active.delete(key);
    visited.add(key);
  };
  for (const key of graph.keys()) visit(key);
  const olderEnds = new Set<string>();
  for (const edge of manifest.subsumptions) {
    const key = refKey(edge.older);
    if (olderEnds.has(key)) problems.push('SUR-28: older option has multiple absorbers');
    olderEnds.add(key);
  }
  return problems;
}

/** True when no tally has run yet: the page renders its named pre-tally empty state. */
export function isPreTally(aggregate: Aggregate): boolean {
  return aggregate.questions.length === 0;
}

/** SUR-7 — the free-text items that passed review. Unreviewed items never reach the page. */
export function moderatedFreeText(aggregate: Aggregate): FreeTextItem[] {
  return aggregate.freeText.filter((item) => item.moderated === true);
}

/**
 * Apply the manifest's subsumption edges to an aggregate (SUR-28): `replaces` uses B26's
 * credential-deduplicated count for its absorber as a labelled editorial merge; `supersedes`
 * closes the older option for separate reporting. Pure: inputs are never mutated.
 * Edges naming options the aggregate does not carry are skipped: the page renders what
 * the tally produced, so partial artifacts and the pre-tally state stay renderable.
 */
export function resolveAggregate(
  manifest: SurveyManifest,
  aggregate: Aggregate,
): ResolvedAggregate {
  const problems = validateManifest(manifest);
  if (problems.length) throw new Error(problems.join('; '));
  if (
    aggregate.surveyRef !== manifest.surveyRef ||
    aggregate.endEpoch !== manifest.endEpoch ||
    aggregate.tallyBasis !== 'response-time-only' ||
    aggregate.interim !== true
  ) {
    throw new Error('Survey artifact identity or tally basis does not match its manifest');
  }
  const seenQuestions = new Set<number>();
  for (const question of aggregate.questions) {
    if (!isNonNegativeInt(question.question) || seenQuestions.has(question.question)) {
      throw new Error('Invalid or duplicate question index');
    }
    seenQuestions.add(question.question);
    const seenOptions = new Set<number>();
    for (const option of question.options) {
      if (
        !isNonNegativeInt(option.option) ||
        !isNonNegativeInt(option.count) ||
        seenOptions.has(option.option)
      ) {
        throw new Error('Invalid count or duplicate option index');
      }
      seenOptions.add(option.option);
    }
    const epochs = new Set<number>();
    for (const point of question.history ?? []) {
      if (
        !isNonNegativeInt(point.epoch) ||
        epochs.has(point.epoch) ||
        point.counts.length !== question.options.length ||
        !point.counts.every(isNonNegativeInt)
      ) {
        throw new Error('Invalid history epoch, count or column cardinality');
      }
      epochs.add(point.epoch);
    }
  }
  const replacements = new Map<string, number>();
  for (const item of aggregate.replacements ?? []) {
    const key = refKey(item.newer);
    if (!isNonNegativeInt(item.count) || replacements.has(key)) {
      throw new Error('Invalid or duplicate replacement tally');
    }
    replacements.set(key, item.count);
  }
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
      list.push(...(absorbed.get(refKey(edge.older)) ?? []));
      absorbed.set(refKey(edge.newer), list);
      const count = replacements.get(refKey(edge.newer));
      if (count === undefined)
        throw new Error('B26 must supply credential-deduplicated replacement counts');
      target.count = count;
      optionsByQuestion.get(edge.older.question)?.delete(edge.older.option);
      editorialMerge = true;
    } else {
      closed.set(refKey(edge.older), {label: source.label, count: source.count});
      optionsByQuestion.get(edge.older.question)?.delete(edge.older.option);
    }
  };
  // Resolve older links first so a valid A -> B -> C chain is order-independent.
  const ordered: SubsumptionEdge[] = [];
  const added = new Set<SubsumptionEdge>();
  const order = (edge: SubsumptionEdge): void => {
    if (added.has(edge)) return;
    for (const dependency of manifest.subsumptions) {
      if (refKey(dependency.newer) === refKey(edge.older)) order(dependency);
    }
    added.add(edge);
    ordered.push(edge);
  };
  for (const edge of manifest.subsumptions) order(edge);
  for (const edge of ordered) absorb(edge);

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

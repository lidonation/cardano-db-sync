/** Pure, browser-free registry queries. No fetching, signing, chain proof or tally arithmetic. */
import Ajv from 'ajv';
import schema from './schema.json';
import type {Network, QuestionRef, Successor, SurveyRecord, SurveyRegistry} from './types';

const checkSchema = new Ajv({allErrors: true, jsonPointers: true}).compile(schema);
export const questionKey = (ref: QuestionRef): string => `${ref.surveyRef}:${ref.question}`;
const identity = (survey: SurveyRecord) => `${survey.network}:${survey.surveyRef}`;
const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** Validate untrusted JSON before using typed queries. Never coerce or strip unknown fields. */
export function readRegistry(input: unknown): SurveyRegistry {
  if (!checkSchema(input)) {
    throw new Error('Survey registry schema: ' + JSON.stringify(checkSchema.errors));
  }
  const registry = input as SurveyRegistry;
  const seen = new Map<string, SurveyRecord>();
  const absorbed = new Set<string>();
  const networks = new Set<Network>();
  const fail = (message: string): never => {
    throw new Error('Survey registry: ' + message);
  };
  for (const survey of registry.surveys) {
    if (Number(survey.surveyRef.split('#')[1]) > 65535) fail('definition index exceeds uint16');
    if (seen.has(identity(survey))) fail('duplicate survey reference');
    if (survey.definedEpoch >= survey.endEpoch) fail('end epoch must exceed definition epoch');
    if (
      survey.cancelledEpoch !== undefined &&
      (survey.cancelledEpoch < survey.definedEpoch || survey.cancelledEpoch > survey.endEpoch)
    ) {
      fail('cancellation outside definition lifetime');
    }
    const earlier = (ref: string): SurveyRecord => {
      const older = seen.get(`${survey.network}:${ref}`);
      if (!older || older.definedEpoch > survey.definedEpoch) {
        fail('edge must reference an earlier definition on the same network (no cycles)');
      }
      return older!;
    };
    if (survey.evolvesFrom) earlier(survey.evolvesFrom);
    else if (networks.has(survey.network)) {
      fail('a later definition must declare additive evolution');
    }
    for (const edge of survey.subsumes) {
      const older = earlier(edge.older.surveyRef);
      const oldQuestion = older.questions[edge.older.question];
      const newQuestion = survey.questions[edge.question];
      if (!oldQuestion || !newQuestion) fail('subsumption question index out of bounds');
      const key = `${survey.network}:${questionKey(edge.older)}`;
      if (absorbed.has(key)) fail('question has multiple absorbers');
      absorbed.add(key);
      if (edge.kind === 'supersedes') {
        if (edge.optionMap) fail('supersedes must never merge options');
      } else if (oldQuestion.optionCount !== undefined || newQuestion.optionCount !== undefined) {
        if (oldQuestion.optionCount === undefined || newQuestion.optionCount === undefined) {
          fail('replacement question shapes disagree');
        }
        const mappings = edge.optionMap ?? [];
        if (
          mappings.length !== oldQuestion.optionCount ||
          new Set(mappings.map((m) => m.older)).size !== mappings.length ||
          mappings.some(
            (m) => m.older >= oldQuestion.optionCount! || m.newer >= newQuestion.optionCount!,
          )
        ) {
          fail('replaces requires a complete, bounded option mapping');
        }
      } else if (edge.optionMap) fail('non-option questions cannot map options');
    }
    seen.set(identity(survey), survey);
    networks.add(survey.network);
  }
  for (const network of ['preview', 'mainnet'] as const) {
    const ref = registry.current[network];
    const cores = registry.surveys.filter((s) => s.network === network && s.kind === 'core');
    if (ref === null ? cores.length > 0 : !cores.some((s) => s.surveyRef === ref)) {
      fail('current must name a registered core on its own network, or null before publication');
    }
  }
  return registry;
}

/** Old definitions and declarations are append-only; only recording cancellation is mutable. */
export function validateEvolution(before: SurveyRegistry, after: SurveyRegistry): string[] {
  const problems: string[] = [];
  try {
    readRegistry(before);
    readRegistry(after);
  } catch (error) {
    return [String(error)];
  }
  for (const [index, older] of before.surveys.entries()) {
    const newer = after.surveys[index];
    if (!newer || identity(older) !== identity(newer)) {
      problems.push('Registry history cannot be removed or reordered');
      continue;
    }
    const {cancelledEpoch: oldCancellation, ...oldFrozen} = older;
    const {cancelledEpoch: newCancellation, ...newFrozen} = newer;
    // Compare JSON values independent of object-key serialization order.
    if (
      !equalJson(oldFrozen, newFrozen) ||
      (oldCancellation !== undefined && oldCancellation !== newCancellation)
    ) {
      problems.push(`${identity(older)}: immutable definition/declarations changed`);
    }
  }
  return problems;
}
function equalJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aa = a as Record<string, unknown>,
    bb = b as Record<string, unknown>;
  const keys = Object.keys(aa);
  return (
    keys.length === Object.keys(bb).length &&
    keys.every((key) => Object.hasOwn(bb, key) && equalJson(aa[key], bb[key]))
  );
}

/** Derived only: no backward pointer is persisted in an immutable definition. */
export function successorIndex(registry: SurveyRegistry, network: Network): Map<string, Successor> {
  const index = new Map<string, Successor>();
  for (const survey of registry.surveys) {
    if (survey.network !== network) continue;
    for (const edge of survey.subsumes) {
      index.set(questionKey(edge.older), {
        ...edge,
        newer: {surveyRef: survey.surveyRef, question: edge.question},
      });
    }
  }
  return index;
}

/** CIP cutoff is inclusive. Cancellation/expiry of one supplement never retires the core. */
export function activeQuestions(
  registry: SurveyRegistry,
  network: Network,
  epoch: number,
): QuestionRef[] {
  if (!integer(epoch)) throw new Error('Invalid current epoch');
  const live = registry.surveys.filter(
    (s) =>
      s.network === network &&
      s.definedEpoch <= epoch &&
      epoch <= s.endEpoch &&
      (s.cancelledEpoch === undefined || epoch < s.cancelledEpoch),
  );
  const hidden = new Set(live.flatMap((s) => s.subsumes.map((edge) => questionKey(edge.older))));
  return live
    .flatMap((s) => s.questions.map((_, question) => ({surveyRef: s.surveyRef, question})))
    .filter((ref) => !hidden.has(questionKey(ref)));
}

/** Historical identities are not erased by expiry. Never sum marginal counts here: B26 must
 * deduplicate per credential for a labelled editorial replacement, not a CIP-179 tally. */
export function resolveHistoricalOption(
  registry: SurveyRegistry,
  network: Network,
  ref: QuestionRef,
  option?: number,
): {
  target: QuestionRef;
  option: number | null;
  editorialMerge: boolean;
  closed: boolean;
} {
  const survey = registry.surveys.find(
    (s) => s.network === network && s.surveyRef === ref.surveyRef,
  );
  const question = integer(ref.question) ? survey?.questions[ref.question] : undefined;
  if (
    !question ||
    (option !== undefined && (!integer(option) || option >= (question.optionCount ?? 0)))
  ) {
    throw new Error('Unknown historical question or option on this network');
  }
  const index = successorIndex(registry, network);
  let target = ref,
    resolvedOption = option ?? null,
    editorialMerge = false;
  const cancelled = new Set(
    registry.surveys
      .filter((s) => s.network === network && s.cancelledEpoch !== undefined)
      .map((s) => s.surveyRef),
  );
  // readRegistry establishes a DAG with one successor per older question.
  for (let edge = index.get(questionKey(target)); edge; edge = index.get(questionKey(target))) {
    if (cancelled.has(edge.newer.surveyRef)) break; // Cancelled surveys must never supply tally answers.
    target = edge.newer;
    if (edge.kind === 'supersedes')
      return {target, option: null, editorialMerge: false, closed: true};
    if (resolvedOption !== null)
      resolvedOption = edge.optionMap!.find((m) => m.older === resolvedOption)!.newer;
    editorialMerge = true;
  }
  return {target, option: resolvedOption, editorialMerge, closed: false};
}

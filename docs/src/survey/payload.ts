import {blake2b} from '@noble/hashes/blake2b';
import freeTextSchema from './free-text-schema.json';
import {chunkText, encodeMetadata, utf8} from './metadata';
import type {
  Anchor,
  Answer,
  Credential,
  Definition,
  DefinitionInput,
  Metadatum,
  NumericConstraints,
  Question,
  Response,
  ResponseInput,
} from './types';

export const SPEC_VERSION = 5;
export const METADATA_LABEL = 17;
/** Must equal the published file byte-for-byte; tested against the static asset. */
export const FREE_TEXT_SCHEMA_BYTES = utf8(JSON.stringify(freeTextSchema) + '\n');
const hash = (bytes: Uint8Array) => blake2b(bytes, {dkLen: 32});
function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`CIP-179: ${message}`);
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): asserts value is number {
  requireThat(
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max,
    'integer out of range',
  );
}
function array(value: unknown, min: number, max = min): asserts value is Metadatum[] {
  requireThat(
    Array.isArray(value) && value.length >= min && value.length <= max,
    'invalid array shape',
  );
}
function bytes(value: unknown, size: number): asserts value is Uint8Array {
  requireThat(value instanceof Uint8Array && value.length === size, `expected ${size} raw bytes`);
}
function text(value: unknown): asserts value is string | string[] {
  if (typeof value === 'string') {
    requireThat(utf8(value).length <= 64, 'text exceeds 64 UTF-8 bytes');
  } else {
    array(value, 1, Number.MAX_SAFE_INTEGER);
    for (const chunk of value) {
      requireThat(typeof chunk === 'string' && utf8(chunk).length <= 64, 'invalid text chunk');
    }
  }
}
function credential(value: unknown): asserts value is Credential {
  array(value, 2);
  requireThat(value[0] === 0 || value[0] === 1, 'invalid credential tag');
  bytes(value[1], 28);
}
function anchor(value: unknown): asserts value is Anchor {
  array(value, 2);
  text(value[0]);
  const uri = typeof value[0] === 'string' ? value[0] : value[0].join('');
  requireThat(
    /^(https:\/\/[^\s]+|ipfs:\/\/[^\s]+)$/.test(uri),
    'anchor requires an HTTPS or IPFS URI',
  );
  bytes(value[1], 32);
}
export function verifyAnchor(rawBytes: Uint8Array, value: Anchor): boolean {
  anchor(value);
  return hash(rawBytes).every((byte, index) => byte === value[1][index]);
}
export function freeTextQuestion(schemaUri: string): Question {
  const value: Anchor = [chunkText(schemaUri), hash(FREE_TEXT_SCHEMA_BYTES)];
  anchor(value);
  return {tag: 0, anchor: value};
}
export function freeTextAnswer(questionIndex: number, value: string): Answer {
  integer(questionIndex);
  return [0, questionIndex, chunkText(value)];
}
/** Append in stage_two, stage_four order; absence is abstention, not zero. */
export function schemaVersionQuestions(): Question[] {
  return [
    {tag: 4, range: [0, 9999]},
    {tag: 4, range: [0, 9999]},
  ];
}
function numericRange(value: unknown): asserts value is NumericConstraints {
  array(value, 2, 3);
  integer(value[0], Number.MIN_SAFE_INTEGER);
  integer(value[1], value[0]);
  if (value.length === 3) integer(value[2], 1);
}
function onGrid(value: unknown, range: NumericConstraints): void {
  integer(value, range[0], range[1]);
  requireThat(
    (BigInt(value) - BigInt(range[0])) % BigInt(range[2] ?? 1) === 0n,
    'answer is off grid',
  );
}
function question(q: Question): Metadatum[] {
  requireThat(q.required === undefined || typeof q.required === 'boolean', 'invalid required flag');
  let result: Metadatum[];
  switch (q.tag) {
    case 0:
      anchor(q.anchor);
      requireThat(
        verifyAnchor(FREE_TEXT_SCHEMA_BYTES, q.anchor),
        'unsupported custom method schema',
      );
      result = [0, '', q.anchor];
      break;
    case 1:
      result = [1, '', q.options];
      break;
    case 2:
    case 3:
      integer(q.min, q.tag === 2 ? 0 : 1);
      integer(q.max, Math.max(1, q.min), q.options);
      result = [q.tag, '', q.options, q.min, q.max];
      break;
    case 4:
      numericRange(q.range);
      result = [4, '', q.range];
      break;
    case 5:
      integer(q.budget, 1);
      result = [5, '', q.options, q.budget];
      break;
    case 6:
      requireThat(typeof q.requireAll === 'boolean', 'invalid require_all flag');
      if (typeof q.scale === 'number') integer(q.scale, 2);
      else numericRange(q.scale);
      result = [6, '', q.options, q.scale as Metadatum, q.requireAll ? 1 : 0];
      break;
    default:
      throw new Error('CIP-179: unsupported question tag');
  }
  if ('options' in q) integer(q.options, 2);
  if (q.required) result.push(1);
  return result;
}

export function buildDefinition(input: DefinitionInput): {
  definition: Definition;
  presentationBytes: Uint8Array;
} {
  credential(input.owner);
  integer(input.currentEpoch);
  integer(input.endEpoch, input.currentEpoch + 1);
  requireThat(input.questions.length > 0, 'empty question set');
  const p = input.presentation;
  requireThat(
    p.specVersion === 5 && p.kind === 'cardano-survey-presentation',
    'invalid presentation profile',
  );
  requireThat(
    typeof p.title === 'string' && typeof p.description === 'string',
    'invalid presentation text',
  );
  requireThat(
    p.questions.length === input.questions.length,
    'presentation question count mismatch',
  );
  const questions = input.questions.map((q, index) => {
    const presentation = p.questions[index];
    requireThat(typeof presentation.prompt === 'string', 'missing prompt');
    if ('options' in q) {
      requireThat(
        presentation.options?.length === q.options &&
          presentation.options.every((option) => typeof option === 'string'),
        'presentation option count mismatch',
      );
    }
    if (q.tag === 6 && typeof q.scale === 'number') {
      requireThat(
        presentation.ratingLabels?.length === q.scale &&
          presentation.ratingLabels.every((label) => typeof label === 'string'),
        'presentation rating count mismatch',
      );
    }
    return question(q);
  });
  const presentationBytes = utf8(JSON.stringify(p) + '\n');
  const contentAnchor: Anchor = [chunkText(input.presentationUri), hash(presentationBytes)];
  anchor(contentAnchor);
  const definition: Definition = new Map<Metadatum, Metadatum>([
    [0, SPEC_VERSION],
    [1, input.owner],
    [2, ''],
    [3, ''],
    [4, [4]],
    [5, input.endEpoch],
    [6, [0]],
    [7, questions],
    [8, contentAnchor],
  ]);
  encodeMetadata(definition);
  // Detach all caller-owned arrays and bytes, and enforce the ledger subset.
  return {definition: structuredClone(definition), presentationBytes};
}

/** Validates this library's public external-content subset, not sealed/custom third-party methods. */
export function validateDefinition(definition: Definition): Question[] {
  requireThat(
    definition instanceof Map && definition.get(0) === SPEC_VERSION,
    'unsupported definition version',
  );
  encodeMetadata(definition);
  credential(definition.get(1));
  text(definition.get(2));
  text(definition.get(3));
  const roles = definition.get(4);
  array(roles, 1);
  requireThat(roles[0] === 4, 'eligible_roles must be Keyholder only');
  integer(definition.get(5));
  const mode = definition.get(6);
  array(mode, 1);
  requireThat(mode[0] === 0, 'public submission mode required');
  anchor(definition.get(8));
  const questions = definition.get(7);
  array(questions, 1, Number.MAX_SAFE_INTEGER);
  return questions.map((wire) => {
    array(wire, 3, 6);
    integer(wire[0], 0, 6);
    text(wire[1]);
    const tag = wire[0];
    let size = 3;
    if (tag === 2 || tag === 3 || tag === 6) size = 5;
    if (tag === 5) size = 4;
    requireThat(wire.length === size || wire.length === size + 1, 'invalid question arity');
    const flag = wire.length === size + 1 ? wire[size] : 0;
    requireThat(flag === 0 || flag === 1, 'invalid required flag');
    const required = flag === 1;
    let q: Question;
    switch (tag) {
      case 0:
        anchor(wire[2]);
        q = {tag, anchor: wire[2], required};
        break;
      case 1:
        integer(wire[2], 2);
        q = {tag, options: wire[2], required};
        break;
      case 2:
      case 3:
        integer(wire[2], 2);
        integer(wire[3]);
        integer(wire[4]);
        q = {tag, options: wire[2], min: wire[3], max: wire[4], required};
        break;
      case 4:
        numericRange(wire[2]);
        q = {tag, range: wire[2], required};
        break;
      case 5:
        integer(wire[2], 2);
        integer(wire[3], 1);
        q = {tag, options: wire[2], budget: wire[3], required};
        break;
      case 6:
        integer(wire[2], 2);
        if (typeof wire[3] === 'number') integer(wire[3], 2);
        else numericRange(wire[3]);
        requireThat(wire[4] === 0 || wire[4] === 1, 'invalid require_all flag');
        q = {tag, options: wire[2], scale: wire[3], requireAll: wire[4] === 1, required};
        break;
      default:
        throw new Error('CIP-179: unsupported question tag');
    }
    question(q); // Same semantic rules for construction and parsing.
    return q;
  });
}
function validateAnswers(answers: Answer[], questions: Question[]): void {
  array(answers, 1, questions.length);
  const seen = new Set<number>();
  for (const item of answers) {
    array(item, 3);
    const [tag, index, value] = item;
    integer(index, 0, questions.length - 1);
    const q = questions[index];
    requireThat(!seen.has(index) && tag === q.tag, 'duplicate index or wrong answer tag');
    seen.add(index);
    switch (q.tag) {
      case 0:
        text(value);
        break;
      case 1:
        integer(value, 0, q.options - 1);
        break;
      case 2:
      case 3: {
        array(value, q.min, q.max);
        for (const option of value) integer(option, 0, q.options - 1);
        requireThat(new Set(value).size === value.length, 'duplicate option');
        break;
      }
      case 4:
        onGrid(value, q.range);
        break;
      case 5:
      case 6: {
        array(value, 1, q.options);
        const options = new Set<number>();
        let total = 0n;
        for (const pair of value) {
          array(pair, 2);
          integer(pair[0], 0, q.options - 1);
          requireThat(!options.has(pair[0]), 'duplicate option');
          options.add(pair[0]);
          if (q.tag === 5) {
            integer(pair[1]);
            total += BigInt(pair[1]);
          } else if (typeof q.scale === 'number') integer(pair[1], 0, q.scale - 1);
          else onGrid(pair[1], q.scale);
        }
        if (q.tag === 5) requireThat(total === BigInt(q.budget), 'points budget mismatch');
        else requireThat(!q.requireAll || options.size === q.options, 'all options must be rated');
        break;
      }
    }
  }
  questions.forEach((q, index) =>
    requireThat(!q.required || seen.has(index), 'required question omitted'),
  );
}

export function buildResponse(input: ResponseInput): Response {
  const questions = validateDefinition(input.definition);
  integer(input.currentEpoch);
  requireThat(input.currentEpoch <= (input.definition.get(5) as number), 'survey expired');
  array(input.surveyRef, 2);
  bytes(input.surveyRef[0], 32);
  integer(input.surveyRef[1], 0, 65535);
  credential(input.credential);
  requireThat(input.credential[0] === 0, 'Keyholder requires a payment key credential');
  validateAnswers(input.answers, questions);
  const response: Response = new Map<Metadatum, Metadatum>([
    [0, SPEC_VERSION],
    [1, input.surveyRef],
    [2, 4],
    [3, input.credential],
    [4, input.answers],
  ]);
  encodeMetadata(response);
  return structuredClone(response);
}

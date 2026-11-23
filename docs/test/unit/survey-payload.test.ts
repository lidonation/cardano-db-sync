import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {blake2b} from '@noble/hashes/blake2b';
import {
  buildDefinition,
  buildResponse,
  freeTextAnswer,
  schemaVersionQuestions,
  verifyAnchor,
  freeTextQuestion,
  freeTextSchemaBytes,
} from '../../src/survey/payload';
import {decodeMetadata, encodeMetadata} from '../../src/survey/metadata';
import type {DefinitionInput, Question} from '../../src/survey/types';

const hash = new Uint8Array(32).fill(9);
export const questions: Question[] = [
  {tag: 1, options: 3, required: true},
  {tag: 2, options: 4, min: 0, max: 3},
  {tag: 3, options: 3, min: 1, max: 3},
  ...schemaVersionQuestions(),
  {tag: 5, options: 3, budget: 100},
  {tag: 6, options: 2, scale: [1, 5], requireAll: true},
  {tag: 6, options: 2, scale: 3, requireAll: false},
  freeTextQuestion('https://example.org/free-text.json'),
];
export function input(): DefinitionInput {
  return {
    owner: [1, new Uint8Array(28)],
    currentEpoch: 100,
    endEpoch: 9999,
    presentationUri: 'https://example.org/presentation.json',
    questions: structuredClone(questions),
    presentation: {
      specVersion: 5,
      kind: 'cardano-survey-presentation',
      title: 'Survey',
      description: 'English content',
      questions: questions.map((q) => ({
        prompt: `Question ${q.tag}`,
        ...('options' in q
          ? {options: Array.from({length: q.options}, (_, i) => `Option ${i}`)}
          : {}),
        ...(q.tag === 6 && typeof q.scale === 'number'
          ? {ratingLabels: ['Bad', 'Okay', 'Good']}
          : {}),
      })),
    },
  };
}
const credential: [0, Uint8Array] = [0, new Uint8Array(28).fill(1)];

describe('CIP-179 public external-content payload', () => {
  it('hashes exactly the static custom-method bytes served by both profiles', () => {
    expect(freeTextSchemaBytes()).toEqual(
      new Uint8Array(readFileSync('static/survey/free-text-v1.json')),
    );
  });
  it('anchors the exact raw presentation bytes and retains all constraints, not labels', () => {
    const {definition, presentationBytes} = buildDefinition(input());
    expect(definition.get(0)).toBe(5);
    expect(definition.get(4)).toEqual([4]);
    expect(definition.get(6)).toEqual([0]);
    expect(definition.get(7)).toEqual([
      [1, '', 3, 1],
      [2, '', 4, 0, 3],
      [3, '', 3, 1, 3],
      [4, '', [0, 9999]],
      [4, '', [0, 9999]],
      [5, '', 3, 100],
      [6, '', 2, [1, 5], 1],
      [6, '', 2, 3, 0],
      [0, '', (questions[8] as Extract<Question, {tag: 0}>).anchor],
    ]);
    expect(definition.get(8)).toEqual([
      'https://example.org/presentation.json',
      blake2b(presentationBytes, {dkLen: 32}),
    ]);
    expect(verifyAnchor(presentationBytes, definition.get(8) as never)).toBe(true);
    expect(verifyAnchor(new Uint8Array([0]), definition.get(8) as never)).toBe(false);
    const detached = freeTextSchemaBytes();
    detached[0] = 0;
    expect(freeTextSchemaBytes()[0]).not.toBe(0);
    expect(decodeMetadata(encodeMetadata(definition))).toEqual(definition);
    expect(JSON.parse(new TextDecoder().decode(presentationBytes))).toEqual(input().presentation);
  });
  it('round-trips every answer type preserving option order, indices and omitted schema versions', () => {
    const {definition} = buildDefinition(input());
    const answers = [
      [1, 0, 2],
      [2, 1, []],
      [3, 2, [2, 0, 1]],
      [4, 3, 42],
      [5, 5, [[0, 100]]],
      [
        6,
        6,
        [
          [0, 1],
          [1, 5],
        ],
      ],
      [6, 7, [[1, 2]]],
      freeTextAnswer(8, '🙂'.repeat(70)),
    ] as Parameters<typeof buildResponse>[0]['answers'];
    const response = buildResponse({
      definition,
      currentEpoch: 101,
      surveyRef: [hash, 2],
      credential,
      answers,
    });
    expect(response.get(2)).toBe(4);
    expect(response.get(4)).toEqual(answers);
    expect(decodeMetadata(encodeMetadata(response))).toEqual(response);
    expect(response.get(1)).toEqual([hash, 2]);
    const rationale: [string, Uint8Array] = ['https://example.org/rationale.json', hash];
    const withRationale = buildResponse({
      definition,
      currentEpoch: 101,
      surveyRef: [hash, 2],
      credential,
      answers,
      rationale,
    });
    expect(withRationale.get(5)).toEqual(rationale);
    expect(() =>
      buildResponse({
        definition,
        currentEpoch: 101,
        surveyRef: [hash, 2],
        credential,
        answers,
        rationale: ['javascript:alert(1)', hash],
      }),
    ).toThrow();
  });
  it('rejects invalid presentation, constraints, expiry, hashes and unbound option counts', () => {
    const cases: ((v: DefinitionInput) => void)[] = [
      (v) => {
        v.endEpoch = 100;
      },
      (v) => {
        v.owner = [0, new Uint8Array(27)];
      },
      (v) => {
        v.presentation.questions.pop();
      },
      (v) => {
        v.presentation.questions[0].options!.pop();
      },
      (v) => {
        v.presentation.questions[7].ratingLabels!.pop();
      },
      (v) => {
        v.questions[0] = {tag: 1, options: 1};
      },
      (v) => {
        v.questions[1] = {tag: 2, options: 4, min: 4, max: 3};
      },
      (v) => {
        v.questions[2] = {tag: 3, options: 4, min: 0, max: 3};
      },
      (v) => {
        v.questions[3] = {tag: 4, range: [0, 9999, 0]};
      },
      (v) => {
        v.questions[5] = {tag: 5, options: 3, budget: 0};
      },
      (v) => {
        v.questions[6] = {tag: 6, options: 2, scale: [5, 1], requireAll: true};
      },
      (v) => {
        v.presentationUri = 'javascript:alert(1)';
      },
      (v) => {
        v.questions[8] = {tag: 0, anchor: ['https://example.org', new Uint8Array(31)]};
      },
    ];
    for (const change of cases) {
      const v = input();
      change(v);
      expect(() => buildDefinition(v)).toThrow();
    }
  });
  it('rejects missing required, duplicate, wrong-type, off-grid and invalid option answers', () => {
    const {definition} = buildDefinition(input());
    const base = {
      definition,
      currentEpoch: 101,
      surveyRef: [hash, 0] as [Uint8Array, number],
      credential,
    };
    for (const answers of [
      [],
      [[1, 0, 3]],
      [
        [1, 0, 0],
        [1, 0, 1],
      ],
      [
        [1, 0, 0],
        [4, 99, 0],
      ],
      [
        [1, 0, 0],
        [4, 1, 0],
      ],
      [
        [1, 0, 0],
        [2, 1, [1, 1]],
      ],
      [
        [1, 0, 0],
        [3, 2, []],
      ],
      [
        [1, 0, 0],
        [4, 3, 10000],
      ],
      [
        [1, 0, 0],
        [5, 5, [[0, 99]]],
      ],
      [
        [1, 0, 0],
        [6, 6, [[0, 2]]],
      ],
      [
        [1, 0, 0],
        [6, 7, [[0, 3]]],
      ],
      [
        [1, 0, 0],
        [0, 8, ['a'.repeat(65)]],
      ],
    ]) {
      expect(() => buildResponse({...base, answers: answers as never})).toThrow();
    }
    expect(() => buildResponse({...base, currentEpoch: 10000, answers: [[1, 0, 0]]})).toThrow(
      /expired/,
    );
    expect(() =>
      buildResponse({...base, surveyRef: [hash, 65536], answers: [[1, 0, 0]]}),
    ).toThrow();
    expect(() =>
      buildResponse({...base, credential: [1, new Uint8Array(28)], answers: [[1, 0, 0]]}),
    ).toThrow(/Keyholder/);
    definition.set(0, 4);
    expect(() => buildResponse({...base, answers: [[1, 0, 0]]})).toThrow(/version/);
  });
});

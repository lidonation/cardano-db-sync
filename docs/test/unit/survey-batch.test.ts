import {describe, expect, it} from 'vitest';
import {batchDefinitions, batchResponses, parseSurveyMetadata} from '../../src/survey/batch';
import {buildDefinition, freeTextQuestion} from '../../src/survey/payload';
import {encodeMetadata} from '../../src/survey/metadata';
import type {DefinitionInput, ResponseInput} from '../../src/survey/types';

function definition() {
  const input: DefinitionInput = {
    owner: [0, new Uint8Array(28)],
    endEpoch: 9999,
    currentEpoch: 100,
    questions: [
      {tag: 1, options: 3, required: true},
      freeTextQuestion('https://example.org/free-text.json'),
    ],
    presentationUri: 'https://example.org/presentation.json',
    presentation: {
      specVersion: 5,
      kind: 'cardano-survey-presentation',
      title: 'English',
      description: '',
      questions: [{prompt: 'Use', options: ['a', 'b', 'c']}, {prompt: 'Wish'}],
    },
  };
  return buildDefinition(input).definition;
}
function response(index: number): ResponseInput {
  return {
    definition: definition(),
    currentEpoch: 101,
    surveyRef: [new Uint8Array(32), index],
    credential: [0, new Uint8Array(28)],
    answers: [
      [1, 0, 2],
      [0, 1, 'hello'],
    ],
  };
}
const budget = {maxTxBytes: 16384, reservedTxBytes: 2048};

describe('label 17 batching without fragmenting a survey response', () => {
  it('packs active surveys once when they fit and splits whole entries without lost indices', () => {
    const inputs = Array.from({length: 400}, (_, index) => response(index));
    const batches = batchResponses(inputs, budget);
    expect(batches.length).toBeGreaterThan(1);
    const read = batches.flatMap((b) => {
      expect(b.cbor.length + budget.reservedTxBytes).toBeLessThanOrEqual(budget.maxTxBytes);
      expect(b.metadata.has(17)).toBe(true);
      return parseSurveyMetadata(b.cbor, () => inputs[0].definition, 101).entries;
    });
    expect(read.map((e) => e.get(1))).toEqual(inputs.map((i) => i.surveyRef));
    expect(read.every((e) => JSON.stringify(e.get(4)) === JSON.stringify(inputs[0].answers))).toBe(
      true,
    );
    expect(batchResponses(inputs.slice(0, 2), budget)).toHaveLength(1);
    expect(batches.map((b) => b.entryStart)).toEqual(
      batches.map((_, i) =>
        batches
          .slice(0, i)
          .reduce((n, b) => n + (b.metadata.get(17) as [number, unknown[]])[1].length, 0),
      ),
    );
  });
  it('uses exact-fit CBOR sizes including list header changes and honors reservations', () => {
    const inputs = Array.from({length: 24}, (_, i) => response(i));
    const one = batchResponses(inputs, budget)[0].cbor.length;
    expect(batchResponses(inputs, {maxTxBytes: one + 100, reservedTxBytes: 100})).toHaveLength(1);
    expect(batchResponses(inputs, {maxTxBytes: one + 99, reservedTxBytes: 100})).toHaveLength(2);
    const single = batchResponses([inputs[0]], budget)[0].cbor.length;
    expect(() =>
      batchResponses([inputs[0]], {maxTxBytes: single + 99, reservedTxBytes: 100}),
    ).toThrow(/single.*fit/);
    expect(() => batchResponses([inputs[0], inputs[0]], budget)).toThrow(/duplicate/);
    for (const invalid of [
      {maxTxBytes: 0, reservedTxBytes: 0},
      {maxTxBytes: 100, reservedTxBytes: 100},
      {maxTxBytes: 100, reservedTxBytes: -1},
      {maxTxBytes: 100.5, reservedTxBytes: 1},
    ])
      expect(() => batchResponses(inputs, invalid)).toThrow();
    expect(() => batchResponses([], budget)).toThrow();
  });
  it('never splits one oversized definition / response; preserves definition-local reference positions', () => {
    const defs = Array.from({length: 50}, definition);
    const batches = batchDefinitions(defs, {maxTxBytes: 1200, reservedTxBytes: 200});
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flatMap((b) => parseSurveyMetadata(b.cbor).entries)).toEqual(defs);
    expect(() => batchDefinitions([definition()], {maxTxBytes: 50, reservedTxBytes: 1})).toThrow(
      /single.*fit/,
    );
    const invalid = definition();
    invalid.set(0, 4);
    expect(() => batchDefinitions([invalid], budget)).toThrow();
  });
  it('fails closed on labels, operation modes, missing definitions, expiry and malformed response fields', () => {
    const original = batchResponses([response(0)], budget)[0].metadata;
    expect(() =>
      parseSurveyMetadata(
        encodeMetadata(new Map([[18, original.get(17)!]])),
        () => definition(),
        101,
      ),
    ).toThrow();
    expect(() => parseSurveyMetadata(encodeMetadata(original))).toThrow(/resolver/);
    expect(() => parseSurveyMetadata(encodeMetadata(original), () => undefined, 101)).toThrow();
    expect(() => parseSurveyMetadata(encodeMetadata(original), () => definition(), 10000)).toThrow(
      /expired/,
    );
    const parsed = parseSurveyMetadata(encodeMetadata(original), () => definition(), 101)
      .entries[0];
    for (const [key, value] of [
      [0, 4],
      [2, 0],
      [1, [new Uint8Array(31), 0]],
      [4, []],
      [5, []],
    ] as const) {
      const bad = structuredClone(parsed);
      bad.set(key, value as never);
      expect(() =>
        parseSurveyMetadata(encodeMetadata(new Map([[17, [1, [bad]]]])), () => definition(), 101),
      ).toThrow();
    }
    for (const value of [
      [2, [[new Uint8Array(32), 0]]],
      [1, []],
      [3, [definition()]],
    ])
      expect(() => parseSurveyMetadata(encodeMetadata(new Map([[17, value]])))).toThrow();
  });
});

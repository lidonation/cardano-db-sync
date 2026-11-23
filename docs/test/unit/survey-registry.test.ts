import {describe, expect, it} from 'vitest';
import committed from '../../src/survey/manifest/registry.json';
import {
  readRegistry,
  validateEvolution,
  activeQuestions,
  successorIndex,
  resolveHistoricalOption,
} from '../../src/survey/manifest/lifecycle';
import type {SurveyRecord, SurveyRegistry} from '../../src/survey/manifest/types';

const ref = (n: number) => n.toString(16).padStart(64, '0') + '#0';
const a = ref(1),
  b = ref(2),
  c = ref(3);
function record(surveyRef = a, extra: Partial<SurveyRecord> = {}): SurveyRecord {
  return {
    surveyRef,
    network: 'preview',
    kind: 'core',
    owner: {type: 'script', hash: 'ab'.repeat(28)},
    definedEpoch: 100,
    endEpoch: 2000,
    questions: [{optionCount: 2}, {}],
    subsumes: [],
    ...extra,
  };
}
function registry(surveys: readonly SurveyRecord[] = [record()]): SurveyRegistry {
  return {schemaVersion: 1, current: {preview: a, mainnet: null}, surveys};
}
function evolved(): SurveyRegistry {
  return registry([
    record(),
    record(b, {
      kind: 'supplementary',
      owner: {type: 'key', hash: 'cd'.repeat(28)},
      definedEpoch: 101,
      endEpoch: 110,
      evolvesFrom: a,
      subsumes: [
        {
          question: 0,
          older: {surveyRef: a, question: 0},
          kind: 'replaces',
          optionMap: [
            {older: 0, newer: 1},
            {older: 1, newer: 0},
          ],
        },
      ],
    }),
  ]);
}

describe('reviewed registry schema and semantic validation (R1/R2)', () => {
  it('accepts the unpublished registry without fabricated canonical refs', () => {
    expect(readRegistry(committed).surveys).toEqual([]);
    expect(committed.current).toEqual({preview: null, mainnet: null});
    expect(activeQuestions(readRegistry(committed), 'mainnet', 100)).toEqual([]);
  });
  it('preserves per-definition owner handover and independently bounded supplements', () => {
    expect(readRegistry(evolved())).toEqual(evolved());
    expect(evolved().surveys[0].owner).not.toEqual(evolved().surveys[1].owner);
  });
  it.each([
    null,
    [],
    {},
    {...registry(), typo: true},
    {...registry(), schemaVersion: 2},
    {...registry(), surveys: [record(a, {endEpoch: 1999})]},
    {...registry(), surveys: [record(a, {endEpoch: 2001})]},
    {...registry(), surveys: [record('core-1')]},
    {...registry(), surveys: [record(ref(1).replace('#0', '#65536'))]},
    {...registry(), surveys: [record(a, {definedEpoch: 2000})]},
    {...registry(), surveys: [record(a, {cancelledEpoch: 99})]},
    {...registry(), surveys: [record(a, {cancelledEpoch: 2001})]},
    {...registry(), current: {preview: b, mainnet: null}},
    {...registry(), current: {preview: null, mainnet: a}},
    {...registry(), surveys: [record(), record()]},
  ])('rejects malformed, expired-at-definition or inconsistent data %#', (value) => {
    expect(() => readRegistry(value)).toThrow(/registry/i);
  });
  it('rejects dangling, same-definition, cross-network, backward and cyclic edges', () => {
    const value = evolved();
    const newer = value.surveys[1];
    for (const older of [c, b]) {
      expect(() =>
        readRegistry(
          registry([
            record(),
            {...newer, subsumes: [{...newer.subsumes[0], older: {surveyRef: older, question: 0}}]},
          ]),
        ),
      ).toThrow();
    }
    expect(() => readRegistry(registry([record(), {...newer, network: 'mainnet'}]))).toThrow();
    expect(() => readRegistry(registry([newer, record()]))).toThrow();
    expect(() => readRegistry(registry([record(a, {evolvesFrom: b}), newer]))).toThrow();
    expect(() => readRegistry(registry([record(), {...newer, definedEpoch: 99}]))).toThrow();
  });
  it('rejects question overflow, ambiguous absorbers and invalid option mappings', () => {
    const value = evolved();
    const newer = value.surveys[1];
    const edge = newer.subsumes[0];
    const badEdges = [
      [{...edge, question: 2}],
      [{...edge, older: {surveyRef: a, question: 2}}],
      [edge, edge],
      [{...edge, optionMap: undefined}],
      [
        {
          ...edge,
          optionMap: [
            {older: 0, newer: 2},
            {older: 1, newer: 0},
          ],
        },
      ],
      [{...edge, optionMap: [{older: 0, newer: 1}]}],
      [
        {
          ...edge,
          optionMap: [
            {older: 0, newer: 1},
            {older: 0, newer: 0},
          ],
        },
      ],
      [{...edge, kind: 'supersedes' as const}],
      [{...edge, question: 1}],
    ];
    for (const subsumes of badEdges) {
      expect(() => readRegistry(registry([record(), {...newer, subsumes}]))).toThrow();
    }
    expect(() =>
      readRegistry(
        registry([
          record(),
          newer,
          record(c, {
            definedEpoch: 102,
            evolvesFrom: a,
            subsumes: [edge],
          }),
        ]),
      ),
    ).toThrow();
  });
});

describe('additions, cancellation and inclusive expiry (R3/R5)', () => {
  it('allows new definitions and owner handover, never amendments or removals', () => {
    const before = registry();
    expect(validateEvolution(before, evolved())).toEqual([]);
    for (const extra of [
      {endEpoch: 2001},
      {owner: {type: 'key' as const, hash: 'ef'.repeat(28)}},
      {questions: [{}]},
      {subsumes: [{question: 0, older: {surveyRef: b, question: 0}, kind: 'replaces' as const}]},
    ]) {
      expect(validateEvolution(before, registry([record(a, extra)]))).not.toEqual([]);
    }
    expect(
      validateEvolution(before, {...before, current: {preview: null, mainnet: null}, surveys: []}),
    ).not.toEqual([]);
    expect(validateEvolution(evolved(), registry([...evolved().surveys].reverse()))).not.toEqual(
      [],
    );
  });
  it('allows recording a cancellation once but cannot erase or change it', () => {
    const before = evolved();
    const cancelled = registry([before.surveys[0], {...before.surveys[1], cancelledEpoch: 105}]);
    expect(validateEvolution(before, cancelled)).toEqual([]);
    expect(validateEvolution(cancelled, before)).not.toEqual([]);
    expect(
      validateEvolution(
        cancelled,
        registry([before.surveys[0], {...before.surveys[1], cancelledEpoch: 106}]),
      ),
    ).not.toEqual([]);
    expect(activeQuestions(readRegistry(cancelled), 'preview', 105)).toContainEqual({
      surveyRef: a,
      question: 0,
    });
    expect(activeQuestions(readRegistry(cancelled), 'preview', 104)).not.toContainEqual({
      surveyRef: a,
      question: 0,
    });
  });
  it('hides only the subsumed question while its absorber is live; core never retires with supplement', () => {
    const value = readRegistry(evolved());
    expect(activeQuestions(value, 'preview', 99)).toEqual([]);
    expect(activeQuestions(value, 'preview', 100)).toEqual([
      {surveyRef: a, question: 0},
      {surveyRef: a, question: 1},
    ]);
    for (const epoch of [101, 110]) {
      expect(activeQuestions(value, 'preview', epoch)).toEqual([
        {surveyRef: a, question: 1},
        {surveyRef: b, question: 0},
        {surveyRef: b, question: 1},
      ]);
    }
    expect(activeQuestions(value, 'preview', 111)).toEqual(activeQuestions(value, 'preview', 100));
    expect(activeQuestions(value, 'preview', 2000)).toHaveLength(2);
    expect(activeQuestions(value, 'preview', 2001)).toEqual([]);
    expect(activeQuestions(value, 'mainnet', 105)).toEqual([]);
    expect(() => activeQuestions(value, 'preview', -1)).toThrow();
  });
});

describe('forward-only declarations and derived historical resolution (R4)', () => {
  it('derives reverse lookup without changing the frozen predecessor', () => {
    const value = readRegistry(evolved());
    const original = JSON.stringify(value);
    expect(successorIndex(value, 'preview').get(`${a}:0`)?.newer).toEqual({
      surveyRef: b,
      question: 0,
    });
    expect(successorIndex(value, 'mainnet').size).toBe(0);
    expect(resolveHistoricalOption(value, 'preview', {surveyRef: a, question: 0}, 0)).toEqual({
      target: {surveyRef: b, question: 0},
      option: 1,
      editorialMerge: true,
      closed: false,
    });
    expect(JSON.stringify(value)).toBe(original);
  });
  it('resolves a replacement chain, independent of expiry, without ever adding marginal counts', () => {
    const value = readRegistry(
      registry([
        ...evolved().surveys,
        record(c, {
          definedEpoch: 102,
          evolvesFrom: b,
          subsumes: [
            {
              question: 0,
              older: {surveyRef: b, question: 0},
              kind: 'replaces',
              optionMap: [
                {older: 0, newer: 1},
                {older: 1, newer: 0},
              ],
            },
          ],
        }),
      ]),
    );
    expect(resolveHistoricalOption(value, 'preview', {surveyRef: a, question: 0}, 0)).toEqual({
      target: {surveyRef: c, question: 0},
      option: 0,
      editorialMerge: true,
      closed: false,
    });
  });
  it('supersedes closes the old question separately and never produces an editorial merge', () => {
    const value = readRegistry(
      registry([
        record(),
        record(b, {
          definedEpoch: 101,
          evolvesFrom: a,
          subsumes: [{question: 1, older: {surveyRef: a, question: 0}, kind: 'supersedes'}],
        }),
      ]),
    );
    expect(resolveHistoricalOption(value, 'preview', {surveyRef: a, question: 0}, 1)).toEqual({
      target: {surveyRef: b, question: 1},
      option: null,
      editorialMerge: false,
      closed: true,
    });
    expect(resolveHistoricalOption(value, 'preview', {surveyRef: a, question: 1})).toEqual({
      target: {surveyRef: a, question: 1},
      option: null,
      editorialMerge: false,
      closed: false,
    });
    expect(() =>
      resolveHistoricalOption(value, 'mainnet', {surveyRef: a, question: 0}, 0),
    ).toThrow();
    expect(() =>
      resolveHistoricalOption(value, 'preview', {surveyRef: a, question: 0}, 2),
    ).toThrow();
  });
});

it('does not absorb historical answers into a cancelled survey (CIP cancellation)', () => {
  const value = evolved();
  const cancelled = readRegistry(
    registry([value.surveys[0], {...value.surveys[1], cancelledEpoch: 105}]),
  );
  expect(resolveHistoricalOption(cancelled, 'preview', {surveyRef: a, question: 0}, 0)).toEqual({
    target: {surveyRef: a, question: 0},
    option: 0,
    editorialMerge: false,
    closed: false,
  });
});
it('resolves bounded generated chains and equivalent non-option questions', () => {
  for (let length = 2; length <= 32; length += 3) {
    const surveys = [record()];
    for (let n = 2; n <= length; n++)
      surveys.push(
        record(ref(n), {
          definedEpoch: 100 + n,
          evolvesFrom: ref(n - 1),
          subsumes: [{question: 1, older: {surveyRef: ref(n - 1), question: 1}, kind: 'replaces'}],
        }),
      );
    expect(
      resolveHistoricalOption(readRegistry(registry(surveys)), 'preview', {
        surveyRef: a,
        question: 1,
      }),
    ).toEqual({
      target: {surveyRef: ref(length), question: 1},
      option: null,
      editorialMerge: true,
      closed: false,
    });
  }
});

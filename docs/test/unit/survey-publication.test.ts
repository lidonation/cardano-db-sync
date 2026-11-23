import {expect, it} from 'vitest';
import registryJson from '../../src/survey/manifest/registry.json';
import aggregateSource from '../../src/survey-results/aggregate.json';
import type {Aggregate} from '../../src/survey-results/types';
const aggregateJson = aggregateSource as Aggregate;
import {readRegistry} from '../../src/survey/manifest/lifecycle';
import {publicationManifest} from '../../src/survey/manifest/publication';
import type {SurveyRegistry} from '../../src/survey/manifest/types';
const ref = '01'.repeat(32) + '#0';
const registry: SurveyRegistry = {
  schemaVersion: 1,
  current: {preview: ref, mainnet: null},
  surveys: [
    {
      surveyRef: ref,
      network: 'preview',
      kind: 'core',
      owner: {type: 'script', hash: 'ab'.repeat(28)},
      definedEpoch: 100,
      endEpoch: 2000,
      questions: [{optionCount: 2}],
      subsumes: [],
    },
  ],
};
it('keeps the unpublished artifact in the empty state, never treats core-1 as canonical', () => {
  expect(
    publicationManifest(readRegistry(registryJson), aggregateJson, 'mainnet').subsumptions,
  ).toEqual([]);
  expect(() =>
    publicationManifest(
      readRegistry(registryJson),
      {...aggregateJson, questions: [{question: 0, label: 'sample', options: []}]},
      'preview',
    ),
  ).toThrow();
  expect(() =>
    publicationManifest(
      readRegistry(registryJson),
      {...aggregateJson, freeText: [{id: 'sample', text: 'No', moderated: true}]},
      'preview',
    ),
  ).toThrow();
});
it('binds published results to a canonical definition on the build network', () => {
  const aggregate = {...aggregateJson, surveyRef: ref};
  expect(publicationManifest(readRegistry(registry), aggregate, 'preview')).toEqual({
    surveyRef: ref,
    endEpoch: 2000,
    subsumptions: [],
  });
  expect(() => publicationManifest(readRegistry(registry), aggregate, 'mainnet')).toThrow();
  expect(() =>
    publicationManifest(readRegistry(registry), {...aggregate, endEpoch: 1999}, 'preview'),
  ).toThrow();
  expect(() =>
    publicationManifest(
      readRegistry(registry),
      {...aggregate, questions: [{question: 1, label: 'unknown', options: []}]},
      'preview',
    ),
  ).toThrow();
  expect(() =>
    publicationManifest(
      readRegistry(registry),
      {
        ...aggregate,
        questions: [
          {question: 0, label: 'unknown', options: [{option: 2, label: 'unknown', count: 1}]},
        ],
      },
      'preview',
    ),
  ).toThrow();
});
it('rejects cancelled tallies and refuses to invent cross-survey replacement totals', () => {
  const aggregate = {
    ...aggregateJson,
    surveyRef: ref,
    questions: [{question: 0, label: 'q', options: [{option: 0, label: 'o', count: 1}]}],
  };
  const core = registry.surveys[0];
  expect(() =>
    publicationManifest(
      readRegistry({...registry, surveys: [{...core, cancelledEpoch: 105}]}),
      aggregate,
      'preview',
    ),
  ).toThrow(/cancelled/);
  const next = {
    ...core,
    surveyRef: '02'.repeat(32) + '#0',
    definedEpoch: 101,
    evolvesFrom: ref,
    subsumes: [{question: 0, older: {surveyRef: ref, question: 0}, kind: 'supersedes' as const}],
  };
  expect(() =>
    publicationManifest(readRegistry({...registry, surveys: [core, next]}), aggregate, 'preview'),
  ).toThrow(/B26/);
});

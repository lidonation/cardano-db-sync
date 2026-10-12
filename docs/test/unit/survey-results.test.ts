import {readFileSync} from 'node:fs';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import aggregateJson from '../../src/survey-results/aggregate.json';
import fixtureJson from '../../src/survey-results/__fixtures__/sample-aggregate.json';
import manifestJson from '../../src/survey-results/manifest.json';
import {
  isPreTally,
  moderatedFreeText,
  resolveAggregate,
  validateManifest,
} from '../../src/survey-results/resolve';
import type {Aggregate, SurveyManifest} from '../../src/survey-results/types';

const manifest = manifestJson as SurveyManifest;
const aggregate = aggregateJson as Aggregate;
const fixture = fixtureJson as Aggregate;

describe('survey manifest (SUR-3, SUR-15, SUR-26)', () => {
  it('the committed manifest is sound', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('locks end_epoch at 2000', () => {
    const problems = validateManifest({...manifest, endEpoch: 1999});
    expect(problems.some((problem) => problem.includes('2000'))).toBe(true);
  });

  it('rejects a subsumption cycle', () => {
    const cyclic: SurveyManifest = {
      ...manifest,
      subsumptions: [
        ...manifest.subsumptions,
        {newer: {question: 0, option: 0}, older: {question: 1, option: 0}, kind: 'replaces'},
      ],
    };
    expect(validateManifest(cyclic).length).toBeGreaterThan(0);
  });

  it('rejects an unknown subsumption kind', () => {
    const bad = {
      ...manifest,
      subsumptions: [
        {newer: {question: 1, option: 0}, older: {question: 0, option: 0}, kind: 'merges'},
      ],
    } as unknown as SurveyManifest;
    expect(validateManifest(bad).length).toBeGreaterThan(0);
  });

  it('rejects a negative index', () => {
    const negative: SurveyManifest = {
      ...manifest,
      subsumptions: [
        {newer: {question: 1, option: -1}, older: {question: 0, option: 0}, kind: 'replaces'},
      ],
    };
    expect(validateManifest(negative).length).toBeGreaterThan(0);
    const olderNegative: SurveyManifest = {
      ...manifest,
      subsumptions: [
        {newer: {question: 1, option: 0}, older: {question: 0, option: -2}, kind: 'supersedes'},
      ],
    };
    expect(validateManifest(olderNegative).length).toBeGreaterThan(0);
  });

  it('skips edges the aggregate does not carry: the page renders what the tally produced', () => {
    const withDangling: SurveyManifest = {
      ...manifest,
      subsumptions: [
        ...manifest.subsumptions,
        {newer: {question: 9, option: 0}, older: {question: 0, option: 1}, kind: 'replaces'},
      ],
    };
    expect(resolveAggregate(withDangling, fixture)).toEqual(resolveAggregate(manifest, fixture));
  });
});

describe('pre-tally empty state', () => {
  it('the committed aggregate is pre-tally', () => {
    expect(isPreTally(aggregate)).toBe(true);
  });

  it('the golden fixture is not', () => {
    expect(isPreTally(fixture)).toBe(false);
  });
});

describe('moderation gate (SUR-7)', () => {
  it('renders only reviewed free text', () => {
    expect(moderatedFreeText(fixture).map((item) => item.id)).toEqual(['ft-approved-1']);
  });

  it('an unreviewed-only aggregate renders nothing', () => {
    const pending: Aggregate = {
      ...fixture,
      freeText: [{id: 'ft-x', text: 'waiting', moderated: false}],
    };
    expect(moderatedFreeText(pending)).toEqual([]);
  });
});

describe('subsumption resolution (SUR-28)', () => {
  it('resolves the golden fixture exactly', () => {
    expect(resolveAggregate(manifest, fixture)).toEqual({
      surveyRef: 'core-1',
      tallyBasis: 'response-time-only',
      interim: true,
      endEpoch: 2000,
      questions: [
        {
          question: 0,
          label: 'How do you run db-sync?',
          options: [{option: 1, label: 'From source', count: 7}],
          history: [
            {epoch: 540, counts: [8, 5, 2]},
            {epoch: 541, counts: [12, 7, 3]},
          ],
          historyOptions: ['Docker', 'From source', 'Nix'],
        },
        {
          question: 1,
          label: 'How do you run db-sync today?',
          options: [
            {
              option: 0,
              label: 'Docker',
              count: 14,
              absorbedFrom: [{question: 0, option: 0, label: 'Docker', count: 12}],
            },
            {option: 1, label: 'Prebuilt binary', count: 4},
          ],
        },
      ],
      closed: [
        {
          question: 0,
          label: 'How do you run db-sync?',
          options: [{option: 2, label: 'Nix', count: 3}],
          supersededBy: {question: 1, option: 1},
        },
      ],
      editorialMerge: true,
      freeText: [
        {id: 'ft-approved-1', text: 'Please document the snapshot restore flow.', moderated: true},
      ],
      generatedAt: '2026-10-01T00:00:00Z',
    });
  });

  it('never mutates its inputs', () => {
    const beforeManifest = JSON.stringify(manifest);
    const beforeFixture = JSON.stringify(fixture);
    resolveAggregate(manifest, fixture);
    expect(JSON.stringify(manifest)).toBe(beforeManifest);
    expect(JSON.stringify(fixture)).toBe(beforeFixture);
  });

  it('a manifest with no edges resolves counts unchanged', () => {
    const resolved = resolveAggregate({...manifest, subsumptions: []}, fixture);
    expect(resolved.editorialMerge).toBe(false);
    expect(resolved.closed).toEqual([]);
    expect(resolved.questions.map((question) => question.options.length)).toEqual([3, 2]);
  });
});

describe('committed artifacts', () => {
  it('the aggregate and manifest agree on surveyRef and endEpoch', () => {
    expect(aggregate.surveyRef).toBe(manifest.surveyRef);
    expect(aggregate.endEpoch).toBe(manifest.endEpoch);
  });

  it('the fixture file on disk is the fixture under test', () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const raw = readFileSync(
      path.join(root, 'src/survey-results/__fixtures__/sample-aggregate.json'),
      'utf8',
    );
    expect(JSON.parse(raw)).toEqual(fixture);
  });
});

describe('artifact integrity', () => {
  it('rejects mismatched survey identities at resolution', () => {
    expect(() => resolveAggregate(manifest, {...fixture, surveyRef: 'other'})).toThrow();
  });
  it('requires deduplicated counts for replacement edges', () => {
    expect(() =>
      resolveAggregate(manifest, {...fixture, replacements: undefined} as Aggregate),
    ).toThrow();
  });
  it('rejects two absorbers for one older option', () => {
    expect(
      validateManifest({
        ...manifest,
        subsumptions: [
          ...manifest.subsumptions,
          {newer: {question: 1, option: 1}, older: {question: 0, option: 0}, kind: 'replaces'},
        ],
      }),
    ).not.toEqual([]);
  });
  it('fails closed for non-boolean moderation approvals', () => {
    expect(
      moderatedFreeText({
        ...fixture,
        freeText: [{id: 'x', text: 'private', moderated: 'false'}],
      } as unknown as Aggregate),
    ).toEqual([]);
  });
  it('rejects malformed history columns and counts', () => {
    expect(() =>
      resolveAggregate(manifest, {
        ...fixture,
        questions: [{...fixture.questions[0], history: [{epoch: 1, counts: [-1]}]}],
      }),
    ).toThrow();
  });
});

describe('invalid tallies fail the build', () => {
  it.each([
    {...fixture, endEpoch: 1999},
    {...fixture, tallyBasis: 'canonical'},
    {...fixture, interim: false},
    {...fixture, questions: [fixture.questions[0], fixture.questions[0]]},
    {...fixture, questions: [{...fixture.questions[0], question: -1}]},
    {
      ...fixture,
      questions: [
        {
          ...fixture.questions[0],
          options: [fixture.questions[0].options[0], fixture.questions[0].options[0]],
        },
      ],
    },
    {
      ...fixture,
      questions: [{...fixture.questions[0], options: [{option: 0, label: 'bad', count: -1}]}],
    },
    {
      ...fixture,
      questions: [
        {
          ...fixture.questions[0],
          history: [
            {epoch: 1, counts: [1, 2, 3]},
            {epoch: 1, counts: [1, 2, 3]},
          ],
        },
      ],
    },
    {...fixture, replacements: [...fixture.replacements!, ...fixture.replacements!]},
    {...fixture, replacements: [{newer: {question: 1, option: 0}, count: -1}]},
  ])('rejects corrupt artifact %#', (invalid) => {
    expect(() => resolveAggregate(manifest, invalid as Aggregate)).toThrow();
  });

  it('rejects an invalid manifest before resolving it', () => {
    expect(() => resolveAggregate({...manifest, endEpoch: 1999}, fixture)).toThrow();
  });

  it('uses the supplied deduplicated result, never raw marginal addition', () => {
    // Twelve older answers and five newer answers overlap at three credentials.
    // B26 has the credential set and supplies 14; the render half cannot infer overlap.
    expect(resolveAggregate(manifest, fixture).questions[1].options[0].count).toBe(14);
  });
});

it('accepts acyclic replacement chains independently of edge ordering', () => {
  const edges: SurveyManifest['subsumptions'] = [
    {newer: {question: 2, option: 0}, older: {question: 1, option: 0}, kind: 'replaces'},
    {newer: {question: 1, option: 0}, older: {question: 0, option: 0}, kind: 'replaces'},
  ];
  const source: Aggregate = {
    ...fixture,
    questions: [0, 1, 2].map((question) => ({
      question,
      label: 'Q',
      options: [{option: 0, label: 'O', count: 5}],
    })),
    replacements: [
      {newer: {question: 1, option: 0}, count: 8},
      {newer: {question: 2, option: 0}, count: 10},
    ],
  };
  const forward = resolveAggregate({...manifest, subsumptions: edges}, source);
  expect(validateManifest({...manifest, subsumptions: edges})).toEqual([]);
  expect(forward).toEqual(
    resolveAggregate({...manifest, subsumptions: [...edges].reverse()}, source),
  );
  expect(forward.questions[0].options[0].count).toBe(10);
});

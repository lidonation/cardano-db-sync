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
              count: 17,
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

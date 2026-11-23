import {readFileSync, writeFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {batchDefinitions, batchResponses, parseSurveyMetadata} from '../../src/survey/batch';
import {
  buildDefinition,
  freeTextQuestion,
  freeTextAnswer,
  schemaVersionQuestions,
  freeTextSchemaBytes,
} from '../../src/survey/payload';
import {surveyLabelId} from '../../src/survey/labelIds';
import presentation from '../../static/survey/example-presentation.json';
import type {Presentation} from '../../src/survey/types';

/** Explicit opt-in fixture refresh, independently validated by scripts/check-survey-cddl.mjs. */
describe('v5 conformance vectors and index interlingua', () => {
  it('matches pinned CDDL-validated definition / response bytes and the hosted English profile', () => {
    const input = {
      owner: [0, new Uint8Array(28).fill(1)] as [0, Uint8Array],
      currentEpoch: 100,
      endEpoch: 9999,
      presentationUri: 'https://example.org/survey/example-presentation.json',
      presentation: presentation as Presentation,
      questions: [
        {tag: 2 as const, options: 3, min: 0, max: 3},
        {tag: 1 as const, options: 2},
        {tag: 4 as const, range: [0, 7] as [number, number]},
        {tag: 3 as const, options: 3, min: 1, max: 3},
        {tag: 6 as const, options: 2, scale: [1, 5] as [number, number], requireAll: false},
        freeTextQuestion('https://example.org/survey/free-text-v1.json'),
        ...schemaVersionQuestions(),
      ],
    };
    const {definition, presentationBytes} = buildDefinition(input);
    expect(presentationBytes).toEqual(
      new Uint8Array(readFileSync('static/survey/example-presentation.json')),
    );
    const definitionBatch = batchDefinitions([definition], {
      maxTxBytes: 16384,
      reservedTxBytes: 2048,
    })[0];
    const responseBatch = batchResponses(
      [
        {
          definition,
          currentEpoch: 101,
          surveyRef: [new Uint8Array(32).fill(2), 0],
          credential: [0, new Uint8Array(28).fill(3)],
          answers: [
            [2, 0, [0, 2]],
            [1, 1, 1],
            [4, 2, 5],
            [3, 3, [2, 0]],
            [6, 4, [[1, 5]]],
            freeTextAnswer(5, '🙂'.repeat(35)),
            [4, 6, 42],
            [4, 7, 3],
          ],
        },
      ],
      {maxTxBytes: 16384, reservedTxBytes: 2048},
    )[0];
    const vectors = {
      definitionHex: Buffer.from(definitionBatch.cbor).toString('hex'),
      responseHex: Buffer.from(responseBatch.cbor).toString('hex'),
      presentationHex: Buffer.from(presentationBytes).toString('hex'),
      methodSchemaHex: Buffer.from(freeTextSchemaBytes()).toString('hex'),
    };
    const file = 'test/fixtures/survey/vectors.json';
    if (process.env.UPDATE_SURVEY_VECTORS === '1')
      writeFileSync(file, JSON.stringify(vectors, null, 2) + '\n');
    expect(vectors).toEqual(JSON.parse(readFileSync(file, 'utf8')));
    expect(JSON.parse(Buffer.from(vectors.presentationHex, 'hex').toString())).toEqual(
      presentation,
    );
    const parsed = parseSurveyMetadata(responseBatch.cbor, () => definition, 101);
    expect(
      (parsed.entries[0].get(4) as unknown[][]).map((a) => surveyLabelId(a[1] as number)),
    ).toEqual(Array.from({length: 8}, (_, i) => `survey.question.${i}`));
    expect(surveyLabelId(0, 2)).toBe('survey.question.0.option.2');
  });
});

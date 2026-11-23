import {describe, expect, it} from 'vitest';
import {blake2b} from '@noble/hashes/blake2b';
import {
  buildDefinition,
  buildResponse,
  freeTextAnswer,
  freeTextQuestion,
} from '../../src/survey/payload';
import {encodeMetadata, utf8} from '../../src/survey/metadata';
import {proves, tally, textApprovalId} from '../../scripts/survey/tally';
import type {ChainInput, TallyConfig, Transaction} from '../../scripts/survey/types';
import type {Anchor, Answer, Metadatum, Question} from '../../src/survey/types';
const bytes = (n: number, length = 28) => new Uint8Array(length).fill(n);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const owner = bytes(1);
const payment = bytes(2);
const txid = (n: number) => hex(bytes(n, 32));
const ref = `${txid(1)}#0`;
const questions: Question[] = [
  {tag: 1, options: 2, required: true},
  {tag: 2, options: 3, min: 0, max: 3},
  {tag: 3, options: 3, min: 1, max: 3},
  {tag: 4, range: [0, 9999]},
  {tag: 5, options: 2, budget: 10},
  {tag: 6, options: 2, scale: 3, requireAll: false},
  freeTextQuestion('https://example.org/schema'),
];
const built = buildDefinition({
  owner: [0, owner],
  currentEpoch: 1,
  endEpoch: 2000,
  questions,
  presentationUri: 'https://example.org/presentation',
  presentation: {
    specVersion: 5,
    kind: 'cardano-survey-presentation',
    title: 'test',
    description: '',
    questions: questions.map((q, i) => ({
      prompt: `Question ${i}`,
      ...('options' in q
        ? {options: Array.from({length: q.options}, (_, j) => `Option ${j}`)}
        : {}),
      ...(q.tag === 6 ? {ratingLabels: ['low', 'mid', 'high']} : {}),
    })),
  },
});
const answers: Answer[] = [
  [1, 0, 0],
  [2, 1, [0, 2]],
  [3, 2, [2, 0]],
  [4, 3, 0],
  [
    5,
    4,
    [
      [0, 3],
      [1, 7],
    ],
  ],
  [6, 5, [[1, 2]]],
  freeTextAnswer(6, 'pending marker'),
];
function tx(n: number, op: number, entries: Metadatum[], epoch = 2): Transaction {
  return {
    id: txid(n),
    slot: n * 100,
    index: 0,
    epoch,
    metadata: encodeMetadata(new Map([[17, [op, entries]]])),
    requiredSigners: [hex(payment)],
    paymentKeys: [hex(payment)],
    scripts: {},
    invalidBefore: null,
    invalidHereafter: null,
  };
}
function response(value = answers, credential = payment) {
  return buildResponse({
    surveyRef: [bytes(1, 32), 0],
    definition: built.definition,
    currentEpoch: 2,
    credential: [0, credential],
    answers: value,
  });
}
function fixture(): {input: ChainInput; config: TallyConfig} {
  const definition = tx(1, 0, [built.definition], 1);
  definition.requiredSigners = [hex(owner)];
  return {
    input: {
      network: 'preview',
      epoch: 5,
      slot: 10000,
      block: txid(90),
      generatedAt: '2026-11-23T00:00:00Z',
      transactions: [definition, tx(2, 1, [response()])],
      presentations: {[hex((built.definition.get(8) as Anchor)[1])]: built.presentationBytes},
    },
    config: {network: 'preview', surveys: [{surveyRef: ref, endEpoch: 2000}], approvedText: []},
  };
}
describe('B26 CIP-179 Keyholder tally', () => {
  it('golden: all methods, role participation, omitted abstains, audited proof and moderation', async () => {
    const {input, config} = fixture();
    const artifact = tally(input, config);
    await expect(JSON.stringify(artifact, null, 2) + '\n').toMatchFileSnapshot(
      '../fixtures/survey/tally-golden.json',
    );
    const s = artifact.surveys[0];
    expect(s.participation).toEqual([{role: 4, count: 1}]);
    expect(s.questions.map((q) => q.options.map((o) => o.count))).toEqual([
      [1, 0],
      [1, 0, 1],
      [0, 0, 1],
      [1],
      [1, 1],
      [0, 1],
      [],
    ]);
    expect(s.questions[2].pairwise).toEqual([
      [0, 1, 0],
      [0, 0, 0],
      [1, 1, 0],
    ]);
    expect(s.questions[4].totals).toEqual(['3', '7']);
    expect(s.questions[5].distributions).toEqual([{option: 1, value: 2, count: 1}]);
    expect(s.questions[0].history).toEqual([{epoch: 2, counts: [1, 0]}]);
    expect(s).toMatchObject({
      interim: true,
      tallyBasis: 'response-time-only',
      snapshotBasis: 'response-time-only',
      state: 'interim',
    });
    expect(JSON.stringify(artifact)).not.toContain('pending marker');
    expect(artifact.audit[0]).toMatchObject({
      status: 'counted',
      role: 4,
      credential: `0:${hex(payment)}`,
    });
    config.approvedText = [textApprovalId('preview', txid(2), 0, 6, 'pending marker')];
    expect(tally(input, config).surveys[0].freeText).toEqual([
      {id: config.approvedText[0], text: 'pending marker', moderated: true},
    ]);
    expect(tally(input, config)).toEqual(
      tally({...input, transactions: [...input.transactions].reverse()}, config),
    );
  });
  it('uses chain order including response index; invalid later responses do not displace valid ones', () => {
    const {input, config} = fixture();
    const invalid = response([[1, 0, 1]]);
    invalid.set(4, [[1, 0, 9]]);
    input.transactions.push(tx(3, 1, [response([[1, 0, 0]]), response([[1, 0, 1]]), invalid]));
    const s = tally(input, config);
    expect(s.surveys[0].questions[0].options.map((o) => o.count)).toEqual([0, 1]);
    expect(s.surveys[0].questions.slice(1).map((q) => q.abstain)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(s.audit.map((a) => a.reason)).toEqual([
      'replaced',
      'replaced',
      'valid',
      'invalid-answer',
    ]);
    expect(s.surveys[0].freeText).toEqual([]);
  });
  it('excludes forged credential, invalid role, missing required answer and out-of-scope reference independently', () => {
    const {input, config} = fixture();
    const badRole = response();
    badRole.set(2, 0);
    const required = response();
    required.set(4, [[4, 3, 1]]);
    const unknown = response();
    unknown.set(1, [bytes(8, 32), 0]);
    input.transactions[1] = tx(2, 1, [
      response(answers, bytes(3)),
      badRole,
      required,
      unknown,
      response(),
    ]);
    expect(tally(input, config).audit.map((a) => a.reason)).toEqual([
      'credential-proof',
      'unsupported-role',
      'invalid-answer',
      'unreviewed-survey',
      'valid',
    ]);
    input.transactions[1].paymentKeys = [];
    expect(tally(input, config).surveys[0].participation[0].count).toBe(0);
  });
  it('inclusive end epoch, definition expiry, cancellation proof and final keyholder snapshot', () => {
    const {input, config} = fixture();
    input.epoch = 2001;
    input.transactions[1].epoch = 2000;
    input.transactions.push(tx(3, 1, [response()], 2001));
    expect(tally(input, config).surveys[0]).toMatchObject({
      state: 'final',
      snapshotBasis: 'end-epoch',
      participation: [{role: 4, count: 1}],
    });
    const cancel = tx(4, 2, [[bytes(1, 32), 0]], 2000);
    input.transactions.push(cancel);
    expect(tally(input, config).surveys[0].state).toBe('final');
    cancel.requiredSigners = [hex(owner)];
    expect(tally(input, config).surveys[0]).toMatchObject({
      state: 'cancelled',
      questions: [],
      freeText: [],
      participation: [{role: 4, count: 0}],
    });
    cancel.epoch = 2001;
    expect(tally(input, config).surveys[0].state).toBe('final');
    input.transactions[0].epoch = 2000;
    expect(() => tally(input, config)).toThrow('definition');
  });
  it('rejects network/tip/reference mismatches, duplicate transactions and unavailable canonical definitions', () => {
    const {input, config} = fixture();
    expect(() => tally({...input, network: 'mainnet'}, config)).toThrow('network');
    expect(() => tally({...input, slot: 50}, config)).toThrow('tip');
    expect(() =>
      tally({...input, transactions: [...input.transactions, input.transactions[0]]}, config),
    ).toThrow('duplicate');
    expect(() => tally({...input, transactions: input.transactions.slice(1)}, config)).toThrow(
      'definition',
    );
    config.surveys[0].endEpoch = 1999;
    expect(() => tally(input, config)).toThrow('epoch');
  });
  it('anchor failure changes labels only, and approval cannot cross network or edited text', () => {
    const {input, config} = fixture();
    config.approvedText = [
      textApprovalId('mainnet', txid(2), 0, 6, 'pending marker'),
      textApprovalId('preview', txid(2), 0, 6, 'other'),
    ];
    input.presentations = {[hex((built.definition.get(8) as Anchor)[1])]: utf8('{}')};
    const s = tally(input, config).surveys[0];
    expect(s.questions[0].label).toBe('Question 0');
    expect(s.freeText).toEqual([]);
    expect(s.participation[0].count).toBe(1);
  });
  it('verifies native owner thresholds and script hashes, without trusting a provided boolean', () => {
    const {input, config} = fixture();
    const script = encodeMetadata([
      3,
      2,
      [
        [0, owner],
        [0, payment],
      ],
    ]);
    const scriptHash = hex(blake2b(new Uint8Array([0, ...script]), {dkLen: 28}));
    const definition = structuredClone(built.definition);
    definition.set(1, [1, Buffer.from(scriptHash, 'hex')]);
    input.transactions[0].metadata = encodeMetadata(new Map([[17, [0, [definition]]]]));
    input.transactions[0].scripts = {[scriptHash]: script};
    expect(() => tally(input, config)).toThrow('definition');
    input.transactions[0].requiredSigners.push(hex(payment));
    expect(tally(input, config).surveys[0].participation[0].count).toBe(1);
    input.transactions[0].scripts[scriptHash] = encodeMetadata([0, owner]);
    expect(() => tally(input, config)).toThrow('definition');
  });
});

it('keeps historical numeric values and signed ranges in positional render columns', () => {
  const {input, config} = fixture();
  const definition = structuredClone(built.definition);
  const wires = definition.get(7) as Metadatum[][];
  wires[3][2] = [-10, 10];
  input.transactions[0].metadata = encodeMetadata(new Map([[17, [0, [definition]]]]));
  const first = response();
  const oldAnswers = structuredClone(answers);
  oldAnswers[3][2] = -1;
  first.set(4, oldAnswers);
  input.transactions[1].metadata = encodeMetadata(new Map([[17, [1, [first]]]]));
  input.transactions.push(
    tx(
      3,
      1,
      [
        response([
          [1, 0, 1],
          [4, 3, 4],
        ]),
      ],
      3,
    ),
  );
  const q = tally(input, config).surveys[0].questions[3];
  expect(q.options).toEqual([
    {option: 0, label: '-1', count: 0},
    {option: 1, label: '4', count: 1},
  ]);
  expect(q.history).toEqual([
    {epoch: 2, counts: [1, 0]},
    {epoch: 3, counts: [0, 1]},
  ]);
  expect(q.distributions).toEqual([{value: 4, count: 1}]);
});
it('remains interim throughout the inclusive end epoch', () => {
  const {input, config} = fixture();
  input.epoch = 2000;
  expect(tally(input, config).surveys[0]).toMatchObject({
    interim: true,
    state: 'interim',
    snapshotBasis: 'response-time-only',
  });
});

it('seeded replay matches an independent latest-wins model and never deduplicates across surveys', () => {
  const {input, config} = fixture();
  input.transactions = input.transactions.slice(0, 1);
  const model = new Map<number, {option: number; numeric: boolean}>();
  let seed = 179;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let n = 2; n < 82; n++) {
    const person = 2 + (random() % 5);
    const option = random() % 2;
    const numeric = random() % 3 === 0;
    const value: Answer[] = [[1, 0, option], ...(numeric ? [[4, 3, n] as Answer] : [])];
    const t = tx(n, 1, [response(value, bytes(person))]);
    t.requiredSigners = [hex(bytes(person))];
    t.paymentKeys = [hex(bytes(person))];
    input.transactions.push(t);
    model.set(person, {option, numeric});
  }
  input.transactions.reverse();
  const actual = tally(input, config).surveys[0];
  expect(actual.participation[0].count).toBe(model.size);
  expect(actual.questions[0].options.map((o) => o.count)).toEqual(
    [0, 1].map((option) => [...model.values()].filter((v) => v.option === option).length),
  );
  expect(actual.questions[3].abstain).toBe([...model.values()].filter((v) => !v.numeric).length);
  const second = tx(90, 0, [built.definition], 1);
  second.slot = 101;
  second.requiredSigners = [hex(owner)];
  input.transactions.push(second);
  const other = response([[1, 0, 1]]);
  other.set(1, [bytes(90, 32), 0]);
  input.transactions.push(tx(91, 1, [other]));
  config.surveys.push({surveyRef: `${txid(90)}#0`, endEpoch: 2000});
  const combined = tally(input, config);
  expect(combined.surveys.map((s) => s.participation[0].count)).toEqual([model.size, 1]);
  expect(
    combined.audit
      .filter((a) => a.status === 'counted' && a.credential === `0:${hex(payment)}`)
      .map((a) => a.surveyRef),
  ).toHaveLength(2);
});

it.each([
  [
    [
      1,
      [
        [0, owner],
        [0, payment],
      ],
    ],
    false,
  ],
  [
    [
      2,
      [
        [0, owner],
        [0, payment],
      ],
    ],
    true,
  ],
  [
    [
      1,
      [
        [0, owner],
        [4, 10],
        [5, 20],
      ],
    ],
    true,
  ],
  [
    [
      1,
      [
        [0, owner],
        [4, 11],
      ],
    ],
    false,
  ],
  [
    [
      1,
      [
        [0, owner],
        [5, 19],
      ],
    ],
    false,
  ],
] as [Metadatum, boolean][])(
  'requires actual native-script satisfaction for %j',
  (wire, expected) => {
    const script = encodeMetadata(wire);
    const hash = blake2b(new Uint8Array([0, ...script]), {dkLen: 28});
    const transaction = tx(1, 2, []);
    transaction.requiredSigners = [hex(owner)];
    transaction.invalidBefore = 10;
    transaction.invalidHereafter = 20;
    transaction.scripts = {[hex(hash)]: script};
    expect(proves([1, hash], transaction)).toBe(expected);
    transaction.invalidBefore = null;
    transaction.invalidHereafter = null;
    if (
      Array.isArray(wire) &&
      wire[0] === 1 &&
      (wire[1] as Metadatum[]).some(
        (child) => Array.isArray(child) && (child[0] === 4 || child[0] === 5),
      )
    )
      expect(proves([1, hash], transaction)).toBe(false);
  },
);

it('tallies distributions across credentials without conflating rating levels or numeric values', () => {
  const {input, config} = fixture();
  const second = tx(3, 1, [
    response(
      [
        [1, 0, 1],
        [4, 3, 4],
        [
          6,
          5,
          [
            [0, 0],
            [1, 1],
          ],
        ],
      ],
      bytes(3),
    ),
  ]);
  second.requiredSigners = [hex(bytes(3))];
  second.paymentKeys = [hex(bytes(3))];
  input.transactions.push(second);
  const s = tally(input, config).surveys[0];
  expect(s.questions[3].options).toEqual([
    {option: 0, label: '0', count: 1},
    {option: 1, label: '4', count: 1},
  ]);
  expect(s.questions[5].distributions).toEqual([
    {option: 0, value: 0, count: 1},
    {option: 1, value: 1, count: 1},
    {option: 1, value: 2, count: 1},
  ]);
  expect(s.questions[5].totals).toEqual(['0', '3']);
});
it.each([
  'not json',
  JSON.stringify({specVersion: 4}),
  JSON.stringify({specVersion: 5, kind: 'cardano-survey-presentation', questions: []}),
])('uses positional labels for invalid but hash-matching presentation: %s', (raw) => {
  const {input, config} = fixture();
  const bytes = utf8(raw);
  const hash = blake2b(bytes, {dkLen: 32});
  const definition = structuredClone(built.definition);
  definition.set(8, ['https://example.org/p', hash]);
  input.transactions[0].metadata = encodeMetadata(new Map([[17, [0, [definition]]]]));
  input.presentations = {[hex(hash)]: bytes};
  const s = tally(input, config).surveys[0];
  expect(s.questions[0].label).toBe('Question 0');
  expect(s.participation[0].count).toBe(1);
});
it('excludes pre-definition and wrong-version responses with explicit audit reasons', () => {
  const {input, config} = fixture();
  const early = tx(3, 1, [response()]);
  early.slot = 50;
  const wrong = response();
  wrong.set(0, 99);
  input.transactions.push(early, tx(4, 1, [wrong]));
  expect(tally(input, config).audit.map((a) => a.reason)).toEqual([
    'before-definition',
    'valid',
    'unsupported-version',
  ]);
});

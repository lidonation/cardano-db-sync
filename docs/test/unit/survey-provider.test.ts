import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {bech32} from 'bech32';
import {blake2b} from '@noble/hashes/blake2b';
import {describe, expect, it, vi} from 'vitest';
import {acquire, epochAtSlot, fetchPresentation, paymentKey} from '../../scripts/survey/provider';
import {configuration, main, runNetwork} from '../../scripts/survey/run';
import {buildDefinition, buildResponse} from '../../src/survey/payload';
import {encodeMetadata, utf8} from '../../src/survey/metadata';
import type {TallyConfig} from '../../scripts/survey/types';
const h = (n: number) => n.toString(16).padStart(64, '0');
const key = new Uint8Array(28).fill(2);
const keyHex = Buffer.from(key).toString('hex');
function address(network = 'preview', tag = 6) {
  return bech32.encode(
    network === 'mainnet' ? 'addr' : 'addr_test',
    bech32.toWords(new Uint8Array([(tag << 4) | (network === 'mainnet' ? 1 : 0), ...key])),
  );
}
const built = buildDefinition({
  owner: [0, key],
  currentEpoch: 1,
  endEpoch: 2000,
  questions: [{tag: 1, options: 2}],
  presentationUri: 'https://lidonation.github.io/p.json',
  presentation: {
    specVersion: 5,
    kind: 'cardano-survey-presentation',
    title: '',
    description: '',
    questions: [{prompt: 'Choose', options: ['A', 'B']}],
  },
});
const response = buildResponse({
  definition: built.definition,
  surveyRef: [Buffer.from(h(1), 'hex'), 0],
  credential: [0, key],
  currentEpoch: 2,
  answers: [[1, 0, 1]],
});
const config: TallyConfig = {
  network: 'preview',
  surveys: [{surveyRef: `${h(1)}#0`, endEpoch: 2000}],
  approvedText: [],
};
function provider() {
  const data: Record<string, unknown> = {
    '/blocks/latest': {height: 35},
    '/blocks/20': {height: 20, hash: h(20), epoch: 2, slot: 200000, time: 1800000000},
    '/metadata/txs/labels/17/cbor?count=100&page=1&order=asc': [
      {
        tx_hash: h(1),
        metadata: Buffer.from(encodeMetadata(new Map([[17, [0, [built.definition]]]]))).toString(
          'hex',
        ),
      },
      {tx_hash: h(2), metadata: Buffer.from(encodeMetadata([1, [response]])).toString('hex')},
    ],
  };
  // Use real response shapes and no network traffic.
  for (const n of [1, 2]) {
    data[`/txs/${h(n)}`] = {
      hash: h(n),
      block_height: n,
      block: h(n + 10),
      slot: n * 86400,
      index: 0,
      valid_contract: true,
      invalid_before: null,
      invalid_hereafter: null,
    };
    data[`/blocks/${h(n + 10)}`] = {hash: h(n + 10), height: n, slot: n * 86400, epoch: n};
    data[`/txs/${h(n)}/required_signers`] = [{witness_hash: keyHex}];
    data[`/txs/${h(n)}/utxos`] = {
      hash: h(n),
      inputs: [{address: address(), collateral: false, reference: false}],
      outputs: [],
    };
  }
  const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.origin === 'https://lidonation.github.io') {
      expect(init?.headers).toBeUndefined();
      return new Response(built.presentationBytes as BodyInit);
    }
    expect(u.origin).toBe('https://cardano-preview.blockfrost.io');
    expect(init?.headers).toEqual({project_id: 'secret-marker'});
    const route = u.pathname.replace('/api/v0', '') + u.search;
    if (!(route in data)) throw new Error('unexpected route ' + route);
    return new Response(JSON.stringify(data[route]));
  });
  return {data, http};
}
describe('B26 provider boundary', () => {
  it('acquires exact bytes, chain order, required signers and real payment evidence', async () => {
    const {http} = provider();
    const input = await acquire(config, 'secret-marker', ['https://lidonation.github.io'], http);
    expect(input).toMatchObject({network: 'preview', epoch: 2, slot: 200000, block: h(20)});
    expect(input.transactions.map((t) => [t.epoch, t.requiredSigners, t.paymentKeys])).toEqual([
      [1, [keyHex], [keyHex]],
      [2, [keyHex], [keyHex]],
    ]);
    expect(Object.values(input.presentations)).toEqual([built.presentationBytes]);
    expect(http.mock.calls.at(-1)?.[0]).toContain('/blocks/20');
  });
  it('uses fixed mainnet origin and never puts the provider key on a presentation request', async () => {
    const http = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain('https://cardano-mainnet.blockfrost.io/');
      throw new Error('secret-marker');
    });
    await expect(
      acquire({...config, network: 'mainnet'}, 'secret-marker', [], http),
    ).rejects.toThrow('Survey chain provider request failed');
    await expect(acquire(config, '', [], http)).rejects.toThrow('configuration');
  });
  it('fails closed on duplicates, missing CBOR, truncated pages, wrong hashes and rollback', async () => {
    for (const kind of ['duplicate', 'null', 'overflow', 'hash', 'rollback'] as const) {
      const {data, http} = provider();
      const rows = data['/metadata/txs/labels/17/cbor?count=100&page=1&order=asc'] as object[];
      if (kind === 'duplicate') rows.push(rows[0]);
      if (kind === 'null') rows[0] = {tx_hash: h(1), metadata: null};
      if (kind === 'overflow')
        data['/metadata/txs/labels/17/cbor?count=100&page=1&order=asc'] = Array(101).fill(rows[0]);
      if (kind === 'hash') (data[`/txs/${h(1)}`] as {hash: string}).hash = h(99);
      if (kind === 'rollback') {
        const original = http.getMockImplementation()!;
        let calls = 0;
        http.mockImplementation(async (url, init) => {
          if (String(url).endsWith('/blocks/20') && ++calls === 2)
            return new Response(JSON.stringify({...(data['/blocks/20'] as object), hash: h(99)}));
          return original(url, init);
        });
      }
      await expect(acquire(config, 'secret-marker', [], http), kind).rejects.toThrow();
    }
  });
  it('bounds bodies and scrubs HTTP/transport failures', async () => {
    for (const http of [
      vi.fn(async () => {
        throw new Error('secret-marker');
      }),
      vi.fn(async () => new Response('secret-marker', {status: 403})),
      vi.fn(async () => new Response('x'.repeat(2_000_001))),
    ]) {
      await expect(acquire(config, 'secret-marker', [], http)).rejects.toThrow(
        /^Survey chain provider request failed$/,
      );
    }
  });
  it('skips unreviewed data, out-of-tip and ledger-invalid transactions without fetching further proofs', async () => {
    const {data, http} = provider();
    (data[`/txs/${h(1)}`] as {block_height: number}).block_height = 21;
    (data[`/txs/${h(2)}`] as {valid_contract: boolean}).valid_contract = false;
    const input = await acquire(config, 'secret-marker', [], http);
    expect(input.transactions).toEqual([]);
    expect(http.mock.calls.some(([url]) => String(url).includes('required_signers'))).toBe(false);
  });
  it('restricts anchor origins, protocol, redirects and credential forwarding', async () => {
    const http = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => new Response('bytes'),
    );
    for (const uri of [
      'https://evil.example/p',
      'https://user:pass@lidonation.github.io/p',
      'ipfs://abc',
      'http://lidonation.github.io/p',
    ])
      expect(
        await fetchPresentation([uri, new Uint8Array(32)], ['https://lidonation.github.io'], http),
      ).toBeUndefined();
    expect(http).not.toHaveBeenCalled();
    expect(
      await fetchPresentation(
        ['https://lidonation.github.io/p', new Uint8Array(32)],
        ['https://lidonation.github.io'],
        http,
      ),
    ).toEqual(utf8('bytes'));
    expect(http.mock.calls[0][1]).toMatchObject({redirect: 'error'});
  });
  it('proves Shelley payment-key usage, not scripts, rewards, Byron or cross-network addresses', () => {
    expect(paymentKey(address(), 'preview')).toBe(keyHex);
    expect(paymentKey(address('mainnet'), 'mainnet')).toBe(keyHex);
    expect(paymentKey(address('preview', 7), 'preview')).toBeNull();
    expect(paymentKey('stake_test1anything', 'preview')).toBeNull();
    expect(paymentKey('Ae2Byron', 'preview')).toBeNull();
    expect(() => paymentKey(address(), 'mainnet')).toThrow('network');
    expect(() => paymentKey('addr_test1broken', 'preview')).toThrow();
  });
});
describe('scheduled publication', () => {
  async function directory() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'survey-tally-'));
    await mkdir(path.join(root, 'config'));
    await writeFile(
      path.join(root, 'config/survey-tally.json'),
      JSON.stringify({preview: config, mainnet: {surveys: [], approvedText: []}}),
    );
    return root;
  }
  it('writes byte-identical aggregates on replay, isolates networks, and retains old data on failure', async () => {
    const root = await directory();
    try {
      const {http} = provider();
      const input = await acquire(config, 'secret-marker', [], http);
      const source = vi.fn(async () => input);
      const env = {BLOCKFROST_PREVIEW_PROJECT_ID: 'secret-marker'};
      expect(await runNetwork(root, 'preview', env, source)).toBe('updated');
      const file = path.join(root, 'generated/survey-preview/aggregate.json');
      const first = await readFile(file, 'utf8');
      expect(await runNetwork(root, 'preview', env, source)).toBe('unchanged');
      await expect(runNetwork(root, 'preview', {}, source)).rejects.toThrow('credential');
      await expect(
        runNetwork(root, 'preview', env, async () => {
          throw new Error('provider failure');
        }),
      ).rejects.toThrow();
      expect(await readFile(file, 'utf8')).toBe(first);
      expect(first).not.toContain('secret-marker');
      expect(await runNetwork(root, 'mainnet', {}, source)).toBe('unconfigured');
      const inactive = JSON.parse(
        await readFile(path.join(root, 'generated/survey-mainnet/aggregate.json'), 'utf8'),
      );
      expect(inactive).toEqual({
        network: 'mainnet',
        generatedAt: null,
        tip: null,
        surveys: [],
        audit: [],
      });
      expect(
        await main(root, ['preview', 'mainnet'], {}, {
          log: vi.fn(),
          error: vi.fn(),
        } as unknown as Console),
      ).toBe(false);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
  it('validates reviewed refs, end epochs, duplicates and network-scoped moderation IDs', () => {
    for (const bad of [
      null,
      [],
      {},
      {surveys: [{surveyRef: 'core-1', endEpoch: 2000}], approvedText: []},
      {...config, surveys: [...config.surveys, ...config.surveys]},
      {...config, approvedText: ['mainnet:' + h(1) + ':0:0:' + h(3)]},
    ])
      expect(() => configuration(bad, 'preview')).toThrow();
    expect(configuration(config, 'preview')).toEqual(config);
  });
});

it('follows full discovery pages without mistaking a page boundary for end-of-history', async () => {
  const {data, http} = provider();
  const route = '/metadata/txs/labels/17/cbor?count=100&page=1&order=asc';
  const canonical = data[route];
  const irrelevant = Buffer.from(encodeMetadata([9, []])).toString('hex');
  data[route] = Array.from({length: 100}, (_, i) => ({tx_hash: h(i + 100), metadata: irrelevant}));
  data['/metadata/txs/labels/17/cbor?count=100&page=2&order=asc'] = canonical;
  const result = await acquire(config, 'secret-marker', [], http);
  expect(result.transactions).toHaveLength(2);
  expect(http.mock.calls.some(([url]) => String(url).includes('page=2'))).toBe(true);
});

it('does not let an unrelated sibling definition force script fetches or alter the canonical tally', async () => {
  const {data, http} = provider();
  const rows = data['/metadata/txs/labels/17/cbor?count=100&page=1&order=asc'] as {
    metadata: string;
  }[];
  const unrelated = structuredClone(built.definition);
  unrelated.set(1, [1, new Uint8Array(28).fill(9)]);
  rows[0].metadata = Buffer.from(
    encodeMetadata(new Map([[17, [0, [built.definition, unrelated]]]])),
  ).toString('hex');
  expect((await acquire(config, 'secret-marker', [], http)).transactions).toHaveLength(2);
  expect(http.mock.calls.some(([url]) => String(url).includes('/scripts/'))).toBe(false);
});

it('acquires native-owner scripts for both definition and later cancellations', async () => {
  const {data, http} = provider();
  const script = encodeMetadata([0, key]);
  const scriptHash = blake2b(new Uint8Array([0, ...script]), {dkLen: 28});
  const native = structuredClone(built.definition);
  native.set(1, [1, scriptHash]);
  const rows = data['/metadata/txs/labels/17/cbor?count=100&page=1&order=asc'] as {
    metadata: string;
  }[];
  rows[0].metadata = Buffer.from(encodeMetadata(new Map([[17, [0, [native]]]]))).toString('hex');
  const id = Buffer.from(scriptHash).toString('hex');
  data[`/scripts/${id}`] = {type: 'timelock'};
  data[`/scripts/${id}/cbor`] = {cbor: Buffer.from(script).toString('hex')};
  (data[`/txs/${h(1)}`] as {invalid_before: string | null}).invalid_before = '100';
  (data[`/txs/${h(1)}`] as {invalid_hereafter: string | null}).invalid_hereafter = '100000';
  const result = await acquire(config, 'secret-marker', [], http);
  expect(result.transactions[0].scripts[id]).toEqual(Buffer.from(script));
  expect(result.transactions[1].scripts[id]).toEqual(Buffer.from(script));
  expect(result.transactions[0]).toMatchObject({invalidBefore: 100, invalidHereafter: 100000});
});
it.each([
  ['preview', 0, 0],
  ['preview', 86399, 0],
  ['preview', 86400, 1],
  ['mainnet', 4492799, 207],
  ['mainnet', 4492800, 208],
  ['mainnet', 4924800, 209],
] as const)('derives %s slot %i as epoch %i', (network, slot, epoch) => {
  expect(epochAtSlot(network, slot)).toBe(epoch);
});

it.each([
  ['tip height', '/blocks/20', 'height', 21, 'height mismatch'],
  ['tip epoch', '/blocks/20', 'epoch', 3, 'epoch/slot mismatch'],
  ['block slot', `/blocks/${h(11)}`, 'slot', 99, 'block/transaction mismatch'],
  ['response epoch', `/blocks/${h(11)}`, 'epoch', 3, 'response epoch/slot mismatch'],
  ['UTxO identity', `/txs/${h(1)}/utxos`, 'hash', h(99), 'UTxO mismatch'],
  ['validity bound', `/txs/${h(1)}`, 'invalid_before', 'not-a-slot', 'validity bound'],
  ['missing integer', '/blocks/latest', 'height', null, 'provider integer'],
] as const)(
  'rejects inconsistent %s evidence instead of publishing partial results',
  async (_name, route, field, value, error) => {
    const {data, http} = provider();
    (data[route] as Record<string, unknown>)[field] = value;
    await expect(acquire(config, 'secret-marker', [], http)).rejects.toThrow(error);
  },
);
it('rejects malformed provider schemas and duplicate signers; excludes collateral/reference role evidence', async () => {
  for (const value of [
    null,
    {},
    [{witness_hash: 'invalid'}],
    [{witness_hash: keyHex}, {witness_hash: keyHex}],
  ]) {
    const {data, http} = provider();
    data[`/txs/${h(1)}/required_signers`] = value;
    await expect(acquire(config, 'secret-marker', [], http)).rejects.toThrow();
  }
  const {data, http} = provider();
  data[`/txs/${h(2)}/utxos`] = {
    hash: h(2),
    inputs: [
      {address: address(), collateral: true},
      {address: address(), reference: true},
    ],
    outputs: [],
  };
  expect((await acquire(config, 'secret-marker', [], http)).transactions[1].paymentKeys).toEqual(
    [],
  );
});

import {describe, expect, it} from 'vitest';
import type {Metadatum} from '../../src/survey/types';
import {decodeMetadata, encodeMetadata, chunkText} from '../../src/survey/metadata';

describe('Cardano metadatum CBOR (CIP-179 v5)', () => {
  it('matches independent RFC 8949 vectors and uses integer map keys / raw bytes', () => {
    const value = new Map<Metadatum, Metadatum>([
      [
        17,
        [
          1,
          [
            new Map<Metadatum, Metadatum>([
              [0, 5],
              [1, [new Uint8Array(32), 0]],
            ]),
          ],
        ],
      ],
    ]);
    const encoded = encodeMetadata(value);
    expect(Buffer.from(encoded).toString('hex')).toBe(
      'a111820181a2000501825820' + '00'.repeat(32) + '00',
    );
    expect(decodeMetadata(encoded)).toEqual(value);
    for (const [v, hex] of [
      [24, '1818'],
      [-1000, '3903e7'],
      [65536, '1a00010000'],
      ['ü', '62c3bc'],
    ] as const) {
      expect(Buffer.from(encodeMetadata(v)).toString('hex')).toBe(hex);
      expect(decodeMetadata(Buffer.from(hex, 'hex'))).toEqual(v);
    }
    expect(decodeMetadata(encodeMetadata(18446744073709551615n))).toBe(18446744073709551615n);
    expect(decodeMetadata(encodeMetadata(-18446744073709551616n))).toBe(-18446744073709551616n);
  });
  it('chunks UTF-8 without splitting code points, with no lost or normalized text', () => {
    for (const text of [
      '',
      'a'.repeat(64),
      'a'.repeat(65),
      '🙂é中'.repeat(100),
      'e\u0301'.repeat(90),
    ]) {
      const chunks = chunkText(text);
      expect(typeof chunks === 'string' ? chunks : chunks.join('')).toBe(text);
      expect(
        (Array.isArray(chunks) ? chunks : [chunks]).every(
          (c) => new TextEncoder().encode(c).length <= 64,
        ),
      ).toBe(true);
      expect(decodeMetadata(encodeMetadata(chunks))).toEqual(chunks);
    }
    expect(() => chunkText('\ud800')).toThrow(/Unicode/);
  });
  it('rejects non-ledger values, duplicates, malformed CBOR and oversized / deep data', () => {
    for (const hex of [
      'f5',
      'f6',
      'fb0000000000000000',
      '9fff',
      '1800',
      'a201000101',
      '6161ff',
      '62ffff',
      '81',
      'd800',
    ]) {
      expect(() => decodeMetadata(Buffer.from(hex, 'hex')), hex).toThrow();
    }
    for (const value of [
      NaN,
      0.5,
      Number.MAX_SAFE_INTEGER + 1,
      'a'.repeat(65),
      new Uint8Array(65),
      2n ** 64n,
      true,
      null,
      {},
      undefined,
    ]) {
      expect(() => encodeMetadata(value as never)).toThrow();
    }
    let deep: unknown = 0;
    for (let i = 0; i < 66; i++) deep = [deep];
    expect(() => encodeMetadata(deep as never)).toThrow(/depth/);
    expect(() =>
      encodeMetadata(
        new Map<Metadatum, Metadatum>([
          [new Uint8Array([0]), 1],
          [new Uint8Array([0]), 2],
        ]),
      ),
    ).toThrow(/duplicate/);
  });
  it('round-trips seeded heterogeneous metadata and canonicalizes map order', () => {
    let seed = 179;
    for (let i = 0; i < 200; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const m = new Map<Metadatum, Metadatum>([
        [2, [seed, -seed, chunkText('🙂'.repeat(seed % 80))]],
        [0, new Uint8Array([seed % 256])],
      ]);
      expect(decodeMetadata(encodeMetadata(m))).toEqual(m);
      expect(encodeMetadata(new Map<Metadatum, Metadatum>([...m].reverse()))).toEqual(
        encodeMetadata(m),
      );
    }
  });
});

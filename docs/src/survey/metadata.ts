import type {Metadatum} from './types';

const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', {fatal: true});
const MAX_BYTES = 1_048_576;
const MAX_UINT = (1n << 64n) - 1n;

/** Never silently replace unpaired surrogates before hashing, encoding or chunking. */
export function utf8(text: string): Uint8Array {
  const bytes = UTF8.encode(text);
  if (UTF8_DECODER.decode(bytes) !== text) throw new Error('Invalid Unicode text');
  return bytes;
}

/** CIP-20-style text, each chunk <=64 UTF-8 bytes, preserving exact code points. */
export function chunkText(text: string): string | string[] {
  if (utf8(text).length <= 64) return text;
  const chunks: string[] = [];
  let chunk = '';
  let size = 0;
  for (const point of text) {
    const length = UTF8.encode(point).length;
    if (size + length > 64) {
      chunks.push(chunk);
      chunk = '';
      size = 0;
    }
    chunk += point;
    size += length;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function compare(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Deterministic, definite-length CBOR for the ledger metadata subset only. Not a tx builder. */
export function encodeMetadata(value: Metadatum): Uint8Array {
  const out: number[] = [];
  const push = (...bytes: number[]) => {
    if (out.length + bytes.length > MAX_BYTES) throw new Error('Metadata size limit');
    out.push(...bytes);
  };
  const header = (major: number, n: bigint) => {
    if (n < 0n || n > MAX_UINT) throw new Error('Integer outside ledger range');
    if (n < 24n) return push((major << 5) | Number(n));
    const size = n <= 255n ? 1 : n <= 65535n ? 2 : n <= 4294967295n ? 4 : 8;
    push((major << 5) | ({1: 24, 2: 25, 4: 26, 8: 27} as const)[size]);
    for (let i = size - 1; i >= 0; i--) push(Number((n >> BigInt(i * 8)) & 255n));
  };
  const write = (v: Metadatum, depth: number): void => {
    if (depth > 64) throw new Error('Metadata depth limit');
    if (typeof v === 'number' || typeof v === 'bigint') {
      if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new Error('Unsafe integer');
      const n = BigInt(v);
      header(n >= 0n ? 0 : 1, n >= 0n ? n : -1n - n);
    } else if (typeof v === 'string' || v instanceof Uint8Array) {
      const bytes = typeof v === 'string' ? utf8(v) : v;
      if (bytes.length > 64) throw new Error('Metadata scalar exceeds 64 bytes');
      header(typeof v === 'string' ? 3 : 2, BigInt(bytes.length));
      push(...bytes);
    } else if (Array.isArray(v)) {
      header(4, BigInt(v.length));
      for (const item of v) write(item, depth + 1);
    } else if (v instanceof Map) {
      // Canonical ordering also detects byte-equivalent keys with distinct JS identities.
      // Keys consume the same depth budget as values (no recursive encoder depth reset).
      const entries = [...v.entries()]
        .map(([key, item]) => {
          const start = out.length;
          write(key, depth + 1);
          const encoded = Uint8Array.from(out.splice(start));
          return {encoded, item};
        })
        .sort((a, b) => compare(a.encoded, b.encoded));
      header(5, BigInt(entries.length));
      for (let i = 0; i < entries.length; i++) {
        if (i && compare(entries[i - 1].encoded, entries[i].encoded) === 0)
          throw new Error('duplicate map key');
        for (const byte of entries[i].encoded) push(byte);
        write(entries[i].item, depth + 1);
      }
    } else throw new Error('Not a transaction metadatum');
  };
  write(value, 0);
  return Uint8Array.from(out);
}

/** Bounded decoder: rejects trailing bytes, indefinite lengths, non-minimal scalars and duplicates. */
export function decodeMetadata(bytes: Uint8Array): Metadatum {
  if (bytes.length > MAX_BYTES) throw new Error('Metadata size limit');
  let offset = 0;
  const byte = () => {
    if (offset >= bytes.length) throw new Error('Truncated CBOR');
    return bytes[offset++];
  };
  const read = (depth: number): Metadatum => {
    if (depth > 64) throw new Error('Metadata depth limit');
    const first = byte();
    const major = first >> 5;
    const info = first & 31;
    if (major > 5 || info > 27) throw new Error('Not ledger CBOR');
    let n = BigInt(info);
    if (info >= 24) {
      const size = 1 << (info - 24);
      n = 0n;
      for (let i = 0; i < size; i++) n = (n << 8n) | BigInt(byte());
      const minimum = [24n, 256n, 65536n, 4294967296n][info - 24];
      if (n < minimum) throw new Error('Non-minimal CBOR');
    }
    if (major <= 1) {
      const integer = major === 0 ? n : -1n - n;
      return integer >= BigInt(Number.MIN_SAFE_INTEGER) &&
        integer <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(integer)
        : integer;
    }
    if (n > BigInt(bytes.length - offset)) throw new Error('Invalid CBOR length');
    const length = Number(n);
    if (major === 2 || major === 3) {
      if (length > 64) throw new Error('Metadata scalar exceeds 64 bytes');
      const data = bytes.slice(offset, offset + length);
      offset += length;
      return major === 2 ? data : UTF8_DECODER.decode(data);
    }
    if (major === 4) return Array.from({length}, () => read(depth + 1));
    const map = new Map<Metadatum, Metadatum>();
    const keys = new Set<string>();
    for (let i = 0; i < length; i++) {
      const key = read(depth + 1);
      const canonical = encodeMetadata(key).join(',');
      if (keys.has(canonical)) throw new Error('duplicate map key');
      keys.add(canonical);
      map.set(key, read(depth + 1));
    }
    return map;
  };
  const value = read(0);
  if (offset !== bytes.length) throw new Error('Trailing CBOR');
  return value;
}

/** Read-only Blockfrost adapter. No user-selected origin, signing key, or unbounded response. */
import {bech32} from 'bech32';
import {decodeMetadata, encodeMetadata} from '../../src/survey/metadata';
import type {Anchor, Metadatum} from '../../src/survey/types';
import {hex, surveyReference} from './tally';
import type {ChainInput, Network, TallyConfig, Transaction} from './types';

const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
function number(v: unknown): number {
  if (!integer(v)) throw new Error('Invalid provider integer');
  return v;
}
function hash(v: unknown, length = 64): string {
  if (typeof v !== 'string' || !new RegExp(`^[a-f0-9]{${length}}$`).test(v))
    throw new Error('Invalid provider hash');
  return v;
}
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid provider object');
  return v as Record<string, unknown>;
}
function array(v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new Error('Invalid provider array');
  return v;
}
function bytes(v: unknown): Uint8Array {
  if (typeof v !== 'string' || v.length > 2_097_152 || !/^(?:[a-f0-9]{2})+$/.test(v))
    throw new Error('Invalid provider CBOR');
  return Buffer.from(v, 'hex');
}
function bound(v: unknown): number | null {
  if (v === null) return null;
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]*)$/.test(v))
    throw new Error('Invalid validity bound');
  return number(Number(v));
}
async function readBytes(response: Response): Promise<Uint8Array> {
  if (!response.ok || !response.body) throw new Error('request failed');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2_000_000) throw new Error('response too large');
      chunks.push(value);
    }
    return Uint8Array.from(Buffer.concat(chunks));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
/** Slots are network-specific; mainnet changed slot length at Shelley epoch 208. */
export function epochAtSlot(network: Network, slot: number): number {
  number(slot);
  if (network === 'preview') return Math.floor(slot / 86400);
  return slot < 4492800 ? Math.floor(slot / 21600) : 208 + Math.floor((slot - 4492800) / 432000);
}
export function paymentKey(address: unknown, network: Network): string | null {
  if (typeof address !== 'string') throw new Error('Invalid provider address');
  // Byron and stake addresses cannot establish a Shelley payment credential.
  if (!address.startsWith('addr')) return null;
  try {
    const decoded = bech32.decode(address, 200);
    const raw = Uint8Array.from(bech32.fromWords(decoded.words));
    const tag = raw[0] >> 4;
    const networkId = raw[0] & 15;
    if (
      networkId !== (network === 'mainnet' ? 1 : 0) ||
      decoded.prefix !== (network === 'mainnet' ? 'addr' : 'addr_test')
    )
      throw new Error('network');
    if (![0, 2, 4, 6].includes(tag)) return null;
    if (
      ([0, 2].includes(tag) && raw.length !== 57) ||
      (tag === 6 && raw.length !== 29) ||
      (tag === 4 && raw.length < 32)
    )
      throw new Error('shape');
    return hex(raw.slice(1, 29));
  } catch {
    throw new Error('Invalid provider payment address or network');
  }
}
/** Allow only origins already reviewed in this network's config. Never forward provider keys. */
export async function fetchPresentation(
  anchor: Anchor,
  origins: readonly string[],
  http: typeof fetch,
): Promise<Uint8Array | undefined> {
  const uri = typeof anchor[0] === 'string' ? anchor[0] : anchor[0].join('');
  try {
    const url = new URL(uri);
    if (url.protocol !== 'https:' || url.username || url.password || !origins.includes(url.origin))
      return;
    return await readBytes(
      await http(url.href, {redirect: 'error', signal: AbortSignal.timeout(15_000)}),
    );
  } catch {
    return;
  }
}
export async function acquire(
  config: TallyConfig,
  key: string,
  presentationOrigins: readonly string[],
  http: typeof fetch = fetch,
): Promise<ChainInput> {
  if (!['preview', 'mainnet'].includes(config.network) || !key)
    throw new Error('Missing network/provider configuration');
  const origin = `https://cardano-${config.network}.blockfrost.io/api/v0`;
  const get = async (route: string): Promise<unknown> => {
    try {
      return JSON.parse(
        Buffer.from(
          await readBytes(
            await http(origin + route, {
              headers: {project_id: key},
              redirect: 'error',
              signal: AbortSignal.timeout(15_000),
            }),
          ),
        ).toString('utf8'),
      );
    } catch {
      throw new Error('Survey chain provider request failed');
    } // Never leak credential-bearing transport errors/bodies.
  };
  const latest = object(await get('/blocks/latest'));
  // Fifteen-block settlement buffer; never publish a moving unconfirmed head.
  const height = Math.max(0, number(latest.height) - 15);
  const tip = object(await get(`/blocks/${height}`));
  if (number(tip.height) !== height) throw new Error('Provider tip height mismatch');
  const block = hash(tip.hash);
  const epoch = number(tip.epoch);
  const slot = number(tip.slot);
  if (epochAtSlot(config.network, slot) !== epoch)
    throw new Error('Provider tip epoch/slot mismatch');
  const generatedAt = new Date(number(tip.time) * 1000).toISOString();
  const transactions: Transaction[] = [];
  const presentations: Record<string, Uint8Array> = {};
  const reviewed = new Set(config.surveys.map((s) => s.surveyRef));
  const listed = new Set<string>();
  const blockCache = new Map<string, Record<string, unknown>>();
  const scriptCache = new Map<string, Uint8Array>();
  let completed = false;
  // Full oldest-first replay on each run; no cursor can hide a late cancellation or rollback.
  // A cap fails the run rather than publishing truncated totals. Last artifact survives.
  for (let page = 1; page <= 1000; page++) {
    const rows = array(await get(`/metadata/txs/labels/17/cbor?count=100&page=${page}&order=asc`));
    if (rows.length > 100) throw new Error('Provider page overflow');
    for (const raw of rows) {
      const row = object(raw);
      const id = hash(row.tx_hash);
      if (listed.has(id)) throw new Error('Duplicate provider page');
      listed.add(id);
      // `metadata` is the non-deprecated raw hex field, not cbor_metadata's PostgreSQL bytea.
      const rawMetadata = bytes(row.metadata); // Missing raw bytes is an acquisition failure.
      let metadata: Metadatum;
      try {
        metadata = decodeMetadata(rawMetadata);
      } catch {
        continue;
      } // Not our deterministic v5 subset.
      const payload = metadata instanceof Map ? metadata.get(17) : metadata;
      if (!Array.isArray(payload) || payload.length !== 2 || !Array.isArray(payload[1])) continue;
      const [op, entries] = payload;
      if (op !== 0 && op !== 1 && op !== 2) continue;
      const relevant =
        op === 0
          ? config.surveys.some((s) => s.surveyRef.startsWith(`${id}#`))
          : entries.some((e) => {
              const ref = surveyReference(op === 1 && e instanceof Map ? e.get(1) : e);
              return ref && reviewed.has(ref);
            });
      if (!relevant) continue;
      const tx = object(await get(`/txs/${id}`));
      if (hash(tx.hash) !== id) throw new Error('Provider transaction mismatch');
      if (number(tx.block_height) > height) continue;
      if (typeof tx.valid_contract !== 'boolean')
        throw new Error('Missing ledger validity evidence');
      if (!tx.valid_contract) continue; // Phase-2-invalid txs have no effective survey metadata.
      const blockId = hash(tx.block);
      let containing = blockCache.get(blockId);
      if (!containing) {
        containing = object(await get(`/blocks/${blockId}`));
        blockCache.set(blockId, containing);
      }
      if (
        hash(containing.hash) !== blockId ||
        number(containing.slot) !== number(tx.slot) ||
        number(containing.height) !== number(tx.block_height)
      )
        throw new Error('Provider block/transaction mismatch');
      if (epochAtSlot(config.network, number(tx.slot)) !== number(containing.epoch))
        throw new Error('Provider response epoch/slot mismatch');
      const requiredSigners: string[] = [];
      // Unlike metadata discovery, this endpoint has no pagination parameters.
      for (const signer of array(await get(`/txs/${id}/required_signers`))) {
        const h = hash(object(signer).witness_hash, 56);
        if (requiredSigners.includes(h)) throw new Error('Duplicate required signer');
        requiredSigners.push(h);
      }
      const utxos = object(await get(`/txs/${id}/utxos`));
      if (hash(utxos.hash) !== id) throw new Error('Provider UTxO mismatch');
      const paymentKeys = [
        ...new Set(
          [...array(utxos.inputs), ...array(utxos.outputs)].flatMap((raw) => {
            const u = object(raw);
            if (u.collateral === true || u.reference === true) return [];
            const payment = paymentKey(u.address, config.network);
            return payment ? [payment] : [];
          }),
        ),
      ];
      const scripts: Record<string, Uint8Array> = {};
      for (const [definitionIndex, entry] of entries.entries()) {
        if (op !== 0 || !reviewed.has(`${id}#${definitionIndex}`)) continue;
        const c = entry instanceof Map ? entry.get(1) : undefined;
        if (Array.isArray(c) && c[0] === 1 && c[1] instanceof Uint8Array && c[1].length === 28) {
          const scriptHash = hex(c[1]);
          const info = object(await get(`/scripts/${scriptHash}`));
          if (info.type === 'timelock') {
            let script = scriptCache.get(scriptHash);
            if (!script) {
              script = bytes(object(await get(`/scripts/${scriptHash}/cbor`)).cbor);
              scriptCache.set(scriptHash, script);
            }
            scripts[scriptHash] = script;
          }
        }
        if (entry instanceof Map) {
          const a = entry.get(8);
          if (
            Array.isArray(a) &&
            a.length === 2 &&
            a[1] instanceof Uint8Array &&
            a[1].length === 32
          ) {
            const fetched = await fetchPresentation(a as Anchor, presentationOrigins, http);
            if (fetched) presentations[hex(a[1])] = fetched;
          }
        }
      }
      transactions.push({
        id,
        slot: number(tx.slot),
        index: number(tx.index),
        epoch: number(containing.epoch),
        metadata: encodeMetadata(new Map([[17, payload]])),
        requiredSigners,
        paymentKeys,
        scripts,
        invalidBefore: bound(tx.invalid_before),
        invalidHereafter: bound(tx.invalid_hereafter),
      });
    }
    if (rows.length < 100) {
      completed = true;
      break;
    }
  }
  if (!completed) throw new Error('Incomplete metadata pagination');
  // Cancellations need the definition's script, which may only be indexed with the definition.
  for (const tx of transactions) Object.assign(tx.scripts, Object.fromEntries(scriptCache));
  if (hash(object(await get(`/blocks/${height}`)).hash) !== block)
    throw new Error('Chain rollback during tally');
  return {network: config.network, epoch, slot, block, generatedAt, transactions, presentations};
}

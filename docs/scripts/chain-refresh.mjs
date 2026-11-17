#!/usr/bin/env node
/** Scheduled acquisition only; site builds never import this module or read provider keys. */
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {format} from 'prettier';
import {numbersState} from '../src/numbers/snapshot.mjs';
import {modelStorage, storageModelMatches} from '../src/storage/model.mjs';
const seconds = {preview: 86400, mainnet: 432000};
// Cardano network genesis anchors; mainnet's Byron and Shelley epochs both last five days.
const genesis = {preview: 1666656000, mainnet: 1506203091};
const integer = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const object = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid provider object');
  return v;
};
const count = (v) => {
  if (!integer(v)) throw new Error('Invalid provider count');
  return v;
};
export function epochBoundary(network, epoch) {
  return new Date((genesis[network] + count(epoch) * seconds[network]) * 1000).toISOString();
}
/** No retries or unbounded history scans. A failure retains the last committed snapshot. */
export async function refreshNetwork(input, http = globalThis.fetch) {
  const {network, key, existing, now} = input;
  if (!key) return {status: 'unconfigured', snapshot: existing};
  const previous = numbersState(existing, network, now ?? new Date().toISOString());
  if (previous.status === 'ready' && storageModelMatches(previous.snapshot))
    return {status: 'unchanged', snapshot: existing};
  async function get(route) {
    try {
      const response = await http(`https://cardano-${network}.blockfrost.io/api/v0${route}`, {
        headers: {project_id: key},
        redirect: 'error',
        signal: globalThis.AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('HTTP failure');
      if (!response.body) throw new Error('Missing response body');
      const reader = response.body.getReader();
      const decoder = new globalThis.TextDecoder();
      let bytes = 0;
      let text = '';
      try {
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 1_000_000) throw new Error('Oversized response');
          text += decoder.decode(value, {stream: true});
        }
        return JSON.parse(text + decoder.decode());
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
    } catch {
      // Response bodies and transport errors may contain credential material. Never log them.
      throw new Error('Chain provider request failed');
    }
  }
  const block = object(await get('/blocks/latest'));
  const epoch = count(block.epoch);
  const nextBoundary = epochBoundary(network, epoch + 1);
  const start = Date.parse(epochBoundary(network, epoch));
  const blockTime = count(block.time) * 1000;
  const current = object(await get(`/epochs/${epoch}`));
  if (current.epoch !== epoch) throw new Error('Provider epoch mismatch');
  const history = epoch === 0 ? [] : await get(`/epochs/${epoch}/previous?count=12&page=1`);
  // A block may be minted while the requests are in flight. Production timestamps completion;
  // tests/replays may supply an explicit clock for byte-identical regeneration.
  const updatedAt = now ?? new Date().toISOString();
  const asOf = Date.parse(updatedAt);
  if (
    !Number.isFinite(asOf) ||
    asOf < start ||
    asOf >= Date.parse(nextBoundary) ||
    blockTime < start ||
    blockTime > asOf
  )
    throw new Error('Provider tip is not in the current network epoch');
  if (!Array.isArray(history) || history.length !== Math.min(12, epoch))
    throw new Error('Incomplete provider epoch history');
  const recentEpochs = history
    .map((raw) => {
      const row = object(raw);
      const number = count(row.epoch);
      return {
        epoch: number,
        blocks: count(row.block_count),
        transactions: count(row.tx_count),
        boundary: epochBoundary(network, number + 1),
      };
    })
    .sort((a, b) => a.epoch - b.epoch);
  if (recentEpochs.some((row, index) => row.epoch !== epoch - recentEpochs.length + index))
    throw new Error('Provider history is not contiguous');
  const facts = {
    network,
    updatedAt,
    nextBoundary,
    source: `Blockfrost (${network})`,
    blockHeight: count(block.height),
    epoch,
    transactions: count(current.tx_count),
    blocksThisEpoch: count(current.block_count),
    recentEpochs,
  };
  if (
    facts.blocksThisEpoch + recentEpochs.reduce((sum, row) => sum + row.blocks, 0) >
    facts.blockHeight + 1
  )
    throw new Error('Provider block counts exceed chain height');
  const snapshot = {
    ...facts,
    storage: recentEpochs.some((row) => row.blocks > 0) ? modelStorage(facts) : null,
  };
  if (numbersState(snapshot, network, updatedAt).status !== 'ready')
    throw new Error('Invalid generated chain snapshot');
  return {status: 'updated', snapshot};
}
/** Atomic per-network replacement; an unconfigured or failing network cannot erase old data. */
export async function main(
  directory = path.resolve(import.meta.dirname, '../generated'),
  env = process.env,
  http = globalThis.fetch,
  now,
  out = console,
) {
  let failed = false;
  for (const network of ['preview', 'mainnet']) {
    const file = path.join(directory, `chain-${network}.json`);
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      let existing = null;
      try {
        existing = JSON.parse(await readFile(file, 'utf8'));
      } catch (error) {
        if (!(error instanceof SyntaxError) && error.code !== 'ENOENT') throw error;
      }
      const result = await refreshNetwork(
        {network, existing, key: env[`BLOCKFROST_${network.toUpperCase()}_PROJECT_ID`] ?? '', now},
        http,
      );
      if (result.status === 'updated') {
        await mkdir(directory, {recursive: true});
        await writeFile(
          temporary,
          await format(JSON.stringify(result.snapshot), {parser: 'json'}),
          {flag: 'wx'},
        );
        await rename(temporary, file);
      }
      out.log(`chain-refresh ${network}: ${result.status}`);
    } catch {
      failed = true;
      out.error(`chain-refresh ${network}: failed; previous snapshot retained`);
    } finally {
      await rm(temporary, {force: true});
    }
  }
  return failed ? 1 : 0;
}
if (process.argv[1] === import.meta.filename) process.exitCode = await main();

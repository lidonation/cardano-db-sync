import {decodeMetadata, encodeMetadata} from './metadata';
import {buildResponse, METADATA_LABEL, SPEC_VERSION, validateDefinition} from './payload';
import type {
  Anchor,
  Answer,
  BatchBudget,
  Credential,
  Definition,
  Response,
  ResponseInput,
  SurveyMetadata,
} from './types';

export interface Batch {
  metadata: SurveyMetadata;
  cbor: Uint8Array;
  /** Start in the caller's entry array. Definition survey_ref index resets to zero per tx. */
  entryStart: number;
}
function arrayHeader(length: number): number {
  if (length < 24) return 1;
  if (length <= 255) return 2;
  if (length <= 65535) return 3;
  return 5;
}
function pack(operation: 0 | 1, entries: (Definition | Response)[], budget: BatchBudget): Batch[] {
  if (
    !Number.isSafeInteger(budget.maxTxBytes) ||
    !Number.isSafeInteger(budget.reservedTxBytes) ||
    budget.reservedTxBytes < 0 ||
    budget.maxTxBytes <= budget.reservedTxBytes
  )
    throw new Error('Invalid transaction size budget');
  if (entries.length === 0) throw new Error('Empty survey batch');
  const limit = budget.maxTxBytes - budget.reservedTxBytes;
  const batches: Batch[] = [];
  let pending: (Definition | Response)[] = [];
  let entryBytes = 0;
  let start = 0;
  const flush = () => {
    const metadata: SurveyMetadata = new Map([[METADATA_LABEL, [operation, pending]]]);
    const cbor = encodeMetadata(metadata);
    if (cbor.length > limit) throw new Error('Metadata budget invariant violated');
    batches.push({metadata: structuredClone(metadata), cbor, entryStart: start});
    start += pending.length;
    pending = [];
    entryBytes = 0;
  };
  for (const entry of entries) {
    const size = encodeMetadata(entry).length;
    // Map header + label17 + payload array header + operation tag = four bytes.
    if (4 + arrayHeader(1) + size > limit)
      throw new Error(
        'A single survey entry cannot fit; shorten answers or use a supplementary survey, never fragment a response',
      );
    if (
      pending.length &&
      (4 + arrayHeader(pending.length + 1) + entryBytes + size > limit ||
        (operation === 0 && pending.length === 65536))
    )
      flush();
    pending.push(entry);
    entryBytes += size;
  }
  flush();
  return batches;
}

/** Whole definitions only: question indices are never rewritten. */
export function batchDefinitions(definitions: Definition[], budget: BatchBudget): Batch[] {
  definitions.forEach(validateDefinition);
  return pack(0, definitions, budget);
}
function responseKey(response: Response): string {
  return encodeMetadata([response.get(1)!, response.get(2)!, response.get(3)!]).join(',');
}
/** Never send two fragments for the same dedup tuple: later fragments would replace earlier ones. */
export function batchResponses(inputs: ResponseInput[], budget: BatchBudget): Batch[] {
  const responses = inputs.map(buildResponse);
  const seen = new Set<string>();
  for (const response of responses) {
    const key = responseKey(response);
    if (seen.has(key)) throw new Error('duplicate survey/role/credential in batch');
    seen.add(key);
  }
  return pack(1, responses, budget);
}

export type DefinitionResolver = (ref: [Uint8Array, number]) => Definition | undefined;
/** Read/reassemble by flattening entries in tx order. Resolving a definition is not proof of identity. */
export function parseSurveyMetadata(
  cbor: Uint8Array,
  resolve?: DefinitionResolver,
  currentEpoch?: number,
): {operation: 0 | 1; entries: (Definition | Response)[]} {
  const metadata = decodeMetadata(cbor);
  if (!(metadata instanceof Map) || metadata.size !== 1 || !metadata.has(METADATA_LABEL))
    throw new Error('Expected metadata label 17 only');
  const payload = metadata.get(METADATA_LABEL);
  if (
    !Array.isArray(payload) ||
    payload.length !== 2 ||
    (payload[0] !== 0 && payload[0] !== 1) ||
    !Array.isArray(payload[1]) ||
    !payload[1].length
  )
    throw new Error('Invalid public CIP-179 payload');
  const operation = payload[0];
  const seen = new Set<string>();
  const entries = payload[1].map((entry) => {
    if (!(entry instanceof Map)) throw new Error('Expected integer-keyed survey record');
    if (operation === 0) {
      validateDefinition(entry);
      return entry;
    }
    if (!resolve || currentEpoch === undefined)
      throw new Error('Response parser requires a definition resolver and current epoch');
    if (entry.get(0) !== SPEC_VERSION || entry.get(2) !== 4)
      throw new Error('Unsupported response version or role');
    const ref = entry.get(1);
    if (
      !Array.isArray(ref) ||
      ref.length !== 2 ||
      !(ref[0] instanceof Uint8Array) ||
      ref[0].length !== 32 ||
      typeof ref[1] !== 'number' ||
      !Number.isSafeInteger(ref[1]) ||
      ref[1] < 0 ||
      ref[1] > 65535
    )
      throw new Error('Invalid survey_ref');
    const surveyRef: [Uint8Array, number] = [ref[0], ref[1]];
    const definition = resolve(surveyRef);
    if (!definition) throw new Error('Unknown survey definition');
    buildResponse({
      definition,
      currentEpoch,
      surveyRef,
      credential: entry.get(3) as Credential,
      answers: entry.get(4) as Answer[],
      ...(entry.has(5) ? {rationale: entry.get(5) as Anchor} : {}),
    });
    const key = responseKey(entry);
    if (seen.has(key)) throw new Error('duplicate survey/role/credential in payload');
    seen.add(key);
    return entry;
  });
  if (operation === 0 && entries.length > 65536)
    throw new Error('Definition indices exceed survey_ref range');
  return {operation, entries};
}

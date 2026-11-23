/** CIP-179 v5's thirteen steps for the site's locked public/Keyholder subset. */
import {blake2b} from '@noble/hashes/blake2b';
import {decodeMetadata, utf8} from '../../src/survey/metadata';
import {buildResponse, validateDefinition, verifyAnchor} from '../../src/survey/payload';
import type {
  Anchor,
  Answer,
  Credential,
  Definition,
  Metadatum,
  Presentation,
  Question,
} from '../../src/survey/types';
import type {
  AuditRow,
  ChainInput,
  MethodTally,
  Network,
  SurveyTally,
  TallyArtifact,
  TallyConfig,
  Transaction,
} from './types';

export const hex = (value: Uint8Array): string => Buffer.from(value).toString('hex');
const digest = (value: Uint8Array) => hex(blake2b(value, {dkLen: 32}));
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function surveyReference(value: unknown): string | null {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !(value[0] instanceof Uint8Array) ||
    value[0].length !== 32 ||
    !integer(value[1]) ||
    value[1] > 65535
  )
    return null;
  return `${hex(value[0])}#${value[1]}`;
}
export function textApprovalId(
  network: Network,
  transaction: string,
  response: number,
  question: number,
  text: string,
): string {
  return `${network}:${transaction}:${response}:${question}:${digest(utf8(text))}`;
}
/** Mechanism A. Inclusion alone is NOT a signer proof. No reliance on vkey witnesses. */
export function proves(credential: unknown, tx: Transaction): boolean {
  if (
    !Array.isArray(credential) ||
    credential.length !== 2 ||
    !(credential[1] instanceof Uint8Array) ||
    credential[1].length !== 28
  )
    return false;
  const id = hex(credential[1]);
  if (credential[0] === 0) return tx.requiredSigners.includes(id);
  if (credential[0] !== 1) return false;
  const bytes = tx.scripts[id];
  if (!bytes || hex(blake2b(new Uint8Array([0, ...bytes]), {dkLen: 28})) !== id) return false;
  const evaluate = (s: Metadatum, depth: number): boolean => {
    if (depth > 64 || !Array.isArray(s)) return false;
    if (s[0] === 0)
      return (
        s.length === 2 &&
        s[1] instanceof Uint8Array &&
        s[1].length === 28 &&
        tx.requiredSigners.includes(hex(s[1]))
      );
    if ((s[0] === 1 || s[0] === 2) && s.length === 2 && Array.isArray(s[1])) {
      const satisfied = s[1].map((child) => evaluate(child, depth + 1));
      return s[0] === 1 ? satisfied.every(Boolean) : satisfied.some(Boolean);
    }
    if (s[0] === 3 && s.length === 3 && integer(s[1]) && Array.isArray(s[2]))
      return (
        s[1] <= s[2].length && s[2].filter((child) => evaluate(child, depth + 1)).length >= s[1]
      );
    if (s[0] === 4 && s.length === 2 && integer(s[1]))
      return tx.invalidBefore !== null && tx.invalidBefore >= s[1];
    if (s[0] === 5 && s.length === 2 && integer(s[1]))
      return tx.invalidHereafter !== null && tx.invalidHereafter <= s[1];
    return false;
  };
  try {
    return evaluate(decodeMetadata(bytes), 0);
  } catch {
    return false;
  }
}
interface Located {
  tx: Transaction;
  entries: Metadatum[];
  operation: number;
}
interface DefinitionRecord {
  definition: Definition;
  tx: Transaction;
  questions: Question[];
  cancelled: boolean;
}
interface Counted {
  row: AuditRow;
  tx: Transaction;
  answers: Answer[];
  responseIndex: number;
}
function before(a: Transaction, b: Transaction): boolean {
  return a.slot < b.slot || (a.slot === b.slot && a.index < b.index);
}

function presentation(record: DefinitionRecord, input: ChainInput): Presentation | undefined {
  const anchor = record.definition.get(8) as Anchor;
  const bytes = input.presentations[hex(anchor[1])];
  if (!bytes || !verifyAnchor(bytes, anchor)) return;
  try {
    const p = JSON.parse(Buffer.from(bytes).toString('utf8')) as Presentation;
    if (
      p.specVersion !== 5 ||
      p.kind !== 'cardano-survey-presentation' ||
      !Array.isArray(p.questions) ||
      p.questions.length !== record.questions.length
    )
      return;
    if (
      !p.questions.every(
        (q, i) =>
          typeof q.prompt === 'string' &&
          (!('options' in record.questions[i]) ||
            (Array.isArray(q.options) &&
              q.options.length === (record.questions[i] as {options: number}).options &&
              q.options.every((o) => typeof o === 'string'))),
      )
    )
      return;
    return p;
  } catch {
    return;
  }
}
function summarize(
  q: Question,
  index: number,
  responses: Counted[],
  p?: Presentation,
): MethodTally {
  const values = responses.flatMap((r) => r.answers.filter((a) => a[1] === index).map((a) => a[2]));
  let options: number[] = [];
  if ('options' in q) options = Array.from({length: q.options}, (_, i) => i);
  else if (q.tag === 4) options = [...new Set(values as number[])].sort((a, b) => a - b);
  const count = (option: number) =>
    values.filter((v) => {
      if (q.tag === 1 || q.tag === 4) return v === option;
      if (q.tag === 2) return (v as number[]).includes(option);
      if (q.tag === 3) return (v as number[])[0] === option;
      if (q.tag === 5 || q.tag === 6) return (v as [number, number][]).some(([i]) => i === option);
      return false;
    }).length;
  const result: MethodTally = {
    question: index,
    label: p?.questions[index].prompt ?? `Question ${index}`,
    method: q.tag,
    abstain: responses.length - values.length,
    options: options.map((option, position) => ({
      option: q.tag === 4 ? position : option,
      label:
        q.tag === 4
          ? String(option)
          : (p?.questions[index].options?.[option] ?? `Option ${option}`),
      count: count(option),
    })),
  };
  if (q.tag === 4 || q.tag === 6) {
    const pairs =
      q.tag === 4
        ? (values as number[]).map((value) => ({value}))
        : (values as [number, number][][]).flatMap((v) =>
            v.map(([option, value]) => ({option, value})),
          );
    const distribution = new Map<string, {option?: number; value: number; count: number}>();
    for (const pair of pairs) {
      const key = JSON.stringify(pair);
      const prior = distribution.get(key);
      if (prior) prior.count++;
      else distribution.set(key, {...pair, count: 1});
    }
    result.distributions = [...distribution.values()].sort(
      (a, b) => (a.option ?? 0) - (b.option ?? 0) || a.value - b.value,
    );
  }
  if (q.tag === 5 || q.tag === 6)
    result.totals = options.map((option) =>
      (values as [number, number][][])
        .reduce((sum, v) => sum + BigInt(v.find(([i]) => i === option)?.[1] ?? 0), 0n)
        .toString(),
    );
  if (q.tag === 3)
    result.pairwise = options.map((a) =>
      options.map((b) =>
        a === b
          ? 0
          : (values as number[][]).filter(
              (v) => v.includes(a) && (!v.includes(b) || v.indexOf(a) < v.indexOf(b)),
            ).length,
      ),
    );
  return result;
}

export function tally(input: ChainInput, config: TallyConfig): TallyArtifact {
  if (!['preview', 'mainnet'].includes(config.network) || input.network !== config.network)
    throw new Error('Tally network mismatch');
  if (
    !integer(input.epoch) ||
    !integer(input.slot) ||
    !/^[a-f0-9]{64}$/.test(input.block) ||
    !Number.isFinite(Date.parse(input.generatedAt))
  )
    throw new Error('Invalid chain tip');
  const configured = new Map(config.surveys.map((s) => [s.surveyRef, s.endEpoch]));
  if (
    configured.size !== config.surveys.length ||
    config.surveys.some(
      (s) => !/^[a-f0-9]{64}#(0|[1-9][0-9]*)$/.test(s.surveyRef) || !integer(s.endEpoch),
    )
  )
    throw new Error('Invalid reviewed survey configuration');
  const transactions = [...input.transactions].sort(
    (a, b) => a.slot - b.slot || a.index - b.index || a.id.localeCompare(b.id),
  );
  const seen = new Set<string>();
  const positions = new Set<string>();
  const located: Located[] = [];
  // Step 1/5: the provider supplies complete label-17 transactions at a stable chain tip.
  for (const tx of transactions) {
    if (seen.has(tx.id) || positions.has(`${tx.slot}:${tx.index}`))
      throw new Error('duplicate chain transaction');
    seen.add(tx.id);
    positions.add(`${tx.slot}:${tx.index}`);
    if (
      !/^[a-f0-9]{64}$/.test(tx.id) ||
      !integer(tx.slot) ||
      !integer(tx.index) ||
      !integer(tx.epoch) ||
      tx.epoch > input.epoch ||
      tx.slot > input.slot
    )
      throw new Error('Transaction exceeds chain tip');
    try {
      const metadata = decodeMetadata(tx.metadata);
      const payload = metadata instanceof Map ? metadata.get(17) : undefined;
      if (
        Array.isArray(payload) &&
        payload.length === 2 &&
        [0, 1, 2].includes(payload[0] as number) &&
        Array.isArray(payload[1])
      )
        located.push({tx, operation: payload[0] as number, entries: payload[1]});
    } catch {
      /* Unrelated/malformed label-17 data is not a survey. */
    }
  }
  const definitions = new Map<string, DefinitionRecord>();
  for (const {tx, operation, entries} of located)
    if (operation === 0)
      entries.forEach((entry, index) => {
        const ref = `${tx.id}#${index}`;
        if (!configured.has(ref)) return;
        try {
          if (!(entry instanceof Map)) throw new Error('record');
          const questions = validateDefinition(entry);
          if ((entry.get(5) as number) <= tx.epoch || !proves(entry.get(1), tx))
            throw new Error('proof/expiry');
          if (entry.get(5) !== configured.get(ref)) throw new Error('epoch mismatch');
          definitions.set(ref, {definition: entry, tx, questions, cancelled: false});
        } catch {
          throw new Error(`Invalid canonical definition or epoch: ${ref}`);
        }
      });
  for (const ref of configured.keys())
    if (!definitions.has(ref)) throw new Error(`Missing canonical definition: ${ref}`);
  // Step 2: cancellation is irrevocable, owner-proven, inclusive through end_epoch.
  for (const {tx, operation, entries} of located)
    if (operation === 2)
      for (const entry of entries) {
        const ref = surveyReference(entry);
        const record = ref ? definitions.get(ref) : undefined;
        if (
          record &&
          before(record.tx, tx) &&
          tx.epoch <= (record.definition.get(5) as number) &&
          proves(record.definition.get(1), tx)
        )
          record.cancelled = true;
      }
  // Steps 3/4: optional linkage is not discovered. Keyholder (4) has no governance voter tag,
  // so binding mechanism B cannot prove this role and does not restrict standalone responses.
  const byId = new Map(located.map((l) => [l.tx.id, l]));
  const audit: AuditRow[] = [];
  const winners = new Map<string, Counted>();
  for (const {tx, operation, entries} of located)
    if (operation === 1)
      entries.forEach((entry, responseIndex) => {
        const record = entry instanceof Map ? entry : new Map<Metadatum, Metadatum>();
        const ref = surveyReference(record.get(1));
        const credential = record.get(3) as Credential | undefined;
        const credentialId =
          Array.isArray(credential) &&
          credential.length === 2 &&
          credential[1] instanceof Uint8Array &&
          credential[1].length === 28
            ? `${credential[0]}:${hex(credential[1])}`
            : null;
        const row: AuditRow = {
          transaction: tx.id,
          responseIndex,
          surveyRef: ref,
          role: typeof record.get(2) === 'number' ? (record.get(2) as number) : null,
          credential: credentialId,
          epoch: tx.epoch,
          status: 'excluded',
          reason: 'invalid-record',
        };
        audit.push(row);
        const reject = (reason: string) => {
          row.reason = reason;
        };
        const definition = ref ? definitions.get(ref) : undefined;
        if (!definition) return reject('unreviewed-survey');
        if (!before(definition.tx, tx)) return reject('before-definition');
        if (definition.cancelled) return reject('cancelled'); // Step 6
        if (record.get(0) !== 5) return reject('unsupported-version');
        if (record.get(2) !== 4) return reject('unsupported-role');
        if (tx.epoch > (definition.definition.get(5) as number)) return reject('expired'); // Step 9
        try {
          // Step 7: independent validation, including omitted required and abstains.
          buildResponse({
            definition: definition.definition,
            surveyRef: record.get(1) as [Uint8Array, number],
            credential: credential!,
            currentEpoch: tx.epoch,
            answers: record.get(4) as Answer[],
            ...(record.has(5) ? {rationale: record.get(5) as Anchor} : {}),
          });
        } catch {
          return reject('invalid-answer');
        }
        // Step 8: required signer AND payment usage on this network, not a claimed role.
        if (!credential || !proves(credential, tx) || !tx.paymentKeys.includes(hex(credential[1])))
          return reject('credential-proof');
        // Step 10: no NFT/registration policy exists here. A proven payment key has no mutable
        // registration, retirement, delegation or expiry to change at the end_epoch snapshot.
        const key = `${ref}:4:${credentialId}`;
        const prior = winners.get(key);
        if (prior) {
          prior.row.status = 'excluded';
          prior.row.reason = 'replaced';
        }
        row.status = 'counted';
        row.reason = 'valid'; // Step 11: chain iteration, array index last.
        winners.set(key, {row, tx, answers: record.get(4) as Answer[], responseIndex});
      });
  const approved = new Set(config.approvedText);
  const surveys: SurveyTally[] = [...definitions].map(([ref, record]) => {
    const endEpoch = record.definition.get(5) as number;
    const responses = [...winners.values()].filter((r) => r.row.surveyRef === ref);
    const p = presentation(record, input); // Step 13: raw bytes hash checked, never used for validation.
    const qs = record.cancelled
      ? []
      : record.questions.map((q, i) => ({
          ...summarize(q, i, responses, p),
          history: [] as {epoch: number; counts: number[]}[],
        }));
    // SUR-18: event-epoch snapshots use latest full responses AS OF each epoch, not a
    // histogram of only today's winners. Cancellation voids even historical totals.
    const history = new Map<string, Counted>();
    const candidates = audit.filter(
      (r) => r.surveyRef === ref && (r.reason === 'valid' || r.reason === 'replaced'),
    );
    const byEpoch = new Map<number, AuditRow[]>();
    for (const row of candidates) {
      const rows = byEpoch.get(row.epoch) ?? [];
      rows.push(row);
      byEpoch.set(row.epoch, rows);
    }
    // Retain numeric history columns even when a later response replaced that value.
    qs.forEach((q, i) => {
      if (record.questions[i].tag === 4) {
        const numbers = [
          ...new Set(
            candidates.flatMap((r) =>
              (
                (
                  byId.get(r.transaction)!.entries[r.responseIndex] as Map<Metadatum, Metadatum>
                ).get(4) as Answer[]
              )
                .filter((a) => a[1] === i)
                .map((a) => a[2] as number),
            ),
          ),
        ].sort((a, b) => a - b);
        q.options = numbers.map((value, option) => ({
          option,
          label: String(value),
          count: q.options.find((o) => o.label === String(value))?.count ?? 0,
        }));
      }
    });
    for (const [epoch, rows] of [...byEpoch].sort(([a], [b]) => a - b)) {
      for (const row of rows) {
        const locatedTx = byId.get(row.transaction)!;
        const response = locatedTx.entries[row.responseIndex] as Map<Metadatum, Metadatum>;
        history.set(row.credential!, {
          row,
          tx: locatedTx.tx,
          answers: response.get(4) as Answer[],
          responseIndex: row.responseIndex,
        });
      }
      qs.forEach((q, i) => {
        const historic = summarize(record.questions[i], i, [...history.values()], p);
        q.history.push({
          epoch,
          counts: q.options.map(
            (o) =>
              historic.options.find((h) =>
                q.method === 4 ? h.label === o.label : h.option === o.option,
              )?.count ?? 0,
          ),
        });
      });
    }
    const freeText = responses.flatMap((r) =>
      r.answers.flatMap(([tag, question, value]) => {
        if (tag !== 0) return [];
        const text = typeof value === 'string' ? value : (value as string[]).join('');
        const id = textApprovalId(input.network, r.tx.id, r.responseIndex, question, text);
        return approved.has(id) ? [{id, text, moderated: true}] : [];
      }),
    );
    // Step 12: unweighted per-role participation and per-question abstains.
    let state: SurveyTally['state'] = input.epoch > endEpoch ? 'final' : 'interim';
    if (record.cancelled) state = 'cancelled';
    return {
      network: input.network,
      surveyRef: ref,
      endEpoch,
      interim: input.epoch <= endEpoch,
      tallyBasis: input.epoch > endEpoch ? 'end-epoch' : 'response-time-only',
      snapshotBasis: input.epoch > endEpoch ? 'end-epoch' : 'response-time-only',
      state,
      participation: [{role: 4, count: responses.length}],
      questions: qs,
      freeText,
      generatedAt: input.generatedAt,
    };
  });
  return {
    network: input.network,
    generatedAt: input.generatedAt,
    tip: {epoch: input.epoch, slot: input.slot, block: input.block},
    surveys,
    audit,
  };
}

# CIP-179 public payloads (B24)

Browser-free TypeScript library. It builds metadata, **not a balanced transaction**. There is no
wallet access, upload, fetch, signing or submission. B25 owns those actions and the network guard;
B32 owns the form. No mainnet definition or canonical survey reference is created here.

## Locked subset

[CIP-179 v5](https://github.com/cardano-foundation/CIPs/blob/d21ffeb3d7a9bdfcf42a9bf3522d95f5540f2cac/CIP-0179/README.md),
public submissions, external-content mode, eligible roles `[4]` (Keyholder). All built-in question
tags are supported plus our anchored custom free-text method. Response credentials are payment
**keys**; native-script response proof, sealed responses, cancellation and tallying are not part of
this subset. A definition may have a key or native-script owner. Construction cannot prove script
satisfaction or ledger identity; the transaction assembler and indexer must do so.

- `buildDefinition(input)` returns an integer-keyed `Map` and exact UTF-8 `presentationBytes`.
  Publish those bytes, unchanged, at `presentationUri` **before signing**. The anchor uses
  BLAKE2b-256, not a truncated BLAKE2b-512 digest. Do not hash a reserialized fetched document.
- `freeTextQuestion(schemaUri)` hashes the canonical static `survey/free-text-v1.json`. Build the
  absolute URI from the selected profile's origin + base URL; do not hardcode a deployment path.
  `freeTextAnswer(index, text)` preserves Unicode code points in <=64-byte UTF-8 chunks inline.
  No respondent-hosted content is required. Answers are public and permanent, not anonymous.
- `schemaVersionQuestions()` appends optional stage_two then stage_four numeric questions,
  each `[0, 9999]`. Their positions, not their names, are the answer keys. The presentation should
  give `SELECT stage_two FROM schema_version` and its stage_four equivalent. Omit to abstain;
  zero is a real answer, not an absence marker.
- `buildResponse(input)` validates type, index, bounds, step, unique options, ranking order,
  points budget, rating completeness, required questions and expiry. It preserves caller answer
  order. Custom methods other than the published free-text schema are rejected.
- `batchDefinitions` and `batchResponses` return `{metadata, cbor, entryStart}[]`. `cbor` is the
  **whole metadata map**, `{17: [operation, entries]}`, not auxiliary data or a transaction.
  Hash bytes are `Uint8Array`, never hex/text in metadata; integer keys remain integer keys.
- `parseSurveyMetadata` validates the same subset on read. Response parsing requires a trusted
  definition resolver and a current epoch. Unknown optional record keys are ignored semantically,
  but remain subject to the ledger metadata codec. This is not a chain identity/tally verifier.
  The metadata codec intentionally accepts only definite lengths and minimal scalar encodings.

## Budget and reassembly

Pass live protocol `maxTxBytes` and a **non-zero, conservative** `reservedTxBytes` for transaction
body, outputs, inputs, witnesses, auxiliary-data wrapper and all non-survey metadata. There is no
hardcoded protocol maximum. Packing measures exact metadata CBOR, including list-header growth.
The assembler must measure the **final signed transaction** again against the live protocol limit;
this library cannot estimate fees, input counts, witnesses or current protocol parameters.

Whole responses to concurrent surveys share one transaction when they fit. If not, return multiple
batches for multiple wallet confirmations. **Never fragment one survey response**: latest-wins
would replace earlier fragments for `(survey_ref, role, credential)`. Duplicate tuples within a
batching request are rejected. An individually oversized entry is rejected, not truncated or
silently rewritten into a new definition. Use smaller answers or a deliberately defined
supplementary survey. Flatten parsed entries in transaction order to reassemble the batch.

Definition `survey_ref` indices restart at zero in each new transaction. `entryStart` identifies the
original source-array offset, so the publisher can record `(actual tx id, local index)` after each
confirmed write. Do not use a global source-array offset as the on-chain reference index.

## Presentation and translation

`static/survey/example-presentation.json` is an **illustration**, not an approved/frozen question
set. The conformance fixture constructs and hashes the same English presentation. Real definitions
must publish their own returned bytes and pass B28's preview pilot before mainnet signing. B40's
`surveyLabelId(questionIndex, optionIndex?)` is the translation interlingua; changing locale never
changes question or option order or sends translated strings on chain.

The sources are `free-text-schema.json` and `example-presentation.json`. After editing either, run
`node scripts/survey-schema.mjs` from `docs/`. This writes both static files as canonical `JSON.stringify(source)` plus a
newline; tests require byte identity with the published file. Never change an existing method's
semantics after a real definition anchors it; create a new method version instead.

## Verification and supply chain

`test/unit/survey-{metadata,payload,batch,conformance}.test.ts` exercises the public contract, seeded
codec round-trips, invalid inputs, budget boundaries, and a 400-survey split/reassembly. Golden
vectors in `test/fixtures/survey/vectors.json` pin constructed bytes. Refresh intentionally with
`UPDATE_SURVEY_VECTORS=1 npx vitest run test/unit/survey-conformance.test.ts`, then independently
validate them with `node scripts/check-survey-cddl.mjs` (Rust/Cargo required). The latter uses
`cddl-cat =0.7.1` with a committed lockfile against the **unchanged** upstream CDDL, with only a
label-17 root wrapper. The upstream schema and JSON profile are CC-BY-4.0, by Thomas Lindseth,
Ryan Wiley and Matthieu Pizenberg. The fixture records the exact source commit.

`@noble/hashes` 1.4.0 was already locked transitively; B24 makes that same version a direct exact pin
and lists it in `config/review-gated-dependencies.json`. No CBOR, wallet or transaction SDK is added.
**SEC-6 requires a human source/dependency review before merge**, including this handwritten CBOR
codec. Automated tests are not that review. This change does not grant approval or merge itself.

## Lifecycle registry (B27)

Canonical references and question-level evolution live in [the reviewed registry](manifest/README.md).
The payload examples are not registered definitions. Registration never changes previously anchored
bytes, extends the core's epoch-2000 horizon, or transfers an old definition's ownership.

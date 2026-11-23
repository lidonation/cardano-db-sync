# Standing-survey registry (B27)

`registry.json` is the reviewed authority for canonical CIP-179 references, **not** a generated
chain cache. It is intentionally empty until actual definitions have been published and reviewed.
Never put the B24 example, the B44-f `core-1` rendering sentinel, or an invented pilot transaction
in it. This does not publish/sign/cancel a survey and does not prove ledger facts.

## Register a definition by PR

1. Verify network, definition transaction and its **local** uint16 definition index. Encode the
   reference as lowercase `64-hex-tx-id#index` (no leading zeroes in the decimal index).
2. Append a record in publication order. Record the owner credential **of that definition**,
   definition epoch, inclusive `endEpoch`, and question positions with option counts where
   applicable. Verify these against the immutable on-chain structure and anchored presentation.
   The registry is a lifecycle projection, not a second copy of every CIP constraint or a proof
   that the owner script is 3-of-5. Never include keys or credentials capable of signing.
3. Every core has `endEpoch: 2000`. Supplements have their own shorter horizon, not the core's
   expiry. Each later definition declares `evolvesFrom` on the same network: an **addition**,
   never an amendment. Owner handover changes only the newly appended definition.
4. `current.preview` / `current.mainnet` name the selected core; null means no published core.
   Historical cores and supplements remain in `surveys`. Do not prune expired/cancelled records.
5. Record verified cancellations with `cancelledEpoch` (within the definition lifetime). Never
   clear or alter a recorded cancellation, or change any other existing field/declaration.
   Cancelling a supplement cannot cancel its core. This reviewed fact must also be consumed by
   the tally job; no cancelled survey's responses may be tallied.

## Subsumption contract

Each **new** record declares `subsumes` at **question** granularity: its `question`, the older
`{surveyRef, question}`, and `kind`. No backward pointer is stored in the old record. The older
record must already exist on the same network; these forward declarations form an acyclic graph.
One absorber per older question is supported: competing branches are rejected, not guessed.

- `replaces`: equivalent semantics. For option questions, `optionMap` maps **every** older option
  exactly once to an in-range newer option (many-to-one is permitted). Both sides must have
  option counts. For non-option questions omit `optionMap`; semantic equivalence still requires
  human review. These counts are **our labelled editorial view, not a CIP-179 tally**. B26 must
  prefer a newer answer for each credential, falling back to older answers; never add marginal
  counts. This registry deliberately contains no tally arithmetic.
- `supersedes`: a different question. No option map is allowed; report the old results separately,
  closed, never merge them. `resolveHistoricalOption` returns `closed: true` and a successor
  question but **no** successor option or merge permission.

The same `subsumes` semantics can be published as an extension in the new anchored presentation
(the CIP profile permits unknown fields). It must be there **before** its bytes are anchored.
This registry does not rewrite a previously anchored document. The repo is authoritative for our
build even when that document is unavailable; third-party tools need the anchored declaration.

## Consumer API

Validate JSON with `readRegistry(unknown)` before calling typed helpers in `lifecycle.ts`.
Ajv 6.15.0 is an existing locked dependency, now explicitly pinned as a **build/test devDependency**;
these modules are browser-free and not imported into the wallet/transaction path.

- `activeQuestions(registry, network, epoch)` composes only live definitions; expiry is inclusive.
  A question hidden by a live absorber reappears when the absorber expires or is cancelled.
  Historical declarations do not expire or get deleted.
- `successorIndex(registry, network)` derives the complete reverse audit index.
- `resolveHistoricalOption(registry, network, questionRef, option?)` follows replacement mappings,
  preserving the distinction above. It never uses a cancelled absorber's answers. A cancelled
  intermediate stops traversal conservatively; it does not manufacture a merge through it.
- `validateEvolution(before, after)` rejects removal, reordering and amendments. Unit CI compares
  against `SURVEY_MANIFEST_BASE_REF` (exact PR base / replaced push commit). Locally run
  `SURVEY_MANIFEST_BASE_REF=origin/release/community-site npm test -- --maxWorkers=6`.

The site build validates this registry before emitting dashboard data. The older B44-f option-level
manifest is now **only** `survey-results/__fixtures__/sample-manifest.json`, used for component
regressions, never as production authority. The current dashboard artifact is single-survey;
`publicationManifest` accepts canonical same-network standalone results, or the empty unpublished
sentinel. It fails closed on cross-survey subsumption data until B26 supplies a registry-resolved,
credential-deduplicated artifact and its renderer consumes these helpers. Wallet/composer UI (B32),
multi-survey tally/renderer integration (B26/B44), actual pilot publication (B28) and key custody
(B45) are not implemented here. No production survey is registered by this ticket.

Tests: `survey-registry*.test.ts`, `survey-publication.test.ts`, and `survey-results-plugin.test.ts`.
The JSON schema is draft-07; semantic validation adds graph/reference/index/lifetime checks.

# Survey tally (B26)

Run `npm run survey:tally -- preview` or `-- mainnet` from `docs/`; omitting the network runs both
independently. The executable is compiled into the ignored dependency cache. No new dependency,
wallet connection, owner secret, transaction submission or mutable backend is involved.

## Activation and artifacts

`config/survey-tally.json` is intentionally empty until B27/B28 publish reviewed canonical
`txid#index` references and their exact `endEpoch`, separately for preview and mainnet. Never
insert the examples from the payload tests. Empty configuration emits an explicit inactive
artifact without contacting a provider. A configured network requires its own
`BLOCKFROST_PREVIEW_PROJECT_ID` or `BLOCKFROST_MAINNET_PROJECT_ID`; missing credentials fail,
rather than overwriting the previous aggregate with zero respondents.

Each network writes `generated/survey-<network>/aggregate.json`. It includes the stable chain tip,
all configured survey tallies, per-role participation, per-question abstains, method statistics,
derived epoch histories and counted/excluded response audit rows. Credentials are public on chain
and intentionally retained as the cross-survey join key; **they are not unique people**. No
credential join, weighting or editorial subsumption merge is presented as a CIP tally. B27 owns
cross-survey lifecycle/subsumption policy; the existing render manifest must name the exact
survey the page displays. A build reads only its profile's artifact and rejects mixed networks.
The old render-half sample may supply only the empty pre-tally state, never real public data.

Counts mean one record per `(survey_ref, role, credential)`, not stake weight. Single/multi-select
are selection counts; ranking `options` are first preferences, with a full pairwise matrix in
`pairwise` (ranked beats unranked; two unranked options tie). Numeric answers have exact value
frequency `distributions` and positional histogram columns, including historical values. Points
and ratings have per-option respondent counts, exact integer-string `totals`, and rating value
frequencies; totals are downstream descriptive statistics, not CIP-sanctioned weights.

`generatedAt` is the settled tip block time, not the wall clock: replaying unchanged chain evidence
and approvals produces identical bytes. Full oldest-first replay observes late cancellations and
rollbacks; the adapter settles 15 blocks behind the tip and checks that height's hash again before
publication. Discovery pages are bounded (100 rows × 1000 pages); exceeding the bound fails
instead of publishing a partial tally. There is no retry loop or silent provider fallback. The
previous artifact survives acquisition, proof, configuration and write failures. No raw chain
response or pending text is written to disk or included in logs.

## Thirteen-step correspondence

The normative version is [CIP-179 v5](https://github.com/cardano-foundation/CIPs/blob/d21ffeb3d7a9bdfcf42a9bf3522d95f5540f2cac/CIP-0179/README.md).
The site's locked subset is **public, external-content, Keyholder-only**, with the custom method
from `src/survey/free-text-schema.json`; sealed surveys, other custom methods and other eligible
roles fail closed. This is not a general-purpose implementation of every CIP-179 mode.

1. Scan label 17 and resolve only reviewed definition transaction/index pairs. Validate v5
   structure, constraints, eligible roles, public mode, owner proof and `end_epoch > inclusion`.
2. Discover cancellations; require an earlier definition, its owner's mechanism-A proof and an
   inclusive `end_epoch` cutoff. Valid cancellation voids all responses and derived history.
3. Governance action discovery is optional and not used for this survey.
4. No governance linkage restriction is imposed. Keyholder has no Conway voter tag, so binding
   mechanism B cannot prove this role. Other roles are not silently treated as Keyholders.
5. Resolve each response's reference independently, retaining its original payload-array index.
6. Exclude every response to a cancelled definition, including responses before cancellation.
7. Reuse B24's type/index/constraint/required-question validation. Omission is abstention;
   an empty multi-select is an explicit empty selection, not abstention. Invalid entries do not
   invalidate independently valid siblings, including repeated tuples within one transaction.
8. Prove key ownership from the body's `required_signers`, **not witness presence**. Require
   payment-key usage in a non-collateral/non-reference input or output of the same transaction.
   This conservative local policy establishes the payment role rather than accepting a declared
   role or a stake-only credential. Native owners are hash-checked over their raw script bytes;
   all/any/threshold/signature/time constraints are evaluated against required signers and the
   transaction's validity bounds, not just its inclusion time. Plutus owners have no proof path.
9. Derive inclusion epoch from network-specific slot semantics (including mainnet's Shelley
   transition); compare it with provider block epoch and accept responses through `end_epoch`.
10. A Keyholder payment key has **no mutable registration, retirement, delegation or expiry**.
    There is no NFT or other off-chain eligibility policy in this survey. The proven payment
    credential therefore remains eligible at the end-epoch snapshot without a DRep/pool/stake
    query or an unverified eligibility boolean. The result remains interim through the inclusive
    end epoch; only after that epoch closes does it declare `snapshotBasis: end-epoch`,
    `tallyBasis: end-epoch`, `interim: false`. Adding mutable eligibility requires a historical
    state adapter and new tests; do not reuse this rule for other roles. The standing-survey page
    supports interim output only and refuses to mislabel a final audit artifact as interim.
11. Latest **valid** response wins in `(slot, transaction index, response index)` order, replacing
    the whole response; an invalid later entry cannot erase a valid earlier answer.
12. Emit unweighted participation (role 4) and abstain counts. The per-epoch history replays
    latest-wins as of each event epoch, not just the surviving responses' timestamps. It is a
    derived view, not a separate CIP tally. Epochs without changes are not duplicated.
13. Fetch presentation bytes only from this network's canonical profile origin, with a timeout,
    size cap, no redirects and **no provider headers**; verify BLAKE2b-256 over exact bytes.
    Failure changes labels to positional fallbacks, never response validity or counts.

## Moderation: default deny, exact-answer approval

Only approved text from a currently counted response can enter any public artifact. An approval
binds **network, transaction ID, response index, question index, and BLAKE2b-256 of exact UTF-8
text**. A resubmission, changed text or different network needs a new approval. Cancellation and
latest-wins still take precedence over approval. The dashboard retains its existing second
moderation gate before emitting client data. Rendering uses text, never HTML.

A Lido Nation human reads the answer on chain, reviews it, then adds its approval ID to that
network's `approvedText` array in a reviewed PR. To compute the ID after compiling the tally:

```sh
# Exact JSON string on stdin; JSON decoding avoids accidental trailing-newline approval.
# Replace TXID, response and question indices with the inspected chain positions.
printf '%s' '"Reviewed answer"' | node -e '
const fs = require("node:fs");
const {textApprovalId} = require("./node_modules/.cache/survey-tally/scripts/survey/tally.js");
console.log(textApprovalId("preview", "TXID", 0, 6, JSON.parse(fs.readFileSync(0, "utf8"))));'
```

Do not commit pending text, review queues, raw provider responses, or credentials. Removing an
approval retracts text from the next generated artifact, not from the immutable chain.

## Operations and verification

`docs-survey-tally.yml` schedules hourly, default-branch only; manual recovery selects one network.
It shares chain-refresh's concurrency lock, commits only the two aggregate paths, dispatches the
existing site rebuild after a data commit, and uses the existing ops-alert workflow. No remote
workflow is triggered as part of local development. Activation on `release/community-site` is
not automatic: the repository's default branch is currently `master`, so the workflow must first
land on the default branch under the existing release process. Do not change that setting here.

Local tests: `survey-tally.test.ts`, `survey-provider.test.ts`, `survey-workflow.test.ts`, and
`survey-results-plugin.test.ts`. They cover known answers for all seven methods, malformed and
forged responses, proof failure, native-script thresholds, cancellation, inclusive boundaries,
replacement and abstention, rollback/provider failure, network isolation, byte-identical replay,
and exact moderation. Real provider execution with a published preview definition remains the
B28 pilot; inactive artifacts are not evidence of a funded end-to-end pilot or canonical survey.

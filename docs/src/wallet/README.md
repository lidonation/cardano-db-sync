# Guarded survey wallet boundary (B25)

`client.ts` is the browser-only CIP-30 boundary for the B32 survey composer. It has no SDK or
transaction-library dependency and is not imported by global chrome. No wallet screen is added
here: B32 owns the designed form, localized status copy and focus/error presentation.

## Integration contract

- Pass `customFields.profile.network` from Docusaurus to `connectWallet`. Never take the expected
  network from a selector, URL, browser storage or the wallet itself.
- Call `discoverWallets()` when the person opens or refreshes their wallet list. It reads
  `window.cardano` at call time, not module initialization. It lists CIP-30 candidates reporting API version `1`, `1.0.0` or `0.1.0`; discovery does not enable a wallet or certify compatibility. Render names as text,
  never HTML. Wallet-supplied icons are deliberately not returned or loaded.
- Call `connectWallet(selectedId, network)` only after explicit selection. It enables that provider,
  validates the required API and checks its network. Store the resulting session in memory only.
- Call `session.signAndSubmit({build, assemble})` only on an explicit submit action. `build` receives
  a frozen snapshot containing network, UTxOs, change address and reward addresses. It never
  receives the privileged wallet API. CIP-30 returns CBOR hex strings.
- `build` owns valid transaction CBOR, input/address/network agreement, fees, outputs, metadata and
  label 17. B24 owns the CIP-179 payload and B32 integrates it. The adapter validates hex encoding,
  not ledger semantics. `assemble` must preserve the exact unsigned transaction body and merge
  the returned witness set; `signTx` does **not** return a complete signed transaction.
- The guard runs on connect, before reading inputs, after reading inputs immediately before build,
  immediately before sign, after sign before assembly and immediately before submit. A mismatch
  throws `WalletNetworkMismatchError` with code `WALLET_NETWORK_MISMATCH`; there is no override.
  Network lookup failures also block every downstream action.
- Show named errors using the composer's localized error/status components. Do not render or log
  raw extension `info`, addresses, UTxOs, transaction bytes or wallet secrets. The adapter's error
  messages are safe fallback text, not the final localized UI dictionary.
- Disconnect the old session on wallet selection changes, route exit and component unmount. A
  pending operation checks local invalidation after each await before its next side effect. Reject
  overlapping submissions. Any failed operation invalidates the session and requires reconnection;
  account-change and access-revocation errors never trigger automatic `enable` or signing retries.
- Disconnect is local only. CIP-30 has no standard permission-revocation call. Revoke site access
  in the wallet itself if needed. A wallet prompt already opened cannot be cancelled by this API;
  a transaction already handed to `submitTx` cannot be recalled. A successful in-flight submit
  still returns its hash. On submission failure or an invalid hash, check wallet history before
  any retry: rejection does not prove a transaction was never broadcast.

CIP-30 `getNetworkId()` distinguishes mainnet (`1`) from testnet (`0`), **not preview from preprod**.
Do not present it as proof of the particular testnet. Rechecking reduces stale-network risk but
cannot make the wallet's selected network atomic with a later call. The builder must encode the
correct network and the wallet/ledger must validate it. The adapter cannot protect against a
compromised extension or compromised same-origin composer code.

## Verification and SEC-7 release gate

`test/unit/wallet.test.ts` exercises discovery, denial, malformed APIs/data, both network mismatch
directions, changes during every asynchronous stage, disconnects, overlap protection, witness
assembly and submission errors. Existing network guard tests cover malformed network IDs.

After building both profiles, run:

```sh
cd docs
npm run build
npm run test:wallet:built
```

The built-browser regression serves the actual adapter as same-origin test modules on the real
built `survey/results` page, with its unmodified generated CSP. Its bridge and transaction bytes
are **simulated**. It proves browser execution and network blocking under that policy, not real
extension injection, valid CIP-179 CBOR, ledger acceptance or a preview end-to-end survey.
The test route is intercepted by Playwright only and never enters either published profile.

**SEC-7 status: NOT VERIFIED.** No supported-wallet/version matrix, real installed wallet profiles
or disposable funded preview accounts were available for this implementation. No wallet is
certified by discovery or by these mocks. Do not tick B25 or claim a passing SEC-7 spike from them.
The production CSP remains strict; no extension-scheme relaxation has been granted.

A release tester must complete this protocol for each wallet in the agreed support matrix:

1. Record wallet name, extension store ID, wallet version, browser/version, OS, build commit,
   profile/network, tested URL, date and the exact CSP meta content. Use a clean profile and the
   actual extension, not a `window.cardano` fixture. Never record seed phrases or private keys.
2. Build the **production profile**, serve it locally, and load the survey page directly. Confirm
   the CSP precedes all scripts; confirm the wallet's own `window.cardano.<id>` appears, enable
   succeeds and `getNetworkId()` works. Record CSP violations and the extension's injection
   mechanism from its reviewed source/manifest or browser evidence; do not infer compatibility
   from the CIP alone. Repeat by navigating from a docs page.
3. Connect the wallet on testnet to the mainnet-profile page and on mainnet to the preview-profile
   page. Both must produce the named hard block without calling build, sign or submit. Switch
   networks after connection and during construction; verify the same block before signing.
   Check the displayed error and recovery with keyboard and assistive technology in B32.
4. With B24/B32's real survey builder integrated, use only a disposable funded **preview** wallet.
   Exercise the same strict production CSP on the preview-profile survey page, build the actual
   label-17 response, sign, assemble witnesses and submit. Record the public preview transaction
   hash and verify its payload/network on-chain. Also verify injection/enable on the production
   profile; do not spend mainnet ADA just to test the CSP.
5. Record each stage as pass/fail/blocked with evidence. A missing extension, locked wallet or
   missing builder is **blocked**, never pass. Hand the results to a maintainer to record in issue
   #30. The issue remains open until its entire DoD is met, including the actual per-wallet spike.

If a real wallet fails injection, follow `docs/SECURITY.md`: investigate first. Only the survey
route may gain a justified extension-scheme allowance; full-page navigation both into and out of
that route must accompany it. Do not loosen global CSP, allow inline scripts or load wallet CDNs.

Protocol source: [CIP-30](https://cips.cardano.org/cip/CIP-0030), especially `enable`,
`getNetworkId`, `APIError.AccountChange`, `signTx` and `submitTx`; site ENV-2, SEC-6, SEC-7, SEC-8.

Version compatibility reference: [Cardano JS SDK Cip30Wallet](https://github.com/input-output-hk/cardano-js-sdk/blob/master/packages/dapp-connector/src/WalletApi/Cip30Wallet.ts)
reports `0.1.0`; the CIP itself specifies `1`. These version strings select candidates only.
The required methods and network are validated after explicit enable. New API versions need review.

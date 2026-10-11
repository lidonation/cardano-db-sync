# Docs site security baseline

The posture for the documentation and community site (SPECIFICATION §12.1, SEC-1 to SEC-8). Each
rule is enforced by a gate in CI; this page says why, so nobody undoes one as a drive-by.

## Content-Security-Policy (SEC-1, SEC-2, SEC-3, SEC-8)

- Every page carries its policy as `<meta http-equiv="Content-Security-Policy">`, written by
  `plugins/security` after the build. GitHub Pages sets no headers, so meta is the only delivery.
- **Accepted limitation (SEC-1):** a meta policy ignores `frame-ancestors`, `sandbox` and
  `report-uri`/`report-to`, and cannot be report-only. There is no clickjacking protection on this
  host. That is a decision, not an oversight: do not add those directives, they would only pretend.
- The policy is
  `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'`.
  Every asset is same-origin, fonts included (they come from `@fontsource-variable`, pinned).
- The only inline script is Docusaurus' colour-mode bootstrap, allowed by its SHA-256 hash, computed
  from the exact bytes each page ships. Any other inline script fails the build. Nonces need a
  server; static hosting has none.
- Only the survey route may ever relax the policy, and only by adding `chrome-extension:` or
  `moz-extension:` to `script-src`, if SEC-7's per-wallet check shows a wallet needs it
  (`SURVEY_SCRIPT_RELAXATION` in `plugins/security`). No other route can be loosened.
- **Before granting that relaxation:** a meta policy belongs to the page a visit starts on, and
  Docusaurus moves between pages client-side. A visitor who reaches the survey by a link keeps the
  strict policy, so the wallet stays blocked; one who lands on the survey and then follows a link
  keeps the relaxed policy on every page after it. The survey must therefore be entered and left by
  full page loads (links into and out of it marked as such) in the same change that grants it.
- `npm run check:csp` checks the built pages: one policy per page ahead of any script or style, the
  policy unloosened, every inline script hashed, no inline style, and no external origin in any
  resource a page or stylesheet loads. Links people follow are not loads and are not checked.

## Subresource Integrity is a non-decision (SEC-4)

SRI is **not** a control on this site, deliberately. It protects against a compromised third-party
CDN; under SEC-2 there is no CDN and every asset is same-origin, so it would add nothing. The real
threat is a compromised npm package baked into the bundle at build time, which SRI cannot detect.
Do not add `integrity` attributes without revisiting SEC-4 in the specification first.

## Supply chain (SEC-5, SEC-6)

- Every dependency in `package.json` is an exact version, and `.npmrc` keeps `npm install` writing
  exact versions. The lockfile is committed; CI installs with `npm ci`. `npm run check:deps`.
- `npm run check:audit` runs `npm audit` over the whole tree. A high or critical advisory fails CI
  unless `config/audit-allowlist.json` accepts it with a reason and an expiry date. An expired entry,
  or one npm no longer reports, fails too, so exceptions leave as soon as the fix lands.
- Dependabot opens update PRs (`.github/dependabot.yml`). A human reviews each one; nothing
  auto-merges.
- **The survey route's money path is review-gated (SEC-6).** Any package taking part in CBOR
  encoding, transaction construction or wallet interaction is listed in
  `config/review-gated-dependencies.json` with its reason, pinned exactly, and every update to it is
  reviewed as code, diff included. A package that reaches the survey route without being listed is a
  review failure, not a routine bump.

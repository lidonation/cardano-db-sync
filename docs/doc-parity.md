# Legacy documentation parity (B16 / CON-6)

`npm run check:doc-parity` audits the migration while `doc/` exists. It does not retire legacy
files, rewrite the triage, or update its baseline automatically. B17 owns retirement.

## Version 1 contract

`data/doc-parity.json` contains `schemaVersion: 1`, `sources` and `targets` objects.
All paths are repository-relative. The B13 record (`data/doc-triage.json`) remains the expected
file-level disposition and omission rationale. Every current legacy file must occur exactly once
in that record; every Markdown file must also occur exactly once in `sources`.

Each source has a `preambleSha256` and a `headings` object. A heading key is `hN Text`, where N is
the Markdown heading depth and Text is its inline plain text. Repeated keys get ` [2]`, ` [3]`,
etc., in document order (for example `h3 Ledger replay [2]`). Each entry has a `sha256` and
**exactly one** of:

- `targets`: a non-empty array of IDs in the top-level `targets` object;
- `omission`: a non-empty accepted-omission reason.

A target has `kind`, `file`, `sha256` and a selector:

- `guide`: `file` must be a published `docs/docs/guides/*.md` file and `heading` selects one heading;
  draft or underscore/dot-prefixed excluded guides do not count as published counterparts;
- `annotation`: `file` must be a repository Haskell source and `name` selects a declaration in
  `generated/haddock-annotations.json`. Constructor and field documentation is included.

Sources pin each heading plus its direct content up to the next heading, and the preamble before
the first heading. Guide targets pin a heading plus its subtree (up to the next equal-or-higher
heading). YAML frontmatter is excluded from guide heading extraction. Annotation targets pin
only documentation, names and constructor/field documentation, not source line numbers.
Digests are lowercase SHA-256 hex of UTF-8 text, with CRLF normalized to LF and outer whitespace
trimmed. Annotation documentation is serialized in the order described by the checker.
Markdown is parsed as CommonMark: fenced code is not a heading; Setext, inline markup and repeated
headings are handled without regular-expression heading matching.

## Failure and report contract

The checker exits 1 for an invalid manifest, untriaged file, missing/stale heading mapping, source
edit, missing/changed target or disagreement with the B13 disposition. A `both` source must account
for both guide and annotation destinations. An omission-only source must retain the B13 reason.
Diagnostics identify the source file and specific heading; changing only target content still
fails, so an empty or replaced migrated section is not silently accepted.

The check never writes inputs. Successful and failed checks produce a deterministic Markdown
report on stdout, suitable for the CI job summary and artifact. CI runs the check on `doc/**`
changes as well as docs changes, includes it in the required docs gate, and retains the report even
on failure. No Haskell compiler, database, browser or network is needed for this check.

## Reviewing a baseline change

A green report proves coverage against an explicit reviewed mapping, not semantic equivalence of
prose. Read the legacy section and each destination before changing a mapping or digest. Keep
accepted omissions explicit and reasoned; do not rebaseline merely to make CI green. For an
upstream edit, migrate the changed content (or document an accepted omission), then update only
the reviewed entries. To compute a digest or inspect parsed heading IDs, import `digest`,
`readHeadings` and `annotationText` from `scripts/check-doc-parity.mjs` in a Node ES module.
The checker deliberately has no automatic update switch.

Before B17 retires `doc/`, copy the green CI parity report into its PR description. Retain this
manifest as the migration record. Removing the old tree without changing the migration policy
must fail this gate rather than turn it into a vacuous success.

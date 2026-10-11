# haddock-extractor (B07)

Parses the Haskell sources with [`ghc-lib-parser`](https://hackage.haskell.org/package/ghc-lib-parser)
and writes the Haddock annotations to the committed artifact at
[`docs/generated/haddock-annotations.json`](../generated/haddock-annotations.json).

**This extractor parses; it never compiles.** A full cabal build of
cardano-db-sync in Actions is hours of compute for a docs change (CON-2), so
the extractor reads each module's AST directly — no package database, no
dependency resolution, no object code. GHC's parser inserts Haddock comments
into the AST (`DocD` declarations, `hsmodHaddockModHeader`, `con_doc`,
`cd_fld_doc`; see `GHC.Parser.PostProcess.Haddock`), and that is what this
package walks.

## The contract

- **Committed artifact (CON-1).** `generated/haddock-annotations.json` is
  committed. The site build consumes it through `src/data/haddock.ts` and
  succeeds with **no Haskell toolchain present** — the artifact is data, and
  `scripts/check-annotations.mjs` guards that it stays consumable.
- **Deterministic (CON-2).** No timestamps, no tool versions, no absolute
  paths, path-sorted file order, sorted object keys. Running the extractor
  twice produces byte-identical output; the golden test pins the exact shape
  against a fixture.
- **Loud failure.** A file the extractor cannot parse fails the run rather
  than silently contributing partial documentation.

## Usage

From `docs/extractor`:

```sh
cabal build all
cabal run extract-haddock -- \
  --repo-root ../.. \
  --out ../generated/haddock-annotations.json \
  --input cardano-db/src
```

`--input` is repository-relative (it becomes the `path` in the artifact) and
may name a file or a directory; directories are walked recursively for `*.hs`.
`--repo-root` is the repository those paths are relative to.

CI runs this from [`.github/workflows/extract-haddock.yml`](../../.github/workflows/extract-haddock.yml):
it builds, runs the golden test, extracts over `cardano-db/src`, and fails when
the committed artifact differs from a fresh extraction. On `master` and
`release/community-site` the regenerated artifact is committed back; on pull
requests the drift gate fails with the diff instead.

## Layout

| Path                          | What it is                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/HaddockExtract/Model.hs` | the artifact shape, kinds, and its deterministic JSON encoding                                                                   |
| `src/HaddockExtract/Parse.hs` | ghc-lib-parser driving: extensions, CPP stripping, parse diagnostics                                                             |
| `src/HaddockExtract/Walk.hs`  | AST → annotations, including the comment-association rules                                                                       |
| `src/HaddockExtract/Run.hs`   | file collection and per-file extraction                                                                                          |
| `app/Main.hs`                 | the `extract-haddock` CLI                                                                                                        |
| `test/Golden.hs`              | golden test: `test/fixtures/Sample.hs` → `test/golden/haddock-annotations.json`, byte-identical, plus the association assertions |

## Notes

- **CPP.** One source file uses `#if`. Compiling to preprocess is out of the
  question for a docs build, so preprocessor lines are stripped (both sides of
  a conditional survive) and the file is flagged `cpp: true` in the artifact.
- **Extensions.** The extractor parses with a generous fixed extension set
  rather than replicating each package's cabal file: extensions only matter
  here where they change the grammar, and more than a file needs never alters
  its parse.
- **Scope.** One artifact feeds all the generated surfaces (reference pages,
  schema explorer, config wizard). Later items may extend the shape; bump
  `schemaVersion` and the access layer together when a field's meaning
  changes.

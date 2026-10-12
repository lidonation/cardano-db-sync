# haddock-extractor (B07, B10)

Two extractors share this package: `extract-haddock` (B07, below) and
[`extract-config`](#the-config-schema-b10) (B10).

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
  --input cardano-db/src \
  --input cardano-db-sync/src/Cardano/DbSync/Config/Types.hs
```

`--input` is repository-relative (it becomes the `path` in the artifact) and
may name a file or a directory; directories are walked recursively for `*.hs`.
Explicit inputs replace defaults. Without them, the schema tree and config types
are selected. Missing, empty, escaped and invalid UTF-8 inputs fail the run.
`--repo-root` is the repository those paths are relative to.

CI runs this from [`.github/workflows/extract-haddock.yml`](../../.github/workflows/extract-haddock.yml):
it builds, runs the golden, regression and CLI tests, extracts schema and config
sources, and fails on drift on both pull requests and deploy branches. Regenerate
and commit the artifact with the source change. The workflow has read-only access
and never commits a repair after deployment has started.

## Layout

| Path                          | What it is                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/HaddockExtract/Model.hs` | the artifact shape, kinds, and its deterministic JSON encoding                                                                   |
| `src/HaddockExtract/Parse.hs` | ghc-lib-parser driving: extensions, CPP stripping, parse diagnostics                                                             |
| `src/HaddockExtract/Walk.hs`  | AST → annotations, including the comment-association rules                                                                       |
| `src/HaddockExtract/Run.hs`   | file collection and per-file extraction                                                                                          |
| `app/Main.hs`                 | the `extract-haddock` CLI                                                                                                        |
| `src/ConfigExtract/Syntax.hs` | B10: GHC AST → a small expression language, with operator re-association                                                         |
| `src/ConfigExtract/Interp.hs` | B10: the `FromJSON` interpreter — keys, shapes, defaults, presets                                                                |
| `app/ExtractConfig.hs`        | the `extract-config` CLI                                                                                                         |
| `test/ConfigGolden.hs`        | B10 golden test: `test/config-fixtures/ConfigSample.hs` → `test/golden/config-schema.json`, plus the real module reads in full   |
| `test/Golden.hs`              | golden test: `test/fixtures/Sample.hs` → `test/golden/haddock-annotations.json`, byte-identical, plus the association assertions |

## The config schema (B10)

`extract-config` reads the `FromJSON` instances db-sync parses its config file
with — `Cardano/DbSync/Config/Types.hs`, plus the trace-dispatcher hand-off in
`Cardano/DbSync/Config.hs` — and writes
[`generated/config-schema.json`](../generated/config-schema.json): every key the
binary reads, whether it is required, the values it accepts, its default, and
what each `insert_options.preset` switches on. The config wizard draws its
options from that schema and `npm run check:config` holds everything it emits
to it (CON-4), so the wizard cannot hand out an option the binary rejects or
silently ignores.

```sh
cabal run extract-config -- --repo-root ../.. --out ../generated/config-schema.json
```

It parses, never compiles, and **reads the parsers as the specification**
rather than keeping a list of options that drifts. `ConfigExtract.Syntax`
lowers the GHC AST into a small expression language (and re-associates
operator chains, which only the renamer would otherwise do);
`ConfigExtract.Interp` interprets the idioms the config module uses:

| idiom                                                                 | reads as                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `withObject … (\o -> C <$> o .: "k" <*> o .:? "j" .!= d …)`           | object keys, typed by `C`'s fields; `.:` required, `.!=` default                    |
| a `do` block binding `o .: "k"` / `o .:? "k"`                         | keys typed by their use: `case v :: Text of`, constructor arguments, `map f v`      |
| `withText … (\case "a" -> …)`, or a helper like `enableDisableToBool` | the accepted strings                                                                |
| `case v of String "x" -> …`                                           | the accepted strings                                                                |
| `deriving newtype (FromJSON)`                                         | the wrapped type                                                                    |
| `.!= def`, record selectors, record updates, named option sets        | defaults, evaluated and turned back into JSON through the parser's own alternatives |
| `preset <- …; base <- case preset of …`                               | `presets`: the effective sibling values for each preset                             |
| ``any (`KeyMap.member` o) ["TraceOptions", …]``                       | `passthrough`: keys handed whole to another reader                                  |

Anything the rules cannot read lands in the artifact's `unresolved` list, and
the run fails: a new parser idiom must be taught to the extractor, not lost
from the schema. `test/ConfigGolden.hs` pins every rule against
`test/config-fixtures/ConfigSample.hs` and checks the real module extracts
with nothing unresolved.

### Schema version 2

Integer shapes retain the Haskell type and inclusive `minimum` and `maximum`
as decimal strings. `Word` and `Int` use the supported 64-bit runtime limits.
`NonEmpty` arrays carry `minItems: 1`. Optional `.:?` reads accept explicit
`null` as absence, including when the parser supplies a default. Object
defaults are included alongside scalar defaults.

The JavaScript validator rejects integers outside the safe range
(-9007199254740991 to 9007199254740991), even when a Haskell `Word64` can hold
them. This prevents rounded config values from passing validation. Wizard
output must stay in that safe range until it has a lossless numeric path.

The loader, gate and validator share structural checks. Unknown shapes,
empty enums, duplicate keys and malformed defaults or presets fail before
config values are checked. Unsupported parser callbacks, guards, multiple
function equations and local bindings fail extraction. The interpreter and
syntax regression suites pin these failures alongside the successful golden.

## Notes

- **CPP.** One source file uses `#if`. Compiling to preprocess is out of the
  question for a docs build, so preprocessor lines are replaced with blank lines (both sides of
  a conditional survive, and physical source line numbers stay correct) and the file is flagged `cpp: true` in the artifact.
- **Extensions.** The extractor parses with a generous fixed extension set
  rather than replicating each package's cabal file: extensions only matter
  here where they change the grammar, and more than a file needs never alters
  its parse.
- **Scope.** One artifact feeds all the generated surfaces (reference pages,
  schema explorer, config wizard). Later items may extend the shape; bump
  `schemaVersion` and the access layer together when a field's meaning
  changes.

Dependency selection is pinned by `cabal.project`. The extraction step has a
60-second timeout; toolchain installation and building the extractor are reported
separately and take longer on a cold cache. CPP conditionals are not evaluated.
Incompatible alternatives fail parsing with a diagnostic, never partial output.

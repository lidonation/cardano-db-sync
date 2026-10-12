# Updates feed boundary

`Updates` takes an `UpdatesFeed | null`. The feed is build-produced data, not a browser request.

- `null` means the feed is unavailable. It must not be presented as zero changes.
- `{asOf, entries: []}` is an available feed with no entries yet.
- Every entry has a unique ID, an inclusive UTC calendar date (`YYYY-MM-DD`), a category
  (`release`, `schema`, or `docs`), a plain-text title, and an absolute HTTPS source URL.
- `asOf` is the snapshot date. Entries cannot be newer than the snapshot.

The B22 feed producer belongs upstream of `feed.ts`. Replace its explicit `null` with
`validateFeed(generatedArtifact)` when that producer lands. Validation fails on malformed
entries, repeated IDs, invalid dates, non-HTTPS links, or URLs with embedded credentials.
Do not fill this boundary with sample commits or infer an empty feed from a failed build.

Week includes the snapshot date and the six preceding UTC calendar days. Month includes
30 calendar days ending on the snapshot date. Total includes every entry. Custom includes
both selected UTC endpoints. Results sort by descending date, then ID for deterministic ties.
No filter uses the visitor's local clock, so hydration and timezone differences cannot change
what a build snapshot reports. Custom dates are selected with native date inputs.

The development-only `__updates` fixture demonstrates real-data shapes, missing and empty
states. Its synthetic entries never ship in either site profile. RSS/Atom generation (B22)
and `DataFeed` structured metadata (B21) are separate build-layer responsibilities.

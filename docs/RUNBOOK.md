# Docs site runbook

How the documentation site is built, deployed and watched, and the repository settings it depends
on. The workflows enforce what they can; the settings below are the part only a repository admin
can apply, so they are written down here (B41, SPECIFICATION §12).

## Deploys

One repository has one Pages site, so each repository publishes one profile (ENV-6):

| Repository                     | Branch                   | Profile | Environment    | URL                                           |
| ------------------------------ | ------------------------ | ------- | -------------- | --------------------------------------------- |
| `lidonation/cardano-db-sync`   | `release/community-site` | dev     | `github-pages` | https://lidonation.github.io/cardano-db-sync/ |
| `IntersectMBO/cardano-db-sync` | `master`                 | prod    | `production`   | https://dbsync.cardano.intersect.org/         |

Both deploy jobs live in `.github/workflows/docs-site.yml`, run on a push after the **Docs CI
gate** passes, and never on a pull request or any other branch. Each asserts BLD-1: the published
tree is measured against the 1 GB Pages limit before upload, and the deploy against the 10-minute
Pages timeout after it. Both figures land in the job summary.

The production job only exists in effect once the site is merged upstream (B48); on the fork it
never runs.

## Repository settings

### Fork (`lidonation/cardano-db-sync`)

- **Settings → Pages → Build and deployment → Source:** GitHub Actions.
- **Settings → Pages → Custom domain:** none. The dev site stays on its `github.io` subpath, and the
  build emits no `CNAME` for it.
- **Settings → Environments → `github-pages` → Deployment branches and tags:** selected branches,
  with one rule, `release/community-site`. A deploy from any other branch is refused by GitHub even
  if a workflow asked for one.
- **Settings → Secrets and variables → Actions:** `CROWDIN_PROJECT_ID` and
  `CROWDIN_PERSONAL_TOKEN` for the translation sync (optional: without them it skips, ENV-5).

### Upstream (`IntersectMBO/cardano-db-sync`), at cutover (B48)

- **Pages → Source:** GitHub Actions. **Custom domain:** `dbsync.cardano.intersect.org`, with
  "Enforce HTTPS" on once the certificate is issued. The production build also emits `CNAME`.
- **Environments → `production`:**
  - **Required reviewers:** the maintainers who approve production deploys. A deploy waits for one
    of them.
  - **Deployment branches and tags:** selected branches, one rule, `master`.
- DNS: a `CNAME` record for `dbsync.cardano.intersect.org` pointing at `intersectmbo.github.io`.
  The sequence is B48's to rehearse.

## Scheduled-job alerts

Every scheduled docs workflow (today the daily Crowdin download in `docs-i18n.yml`; later
`chain-refresh` and the survey tally) ends with the shared **Docs ops alert** job
(`.github/workflows/docs-ops-alert.yml`, NUM-4):

- When the watched job fails or is cancelled, it opens an issue titled
  `[ops-alert] <workflow> failed`, labelled `ops-alert`. If one is already open, it comments with
  the new run instead. Repository watchers are notified either way.
- When the job next succeeds, it comments with the recovering run and closes the issue.

**When an alert opens:** follow the run link and fix the cause, then re-run the workflow
(**Actions → the workflow → Run workflow**). Do not close the issue by hand; the successful run
closes it, which proves the job works again. The alert job reports on manual runs as well as
scheduled ones for exactly this reason (a manual run that fails comments on the issue too). While it stays open, the chain and survey figures on
the site are stale.

Schedules run only from the repository's default branch, and fork pull requests cannot read
Actions secrets, so nothing scheduled depends on a pull request (NUM-4).

## Running the alert drill

Proves the alert path end to end on demand (`.github/workflows/docs-ops-drill.yml`), for
example after changing the alert workflow:

1. Push any commit carrying the workflows to a branch named `ops-drill/<name>`, for example
   `ops-drill/seeded-failure`. Its stand-in job fails, and an `[ops-alert] Docs ops alert drill
failed` issue opens.
2. Push the same commit to `ops-drill/<name>-pass`. The stand-in job passes and the issue closes.
3. Delete both `ops-drill/*` branches.

## Budgets

| Limit                     | Where it is enforced                    |
| ------------------------- | --------------------------------------- |
| Published site under 1 GB | deploy job, `check-publish.mjs size`    |
| Deploy under 10 minutes   | deploy job, `check-publish.mjs elapsed` |
| Per-locale asset budget   | Docs CI, `check:budget` (PERF-1)        |

B38 replaces the asset budget's placeholder limits with the specification's.

### Weekly repository activity refresh (B52)

GitHub only runs scheduled workflow definitions from the default branch. Once the B52
change is merged into `release/community-site`, copy `.github/workflows/docs-weekly-dispatch.yml`
to the fork's default branch as `.github/workflows/docs-site.yml` via its normal review process.
That name registers the workflow on the default branch, which GitHub requires for dispatch. Its
weekly schedule dispatches `docs-site.yml` at `release/community-site`; that run executes the
docs gate and deploys the developer profile in the release branch's cache scope. Merely adding `schedule` on the release branch does not enable a schedule. The workflow
checks out upstream `master` with full history and caches the last good public data and local
avatar assets. When the checkout or GitHub API is unavailable, builds use the last valid cache;
without one, the page names the data as unavailable. No profile locations or emails are stored in
the cache. Routine `docs/` changes continue to trigger the existing push workflow.
The plugin exposes the full location-free snapshot at
`@generated/repository-activity/default/history.json` for build-time chart and activity
consumers; the Ecosystem page imports only the compact summary. Aggregate history before
shipping future charts so the site stays within its existing payload limits.

### Roadmap project snapshot (B55)

On 2026-10-29 the public project 8 page exposed an exact total of 108 and status groups
(3 unset, 1 In Progress, 104 Done). Its HTML contained only 29 records; the Done group
indicated more pages. Its anonymous `memexes/6909988/paginated_items` JSON endpoint returned
100 and 8 records using `after` cursors. As a one-time cross-check, the 108 distinct items
were compared by content ID to all pages of GitHub's authenticated `projectV2` GraphQL API:
Status, Performance and Release Planned agreed for every item. The objective totals were
Sync speed 11/12, Memory 5/5, Modularity 4/4 and Disk space 1/1.

This endpoint and the page's embedded JSON are undocumented and may change. The build does not
send a credential to it. It validates field definitions and each value, page cursors, exact totals,
unique item IDs and the status groups; an inconsistency is rejected. This is not a transactional
snapshot: a concurrent change that preserves all checked totals could still escape detection. If
retrieval fails or the format changes, the last valid Actions cache is used; without one, the page
shows an explicit unavailable state. The snapshot date is displayed. Revisit #101 with Intersect
if the public endpoint becomes unreliable. Weekly rebuilds require installing the existing
weekly-dispatch workflow on the default branch as described above; a release-branch schedule alone
cannot fire.

Anonymous roadmap retrieval has a 60-second snapshot deadline, a 15-second per-request
limit, a 5 MiB decoded response-body limit and a 20 MiB cumulative body limit. These
limits include all pagination; exceeding one takes the same last-good-cache or unavailable
path as a failed request, rather than keeping a build waiting on an unstable endpoint.

### Headless prose search (B20)

The production and development builds emit one Pagefind 1.5.2 index for each Docusaurus
`(version, locale)` under the locale's `pagefind/<version>/` directory, with one shared runtime per locale. Only rendered docs
are indexed, not navigation or redirects. The build fails if indexing fails. The engine is minified for a same-origin module worker using Pagefind's public instance API,
with no second engine copy for main-thread fallback. Errors and warnings are retained; verbose
console logging is removed. Browsers must support module workers. Worker failure or a 30-second
request timeout rejects the query and allows a retry, rather than weakening the page CSP.
The Pagefind UI and highlighter are not shipped: the planned search interface consumes the headless API.

Use `bundlePath` from `src/search/version.ts` with the active locale base URL and Docusaurus
version name, then `loadProseApi` and `searchProse` from `src/search/prose.ts`. The latter
serializes searches and returns independent hydrated results, including heading-level `sub_results`.
Repeated queries reuse the active worker and its cache. A bundle change or failure resets it;
failed hydration drains every pending result before the next bundle can begin.
Load it only when a prose query is needed. Pagefind's actual 1.5.2 option is `basePath` (not
`bundlePath`); the adapter also prevents profile/locale prefixes being duplicated in results.
Treat returned excerpts as untrusted HTML when rendering. Run `npm run test:pagefind:built`
for real-browser indexing, identifier, version-isolation, CSP and reproducibility regressions.
After building both profiles, run `npm run test:pagefind:profiles` to query their actual indexes
under the emitted CSP in all five locales.

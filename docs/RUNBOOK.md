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
closes it, which proves the job works again. While it stays open, the chain and survey figures on
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

# cardano-db-sync docs site + usage survey

Astro 6 + Cloudflare Pages. Markdown docs at the root, interactive survey at `/survey`,
analytics dashboard at `/survey/results`, backed by Cloudflare D1.

## First-time setup

```bash
cd docs
npm install
npx wrangler login
npx wrangler d1 create dbsync
# copy the database_id into wrangler.toml
npm run db:apply
# change the salt in src/pages/api/submit.ts
```

## Local dev

```bash
npm run dev
```

Visit http://localhost:4321. D1 is proxied via Wrangler thanks to `platformProxy`.

For a production-like local build, run `npm run build && npm run preview`.

## Deploy

Connect this repo to Cloudflare Pages via the dashboard:

- **Workers & Pages → Create → Pages → Connect to Git**
- Production branch: `master` (or your working branch)
- Build command: `cd docs && npm install && npm run build`
- Build output directory: `docs/dist`
- Root directory: `/` (project root, not `docs/`)
- Environment variables: `NODE_VERSION = 20`

After the first deploy:

- Pages project → **Settings → Functions → D1 database bindings → Add binding**
- Variable name: `DB`
- D1 database: `dbsync`
- Redeploy

## Test

```bash
curl -X POST https://<your-project>.pages.dev/api/submit \
  -H 'Content-Type: application/json' \
  -d '{"role":"developer","satisfaction":8,"team_size":"2-5","frequency":2,"use_case":["analytics"],"pain_points":["sync_time","disk"],"nps_why":"test"}'
```

Then visit `/survey/results` to see your test response aggregated, or query directly:

```bash
npx wrangler d1 execute dbsync --command "SELECT * FROM responses" --remote
```

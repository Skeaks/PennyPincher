# Deploy

Merge is deploy. `.github/workflows/deploy.yml` runs on every push to `main` that touches
`apps/api/**`, `packages/**`, or itself: apply D1 migrations, `wrangler deploy --env production`,
then poll `/healthz` until it reports the merged commit's SHA. There is no second gate, tag,
lock, or release script (ADR 0004). The extension is not deployed by this workflow (S15).

## What is live?

```bash
curl -s https://pennypincher-api.<account-subdomain>.workers.dev/healthz
```

`build` is the full git SHA of the commit that was deployed. Compare with `git log -1 origin/main`.
The exact URLs are printed in each deploy run's summary (Actions > deploy > run > Summary).

## Measured: merge clicked to `/healthz` returning the new build

| When | Target | Trigger | Measured | Run |
|---|---|---|---|---|
| TBD | staging | PR label `deploy-staging` | TBD (job start to live) | TBD |
| TBD | production | merge to `main` | TBD (merge commit timestamp to live) | TBD |

Target from `CONTRIBUTING.md`: under 5 minutes. The verify step in `deploy.yml` prints the
number in the job summary on every run, so this table can be refreshed from any later deploy.

## Staging

Add the `deploy-staging` label to a PR. `deploy.yml` deploys the PR head to
`pennypincher-api-staging` with the staging D1, and redeploys on every push while the label
stays on. Remove the label to stop. Staging and production are separate Workers with separate
databases and separate `PILOT_TOKEN` secrets; nothing a PR does on staging can reach production
(drill: `docs/audit/S08-deploy-drill.md`).

## Rollback

Fastest (seconds, from a machine with `wrangler login`; from `apps/api/`):

```bash
pnpm exec wrangler rollback --env production
```

It lists recent versions and asks which to restore; pick the previous one. `/healthz` then
reports that version's `build`. Durable (a minute): `git revert <merge sha>` on a branch, open
a PR, merge. The revert deploys like any other merge. Do the fast one first if users are
affected, then the durable one so `main` matches what is live.

## If a deploy fails

1. Open the failed run (Actions > deploy). Every step before the failing one succeeded; the
   failing one names the cause (auth, migration SQL, wrangler config, `/healthz` never matched).
2. Nothing is half-deployed: `wrangler deploy` is atomic, and a migration failure stops the job
   before deploy. Production keeps serving the previous build. Check `/healthz` to confirm.
3. Fix forward on a branch, open a PR, merge. Do not hand-edit anything in the Cloudflare
   dashboard; the next deploy would overwrite it.
4. Re-run the failed job (Actions > run > Re-run failed jobs) only if the cause was transient
   (Cloudflare or GitHub outage). Migrations are idempotent, so re-running is safe.
5. Auth errors (`10000`, `Authentication error`): the `CLOUDFLARE_API_TOKEN` repo secret needs
   the "Edit Cloudflare Workers" template plus D1 Edit. Only Jamie can rotate it.

## Secrets and config

| Thing | Where | Who sets it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub repo secrets | Jamie |
| `PILOT_TOKEN` | `wrangler secret put PILOT_TOKEN --env staging` and `--env production` | Jamie |
| D1 database ids, Worker names, bindings | `apps/api/wrangler.toml` (committed; identifiers, not secrets) | anyone, via PR |
| `BUILD_SHA` | injected per deploy with `--var`; never in the repo | `deploy.yml` |

A fresh clone plus the two repo secrets deploys correctly. Nothing lives in a gitignored file.

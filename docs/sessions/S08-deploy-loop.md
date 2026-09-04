---
id: S08
title: Deploy loop
role: platform
depends_on: [S07]
owns:
  - docs/sessions/S08.outcome.md
  - .github/workflows/deploy.yml
  - docs/deploy.md
human_review_required: true   # gate
---

## Context

Merge is deploy. This session makes that true and measures it. Read ADR 0004 and the table in
`CONTRIBUTING.md`; every row is a thing this workflow must not reintroduce.

## Before starting (Jamie, about 15 minutes, cannot be delegated)

The agent has no Cloudflare access and must not be given the account password. Do these
first and paste the results into the session prompt:

1. Cloudflare account (free plan is enough). Note the **Account ID** from the dashboard
   sidebar.
2. `npm i -g wrangler && wrangler login`, then from `apps/api/`:
   `wrangler d1 create pennypincher-staging` and `wrangler d1 create pennypincher-production`.
   Each prints a `database_id`; give both to the session (they are not secrets; they go in
   `wrangler.toml`).
3. Create an API token at My Profile > API Tokens > Create Token > "Edit Cloudflare Workers"
   template, and add **D1: Edit** to its permissions. Store it as the GitHub repo secret
   `CLOUDFLARE_API_TOKEN`; store the Account ID as `CLOUDFLARE_ACCOUNT_ID`
   (Settings > Secrets and variables > Actions). Never paste the token into chat.
4. Generate the pilot bearer token yourself (`openssl rand -hex 32`) and set it with
   `wrangler secret put PILOT_TOKEN --env staging` and again `--env production`. Keep a copy
   somewhere private; S11's extension build needs it.

## Acceptance

- `deploy.yml`: on push to `main`, if `apps/api/**` or `packages/**` changed, run
  `wrangler deploy --env production` for the API. PRs deploy to `staging` on label
  `deploy-staging`. Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` from repo secrets
  (Jamie sets them; the brief tells Jamie exactly which token scopes).
- D1 migrations applied by `wrangler d1 migrations apply` in the same job, before deploy.
  Idempotent.
- The API's pilot bearer token lives in `wrangler secret`, never in the repo.
- `docs/deploy.md`: the measured time from "merge clicked" to `/healthz` returning the new
  build (target under 5 minutes; record the actual), the rollback command, and "what to do if
  deploy fails" in five lines or fewer.
- A `build` field in `/healthz` returns the git SHA so a human can confirm what is live.
- Deliberately break a deploy on staging (bad wrangler config) and confirm production is
  untouched. Record in `docs/audit/S08-deploy-drill.md`.

## Out of scope

- Pages deploy for the landing site (S15 adds a second job by copying this one).
- Any extension packaging.

---
id: S08
title: Deploy loop
role: platform
depends_on: [S07]
owns:
  - .github/workflows/deploy.yml
  - docs/deploy.md
human_review_required: true   # gate
---

## Context

Merge is deploy. This session makes that true and measures it. Read ADR 0004 and the table in
`CONTRIBUTING.md`; every row is a thing this workflow must not reintroduce.

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

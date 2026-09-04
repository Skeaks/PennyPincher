# S08 deploy drill

Purpose: break a staging deploy on purpose (bad `wrangler.toml`) and show that production is
untouched, and that a failed deploy leaves the previous staging build serving.

## Status: not yet run

Blocked on two Jamie steps recorded in `docs/sessions/S08.outcome.md`: the account needs a
workers.dev subdomain before any Worker can be reached, and #19 (`build` in `/healthz`) needs
merging before the verify step has anything to match. The first staging attempt
([run 33917779955](https://github.com/Skeaks/PennyPincher/actions/runs/33917779955)) got as far
as uploading the Worker: auth, install, and the D1 migration (`0001_observations.sql` applied
to `437f30bb…`) all worked.

## Procedure (to run once unblocked)

1. Confirm the baseline: staging and production `/healthz` both return a `build`; note both.
2. Branch off `main`, edit `apps/api/wrangler.toml` so the staging D1 `database_id` is not a
   real database (for example `00000000-0000-0000-0000-000000000000`). Open a PR, label it
   `deploy-staging`.
3. Expected: the `apply D1 migrations` step fails; `wrangler deploy` and the verify step are
   skipped. Nothing is uploaded.
4. Confirm staging `/healthz` still reports the baseline `build` (the previous deployment is
   still serving) and production `/healthz` is unchanged.
5. Close the PR unmerged; delete the branch. Record run ids and both `/healthz` bodies below.

## Result

| Check | Expected | Observed |
|---|---|---|
| failing step | `apply D1 migrations` | |
| staging `/healthz` after | baseline build, unchanged | |
| production `/healthz` after | baseline build, unchanged | |

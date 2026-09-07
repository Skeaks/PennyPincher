# S08 deploy drill, 2026-09-04

Purpose: break a staging deploy on purpose (bad `wrangler.toml`) and show that production is
untouched and that a failed deploy leaves the previous staging build serving.

## Baseline

Staging run 2 of PR #21, [run 33920012104](https://github.com/Skeaks/PennyPincher/actions/runs/33920012104),
had just deployed `1233bb1a8254347afd86a9779f11b70292381b7d` to
`https://pennypincher-api-staging.jamesjlee04.workers.dev`. Production
(`https://pennypincher-api.jamesjlee04.workers.dev`) did not exist yet: HTTP 404, because the
first production deploy is the merge of #21 itself.

## Procedure

1. Branch `s08/drill-bad-config` off `s08/deploy-loop` (the PR head must carry `deploy.yml`).
2. `apps/api/wrangler.toml`: staging `database_id` replaced with
   `00000000-0000-0000-0000-000000000000`. Nothing else changed.
3. Draft PR [#22](https://github.com/Skeaks/PennyPincher/pull/22), labelled `deploy-staging`.
4. Read the run, then `curl` both `/healthz` URLs.
5. PR closed unmerged.

## Result: [run 33920157092](https://github.com/Skeaks/PennyPincher/actions/runs/33920157092)

| Check | Expected | Observed |
|---|---|---|
| failing step | `apply D1 migrations` | `apply D1 migrations` failed: `A request to the Cloudflare API (/accounts/…/d1/database/00000000-0000-0000-0000-000000000000/query) failed.` |
| `wrangler deploy`, verify | skipped, nothing uploaded | both skipped |
| staging `/healthz` after | baseline build, unchanged | `{"ok":true,"schemaVersion":"1.0.0","build":"1233bb1a…"}` |
| production `/healthz` after | unchanged | still 404 (not yet deployed) |

## Conclusions

- A bad config fails before anything is uploaded. There is no half-deployed state to clean up;
  the previous Worker keeps serving.
- The job only ever passes `--env staging` on PR events, and staging and production are
  separate Workers with separate D1 ids and secrets, so a PR cannot reach production by
  construction. This drill could not observe a live production build being untouched because
  none existed yet; once #21 has merged, re-running steps 1 to 5 takes about three minutes and
  the production row can be re-checked against a real `build`.

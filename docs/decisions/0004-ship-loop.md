# ADR 0004: The ship loop

**Status:** accepted, 2026-09-04

## Decision

- The gate is `pnpm gate`, identical locally and in CI, under 2 minutes.
- The gate runs **once**, on the PR. Merge to `main` deploys. There is no second gate, release
  script, tag, or lock.
- Deploys are declarative: `wrangler deploy` for the Worker, Pages for the site. Each replaces
  the whole artifact. Rollback is `wrangler rollback` or revert-and-merge.
- Slow checks (mutation, CodeQL, E2E on fixtures, bundle budgets) run nightly and open issues.
  They never block.
- Review is one fresh session per PR, advisory, no re-runs. In-diff P0s get fixed; everything
  else is a follow-up.
- All non-secret config is committed. Secrets live only in Cloudflare and GitHub Actions
  secrets. A fresh clone deploys correctly.

## Why

Verstill's release path grew a 30 KB script, an S3 lock, tag hygiene, migration drift checks,
and a review panel that looped. Deploys took 20 to 40 minutes and partial deploys left stale
artifacts behind. Every rule above removes one of those failure modes. See the table in
`CONTRIBUTING.md`.

## Consequences

- The extension is the exception: Chrome Web Store review is hours to days. Dev loop is "load
  unpacked". Pilot uses an unlisted listing.
- With no branch protection (free plan), the boundary-guard CI step plus `CLAUDE.md` rules are
  the controls on gate edits. If the repo moves to Pro, turn on required checks and CODEOWNERS;
  nothing else needs to change.

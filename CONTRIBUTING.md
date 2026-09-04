# Contributing — the ship loop

Target: **a feature goes from "tests pass locally" to "live" in 1 to 5 minutes.** Everything in
this document exists to protect that number. When a rule here conflicts with another doc, this
one wins.

## Why it is designed this way

The previous project (verstill-ops) had a 30 KB release script with an S3 lock, tag hygiene,
migration-drift checks, a four-suite serial test gate, and an advisory review panel that agents
were told to run "once" and ran in loops. Deploys took 20 to 40 minutes, partial deploys left
stale bundles behind, and hand edits after a deploy broke the next one. Lessons applied here:

| Verstill pain | PennyPincher rule |
|---|---|
| Release script does many things; any one failing strands the rest | Deploys are **declarative and atomic**: `wrangler deploy` replaces the whole Worker; Pages replaces the whole site. Nothing accumulates. |
| Full test gate serial at deploy time | The gate runs **once, in CI, on the PR**. Merge = deploy. No second gate. |
| Tags, locks, drift checks | None. `main` is the release record. Rollback is `wrangler rollback` (seconds) or revert + merge. |
| Review panel loops | Review is **one** separate session, one comment, and it is **advisory**. Fix in-diff P0s, then merge. No re-runs. |
| Prod-only config in gitignored files | All non-secret config is committed (`wrangler.toml`). Secrets live in Cloudflare only. A fresh clone deploys correctly. |
| Agents editing the gate to pass it | Agents **cannot** edit `.github/` alongside code (boundary-guard). |

## The loop (every session)

1. **Read your brief** in `docs/sessions/`. It names the paths you own and the acceptance list.
2. **Branch** off `main`: `git checkout -b s05/instacart-adapter` (session id + slug).
3. **Build.** Run the touched package's tests as you go (`pnpm --filter @pennypincher/schema test`).
4. **Gate locally**: `pnpm gate` (lint, typecheck, test, guards). Same as CI. Under 60 s.
5. **PR**: `gh pr create --fill` using the template. Copy the brief's acceptance list in.
   Unmet criteria means `--draft`.
6. **Review session**: open a fresh Claude Code session with `docs/sessions/REVIEW.md` and the
   PR number. It leaves one comment. Fix in-diff P0s. Do not loop.
7. **Merge**: `gh pr merge <n> --squash --delete-branch` once CI is green.
8. **Deploy happens on merge** (`deploy.yml`, added in S08). Worker and Pages deploy in about a
   minute. The extension is the exception: it is loaded unpacked in dev and goes to the Chrome
   Web Store on a manual cadence (S15).
9. **Retro**: write `docs/sessions/<id>.outcome.md`. Commit it in the same PR or a one-line
   follow-up.

## What the gate checks (and what it deliberately does not)

On every PR, under 2 minutes: boundary-guard, no-escape-hatches, forbidden-api, Biome, tsc,
Vitest, gitleaks.

**Not** on the PR: mutation testing, CodeQL, E2E against fixtures, bundle-size budgets. Those run
nightly (`nightly.yml`, S10) and open an issue when they fail. They never block a merge.

## Two things a human does

- **Approve gate changes.** Any PR touching `.github/`, `scripts/check-*.sh`, `packages/schema`,
  `fixtures/`, or user-facing claims copy waits for Jamie. Everything else, agents merge.
- **Apply labels**: `claims-reviewed`, `fixtures-reviewed`. Agents never self-apply them.

## Local setup

```bash
git clone https://github.com/Skeaks/PennyPincher.git && cd PennyPincher
pnpm install
pnpm gate
```

Node 22+, pnpm 9+ (`npm i -g pnpm@9`), GitHub CLI logged in as a collaborator.

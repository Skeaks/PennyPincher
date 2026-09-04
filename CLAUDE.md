# CLAUDE.md — PennyPincher

## What this is

A consumer price-transparency platform. A browser extension passively records the price a
shopper was *already shown* (never logging in, never storing credentials), a consented panel of
such shoppers pools those observations, and a stats engine reconstructs the retailer's full
price distribution so any shopper can see where their price sits and what the real floor is.
A second, individual-value track (the "lever probe") shows a single shopper whether being
logged in, their fulfilment path, or their ZIP is changing their price right now.

Read in this order: this file, `CONTRIBUTING.md` (the ship loop), then the brief for your
session in `docs/sessions/`. Strategy and critique live in `docs/plan/` and `docs/CRITIQUE.md`;
you do not need them to do a session.

## Layout

```
packages/schema/     the observation contract (Zod). KEYSTONE. Ask before changing.
packages/synth/      synthetic price ladders with known ground truth (S03)
packages/stats/      tier resolution, confidence, UNRESOLVED (S09+)
packages/normalize/  product identity: UPC + fuzzy (S13)
apps/extension/      MV3 extension (WXT). Passive capture + lever probe + ladder popup
apps/api/            Hono on Cloudflare Workers. Ingest + query
apps/web/            static landing/waitlist on Cloudflare Pages (S15). No Next.js.
fixtures/            scrubbed retailer page snapshots. Tests run against these, never live sites
docs/sessions/       one brief per Claude Code session, plus <id>.outcome.md retros
docs/decisions/      ADRs. Read the one your session cites.
scripts/             the guard scripts CI runs. Runnable locally.
```

Stack: TypeScript everywhere, pnpm workspaces, Biome (lint + format), Vitest, Zod.
`pnpm gate` runs exactly what CI runs. If it is green locally it is green in CI.

## Non-negotiable rules

1. NEVER modify a test to make it pass. If a test fails, fix the implementation or stop and
   report the blocker in the PR body.
2. NEVER add `@ts-ignore`, `@ts-expect-error`, `biome-ignore`, `.skip(`, `.only(`, `xit`, or
   `xdescribe`. CI rejects them (`scripts/check-escape-hatches.sh`).
3. NEVER modify files under `__golden__/` or `fixtures/`. They are human-owned ground truth.
   If a fixture is wrong, say so in the PR; do not edit it.
4. NEVER modify anything under `.github/` or `scripts/check-*.sh` in the same PR as app or
   package code. CI's boundary-guard rejects it. Gate changes are their own PR, reviewed by Jamie.
5. NEVER write code that reads, stores, transmits, or requests a user's retailer credentials or
   cookies, calls a retailer login/auth endpoint, or automates navigation on a retailer site.
   This is a legal constraint (see `docs/decisions/0003-capture-posture.md`), enforced by
   `scripts/check-forbidden-api.sh`. Cross-origin probes use `credentials: "omit"`.
6. NEVER change `packages/schema` without bumping `SCHEMA_VERSION` and adding
   `docs/migrations/<version>.md`. Schema changes can invalidate every observation collected.
7. If you cannot complete the session's acceptance criteria, open the PR as a DRAFT with a
   written explanation. A partial, honest PR is worth more than a complete one that games a check.
8. Stay inside the paths listed in your session brief's `owns:` field. Need something outside
   it? Note it in the PR as follow-up; do not reach across.
9. Tests run against `fixtures/`, never against live retailer sites. No network in tests.
10. No user-facing copy may say "save", "savings", "cheapest", "lowest price", or "guarantee"
    without a `claims-reviewed` label from Jamie. Regulated claims; see CRITIQUE §6.

## Session hygiene

- One session = one branch = one PR = one merge. No stacked branches.
- Scope to fit one context window with headroom. If you need compaction to finish, the brief was
  too big: finish a coherent subset, ship it, and say so in the retro.
- End every session by writing `docs/sessions/<id>.outcome.md`: what shipped, what the brief got
  wrong, what was harder than expected. Three to ten lines. This is how briefs get better.
- Reviewing is a separate session (`docs/sessions/REVIEW.md`). Never review your own PR.

## Git and GitHub

Remote: `https://github.com/Skeaks/PennyPincher.git`, default branch `main`.

You may, without asking: create branches, commit, push your own feature branch, open PRs,
merge your own PR once CI is green and a review session has signed off (`gh pr merge --squash
--delete-branch`).

Ask first for: force pushes, deleting or renaming branches on origin, rewriting pushed history,
changing repo settings, branch protection, secrets, or collaborators.

If a push is rejected because `main` advanced: `git fetch origin && git rebase origin/main &&
git push`. Rebase conflicts in files you changed: resolve, rerun `pnpm gate`, push.

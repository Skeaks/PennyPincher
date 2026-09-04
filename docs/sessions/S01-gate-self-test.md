---
id: S01
title: Gate self-test + nightly skeleton
role: platform
depends_on: [S00]
owns:
  - .github/**
  - docs/audit/**
  - scripts/**
human_review_required: true   # touches the gate
---

## Context

A gate you have not tried to break is a gate you do not have. CI exists (`ci.yml`) but nothing
has proven it rejects what it is meant to reject. This session opens four deliberately bad PRs,
records that each is blocked, closes them, and adds the nightly job skeleton for slow checks.

## Acceptance

- Four branches, each with a PR, each failing CI for the intended reason and no other:
  1. `bad/skip`: adds `it.skip(` to a schema test.
  2. `bad/boundary`: edits `ci.yml` and `packages/schema/src/index.ts` in one PR.
  3. `bad/forbidden`: adds a file under `packages/` containing `document.cookie`.
  4. `bad/secret`: commits a fake AWS key pattern (`AKIA` + 16 uppercase alnum) in a `.ts` file.
- `docs/audit/S01-gate-self-test.md` lists each PR number, the failing check name, and a link
  to the run. All four PRs closed, branches deleted.
- `.github/workflows/nightly.yml` exists: cron 04:00 UTC, runs `pnpm gate` plus placeholders
  (commented) for mutation and E2E, opens an issue on failure using `actions/github-script`.
- `pnpm gate` still green on `main`.

## Out of scope

- Adding any new checks to `ci.yml`.
- Mutation testing config (S10).

## Notes

This PR touches `.github/` so it must not touch `apps/` or `packages/` (boundary-guard). The bad
PRs are separate PRs by design. Jamie merges this one.

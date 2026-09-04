# S01 gate self-test, 2026-09-04

Four deliberately bad PRs were opened against `main` at `6e8ec34` to prove that `ci.yml`
rejects what it is meant to reject. Each was expected to fail exactly one named step. All four
did, with every earlier step green. All four were then closed unmerged and their branches
deleted.

| # | PR | Branch | Violation | Failing check | Run |
|---|---|---|---|---|---|
| 1 | [#1](https://github.com/Skeaks/PennyPincher/pull/1) | `bad/skip` | `it.skip(` added to `packages/schema/test/observation.test.ts` | `no-escape-hatches` | [33883433187](https://github.com/Skeaks/PennyPincher/actions/runs/33883433187/job/101057350217) |
| 2 | [#2](https://github.com/Skeaks/PennyPincher/pull/2) | `bad/boundary` | `.github/workflows/ci.yml` and `packages/schema/src/index.ts` changed in one PR | `boundary-guard` | [33883440677](https://github.com/Skeaks/PennyPincher/actions/runs/33883440677/job/101057375825) |
| 3 | [#3](https://github.com/Skeaks/PennyPincher/pull/3) | `bad/forbidden` | new `packages/probe/cookie.ts` reading `document.cookie` | `forbidden-api` | [33883446546](https://github.com/Skeaks/PennyPincher/actions/runs/33883446546/job/101057397045) |
| 4 | [#4](https://github.com/Skeaks/PennyPincher/pull/4) | `bad/secret` | fake AWS access key id (`AKIA` + 16 base32 chars) in `packages/probe/config.ts` | `secret-scan` (gitleaks rule `aws-access-token`) | [33883452580](https://github.com/Skeaks/PennyPincher/actions/runs/33883452580/job/101057414840) |

## Step-by-step conclusions

Steps run in order and the job stops at the first failure, so "failed for the intended reason
and no other" means: every step before the named one passed, the named one failed.

- **#1 bad/skip**: boundary-guard ok, no-escape-hatches **fail**.
  Log: `Escape hatches found ... ./packages/schema/test/observation.test.ts:15: it.skip("pins the schema version"`.
- **#2 bad/boundary**: boundary-guard **fail**.
  Log: `boundary-guard: a PR may change .github/ OR apps|packages, never both.`
- **#3 bad/forbidden**: boundary-guard ok, no-escape-hatches ok, forbidden-api **fail**.
  Log: `forbidden-api: never read or write cookies from content scripts` with both hits in
  `packages/probe/cookie.ts`.
- **#4 bad/secret**: boundary-guard, no-escape-hatches, forbidden-api, install, lint, typecheck,
  test all ok, secret-scan **fail**.
  Log: `RuleID: aws-access-token`, `File: packages/probe/config.ts`, `leaks found: 1`.

## Notes for whoever reads this next

- The key in #4 uses only `[A-Z2-7]` after `AKIA` and does not end in `EXAMPLE`. Current
  gitleaks allowlists `...EXAMPLE` suffixes and only matches base32 characters, so a sloppier
  fake key would have passed the scan and produced a false green.
- #4 is the only PR that exercised the whole gate: a fresh `pnpm install --frozen-lockfile`,
  Biome, tsc, and Vitest all passed on a CI runner. That doubles as proof that a clean clone
  builds.
- The gate ran in 4 to 23 seconds per PR, well inside the 2 minute budget.
- Nothing in `ci.yml` was changed by this session (out of scope). `nightly.yml` was added.

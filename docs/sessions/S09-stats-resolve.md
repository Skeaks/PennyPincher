---
id: S09
title: Tier resolution + confidence + UNRESOLVED
role: stats
depends_on: [S03]
owns:
  - docs/sessions/S09.outcome.md
  - packages/stats/**
human_review_required: true   # the integrity-critical module
---

## Context

The mathematical core. Given N observations for one cell, infer the discrete price set, the
share of each tier, and the floor, with confidence. When N is insufficient, say `UNRESOLVED`.
A confidently wrong floor is the worst thing this product can do. Test everything against
`packages/synth` ground truth.

## Acceptance

- `resolve(observations): Resolution` where `Resolution` is
  `{ status: "RESOLVED", tiers: {price, share, n}[], floor, confidence }` or
  `{ status: "UNRESOLVED", reason, n, needed }`.
- Tier detection: cluster prices exactly (integer cents), drop singletons below a documented
  threshold as noise, and cap at 8 tiers.
- Confidence: coupon-collector based. Expected draws to see all k tiers is `k·H_k`; require
  `N >= ceil(k·H_k · 1.5)` for `RESOLVED` (the 1.5 is a named constant with a comment; it is
  not a magic number). `needed` reports the shortfall.
- Floor guard: `RESOLVED` additionally requires that the rarest observed tier has `n >= 3`.
  Otherwise `UNRESOLVED` with reason `"rare_tier_unconfirmed"`.
- Time window: only observations within `windowHours` (default 72) count. A `windowHours`
  option, documented.
- Property test (fast-check) over synth: 1,000 seeds, k in 2..5, N random in 1..200: **never**
  reports a floor below the true floor; reports `RESOLVED` with the wrong tier count in fewer
  than 2% of seeds at N above threshold. Numbers recorded in the test names.
- A `explain(resolution): string` that produces the plain-English line the UI will show,
  including N. No savings language.

## Out of scope

- Change-point / test-window detection (S10).
- Any UI (S11).
- Fee or basket math (phase 2).

---
id: S03
title: Schema 1.0.0 + synthetic ladders
role: schema, stats
depends_on: [S02]
owns:
  - docs/sessions/S03.outcome.md
  - packages/schema/**
  - packages/synth/**
  - docs/migrations/**
human_review_required: true   # schema
---

## Context

Part A: revise `packages/schema` against the real pages in `fixtures/`. Every field should be
either observable on at least one retailer's page or justified as context. Tag `1.0.0`.

Part B: `packages/synth` generates price ladders with known ground truth so the stats engine
(S09) can be tested against answers known by construction, months before real data exists.

## Acceptance

Schema:
- Every field in `PriceObservation` has a comment naming which fixture(s) show it, or "context".
- Fields no fixture supports are removed or made optional with a written reason.
- `SCHEMA_VERSION = "1.0.0"`, `docs/migrations/1.0.0.md` written, all tests green.

Synth:
- `generateLadder({ tiers, probabilities, floorRarity, seed })` returns
  `{ truth: { prices: number[], probabilities: number[] }, sample(n): PriceObservation[] }`.
- Sampling is i.i.d. from the tier distribution, deterministic per seed.
- A `plantFloor` option puts one tier at a chosen rarity `p` so floor-detection tests can ask
  "did we find it at ~3/p observations".
- Optional serial correlation knob (`stickiness`) to model hash-stable assignment for repeat
  observers, documented as "real panels are worse than i.i.d.".
- Produces valid `PriceObservation`s (schema test), with `panelistId` distinct per observer.
- README with the coupon-collector formulas (`k·H_k`, `~3/p`) and a table of expected N for
  k = 2..5, p = 0.02..0.5.

## Out of scope

- Any resolution logic (S09). Synth only generates.

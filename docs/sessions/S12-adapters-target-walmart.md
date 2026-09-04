---
id: S12
title: Adapters 2 and 3 + health beacon
role: capture
depends_on: [S05]
owns:
  - docs/sessions/S12.outcome.md
  - apps/extension/src/capture/adapters/target.ts
  - apps/extension/src/capture/adapters/walmart.ts
  - apps/extension/src/capture/health.ts
  - apps/extension/test/capture/**
  - apps/api/src/routes/health.ts
human_review_required: true
---

## Acceptance

- Target and Walmart adapters pass every fixture under `fixtures/target/` and
  `fixtures/walmart/`, same contract as S05.
- Health beacon: per adapter, count `attempted`, `extracted`, `failed` (by reason) in local
  storage; upload as a daily summary to `POST /v1/adapter-health` (no observation data, no
  identifiers beyond `clientVersion` and adapter version). API stores it in a `adapter_health`
  table. A one-line `GET /v1/adapter-health` returns the last 7 days per adapter.
- Graceful degradation: a DOM change that breaks extraction produces a `failed` count, never a
  thrown error, never a partial observation.

## Out of scope

- Amazon, Safeway, Kroger. Add after the pilot picks its second retailer.

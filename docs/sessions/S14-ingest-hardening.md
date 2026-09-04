---
id: S14
title: Ingest hardening + deletion
role: ingest, capture
depends_on: [S07]
owns:
  - docs/sessions/S14.outcome.md
  - apps/api/**
  - apps/extension/src/identity/**
---

## Acceptance

- Rate limit: per token and per `panelistId`, 1,000 observations per hour, 429 beyond.
- Semantic dedup: same `panelistId + cellKey + price` within 10 minutes is stored once
  (`duplicates` counter). Repeat views must not inflate N.
- Abuse guard: a `panelistId` whose observations for one cell all show a price outside the
  cell's observed range by more than 50% is flagged `suspect` and excluded from `resolve()`
  until reviewed. Logged, not silently dropped.
- Panelist rotation: extension mints a new `panelistId` every 7 days, keeps the last 4 locally.
  `DELETE /v1/panelists/:id` removes all rows for that id; the extension's "Delete my data"
  calls it for every id it has ever used, then clears local state. Test end to end with the
  in-memory repo.
- `docs/data-retention.md`: what is stored, for how long (raw 90 days, aggregates
  indefinitely), how deletion works.

## Out of scope

- Accounts or login. The pilot is anonymous by design.

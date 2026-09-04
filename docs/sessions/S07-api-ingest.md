---
id: S07
title: Ingest API
role: ingest
depends_on: [S03]
owns:
  - apps/api/**
---

## Context

Hono on Cloudflare Workers with D1. One endpoint that accepts an `ObservationBatch`, validates
it with `parseObservationBatch` (PII guard included), and stores it idempotently.

## Acceptance

- `apps/api` with `wrangler.toml` committed (two environments: `staging`, `production`), D1
  binding `DB`, no secrets in the file.
- `POST /v1/observations`: body is `ObservationBatch`. 400 with the error list on failure.
  201 `{ accepted, duplicates }` on success. `observationId` is the primary key; duplicates are
  counted, not errors.
- `GET /healthz` returns `{ ok: true, schemaVersion }`.
- D1 migration `0001_observations.sql`: table `observations` with columns for every top-level
  field plus a `cell_key` = `retailer|retailerStoreId|retailerSku|fulfillment|zip3` (nulls as
  empty) and an index on `(cell_key, observed_at)`. `raw_json` column holds the full validated
  payload.
- Repository layer `src/repo/observations.ts` with an interface; D1 implementation; an
  in-memory implementation used by tests.
- Tests: valid batch stored; PII batch rejected; duplicate ids counted; unknown schema version
  rejected; batch over 200 rejected. Run with Vitest and the in-memory repo. No network.
- `pnpm --filter api dev` serves locally with `wrangler dev`.

## Out of scope

- Auth. The pilot uses a per-build shared bearer token set in S08; the endpoint is open in dev.
- Rate limiting, abuse, dedup beyond id (S14).
- Query endpoints (S11).

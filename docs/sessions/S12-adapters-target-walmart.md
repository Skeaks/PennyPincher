---
id: S12
title: Adapters 2 and 3 + health beacon
role: capture
depends_on: [S05, S17, S11]
owns:
  - docs/sessions/S12.outcome.md
  - apps/extension/src/capture/adapters/target.ts
  - apps/extension/src/capture/adapters/walmart.ts
  - apps/extension/src/capture/registry.ts
  - apps/extension/src/capture/health.ts
  - apps/extension/src/entrypoints/target.content.ts
  - apps/extension/src/entrypoints/walmart.content.ts
  - apps/extension/test/capture/**
  - apps/api/src/routes/adapter-health.ts
  - apps/api/migrations/0002_adapter_health.sql
  - apps/api/test/adapter-health.test.ts
human_review_required: true
---

## Context

Two more retailers on the direct sites (target.com, walmart.com), plus the telemetry that
tells us when a retailer's DOM change has silently broken capture. Build on what S17 added:
`capture/jsonld.ts` (JSON-LD first), `capture/tiles.ts` (listing tiles) and
`capture/tally.ts` (per-page counts). Do not fork them; if a retailer needs a variant, extend
the shared module.

Read the fixture sidecars first. Two traps are recorded there: Target renders the price box
lazily (`[data-test="product-price"]` is an empty skeleton until scroll), and Walmart never
renders a store number, only a label, so `store` is label-only on Walmart (schema 1.0.0
allows it).

## Acceptance

Adapters:
- Target and Walmart adapters implement the S05 `Adapter` contract and pass every fixture
  under `fixtures/target/` and `fixtures/walmart/` (sidecar `expected` block, same test shape
  as `test/capture/instacart.test.ts`).
- JSON-LD first where the page has a `Product` block; DOM selectors documented at the top of
  each adapter file, as the Instacart adapter does.
- Listing tiles and the product modal/quick-view, where the retailer has them, go through
  `capture/tiles.ts`. If no fixture shows a tile or modal for a retailer, say so in the retro
  and ask Jamie for a capture; do not guess selectors.
- Content-script entrypoints `target.content.ts` and `walmart.content.ts` are shims over
  `capture/run.ts`, like the Instacart one. Manifest host permissions already cover both.
- `capture/registry.ts` lists all three adapters; the runner picks by `matches(url)`.

Health beacon:
- `capture/health.ts`: per adapter, `attempted`, `extracted`, `failed` by reason, kept in
  `chrome.storage.local`, reset after each successful upload. Reuse `capture/tally.ts` for
  the counting if it already covers it.
- Uploaded once a day through the existing `sync/transport.ts` (add a `postAdapterHealth`
  function there). **No new `fetch` call site**: `test/probe/posture.test.ts` pins exactly two
  files and this session does not change that pin. Payload carries `clientVersion`, adapter
  name and version, the counts, and a UTC date. No observation data, no ids.
- API: `POST /v1/adapter-health` (bearer-gated like ingest) stores rows in `adapter_health`
  (migration `0002`); `GET /v1/adapter-health` returns the last 7 days per adapter as
  `{ adapter, date, attempted, extracted, failed }[]`. Tests on the memory repo. Coordinate:
  S14 also edits `apps/api`; keep this PR to the three API files listed in `owns:`.
- Graceful degradation test: an adapter given a fixture with its price container removed
  returns `{ ok: false, reason }`, increments `failed`, and never throws or emits a partial
  observation.

## Out of scope

- Amazon, Safeway, Kroger. After the pilot picks its second retailer.
- Any popup change beyond what `tiles.ts` already renders.

## Note on the Target pair

`fixtures/target/banana-each*` were captured at different stores (Princeton vs Durham). The
probe already handles that as `STORE_DIFFERS`; the adapter's job here is only to extract the
store id from each page correctly so that verdict fires.

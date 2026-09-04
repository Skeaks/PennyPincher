---
id: S05
title: Adapter interface + Instacart adapter
role: capture
depends_on: [S02, S03, S04]
owns:
  - apps/extension/src/capture/**
  - apps/extension/test/capture/**
human_review_required: true   # capture code is a human-locked path
---

## Context

An adapter turns a rendered product page into a `PriceObservation`. This session defines the
interface once and implements it for Instacart, tested only against `fixtures/instacart/*`.

## Acceptance

- `Adapter` interface: `{ name, version, matches(url): boolean, extract(doc: Document,
  ctx: PageContext): ExtractResult }` where `ExtractResult` is `{ ok: true, observation }` or
  `{ ok: false, reason }`. Adapters never throw.
- `PageContext` carries what the content script knows: url, fulfilment (from the page), session
  state (from the page's own logged-in indicator, never from cookies), surface, device class.
- Instacart adapter extracts: retailerSku, title, brand, sizeText, price, wasPrice, promoTags,
  memberPrice, store (retailer slug), unitPriceText. Zip3 only if the page displays a ZIP.
- `evidenceHash` = SHA-256 of the scrubbed price-container `outerHTML` (reuse the scrub rules
  from `tools/scrub` as a shared function if practical, otherwise a minimal in-extension scrub).
- Test: every fixture in `fixtures/instacart/` extracts to an observation whose fields match
  its `.meta.json` `expected` block. A fixture that fails is a failing test, not a skipped one.
- Content script: on product page load (and on SPA route change via `MutationObserver` with a
  500 ms debounce), run the matching adapter, write to the local store. Passive only: no
  clicks, no navigation, no fetch.
- Capture is gated on consent (S04). Verified by a test.

## Out of scope

- Other retailers (S12).
- Uploading observations (S11).
- The lever probe (S06).

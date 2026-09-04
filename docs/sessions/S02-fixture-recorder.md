---
id: S02
title: Fixture recorder + first snapshots
role: capture
depends_on: [S00]
owns:
  - docs/sessions/S02.outcome.md
  - tools/scrub/**
  - fixtures/**
  - docs/fixtures.md
human_review_required: true   # fixtures are ground truth
---

## Context

Tests run against recorded retailer pages, never live sites (rate limits, ToS, flakiness). But
raw saved pages contain the recorder's name, address, cart, and session tokens. This session
builds the scrubber and commits the first clean snapshots.

Jamie records the raw pages (agents must not browse retailers on the user's behalf). The
procedure: open the product page in Chrome, DevTools, right-click `<html>`, "Copy outerHTML",
save to `fixtures/raw/<retailer>/<slug>.html`. `fixtures/raw/` is gitignored.

## Acceptance

- `tools/scrub` is a Node CLI: `pnpm scrub fixtures/raw/instacart/bananas.html` writes
  `fixtures/instacart/bananas.html` with:
  - all `<script>`, `<style>`, `<link>`, `<meta>`, `<iframe>`, `<svg>`, `<img src>` removed
  - every attribute except `id`, `class`, `data-*`, `href`, `aria-*`, `itemprop` removed
  - `href` values reduced to path only
  - any text node matching an email, phone, or 5-digit ZIP replaced with `[scrubbed]`
  - any greeting containing a first name (`Hi, James`, `Hello James`, `Welcome back, James`)
    replaced with `[scrubbed]`; the name list is a CLI flag (`--name James`) so nothing
    personal is hard-coded in the tool
  - store labels that embed a street address or full ZIP (Walmart's default-store header)
    reduced to the store's city or id
  - a `fixtures/<retailer>/<slug>.meta.json` with `{retailer, capturedAt, fulfillment,
    sessionState, zip3, store: {retailerStoreId, label}, expected: {price, title,
    retailerSku}}` filled by hand from `fixtures/raw/CAPTURE-LOG.md`. `store` is required:
    the Target logged-in/logged-out pair was captured at different stores (Durham vs
    Princeton), so any test comparing the pair must be able to see that
- A `--check` mode that fails if any output file matches the PII patterns. Runs in `pnpm gate`
  via a new `test` in `tools/scrub`.
- At least 3 snapshots each for Instacart, Target, Walmart (product page, logged in), and at
  least 1 logged-out snapshot per retailer, all with `.meta.json`.
- `docs/fixtures.md` explains the recording procedure and the scrub guarantees.

## Known traps (from the raw captures)

- Target renders the price box lazily. A capture before scroll has an empty skeleton where
  `[data-test="product-price"]` should be. The raw files were captured after render; the
  scrubber's `--check` should fail a file whose expected price text is not present.
- Logged-in pages carry the account first name in the header and, on Walmart, the default
  store with ZIP. The `--check` PII patterns must include the `--name` list and 5-digit ZIPs.
- Raw files are 300 KB to 1.2 MB. Scrubbed output should be well under 200 KB each; if not,
  the attribute and script stripping is not working.

## Out of scope

- Parsing prices from the fixtures (S05).
- Search result or cart pages. Product pages only.

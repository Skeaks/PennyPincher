---
id: S02
title: Fixture recorder + first snapshots
role: capture
depends_on: [S00]
owns:
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
  - a `fixtures/<retailer>/<slug>.meta.json` with `{retailer, capturedAt, fulfillment,
    sessionState, zip3, expected: {price, title, retailerSku}}` filled by hand
- A `--check` mode that fails if any output file matches the PII patterns. Runs in `pnpm gate`
  via a new `test` in `tools/scrub`.
- At least 3 snapshots each for Instacart, Target, Walmart (product page, logged in), and at
  least 1 logged-out snapshot per retailer, all with `.meta.json`.
- `docs/fixtures.md` explains the recording procedure and the scrub guarantees.

## Out of scope

- Parsing prices from the fixtures (S05).
- Search result or cart pages. Product pages only.

---
id: S06
title: Lever probe v1
role: capture
depends_on: [S05]
owns:
  - docs/sessions/S06.outcome.md
  - apps/extension/src/probe/**
  - apps/extension/src/popup/**
  - apps/extension/test/probe/**
human_review_required: true   # capture posture
---

## Context

Track A. The individual-value feature that works at N=1 and starts producing the data for the
S16 go/pivot decision. When the user views a product, the background script fetches the same
public product page **logged out** and compares. Read ADR 0003 before writing a line.

## Acceptance

- Background: on a new observation from the content script, if the user is `logged_in`,
  `fetch(product.url, { credentials: "omit", cache: "no-store" })` at most once per
  `retailerSku` per hour (`chrome.alarms` + a small rate table in storage). Parse the response
  with the same adapter (`DOMParser`). Store the result as a second observation with
  `sessionState: "logged_out"`, `cleanSession: true`, same `panelistId`.
- If the logged-out page has no price (login wall, bot check, different layout), record
  `{ ok: false, reason }` in a `probeFailures` counter per retailer and do nothing else. Never
  retry within the hour. Never follow redirects to auth pages.
- **Same-store rule.** A comparison is only valid when the logged-out page resolved to the
  same `store.retailerStoreId` as the logged-in observation. Retailers assign a store on
  login (Target moved Jamie from Princeton to Durham on sign-in during S02's captures, and the
  banana went from $0.39 to $0.29 with it). If the stores differ, the result is
  `STORE_DIFFERS`, shown as "Anonymous visitors are served a different store", and the pair is
  still stored (both observations, with their stores) because the panel can use it.
- Popup (minimal): for the current tab's product, show "Your price", "Anonymous price", and one
  of: `Same`, `You pay $X more`, `You pay $X less`, `Store differs`, `Could not check`. No
  savings language.
- A `probes` summary in options: per retailer, checks run, differences found, failures.
- Tests on fixtures: logged-in fixture + logged-out fixture for the same SKU produce the
  expected comparison; the Target banana pair produces `STORE_DIFFERS`; a login-wall fixture
  produces `Could not check`.
- `scripts/check-forbidden-api.sh` clean. Manifest unchanged except `alarms` (already present).

## Out of scope

- ZIP or fulfilment probes (they need the panel or a UI to vary them; later).
- Uploading probe results (S11 uploads all observations uniformly).
- Any claim copy. The words "save" and "cheaper" do not appear.

## Decision data

From this session on, Jamie's own usage produces a table: retailer, SKU, logged-in price,
logged-out price. Ten SKUs across three retailers over a week is enough to know whether Track A
has a story before S16.

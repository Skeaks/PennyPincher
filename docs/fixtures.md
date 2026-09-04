# Fixtures: recorded retailer pages

Tests run against recorded product pages under `fixtures/<retailer>/`, never against live
sites. A recorded page is a real render, with everything that could identify the recorder or
change between loads removed by `tools/scrub`. The scrubbed pages are ground truth: agents never
edit them (CLAUDE.md rule 3), and a PR that adds or changes one waits for Jamie's
`fixtures-reviewed` label.

## Recording a page (a human does this)

Agents must not browse retailers on the user's behalf (ADR 0003), so raw pages are recorded by
hand.

1. Open the product page in Chrome. For a logged-in capture, be signed in; for a logged-out
   capture, use a fresh profile or sign out first. Scroll until the price box has rendered.
   Target renders it lazily: a capture taken before scroll has an empty skeleton where
   `[data-test="product-price"]` should be, and `--check` will reject it.
2. DevTools, Elements tab, right-click `<html>`, Copy, Copy outerHTML. Or in the console:
   `copy(document.documentElement.outerHTML)`.
3. Save to `fixtures/raw/<retailer>/<slug>.html`. A logged-out capture ends in `-logged-out`.
   `fixtures/raw/` is gitignored and never leaves your machine.
4. Add a row to `fixtures/raw/CAPTURE-LOG.md`: file, URL, session state, fulfilment shown,
   store, and the price you saw. The sidecar below is filled from this row.
5. Scrub:

   ```bash
   pnpm scrub fixtures/raw/target/banana-each.html --name <your first name> --name <your username>
   ```

   This writes `fixtures/target/banana-each.html` and, if none exists, a
   `banana-each.meta.json` template. `--name` is any word that identifies you on the page
   (the account first name in the header, a username). It is never stored anywhere.
6. Fill the sidecar from the capture log, then confirm:

   ```bash
   pnpm scrub --check --name <your first name>
   ```

7. Before committing, open the scrubbed file and search it for your name, street, and ZIP.
   The check is a net, not a proof; you are the last line.

## The sidecar: `<slug>.meta.json`

```json
{
  "retailer": "target",
  "capturedAt": "2026-09-04T15:26:18Z",
  "fulfillment": "pickup",
  "sessionState": "logged_in",
  "zip3": "085",
  "store": { "retailerStoreId": "1872", "label": "Durham" },
  "expected": {
    "price": { "amountMinor": 29, "currency": "USD" },
    "priceText": "$0.29",
    "title": "Fresh Banana - each - Good & Gather™",
    "retailerSku": "15013944"
  },
  "notes": "optional"
}
```

- `fulfillment`, `sessionState` and `zip3` use the same vocabulary as `packages/schema`.
- `store` is required. A login can reassign the store: the Target banana pair was priced at
  Princeton (logged out, $0.39) and Durham (logged in, $0.29). Any test that compares two
  fixtures must look at `store.retailerStoreId` before calling a difference a price difference.
- `expected.priceText` and `expected.title` must appear verbatim in the scrubbed page's text.
  `expected.price` is minor units and must agree with `priceText`.
- `store.label` is a city or store name, never a street address or full ZIP.

## What the scrubber guarantees

`tools/scrub/src/scrub.ts` is a pure function over the HTML. The same rules drive both the
scrub and `--check`, so the two cannot disagree. On every page:

- `<script>`, `<style>`, `<link>`, `<meta>`, `<iframe>`, `<svg>`, `<img>`, `<noscript>`,
  `<template>` and HTML comments are removed with their subtrees. This is where the bulk of the
  PII lives: the retailers' hydration state (`__NEXT_DATA__`, Apollo cache) carries customer
  ids, usernames, store assignments and full ZIPs.
- Every attribute except `id`, `class`, `data-*`, `href`, `aria-*` and `itemprop` is removed.
  Inline styles, event handlers, `src`, `srcset`, `content`, `value` all go.
- `href` is reduced to its path. No origin, query string or fragment. `mailto:`, `tel:`,
  `javascript:` and `data:` hrefs are dropped.
- In every text node and every kept attribute value, these are replaced with `[scrubbed]`:
  emails, US phone numbers, 5-digit ZIPs (with or without +4), street addresses
  (`500 Nassau Park Blvd`, `839 US HIGHWAY 130`), greetings followed by a capitalised word
  (`Hi, James`, `Hello James`, `Welcome back, James`, `Hi, James L`), and any word containing
  a `--name` value (`James`, `jamesjlee04`, `James's`).
- A value that is a store label ending in a full ZIP (`Princeton, NJ 08540`,
  `839 US Highway 130, East Windsor, NJ 08520`) is reduced to the city (`Princeton`,
  `East Windsor`).
- `id` and `class` values are exempt from the ZIP, phone and address rules only. Generated
  class names contain 5-digit hashes, and rewriting them would break selectors. They are still
  checked for emails, greetings and names.

## What `--check` verifies (runs in `pnpm gate`)

`tools/scrub/test/fixtures.test.ts` runs `checkFixtureDir` over `fixtures/` on every PR. For
each `.html` it asserts:

- none of the dropped tags, comments or disallowed attributes are present;
- no email, phone, ZIP, street address or greeting pattern anywhere in text or kept
  attributes;
- the file is under 400 KB (raw captures are 300 KB to 1.2 MB; Instacart and Target scrub
  to 45 to 65 KB, Walmart to 175 to 305 KB because its product pages carry about 4,000
  elements of utility classes);
- a `.meta.json` exists, validates, matches its directory and slug, and its `priceText` and
  `title` appear in the page text;
- each of Instacart, Target and Walmart has at least three logged-in and one logged-out page.

The gate check runs without a name list, because a name list would have to live in the repo.
It catches greetings by shape (`Hi, <Capitalised>`), which is how every retailer header
renders the account name. A bare first name elsewhere on the page (Target's `display-name`
span) is only caught when the recorder passes `--name`, which is why step 7 exists.

## Known limits

- 5-digit review counts and 5-digit ids in nav link paths are scrubbed too. A ZIP is
  indistinguishable from them, and a false `[scrubbed]` in a review count costs nothing.
- Whitespace-only text nodes are kept as recorded, so `textContent` matches the live page.
- The scrubber does not remove non-product regions (recommendation carousels, footers). That
  would be a retailer-specific judgement about ground truth, which is a human call.
- Instacart, Target and Walmart product pages only. Search and cart pages are out of scope.

## Current snapshots (2026-09-04)

| retailer | logged in | logged out | store |
|---|---|---|---|
| instacart | wegmans-bananas, wegmans-organic-strawberries-16oz, wegmans-red-seedless-grapes | wegmans-bananas-logged-out | Wegmans (10769), delivery |
| target | banana-each, organic-bananas-2lb, hass-avocados-4ct | banana-each-logged-out | Durham (1872) logged in, Princeton (1151) logged out, pickup |
| walmart | fresh-banana-each, marketside-organic-bananas-bunch, great-value-sliced-bananas-frozen-16oz | fresh-banana-each-logged-out | East Windsor Supercenter (3266), pickup |

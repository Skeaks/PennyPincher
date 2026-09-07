---
id: S17
title: Instacart capture surfaces: product modal, search tiles, anonymous HTML
role: capture
depends_on: [S06]
owns:
  - docs/sessions/S17.outcome.md
  - apps/extension/src/capture/**
  - apps/extension/src/probe/**
  - apps/extension/test/capture/**
  - apps/extension/test/probe/**
human_review_required: true   # capture code
---

## Context

Jamie's first real use of the extension (2026-09-07, Instacart with the Walmart storefront)
found three gaps. All three are in `fixtures/raw/CAPTURE-LOG.md`, "2026-09-07 additions".

1. **The product modal.** Clicking a tile opens Instacart's product overlay. The URL changes
   to `/products/<sku>-...` but the DOM is a modal with a "Back" control, not the standalone
   page the adapter was written against. Nothing is recorded. Only a full reload renders the
   standalone page. Most shoppers never leave the modal, or never open it at all.
2. **Search and aisle tiles.** Search results show a price on every tile ($4.95, $2.55, a
   "Rollback $4.78 was $5.32"). Shoppers add to cart from tiles with "+". Nothing captures
   tile prices, which is most of what a shopper is shown.
3. **The probe's anonymous HTML.** The S06 probe fetches the product page without credentials
   and got "The anonymous page showed no price". The raw HTML does contain the price: a
   `Current price: $4.95` screen-reader span inside `#item_details`, and a JSON-LD
   `<script type="application/ld+json">` with `Product.offers.price = "4.95"`, `brand`,
   `size`, and `name`. What it lacks is `id="item_details-items_<store>-<sku>"` and the
   `[aria-label="service type"]` fulfilment control. Parsing failed, not fetching. The raw
   fetch is saved as `fixtures/raw/instacart/walmart-whole-milk-1gal-anonymous-fetch.html`.

## Acceptance

Fixtures (Jamie records the logged-in ones; the session scrubs and commits all three):
- `fixtures/instacart/walmart-whole-milk-1gal-modal.html`: the product modal open over a
  search page, logged in.
- `fixtures/instacart/walmart-search-milk.html`: the search results page for "Milk", logged
  in, showing at least one "Rollback" tile with a struck-through was-price.
- `fixtures/instacart/walmart-whole-milk-1gal-anonymous-fetch.html`: the raw fetch above.
  Its sidecar records `sessionState: logged_out`, `cleanSession: true`.

Adapter:
- **JSON-LD first.** When a `Product` JSON-LD block is present, title, brand, size and price
  come from it; DOM selectors fill the rest and act as the fallback. Evidence hash covers the
  JSON-LD script text when it was the source.
- **Modal.** Detect the product modal (URL matches `/products/` and the modal container is
  present without the standalone `#item_details` layout, or however the fixture shows it),
  extract the same fields, and record `surface` context unchanged (`web`). One observation per
  modal open, deduped by the existing per-rendering rule.
- **Tiles.** On search and aisle pages, extract one observation per product tile that shows a
  price: sku from the tile's product link, title, price, `wasPrice` when struck through,
  `promoTags` such as "Rollback". Store comes from the storefront header. `fulfillment` from
  the page's Delivery/Pickup control when present.
- **Missing fulfilment.** When the page shows no Delivery/Pickup control (anonymous HTML,
  some tiles), fall back to `delivery`, which is Instacart's default, and set a new
  `context.fulfillmentInferred: true`. This is an additive optional field: bump the schema to
  `1.1.0` with `docs/migrations/1.1.0.md` (touches `packages/schema`; Jamie reviews).
- The anonymous-fetch fixture extracts to a valid observation with price 495 cents, brand
  "Great Value", size "1 gal", store label "Walmart", `sessionState: logged_out`.

Probe:
- With the adapter fix, the probe on the milk page produces a real comparison instead of
  "Could not check". A test runs the probe pipeline with the logged-in modal fixture and the
  anonymous-fetch fixture for the same SKU and asserts a verdict, not a failure.

Popup:
- On a search or aisle page, the popup says how many prices on this page were recorded (no
  comparison; that is per product).

## Out of scope

- Target and Walmart direct-site adapters (S12), which will need the same three surfaces.
  Write the tile and modal handling so an adapter can reuse it.
- Any change to the probe's fetch posture (ADR 0003). Only the parser changes.

## Why this is next

Until this lands, the extension records almost nothing from real shopping, and the lever
probe produces no decision data. S09 (stats) is independent and can run in parallel.

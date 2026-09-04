---
id: S13
title: Product identity
role: ingest
depends_on: [S07]
owns:
  - packages/normalize/**
  - apps/api/src/repo/products.ts
human_review_required: true   # golden fixtures
---

## Context

The same banana is `item_123` on Instacart and `A-5432` at Target. Cross-retailer ladders (and
phase 2's basket optimizer) need a canonical product id. UPC when present, fuzzy title + brand
+ size otherwise.

## Acceptance

- `canonicalize(product: ProductRef): { canonicalId, method: "upc" | "fuzzy" | "none",
  confidence }`. UPC normalised to GTIN-14. Fuzzy uses token-set similarity on
  `brand + title + sizeText` with size units normalised (fl oz, oz, ct, lb, g, ml).
- `packages/normalize/__golden__/pairs.json`: 100 hand-labelled same/different pairs across
  the three retailers (Jamie labels; the session builds the harness and proposes candidates).
  Precision on "same" >= 0.97 on the golden set; recall reported.
- API: `products` table keyed by `canonicalId`; ingest stores `canonical_id` on each
  observation; `cell_key` gains an alternative `canonicalCellKey` for cross-retailer queries.

## Out of scope

- Anything cross-retailer in the UI.

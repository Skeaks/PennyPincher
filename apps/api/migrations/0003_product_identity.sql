-- 0003: product identity (S13). Additive; 0001 and 0002 are untouched.
--
-- 1. products: one row per canonical product id from @pennypincher/normalize. `gtin:<14>`
--    when a page showed a UPC, `fuzzy:<tokens>@<size>` otherwise. The row keeps the FIRST
--    reference that minted the id as its representative (title, brand, size, upc), the method
--    and confidence of that first resolution, and when it was first and last seen. No
--    panelist, price or URL: nothing here is personal or per-observation, so retention and
--    DELETE /v1/panelists/:id leave it alone.
-- 2. product_skus: (retailer, retailerSku) -> canonical_id. Once a SKU has been resolved it
--    keeps its id, so a SKU never drifts between products as the products table grows.
--    sku_key = retailer|retailerSku.
-- 3. product_tokens: inverted index of each product's normalised title tokens, used to pull
--    fuzzy-match candidates ("products sharing a token with this one") in one query.
-- 4. observations gains canonical_id and canonical_cell_key = canonicalId|fulfillment|zip3,
--    the cross-retailer cell (retailer and store dropped on purpose), indexed like cell_key.
--    Both are nullable: rows ingested before this migration, and titles that normalise to
--    nothing, carry NULL.
CREATE TABLE IF NOT EXISTS products (
  canonical_id  TEXT PRIMARY KEY,
  method        TEXT    NOT NULL,
  confidence    REAL    NOT NULL,
  title         TEXT    NOT NULL,
  brand         TEXT,
  size_text     TEXT,
  upc           TEXT,
  first_seen_at TEXT    NOT NULL,
  last_seen_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS product_skus (
  sku_key      TEXT PRIMARY KEY,
  retailer     TEXT NOT NULL,
  retailer_sku TEXT NOT NULL,
  canonical_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS product_skus_canonical_id
  ON product_skus (canonical_id);

CREATE TABLE IF NOT EXISTS product_tokens (
  token        TEXT NOT NULL,
  canonical_id TEXT NOT NULL,
  PRIMARY KEY (token, canonical_id)
);

ALTER TABLE observations ADD COLUMN canonical_id TEXT;
ALTER TABLE observations ADD COLUMN canonical_cell_key TEXT;

CREATE INDEX IF NOT EXISTS observations_canonical_cell_key_observed_at
  ON observations (canonical_cell_key, observed_at);

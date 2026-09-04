-- 0001: the observations table. One row per PriceObservation (schema 1.0.0).
--
-- observation_id is the primary key and the ingest idempotency key: INSERT OR IGNORE makes a
-- resend a no-op that the API reports as a duplicate, never an error.
--
-- Every top-level field of the observation has a column; nested objects (store, product, facts,
-- context, provenance) are flattened to the parts the stats engine (S09+) and the query API
-- (S11) filter or group on. raw_json holds the full validated payload, so nothing is lost when
-- a later session wants a field that was not flattened.
--
-- cell_key = retailer|retailerStoreId|retailerSku|fulfillment|zip3, absent parts as empty
-- strings. A "cell" is the unit the price ladder is reconstructed within.
CREATE TABLE IF NOT EXISTS observations (
  observation_id    TEXT PRIMARY KEY,
  schema_version    TEXT    NOT NULL,
  panelist_id       TEXT    NOT NULL,
  observed_at       TEXT    NOT NULL,
  retailer          TEXT    NOT NULL,
  retailer_store_id TEXT,
  store_label       TEXT,
  retailer_sku      TEXT    NOT NULL,
  upc               TEXT,
  title             TEXT    NOT NULL,
  price_minor       INTEGER NOT NULL,
  currency          TEXT    NOT NULL,
  is_estimate       INTEGER NOT NULL,
  fulfillment       TEXT    NOT NULL,
  session_state     TEXT    NOT NULL,
  surface           TEXT    NOT NULL,
  zip3              TEXT,
  device            TEXT    NOT NULL,
  adapter           TEXT    NOT NULL,
  client_version    TEXT    NOT NULL,
  evidence_hash     TEXT    NOT NULL,
  cell_key          TEXT    NOT NULL,
  raw_json          TEXT    NOT NULL,
  received_at       TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS observations_cell_key_observed_at
  ON observations (cell_key, observed_at);

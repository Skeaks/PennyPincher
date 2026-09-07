-- 0002: ingest hardening (S14). Three additions, all additive; 0001 is untouched.
--
-- 1. An index on (panelist_id, observed_at). Semantic dedup reads a panelist's recent rows on
--    it; DELETE /v1/panelists/:id deletes on it.
-- 2. rate_buckets: fixed one-hour windows, one row per (bucket key, window start). The key is
--    "token:<sha256 prefix>" for the bearer or "panelist:<panelistId>". The retention job
--    drops windows older than two hours.
-- 3. panelist_flags: the abuse guard's log. A panelist is "suspect" until a human sets
--    reviewed_at (and status to "cleared" or leaves it "suspect"). The query API excludes
--    unreviewed suspects from resolve(); their rows stay in observations.
CREATE INDEX IF NOT EXISTS observations_panelist_id_observed_at
  ON observations (panelist_id, observed_at);

CREATE INDEX IF NOT EXISTS observations_received_at
  ON observations (received_at);

CREATE TABLE IF NOT EXISTS rate_buckets (
  bucket_key   TEXT    NOT NULL,
  window_start TEXT    NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE TABLE IF NOT EXISTS panelist_flags (
  panelist_id TEXT PRIMARY KEY,
  status      TEXT NOT NULL,
  reason      TEXT NOT NULL,
  cell_key    TEXT NOT NULL,
  flagged_at  TEXT NOT NULL,
  reviewed_at TEXT,
  review_note TEXT
);

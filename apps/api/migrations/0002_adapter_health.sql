-- 0002: adapter health (S12). One row per adapter per daily report from one client.
--
-- The extension counts, per adapter, how many captures it attempted, how many yielded an
-- observation and how many failed by reason, and posts the counts once a day. GET
-- /v1/adapter-health sums the last 7 days per adapter and date. Nothing here identifies a
-- panelist or an observation: no ids, no URLs, no prices.
--
-- adapter is `name@version` (the observation's provenance.adapter), so a release that broke a
-- selector stands apart from the one before it. failed_json is {"<reason>": n}.
CREATE TABLE IF NOT EXISTS adapter_health (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  adapter        TEXT    NOT NULL,
  client_version TEXT    NOT NULL,
  date           TEXT    NOT NULL,
  attempted      INTEGER NOT NULL,
  extracted      INTEGER NOT NULL,
  failed_json    TEXT    NOT NULL,
  received_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS adapter_health_date_adapter
  ON adapter_health (date, adapter);

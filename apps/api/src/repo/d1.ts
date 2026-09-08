import type {
  DeleteResult,
  InsertResult,
  ObservationRepo,
  ObservationRow,
  PanelistFlag,
  PurgeResult,
  RateDemand,
} from "./observations";

type Bindable = string | number | null;

/**
 * Column name and how to read it off a row, in one place so the INSERT column list and its
 * bindings cannot drift. Must match migrations/0001_observations.sql (a test checks this).
 */
const COLUMNS: ReadonlyArray<readonly [string, (r: ObservationRow) => Bindable]> = [
  ["observation_id", (r) => r.observationId],
  ["schema_version", (r) => r.schemaVersion],
  ["panelist_id", (r) => r.panelistId],
  ["observed_at", (r) => r.observedAt],
  ["retailer", (r) => r.retailer],
  ["retailer_store_id", (r) => r.retailerStoreId],
  ["store_label", (r) => r.storeLabel],
  ["retailer_sku", (r) => r.retailerSku],
  ["upc", (r) => r.upc],
  ["title", (r) => r.title],
  ["price_minor", (r) => r.priceMinor],
  ["currency", (r) => r.currency],
  ["is_estimate", (r) => (r.isEstimate ? 1 : 0)],
  ["fulfillment", (r) => r.fulfillment],
  ["session_state", (r) => r.sessionState],
  ["surface", (r) => r.surface],
  ["zip3", (r) => r.zip3],
  ["device", (r) => r.device],
  ["adapter", (r) => r.adapter],
  ["client_version", (r) => r.clientVersion],
  ["evidence_hash", (r) => r.evidenceHash],
  ["cell_key", (r) => r.cellKey],
  ["raw_json", (r) => r.rawJson],
  ["received_at", (r) => r.receivedAt],
  // S13 (migration 0003): absent on a row built without a products repo, stored as NULL.
  ["canonical_id", (r) => r.canonicalId ?? null],
  ["canonical_cell_key", (r) => r.canonicalCellKey ?? null],
];

export const OBSERVATION_COLUMNS: readonly string[] = COLUMNS.map(([name]) => name);

const PLACEHOLDERS = OBSERVATION_COLUMNS.map((_, i) => `?${i + 1}`).join(", ");

export const INSERT_SQL = `INSERT OR IGNORE INTO observations (${OBSERVATION_COLUMNS.join(", ")}) VALUES (${PLACEHOLDERS})`;

const SELECT_SQL = `SELECT ${OBSERVATION_COLUMNS.join(", ")} FROM observations WHERE observation_id = ?1`;

/**
 * One cell's rows in a time range, on the (cell_key, observed_at) index. The bounds compare
 * ISO-8601 strings: the schema pins `observedAt` to the UTC "Z" form, so the order is
 * chronological except that "…:18Z" sorts after "…:18.000Z". `listByCell` widens the bounds
 * by a second to cover that and the caller re-filters exactly.
 */
export const SELECT_BY_CELL_SQL = `SELECT ${OBSERVATION_COLUMNS.join(", ")} FROM observations WHERE cell_key = ?1 AND observed_at >= ?2 AND observed_at <= ?3 ORDER BY observed_at`;

/** Same shape on the (panelist_id, observed_at) index from migration 0002 (S14). */
export const SELECT_BY_PANELIST_SQL = `SELECT ${OBSERVATION_COLUMNS.join(", ")} FROM observations WHERE panelist_id = ?1 AND observed_at >= ?2 AND observed_at <= ?3 ORDER BY observed_at`;

/** Same shape on the (canonical_cell_key, observed_at) index from migration 0003 (S13). */
export const SELECT_BY_CANONICAL_CELL_SQL = `SELECT ${OBSERVATION_COLUMNS.join(", ")} FROM observations WHERE canonical_cell_key = ?1 AND observed_at >= ?2 AND observed_at <= ?3 ORDER BY observed_at`;

const BOUND_SLACK_MS = 1_000;

/** DELETE /v1/panelists/:id (S14): everything stored under the id, in one transaction. */
export const DELETE_PANELIST_SQL = [
  "DELETE FROM observations WHERE panelist_id = ?1",
  "DELETE FROM panelist_flags WHERE panelist_id = ?1",
  "DELETE FROM rate_buckets WHERE bucket_key = ?1",
] as const;

/** Create-or-increment on the (bucket_key, window_start) primary key. */
export const RATE_ADD_SQL =
  "INSERT INTO rate_buckets (bucket_key, window_start, count) VALUES (?1, ?2, ?3) ON CONFLICT (bucket_key, window_start) DO UPDATE SET count = count + excluded.count";

const FLAG_COLUMNS = [
  "panelist_id",
  "status",
  "reason",
  "cell_key",
  "flagged_at",
  "reviewed_at",
  "review_note",
] as const;

/** OR IGNORE on the primary key: the first flag on a panelist sticks, later ones are no-ops. */
export const INSERT_FLAG_SQL = `INSERT OR IGNORE INTO panelist_flags (${FLAG_COLUMNS.join(", ")}) VALUES (${FLAG_COLUMNS.map((_, i) => `?${i + 1}`).join(", ")})`;

/** Retention (docs/data-retention.md): raw rows by receipt time, flags by flag time. */
export const PURGE_SQL = {
  observations: "DELETE FROM observations WHERE received_at < ?1",
  flags: "DELETE FROM panelist_flags WHERE flagged_at < ?1",
  buckets: "DELETE FROM rate_buckets WHERE window_start < ?1",
} as const;

/** `?1, ?2, ...` for an IN list, numbered from `from`. */
function placeholders(n: number, from = 1): string {
  return Array.from({ length: n }, (_, i) => `?${from + i}`).join(", ");
}

/** The shape D1 hands back for SELECT_SQL. */
interface DbRecord {
  observation_id: string;
  schema_version: string;
  panelist_id: string;
  observed_at: string;
  retailer: string;
  retailer_store_id: string | null;
  store_label: string | null;
  retailer_sku: string;
  upc: string | null;
  title: string;
  price_minor: number;
  currency: string;
  is_estimate: number;
  fulfillment: string;
  session_state: string;
  surface: string;
  zip3: string | null;
  device: string;
  adapter: string;
  client_version: string;
  evidence_hash: string;
  cell_key: string;
  raw_json: string;
  received_at: string;
  canonical_id: string | null;
  canonical_cell_key: string | null;
}

function fromRecord(d: DbRecord): ObservationRow {
  return {
    observationId: d.observation_id,
    schemaVersion: d.schema_version,
    panelistId: d.panelist_id,
    observedAt: d.observed_at,
    retailer: d.retailer,
    retailerStoreId: d.retailer_store_id,
    storeLabel: d.store_label,
    retailerSku: d.retailer_sku,
    upc: d.upc,
    title: d.title,
    priceMinor: d.price_minor,
    currency: d.currency,
    isEstimate: d.is_estimate === 1,
    fulfillment: d.fulfillment,
    sessionState: d.session_state,
    surface: d.surface,
    zip3: d.zip3,
    device: d.device,
    adapter: d.adapter,
    clientVersion: d.client_version,
    evidenceHash: d.evidence_hash,
    cellKey: d.cell_key,
    rawJson: d.raw_json,
    receivedAt: d.received_at,
    canonicalId: d.canonical_id ?? null,
    canonicalCellKey: d.canonical_cell_key ?? null,
  };
}

interface FlagRecord {
  panelist_id: string;
  status: string;
  reason: string;
  cell_key: string;
  flagged_at: string;
  reviewed_at: string | null;
  review_note: string | null;
}

function fromFlagRecord(d: FlagRecord): PanelistFlag {
  return {
    panelistId: d.panelist_id,
    status: d.status === "cleared" ? "cleared" : "suspect",
    reason: d.reason,
    cellKey: d.cell_key,
    flaggedAt: d.flagged_at,
    reviewedAt: d.reviewed_at,
    reviewNote: d.review_note,
  };
}

/** Bindings for INSERT_SQL, in column order. Exported so a test can pin the mapping. */
export function bindingsFor(row: ObservationRow): Bindable[] {
  return COLUMNS.map(([, read]) => read(row));
}

/**
 * D1-backed repo. One batch = one `db.batch()`, which D1 runs as a single transaction, so a
 * batch either lands whole or not at all. INSERT OR IGNORE on the primary key makes resends
 * idempotent; `meta.changes` tells us which statements actually wrote a row.
 */
export class D1ObservationRepo implements ObservationRepo {
  constructor(private readonly db: D1Database) {}

  async insertMany(rows: ObservationRow[]): Promise<InsertResult> {
    if (rows.length === 0) return { accepted: 0, duplicates: 0 };
    const insert = this.db.prepare(INSERT_SQL);
    const results = await this.db.batch(rows.map((row) => insert.bind(...bindingsFor(row))));
    const accepted = results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
    return { accepted, duplicates: rows.length - accepted };
  }

  async getById(observationId: string): Promise<ObservationRow | undefined> {
    const record = await this.db.prepare(SELECT_SQL).bind(observationId).first<DbRecord>();
    return record ? fromRecord(record) : undefined;
  }

  async listByCell(cellKey: string, from: Date, to: Date): Promise<ObservationRow[]> {
    return this.listRange(SELECT_BY_CELL_SQL, cellKey, from, to);
  }

  async listByPanelist(panelistId: string, from: Date, to: Date): Promise<ObservationRow[]> {
    return this.listRange(SELECT_BY_PANELIST_SQL, panelistId, from, to);
  }

  async listByCanonicalCell(
    canonicalCellKey: string,
    from: Date,
    to: Date,
  ): Promise<ObservationRow[]> {
    return this.listRange(SELECT_BY_CANONICAL_CELL_SQL, canonicalCellKey, from, to);
  }

  private async listRange(
    sql: string,
    key: string,
    from: Date,
    to: Date,
  ): Promise<ObservationRow[]> {
    const lower = new Date(from.getTime() - BOUND_SLACK_MS).toISOString();
    const upper = new Date(to.getTime() + BOUND_SLACK_MS).toISOString();
    const { results } = await this.db.prepare(sql).bind(key, lower, upper).all<DbRecord>();
    return results.map(fromRecord);
  }

  async deletePanelist(panelistId: string): Promise<DeleteResult> {
    const [observations] = await this.db.batch([
      this.db.prepare(DELETE_PANELIST_SQL[0]).bind(panelistId),
      this.db.prepare(DELETE_PANELIST_SQL[1]).bind(panelistId),
      this.db.prepare(DELETE_PANELIST_SQL[2]).bind(`panelist:${panelistId}`),
    ]);
    return { observations: observations?.meta.changes ?? 0 };
  }

  async rateCounts(keys: readonly string[], windowStart: string): Promise<Map<string, number>> {
    const out = new Map<string, number>(keys.map((key) => [key, 0]));
    if (keys.length === 0) return out;
    const { results } = await this.db
      .prepare(
        `SELECT bucket_key, count FROM rate_buckets WHERE window_start = ?1 AND bucket_key IN (${placeholders(keys.length, 2)})`,
      )
      .bind(windowStart, ...keys)
      .all<{ bucket_key: string; count: number }>();
    for (const r of results) out.set(r.bucket_key, r.count);
    return out;
  }

  async rateAdd(demands: readonly RateDemand[], windowStart: string): Promise<void> {
    if (demands.length === 0) return;
    const add = this.db.prepare(RATE_ADD_SQL);
    await this.db.batch(demands.map((d) => add.bind(d.key, windowStart, d.count)));
  }

  async getFlags(panelistIds: readonly string[]): Promise<PanelistFlag[]> {
    if (panelistIds.length === 0) return [];
    const { results } = await this.db
      .prepare(
        `SELECT ${FLAG_COLUMNS.join(", ")} FROM panelist_flags WHERE panelist_id IN (${placeholders(panelistIds.length)})`,
      )
      .bind(...panelistIds)
      .all<FlagRecord>();
    return results.map(fromFlagRecord);
  }

  async flagPanelist(flag: PanelistFlag): Promise<boolean> {
    const result = await this.db
      .prepare(INSERT_FLAG_SQL)
      .bind(
        flag.panelistId,
        flag.status,
        flag.reason,
        flag.cellKey,
        flag.flaggedAt,
        flag.reviewedAt,
        flag.reviewNote,
      )
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  async purgeBefore(cutoff: Date, bucketCutoff: Date): Promise<PurgeResult> {
    const at = cutoff.toISOString();
    const [observations, flags, buckets] = await this.db.batch([
      this.db.prepare(PURGE_SQL.observations).bind(at),
      this.db.prepare(PURGE_SQL.flags).bind(at),
      this.db.prepare(PURGE_SQL.buckets).bind(bucketCutoff.toISOString()),
    ]);
    return {
      observations: observations?.meta.changes ?? 0,
      flags: flags?.meta.changes ?? 0,
      buckets: buckets?.meta.changes ?? 0,
    };
  }
}

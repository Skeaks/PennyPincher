import type { InsertResult, ObservationRepo, ObservationRow } from "./observations";

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
];

export const OBSERVATION_COLUMNS: readonly string[] = COLUMNS.map(([name]) => name);

const PLACEHOLDERS = OBSERVATION_COLUMNS.map((_, i) => `?${i + 1}`).join(", ");

export const INSERT_SQL = `INSERT OR IGNORE INTO observations (${OBSERVATION_COLUMNS.join(", ")}) VALUES (${PLACEHOLDERS})`;

const SELECT_SQL = `SELECT ${OBSERVATION_COLUMNS.join(", ")} FROM observations WHERE observation_id = ?1`;

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
}

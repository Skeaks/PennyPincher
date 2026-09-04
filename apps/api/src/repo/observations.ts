import type { PriceObservation } from "@pennypincher/schema";

/**
 * One stored observation: the flattened columns of the `observations` table (see
 * migrations/0001_observations.sql) plus the full validated payload as JSON.
 */
export interface ObservationRow {
  observationId: string;
  schemaVersion: string;
  panelistId: string;
  observedAt: string;
  retailer: string;
  retailerStoreId: string | null;
  storeLabel: string | null;
  retailerSku: string;
  upc: string | null;
  title: string;
  priceMinor: number;
  currency: string;
  isEstimate: boolean;
  fulfillment: string;
  sessionState: string;
  surface: string;
  zip3: string | null;
  device: string;
  adapter: string;
  clientVersion: string;
  evidenceHash: string;
  cellKey: string;
  rawJson: string;
  receivedAt: string;
}

export interface InsertResult {
  /** Rows written. */
  accepted: number;
  /** Rows whose observationId already existed, in the table or earlier in the same batch. */
  duplicates: number;
}

/** Storage behind the ingest endpoint. D1 in the Worker, a Map in tests. */
export interface ObservationRepo {
  /** Idempotent on observationId. Duplicates are counted, never errors. */
  insertMany(rows: ObservationRow[]): Promise<InsertResult>;
  getById(observationId: string): Promise<ObservationRow | undefined>;
}

/**
 * The cell an observation belongs to: retailer|retailerStoreId|retailerSku|fulfillment|zip3.
 * Absent parts are empty strings so the key is stable and sortable.
 */
export function cellKey(o: PriceObservation): string {
  return [
    o.retailer,
    o.store?.retailerStoreId ?? "",
    o.product.retailerSku,
    o.context.fulfillment,
    o.context.zip3 ?? "",
  ].join("|");
}

/** Flatten a validated observation into a row. `receivedAt` is the server clock at ingest. */
export function toRow(o: PriceObservation, receivedAt: string): ObservationRow {
  return {
    observationId: o.observationId,
    schemaVersion: o.schemaVersion,
    panelistId: o.panelistId,
    observedAt: o.observedAt,
    retailer: o.retailer,
    retailerStoreId: o.store?.retailerStoreId ?? null,
    storeLabel: o.store?.label ?? null,
    retailerSku: o.product.retailerSku,
    upc: o.product.upc ?? null,
    title: o.product.title,
    priceMinor: o.facts.price.amountMinor,
    currency: o.facts.price.currency,
    isEstimate: o.facts.isEstimate,
    fulfillment: o.context.fulfillment,
    sessionState: o.context.sessionState,
    surface: o.context.surface,
    zip3: o.context.zip3 ?? null,
    device: o.context.device,
    adapter: o.provenance.adapter,
    clientVersion: o.provenance.clientVersion,
    evidenceHash: o.provenance.evidenceHash,
    cellKey: cellKey(o),
    rawJson: JSON.stringify(o),
    receivedAt,
  };
}

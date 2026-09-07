import type { PriceObservation } from "@pennypincher/schema";
import { canonicalCellKey } from "./products";

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
  /**
   * Product identity (S13, migration 0003). Absent on rows built without a products repo
   * (stored as NULL); null when the title normalised to nothing.
   */
  canonicalId?: string | null;
  /** `canonicalId|fulfillment|zip3`, the cross-retailer cell. Null whenever canonicalId is. */
  canonicalCellKey?: string | null;
}

export interface InsertResult {
  /** Rows written. */
  accepted: number;
  /** Rows whose observationId already existed, in the table or earlier in the same batch. */
  duplicates: number;
}

/** A rate-limit bucket: the key and how many rows the caller wants to add to it. */
export interface RateDemand {
  key: string;
  count: number;
}

/** The abuse guard's record of a panelist (S14). One per panelist; the first flag sticks. */
export interface PanelistFlag {
  panelistId: string;
  /** "suspect" until a human reviews; a reviewer sets "cleared" to lift the exclusion. */
  status: "suspect" | "cleared";
  reason: string;
  /** The cell whose range the panelist's prices fell outside of. */
  cellKey: string;
  flaggedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface DeleteResult {
  /** Observation rows removed. Flags and rate buckets for the id go too, uncounted. */
  observations: number;
}

export interface PurgeResult {
  observations: number;
  flags: number;
  buckets: number;
}

/** Storage behind the ingest and query endpoints. D1 in the Worker, a Map in tests. */
export interface ObservationRepo {
  /** Idempotent on observationId. Duplicates are counted, never errors. */
  insertMany(rows: ObservationRow[]): Promise<InsertResult>;
  getById(observationId: string): Promise<ObservationRow | undefined>;
  /**
   * Every row of one cell with `observedAt` in `[from, to]`, ascending by `observedAt`. The
   * query endpoint (S11) reads a 72 h window this way. Implementations may return a few rows
   * just outside the bounds (D1 compares the ISO strings); the caller re-filters exactly.
   */
  listByCell(cellKey: string, from: Date, to: Date): Promise<ObservationRow[]>;
  /** Every row of one panelist with `observedAt` in `[from, to]`, same slack as listByCell. */
  listByPanelist(panelistId: string, from: Date, to: Date): Promise<ObservationRow[]>;
  /**
   * Every row of one cross-retailer cell (S13: `canonicalId|fulfillment|zip3`) in
   * `[from, to]`, same slack as listByCell. Rows with no canonical id never match.
   */
  listByCanonicalCell(canonicalCellKey: string, from: Date, to: Date): Promise<ObservationRow[]>;
  /**
   * Remove everything stored under a panelistId: observations, the abuse flag, rate buckets.
   * Idempotent; an unknown id deletes nothing and is not an error.
   */
  deletePanelist(panelistId: string): Promise<DeleteResult>;
  /** Current counts for the given bucket keys in one window. Missing keys are 0. */
  rateCounts(keys: readonly string[], windowStart: string): Promise<Map<string, number>>;
  /** Add to the buckets, creating them at 0. */
  rateAdd(demands: readonly RateDemand[], windowStart: string): Promise<void>;
  /** The flags on file for any of the given panelists. */
  getFlags(panelistIds: readonly string[]): Promise<PanelistFlag[]>;
  /** Record a flag. Returns false, changing nothing, when the panelist already has one. */
  flagPanelist(flag: PanelistFlag): Promise<boolean>;
  /**
   * Retention (docs/data-retention.md): drop observations received before `cutoff`, flags
   * raised before it, and rate buckets whose window started before `bucketCutoff`.
   */
  purgeBefore(cutoff: Date, bucketCutoff: Date): Promise<PurgeResult>;
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

/**
 * Flatten a validated observation into a row. `receivedAt` is the server clock at ingest.
 * `identity` (S13) is the resolved product id for this observation's SKU; when given, the
 * row carries `canonicalId` and `canonicalCellKey` (both null for an id of null).
 */
export function toRow(
  o: PriceObservation,
  receivedAt: string,
  identity?: { canonicalId: string | null },
): ObservationRow {
  const canonical =
    identity === undefined
      ? {}
      : {
          canonicalId: identity.canonicalId,
          canonicalCellKey:
            identity.canonicalId === null ? null : canonicalCellKey(o, identity.canonicalId),
        };
  return {
    ...canonical,
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

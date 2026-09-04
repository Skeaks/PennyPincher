/**
 * Lever probe (S06) types. A probe pairs the price the user was shown (their own, logged-in
 * observation) with the price the same public product page shows an anonymous visitor, fetched
 * from the background with no credentials (ADR 0003, line 2).
 *
 * Everything the popup and the options page display comes from `ProbeResult`, which is stored
 * per retailer + SKU. Both observations of a pair also go into the ordinary observation store,
 * so S11 uploads them like any other row.
 */
import type { Fulfillment, Retailer } from "@pennypincher/schema";

/** Rate-table key: one probe per retailer + SKU per hour. */
export function probeKey(retailer: Retailer, retailerSku: string): string {
  return `${retailer}:${retailerSku}`;
}

/** One side of a comparison, as much as the popup needs to show it. */
export interface PricePoint {
  observationId: string;
  amountMinor: number;
  priceText: string;
  fulfillment: Fulfillment;
  storeId?: string;
  storeLabel?: string;
}

/**
 * The five outcomes the popup may show. No others exist; in particular there is no outcome
 * that implies the user should act.
 *  - SAME / MORE / LESS: both pages resolved to the same store and the prices were compared.
 *  - STORE_DIFFERS: the anonymous page resolved to a different store, so the prices are not
 *    comparable. The pair is still stored for the panel.
 *  - UNCHECKED: no anonymous price could be read. `reason` says why.
 */
export type ProbeVerdict = "SAME" | "MORE" | "LESS" | "STORE_DIFFERS" | "UNCHECKED";

/**
 * Why a probe produced no comparison. Adapter failures are the adapter's own reason
 * (`no_price`, `no_title`, ...); the rest are the probe's.
 */
export type ProbeFailureReason =
  | "redirected"
  | "http_error"
  | "network_error"
  | "extract_unavailable"
  | "sku_mismatch"
  | "store_unknown"
  | "store_rejected"
  | "not_product_page"
  | "no_title"
  | "no_price"
  | "unparseable_price"
  | "no_sku"
  | "no_fulfillment"
  | "adapter_threw";

export interface ProbeResult {
  key: string;
  retailer: Retailer;
  retailerSku: string;
  /** Canonical product URL, as in `product.url`. */
  url: string;
  /** ISO-8601 UTC. */
  checkedAt: string;
  /** The user's own (logged-in) price. */
  mine: PricePoint;
  verdict: ProbeVerdict;
  /** The anonymous price. Present unless `verdict` is UNCHECKED. */
  anon?: PricePoint;
  /** `mine - anon` in minor units. Positive: the user was shown more. SAME / MORE / LESS only. */
  deltaMinor?: number;
  /** UNCHECKED only. */
  reason?: ProbeFailureReason;
  /** Free-text detail for the options page (an HTTP status, an adapter detail). Never PII. */
  detail?: string;
}

/** Per-retailer counters for the options page ("probes" summary). */
export interface RetailerProbeStats {
  /** Probes that got as far as a fetch. */
  checks: number;
  /** Verdicts MORE or LESS. */
  differences: number;
  /** Verdicts UNCHECKED. */
  failures: number;
  /** `probeFailures` in the brief: UNCHECKED verdicts by reason. */
  failuresByReason: Partial<Record<ProbeFailureReason, number>>;
}

export interface ProbeState {
  version: 1;
  /** `probeKey` -> epoch ms of the last attempt. Entries older than an hour are pruned. */
  rate: Record<string, number>;
  /** `probeKey` -> the latest result. Capped; oldest dropped. */
  results: Record<string, ProbeResult>;
  stats: Partial<Record<Retailer, RetailerProbeStats>>;
}

export function emptyProbeState(): ProbeState {
  return { version: 1, rate: {}, results: {}, stats: {} };
}

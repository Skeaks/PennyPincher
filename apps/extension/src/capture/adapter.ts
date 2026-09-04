/**
 * The adapter contract (S05). An adapter turns a rendered product page into the page-derived
 * part of a `PriceObservation`. The runner (`run.ts`) adds what only the client knows: ids,
 * the clock, the client version.
 *
 * Rules every adapter must keep:
 *  - Read only. It is handed a Document and must not click, navigate, submit, or request
 *    anything. The lever probe (S06) hands it a `DOMParser` document with no window at all,
 *    so nothing here may touch `window`, `location`, or `getComputedStyle`.
 *  - Never throw. Every failure is `{ ok: false, reason }` so a DOM change becomes a counted
 *    failure (S12 health beacon), never a broken content script.
 *  - Session state comes from the page's own logged-in indicator, never from cookies (ADR 0003).
 */
import type {
  CaptureContext,
  Fulfillment,
  PriceFacts,
  ProductRef,
  Retailer,
  SessionState,
  StoreRef,
  Surface,
} from "@pennypincher/schema";

export type DeviceClass = CaptureContext["device"];

/** What the content script knows before any adapter runs. */
export interface PageContext {
  /** The URL bar. The adapter canonicalises it (query and fragment stripped). */
  url: string;
  surface: Surface;
  device: DeviceClass;
  /**
   * Optional overrides for a caller that knows better than the page. Passive capture never
   * sets them; the lever probe (S06) sets `sessionState: "logged_out"` and `cleanSession: true`
   * on a document it fetched anonymously. When absent, the adapter reads the page.
   */
  fulfillment?: Fulfillment;
  sessionState?: SessionState;
  cleanSession?: boolean;
}

/** Stable failure identifiers. S12 counts them per adapter; keep them short and fixed. */
export type ExtractFailureReason =
  | "not_product_page"
  | "no_title"
  | "no_price"
  | "unparseable_price"
  | "no_sku"
  | "no_fulfillment"
  | "adapter_threw";

/**
 * The page-derived part of an observation. Everything in `PriceObservation` except the fields
 * only the client can mint (`schemaVersion`, `observationId`, `panelistId`, `observedAt`,
 * `provenance.clientVersion`).
 */
export interface AdapterObservation {
  retailer: Retailer;
  store?: StoreRef;
  product: ProductRef;
  facts: PriceFacts;
  context: CaptureContext;
  /** `name@version` of the adapter that produced this, for `provenance.adapter`. */
  adapter: string;
  /** SHA-256 hex of the scrubbed price container's outerHTML. See `evidence.ts`. */
  evidenceHash: string;
}

export type ExtractResult =
  | { ok: true; observation: AdapterObservation }
  | { ok: false; reason: ExtractFailureReason; detail?: string };

export interface Adapter {
  /** Matches `Retailer`. */
  name: Retailer;
  /** Semver. Bump on any selector change so bad releases can be quarantined. */
  version: string;
  /** True when this adapter should run on the page at `url`. Pure; no DOM. */
  matches(url: string): boolean;
  /** Extract from a rendered document. Never throws. */
  extract(doc: Document, ctx: PageContext): ExtractResult;
}

export function fail(reason: ExtractFailureReason, detail?: string): ExtractResult {
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
}

/** Whitespace-normalised text of a node, or "" for null. */
export function textOf(node: { textContent: string | null } | null | undefined): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Drop query string and fragment. Returns undefined when `url` does not parse. */
export function canonicalUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.href;
  } catch {
    return undefined;
  }
}

/**
 * Strips keys whose value is `undefined` so the result satisfies `exactOptionalPropertyTypes`.
 * The input type says every key may be undefined; the output type is the schema's.
 */
export function withDefined<T extends object>(input: { [K in keyof T]: T[K] | undefined }): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

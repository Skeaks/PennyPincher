/**
 * The adapter contract (S05, extended in S17). An adapter turns a rendered retailer page into
 * the page-derived part of one or more `PriceObservation`s. The runner (`run.ts`) adds what
 * only the client knows: ids, the clock, the client version.
 *
 * Two surfaces (S17):
 *  - a product surface: the standalone product page or the product modal that opens over a
 *    listing. `extract` reads the one hero price.
 *  - a listing surface: search results, aisles, the storefront. `extractTiles` reads one
 *    observation per product tile that shows a price.
 * `pageKind(url)` says which one a URL is, from the URL alone.
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
  /**
   * SHA-256 hex of the evidence the price was read from: the scrubbed outerHTML of the price
   * container (`evidence.ts`), or the JSON-LD script text when that was the source (S17).
   */
  evidenceHash: string;
}

export type ExtractResult =
  | { ok: true; observation: AdapterObservation }
  | { ok: false; reason: ExtractFailureReason; detail?: string };

/**
 * A listing page's tiles, all at once. Tiles that showed no usable price are counted by
 * reason rather than failing the page: a listing with one broken tile still yields the rest.
 */
export interface TileExtraction {
  observations: AdapterObservation[];
  skipped: Partial<Record<ExtractFailureReason, number>>;
}

/** Which surface a URL is. `product` covers the standalone page and the modal over a listing. */
export type PageKind = "product" | "listing";

export interface Adapter {
  /** Matches `Retailer`. */
  name: Retailer;
  /** Semver. Bump on any selector change so bad releases can be quarantined. */
  version: string;
  /** True when this adapter should run on the page at `url`. Pure; no DOM. */
  matches(url: string): boolean;
  /** The surface at `url`, or undefined when `matches` is false. Pure; no DOM. */
  pageKind(url: string): PageKind | undefined;
  /** Extract the hero price from a product surface. Never throws. */
  extract(doc: Document, ctx: PageContext): ExtractResult;
  /**
   * Extract every priced tile on a listing surface. Never throws. Optional: an adapter that
   * has not learnt its retailer's tiles yet (S12 until it does) records product pages only.
   */
  extractTiles?(doc: Document, ctx: PageContext): TileExtraction;
}

export function fail(reason: ExtractFailureReason, detail?: string): ExtractResult {
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
}

/** Whitespace-normalised text of a node, or "" for null. */
export function textOf(node: { textContent: string | null } | null | undefined): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Query parameters that name the store and therefore stay in a canonical URL. Instacart's
 * `/products/<sku>-…?retailerSlug=walmart` (the shape the product modal takes) is a different
 * page from `/products/<sku>-…` alone: without the slug Instacart picks a storefront itself,
 * and the probe's anonymous fetch of `product.url` would compare prices across stores.
 */
export const KEPT_QUERY_PARAMS: readonly string[] = ["retailerSlug"];

/**
 * Drop the fragment and every query parameter except the store-naming ones. Returns undefined
 * when `url` does not parse.
 */
export function canonicalUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const kept = new URLSearchParams();
    for (const name of KEPT_QUERY_PARAMS) {
      const value = u.searchParams.get(name);
      if (value !== null && value !== "") kept.set(name, value);
    }
    u.search = kept.toString();
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

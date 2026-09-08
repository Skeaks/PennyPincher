/**
 * Product identity at ingest (S13). Every observation gets a canonical product id from
 * @pennypincher/normalize so cross-retailer cells can be built; this file is the storage
 * behind that (migration 0003) and the per-batch resolver.
 *
 * Resolution, per distinct (retailer, SKU) in a batch:
 *   1. a SKU already linked keeps its id (product_skus), no scoring;
 *   2. otherwise `canonicalize()` with candidates = known products sharing a title token
 *      (product_tokens), which attaches to the best fuzzy match above threshold or mints a
 *      fresh id; UPC ids never need candidates;
 *   3. the id is recorded: product row (first reference wins as representative), SKU link,
 *      token index. Two new SKUs in one batch that match each other resolve in order, so the
 *      second sees the first.
 *
 * Nothing stored here is per-panelist or per-price. Retention and panelist deletion do not
 * touch these tables.
 */
import {
  type Canonical,
  type KnownProduct,
  canonicalize,
  normalizeUpc,
  signature,
} from "@pennypincher/normalize";
import type { PriceObservation, ProductRef } from "@pennypincher/schema";

/** One row of `products`: the first reference that minted the id, and when it was seen. */
export interface ProductRow {
  canonicalId: string;
  method: "upc" | "fuzzy";
  /** Of the resolution that minted the row: 1 for a UPC, the match score or heuristic else. */
  confidence: number;
  title: string;
  brand: string | null;
  sizeText: string | null;
  /** GTIN-14, when the reference carried a valid code. */
  upc: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** One row of `product_skus`. */
export interface SkuLink {
  skuKey: string;
  retailer: string;
  retailerSku: string;
  canonicalId: string;
}

/** `retailer|retailerSku`, the product_skus primary key. */
export function skuKey(retailer: string, retailerSku: string): string {
  return `${retailer}|${retailerSku}`;
}

/** How many candidate products the fuzzy step compares against. */
export const CANDIDATE_LIMIT = 50;

/** Tokens per candidate query, so the IN list stays inside D1's bound-parameter budget. */
export const QUERY_TOKEN_LIMIT = 32;

export interface ProductsRepo {
  /** The products already linked to these sku keys. Unknown keys are absent from the map. */
  linked(skuKeys: readonly string[]): Promise<Map<string, ProductRow>>;
  /**
   * Products sharing at least one of `tokens` with the reference, most shared tokens first,
   * ties by canonical id, at most `limit`.
   */
  candidates(tokens: readonly string[], limit: number): Promise<KnownProduct[]>;
  /**
   * Record a resolution: insert the product if its id is new (else touch `lastSeenAt`),
   * link the SKU if it is new, add the tokens to the index. Idempotent.
   */
  record(product: ProductRow, link: SkuLink, tokens: readonly string[]): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Resolver.
// ---------------------------------------------------------------------------------------------

/** What ingest needs per observation: the id (null when none) and how it was reached. */
export type Identity = Canonical;

function representative(product: ProductRef, c: Canonical, now: string): ProductRow | undefined {
  if (c.canonicalId === null || c.method === "none") return undefined;
  return {
    canonicalId: c.canonicalId,
    method: c.method,
    confidence: c.confidence,
    title: product.title,
    brand: product.brand ?? null,
    sizeText: product.sizeText ?? null,
    upc: normalizeUpc(product.upc) ?? null,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}

/**
 * Resolve every distinct (retailer, SKU) in `observations` to an Identity, keyed by
 * `skuKey()`. The first observation of a SKU in the batch is the reference the products
 * table sees. Sequential on purpose: a SKU resolved earlier in the batch is a candidate for
 * the ones after it.
 */
export async function resolveIdentities(
  repo: ProductsRepo,
  observations: readonly PriceObservation[],
  now: string,
): Promise<Map<string, Identity>> {
  const distinct = new Map<string, { retailer: string; product: ProductRef }>();
  for (const o of observations) {
    const key = skuKey(o.retailer, o.product.retailerSku);
    if (!distinct.has(key)) distinct.set(key, { retailer: o.retailer, product: o.product });
  }
  const out = new Map<string, Identity>();
  if (distinct.size === 0) return out;

  const known = await repo.linked([...distinct.keys()]);
  for (const [key, { retailer, product }] of distinct) {
    const hit = known.get(key);
    if (hit) {
      out.set(key, {
        canonicalId: hit.canonicalId,
        method: hit.method,
        confidence: hit.confidence,
      });
      continue;
    }
    const sig = signature(product);
    const needsCandidates = normalizeUpc(product.upc) === undefined && sig.tokens.length > 0;
    const candidates = needsCandidates
      ? await repo.candidates(sig.tokens.slice(0, QUERY_TOKEN_LIMIT), CANDIDATE_LIMIT)
      : [];
    const identity = canonicalize(product, { candidates });
    out.set(key, identity);
    const row = representative(product, identity, now);
    if (row === undefined) continue;
    await repo.record(
      row,
      { skuKey: key, retailer, retailerSku: product.retailerSku, canonicalId: row.canonicalId },
      sig.tokens,
    );
    // Later SKUs in this batch may link to the id just recorded without another lookup.
    known.set(key, row);
  }
  return out;
}

/** `canonicalId|fulfillment|zip3`: the cross-retailer cell. Retailer and store are dropped. */
export function canonicalCellKey(o: PriceObservation, canonicalId: string): string {
  return [canonicalId, o.context.fulfillment, o.context.zip3 ?? ""].join("|");
}

export function toKnown(p: ProductRow): KnownProduct {
  return {
    canonicalId: p.canonicalId,
    title: p.title,
    ...(p.brand !== null ? { brand: p.brand } : {}),
    ...(p.sizeText !== null ? { sizeText: p.sizeText } : {}),
    ...(p.upc !== null ? { upc: p.upc } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Memory repo (tests).
// ---------------------------------------------------------------------------------------------

export class MemoryProductsRepo implements ProductsRepo {
  readonly products = new Map<string, ProductRow>();
  readonly skus = new Map<string, SkuLink>();
  /** token -> canonical ids. */
  readonly tokens = new Map<string, Set<string>>();

  async linked(skuKeys: readonly string[]): Promise<Map<string, ProductRow>> {
    const out = new Map<string, ProductRow>();
    for (const key of skuKeys) {
      const link = this.skus.get(key);
      const product = link ? this.products.get(link.canonicalId) : undefined;
      if (product) out.set(key, product);
    }
    return out;
  }

  async candidates(tokens: readonly string[], limit: number): Promise<KnownProduct[]> {
    const shared = new Map<string, number>();
    for (const token of new Set(tokens)) {
      for (const id of this.tokens.get(token) ?? []) shared.set(id, (shared.get(id) ?? 0) + 1);
    }
    return [...shared.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .flatMap(([id]) => {
        const p = this.products.get(id);
        return p ? [toKnown(p)] : [];
      });
  }

  async record(product: ProductRow, link: SkuLink, tokens: readonly string[]): Promise<void> {
    const existing = this.products.get(product.canonicalId);
    if (existing) existing.lastSeenAt = product.lastSeenAt;
    else this.products.set(product.canonicalId, { ...product });
    if (!this.skus.has(link.skuKey)) this.skus.set(link.skuKey, { ...link });
    for (const token of tokens) {
      const ids = this.tokens.get(token) ?? new Set<string>();
      ids.add(product.canonicalId);
      this.tokens.set(token, ids);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// D1 statements and record shapes. The D1 repo itself lives in products-d1.ts because it
// needs the Workers `D1Database` global, which the extension (which imports app.ts for its
// end-to-end test) does not have. Same split as adapter-health (S12).
// ---------------------------------------------------------------------------------------------

export const PRODUCT_COLUMNS = [
  "canonical_id",
  "method",
  "confidence",
  "title",
  "brand",
  "size_text",
  "upc",
  "first_seen_at",
  "last_seen_at",
] as const;

export function placeholders(n: number, from = 1): string {
  return Array.from({ length: n }, (_, i) => `?${from + i}`).join(", ");
}

/** OR IGNORE: the first reference to mint an id is the representative. */
export const INSERT_PRODUCT_SQL = `INSERT OR IGNORE INTO products (${PRODUCT_COLUMNS.join(", ")}) VALUES (${placeholders(PRODUCT_COLUMNS.length)})`;
export const TOUCH_PRODUCT_SQL =
  "UPDATE products SET last_seen_at = ?2 WHERE canonical_id = ?1 AND last_seen_at < ?2";
export const INSERT_SKU_SQL =
  "INSERT OR IGNORE INTO product_skus (sku_key, retailer, retailer_sku, canonical_id) VALUES (?1, ?2, ?3, ?4)";
export const INSERT_TOKEN_SQL =
  "INSERT OR IGNORE INTO product_tokens (token, canonical_id) VALUES (?1, ?2)";

export interface ProductRecord {
  canonical_id: string;
  method: string;
  confidence: number;
  title: string;
  brand: string | null;
  size_text: string | null;
  upc: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export function fromProductRecord(d: ProductRecord): ProductRow {
  return {
    canonicalId: d.canonical_id,
    method: d.method === "upc" ? "upc" : "fuzzy",
    confidence: d.confidence,
    title: d.title,
    brand: d.brand,
    sizeText: d.size_text,
    upc: d.upc,
    firstSeenAt: d.first_seen_at,
    lastSeenAt: d.last_seen_at,
  };
}

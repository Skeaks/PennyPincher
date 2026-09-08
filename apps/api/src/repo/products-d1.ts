/** The D1 half of the products repo (S13). Only the Worker entry imports this. */
import type { KnownProduct } from "@pennypincher/normalize";
import {
  INSERT_PRODUCT_SQL,
  INSERT_SKU_SQL,
  INSERT_TOKEN_SQL,
  PRODUCT_COLUMNS,
  type ProductRecord,
  type ProductRow,
  type ProductsRepo,
  type SkuLink,
  TOUCH_PRODUCT_SQL,
  fromProductRecord,
  placeholders,
  toKnown,
} from "./products";

const productSelect = PRODUCT_COLUMNS.map((c) => `p.${c}`).join(", ");

/** SKU links joined to their product rows, for `linked()`. */
export const SELECT_LINKED_SQL = (n: number) =>
  `SELECT s.sku_key AS sku_key, ${productSelect} FROM product_skus s JOIN products p ON p.canonical_id = s.canonical_id WHERE s.sku_key IN (${placeholders(n)})`;

/** Products sharing a token, most shared first, for `candidates()`. The limit is the last bind. */
export const SELECT_CANDIDATES_SQL = (n: number) =>
  `SELECT ${productSelect}, COUNT(*) AS shared FROM product_tokens t JOIN products p ON p.canonical_id = t.canonical_id WHERE t.token IN (${placeholders(n)}) GROUP BY p.canonical_id ORDER BY shared DESC, p.canonical_id LIMIT ?${n + 1}`;

/**
 * D1-backed repo. `record()` is one `db.batch()` (one transaction): the product insert, the
 * last-seen touch, the SKU link and the token index land together or not at all.
 */
export class D1ProductsRepo implements ProductsRepo {
  constructor(private readonly db: D1Database) {}

  async linked(skuKeys: readonly string[]): Promise<Map<string, ProductRow>> {
    const out = new Map<string, ProductRow>();
    if (skuKeys.length === 0) return out;
    const { results } = await this.db
      .prepare(SELECT_LINKED_SQL(skuKeys.length))
      .bind(...skuKeys)
      .all<ProductRecord & { sku_key: string }>();
    for (const r of results) out.set(r.sku_key, fromProductRecord(r));
    return out;
  }

  async candidates(tokens: readonly string[], limit: number): Promise<KnownProduct[]> {
    const distinct = [...new Set(tokens)];
    if (distinct.length === 0) return [];
    const { results } = await this.db
      .prepare(SELECT_CANDIDATES_SQL(distinct.length))
      .bind(...distinct, limit)
      .all<ProductRecord>();
    return results.map((r) => toKnown(fromProductRecord(r)));
  }

  async record(product: ProductRow, link: SkuLink, tokens: readonly string[]): Promise<void> {
    const statements = [
      this.db
        .prepare(INSERT_PRODUCT_SQL)
        .bind(
          product.canonicalId,
          product.method,
          product.confidence,
          product.title,
          product.brand,
          product.sizeText,
          product.upc,
          product.firstSeenAt,
          product.lastSeenAt,
        ),
      this.db.prepare(TOUCH_PRODUCT_SQL).bind(product.canonicalId, product.lastSeenAt),
      this.db
        .prepare(INSERT_SKU_SQL)
        .bind(link.skuKey, link.retailer, link.retailerSku, link.canonicalId),
      ...[...new Set(tokens)].map((token) =>
        this.db.prepare(INSERT_TOKEN_SQL).bind(token, product.canonicalId),
      ),
    ];
    await this.db.batch(statements);
  }
}

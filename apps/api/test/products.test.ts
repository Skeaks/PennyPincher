import { gs1CheckDigit } from "@pennypincher/normalize";
import type { PriceObservation } from "@pennypincher/schema";
import { describe, expect, it } from "vitest";
import migration from "../migrations/0003_product_identity.sql?raw";
import { createApp } from "../src/app";
import { MemoryObservationRepo } from "../src/repo/memory";
import { toRow } from "../src/repo/observations";
import {
  INSERT_PRODUCT_SQL,
  INSERT_SKU_SQL,
  INSERT_TOKEN_SQL,
  MemoryProductsRepo,
  canonicalCellKey,
  resolveIdentities,
  skuKey,
} from "../src/repo/products";
import { FIXED_NOW, uuidFor, validObservation } from "./fixtures";

const NOW = FIXED_NOW.toISOString();
const upc = (body: string) => `${body}${gs1CheckDigit(body)}`;

/** An observation of one product at one retailer; the rest is the Wegmans banana fixture. */
function seen(
  retailer: PriceObservation["retailer"],
  retailerSku: string,
  title: string,
  extra: Partial<PriceObservation["product"]> = {},
  n = 1,
): PriceObservation {
  return validObservation({
    observationId: uuidFor(n),
    retailer,
    product: { retailerSku, title, url: `https://www.${retailer}.com/x/${retailerSku}`, ...extra },
  });
}

const GV_GAL = "Great Value Whole Vitamin D Milk";

describe("keys", () => {
  it("skuKey is retailer|retailerSku", () => {
    expect(skuKey("target", "15013944")).toBe("target|15013944");
  });

  it("canonicalCellKey is canonicalId|fulfillment|zip3, retailer and store dropped", () => {
    const o = validObservation();
    expect(canonicalCellKey(o, "gtin:00036000291452")).toBe("gtin:00036000291452|delivery|085");
    const { zip3: _z, ...context } = o.context;
    expect(canonicalCellKey({ ...o, context }, "fuzzy:banana")).toBe("fuzzy:banana|delivery|");
  });
});

describe("resolveIdentities", () => {
  it("mints a fuzzy id for a new SKU and records product, link and tokens", async () => {
    const repo = new MemoryProductsRepo();
    const ids = await resolveIdentities(
      repo,
      [seen("instacart", "20654983", GV_GAL, { sizeText: "1 gal" })],
      NOW,
    );
    const id = ids.get("instacart|20654983");
    expect(id).toEqual({
      canonicalId: "fuzzy:d-great-milk-value-vitamin-whole@3785ml",
      method: "fuzzy",
      confidence: 0.8,
    });
    expect(repo.products.get("fuzzy:d-great-milk-value-vitamin-whole@3785ml")).toEqual({
      canonicalId: "fuzzy:d-great-milk-value-vitamin-whole@3785ml",
      method: "fuzzy",
      confidence: 0.8,
      title: GV_GAL,
      brand: null,
      sizeText: "1 gal",
      upc: null,
      firstSeenAt: NOW,
      lastSeenAt: NOW,
    });
    expect(repo.skus.get("instacart|20654983")).toMatchObject({
      retailer: "instacart",
      retailerSku: "20654983",
      canonicalId: "fuzzy:d-great-milk-value-vitamin-whole@3785ml",
    });
    expect([...repo.tokens.keys()].sort()).toEqual([
      "d",
      "great",
      "milk",
      "value",
      "vitamin",
      "whole",
    ]);
  });

  it("keeps a linked SKU on its id even when the title changes, without re-scoring", async () => {
    const repo = new MemoryProductsRepo();
    await resolveIdentities(
      repo,
      [seen("instacart", "20654983", GV_GAL, { sizeText: "1 gal" })],
      NOW,
    );
    const later = "2026-09-05T16:00:00.000Z";
    const ids = await resolveIdentities(
      repo,
      [seen("instacart", "20654983", "Great Value Milk (new packaging)", { sizeText: "1 gal" })],
      later,
    );
    expect(ids.get("instacart|20654983")?.canonicalId).toBe(
      "fuzzy:d-great-milk-value-vitamin-whole@3785ml",
    );
    expect(repo.products.size).toBe(1);
    expect(repo.products.get("fuzzy:d-great-milk-value-vitamin-whole@3785ml")?.lastSeenAt).toBe(
      NOW,
    );
  });

  it("attaches another retailer's SKU to the existing product through the token index", async () => {
    const repo = new MemoryProductsRepo();
    await resolveIdentities(
      repo,
      [seen("instacart", "20654983", GV_GAL, { sizeText: "1 gal" })],
      NOW,
    );
    const ids = await resolveIdentities(
      repo,
      [seen("walmart", "10450114", "Great Value Milk, Vitamin D, Whole, Gallon, 128 fl oz")],
      NOW,
    );
    const id = ids.get("walmart|10450114");
    expect(id?.canonicalId).toBe("fuzzy:d-great-milk-value-vitamin-whole@3785ml");
    expect(id?.method).toBe("fuzzy");
    expect(id?.confidence).toBeCloseTo(12 / 13, 5);
    expect(repo.products.size).toBe(1);
    expect(repo.skus.size).toBe(2);
    // The new reference's tokens widen the index for the next lookup.
    expect(repo.tokens.get("gallon")?.has("fuzzy:d-great-milk-value-vitamin-whole@3785ml")).toBe(
      true,
    );
  });

  it("does not attach across a size or variant conflict", async () => {
    const repo = new MemoryProductsRepo();
    await resolveIdentities(
      repo,
      [seen("instacart", "20654983", GV_GAL, { sizeText: "1 gal" })],
      NOW,
    );
    const ids = await resolveIdentities(
      repo,
      [
        seen(
          "instacart",
          "20655081",
          "Great Value Vitamin D Whole Milk",
          { sizeText: "0.5 gal" },
          2,
        ),
        seen("instacart", "20630136", "Great Value 2% Reduced Fat Milk", { sizeText: "128 oz" }, 3),
      ],
      NOW,
    );
    expect(ids.get("instacart|20655081")?.canonicalId).toBe(
      "fuzzy:d-great-milk-value-vitamin-whole@1893ml",
    );
    // "128 oz" is a weight on the tile, so the key carries grams, not millilitres.
    expect(ids.get("instacart|20630136")?.canonicalId).toBe(
      "fuzzy:2pct-fat-great-milk-reduced-value@3629g",
    );
    expect(repo.products.size).toBe(3);
  });

  it("uses the GTIN when a page shows a valid UPC, and needs no candidates for it", async () => {
    const repo = new MemoryProductsRepo();
    const code = upc("07874235100");
    const ids = await resolveIdentities(
      repo,
      [
        seen("walmart", "10450114", GV_GAL, { upc: code }),
        seen(
          "target",
          "13276112",
          "Whole Milk - 1gal",
          { upc: `0${code}`, brand: "Great Value" },
          2,
        ),
      ],
      NOW,
    );
    expect(ids.get("walmart|10450114")).toEqual({
      canonicalId: `gtin:00${code}`,
      method: "upc",
      confidence: 1,
    });
    expect(ids.get("target|13276112")?.canonicalId).toBe(`gtin:00${code}`);
    expect(repo.products.get(`gtin:00${code}`)).toMatchObject({
      method: "upc",
      upc: `00${code}`,
      title: GV_GAL,
    });
    expect(repo.skus.size).toBe(2);
  });

  it("lets the second of two new matching SKUs in one batch attach to the first", async () => {
    const repo = new MemoryProductsRepo();
    const ids = await resolveIdentities(
      repo,
      [
        seen("instacart", "20654983", GV_GAL, { sizeText: "1 gal" }),
        seen("walmart", "10450114", "Great Value Milk, Vitamin D, Whole, Gallon, 128 fl oz", {}, 2),
      ],
      NOW,
    );
    expect(ids.get("walmart|10450114")?.canonicalId).toBe(
      ids.get("instacart|20654983")?.canonicalId,
    );
    expect(repo.products.size).toBe(1);
  });

  it("resolves a SKU seen several times in one batch once, on its first observation", async () => {
    const repo = new MemoryProductsRepo();
    const ids = await resolveIdentities(
      repo,
      [
        seen("instacart", "20654983", GV_GAL, { sizeText: "1 gal" }),
        seen("instacart", "20654983", "Something else entirely", {}, 2),
      ],
      NOW,
    );
    expect(ids.size).toBe(1);
    expect(repo.products.get("fuzzy:d-great-milk-value-vitamin-whole@3785ml")?.title).toBe(GV_GAL);
  });

  it("reports none, stores nothing, for a title that normalises to nothing", async () => {
    const repo = new MemoryProductsRepo();
    const ids = await resolveIdentities(repo, [seen("walmart", "1", "- & -")], NOW);
    expect(ids.get("walmart|1")).toEqual({ canonicalId: null, method: "none", confidence: 0 });
    expect(repo.products.size).toBe(0);
    expect(repo.skus.size).toBe(0);
  });

  it("returns an empty map for an empty batch", async () => {
    expect((await resolveIdentities(new MemoryProductsRepo(), [], NOW)).size).toBe(0);
  });
});

describe("toRow with an identity", () => {
  it("carries canonicalId and canonicalCellKey, null for a null id, absent when not resolved", () => {
    const o = validObservation();
    const resolved = toRow(o, NOW, { canonicalId: "fuzzy:banana@1ct" });
    expect(resolved.canonicalId).toBe("fuzzy:banana@1ct");
    expect(resolved.canonicalCellKey).toBe("fuzzy:banana@1ct|delivery|085");
    const none = toRow(o, NOW, { canonicalId: null });
    expect(none.canonicalId).toBeNull();
    expect(none.canonicalCellKey).toBeNull();
    const unresolved = toRow(o, NOW);
    expect("canonicalId" in unresolved).toBe(false);
    expect("canonicalCellKey" in unresolved).toBe(false);
  });
});

describe("MemoryObservationRepo.listByCanonicalCell", () => {
  it("returns the cross-retailer cell's rows in order and never a row without an id", async () => {
    const repo = new MemoryObservationRepo();
    const id = "fuzzy:d-great-milk-value-vitamin-whole@3785ml";
    const a = toRow(seen("instacart", "20654983", GV_GAL, {}, 1), NOW, { canonicalId: id });
    const b = toRow(
      { ...seen("walmart", "10450114", GV_GAL, {}, 2), observedAt: "2026-09-04T15:00:00.000Z" },
      NOW,
      { canonicalId: id },
    );
    const c = toRow(seen("target", "1", GV_GAL, {}, 3), NOW);
    await repo.insertMany([a, b, c]);
    const rows = await repo.listByCanonicalCell(`${id}|delivery|085`, new Date(0), FIXED_NOW);
    expect(rows.map((r) => r.retailer)).toEqual(["walmart", "instacart"]);
    expect(await repo.listByCanonicalCell("null|delivery|085", new Date(0), FIXED_NOW)).toEqual([]);
  });
});

describe("D1 statements", () => {
  const columnsOf = (table: string) => {
    const body =
      new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([^;]*)\\);`).exec(migration)?.[1] ?? "";
    return body
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) => line.length > 0 && !line.startsWith("--") && !line.startsWith("PRIMARY KEY"),
      )
      .map((line) => line.split(/\s+/)[0] ?? "");
  };
  const insertColumns = (sql: string) =>
    (/\(([^)]*)\) VALUES/.exec(sql)?.[1] ?? "").split(",").map((s) => s.trim());

  it("insert exactly the columns migration 0003 creates", () => {
    expect(insertColumns(INSERT_PRODUCT_SQL).sort()).toEqual(columnsOf("products").sort());
    expect(insertColumns(INSERT_SKU_SQL).sort()).toEqual(columnsOf("product_skus").sort());
    expect(insertColumns(INSERT_TOKEN_SQL).sort()).toEqual(columnsOf("product_tokens").sort());
  });

  it("are idempotent on their primary keys", () => {
    for (const sql of [INSERT_PRODUCT_SQL, INSERT_SKU_SQL, INSERT_TOKEN_SQL]) {
      expect(sql.startsWith("INSERT OR IGNORE INTO ")).toBe(true);
    }
    expect(migration).toMatch(/canonical_id\s+TEXT PRIMARY KEY/);
    expect(migration).toMatch(/sku_key\s+TEXT PRIMARY KEY/);
    expect(migration).toMatch(/PRIMARY KEY \(token, canonical_id\)/);
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS \w+\s+ON observations \(canonical_cell_key, observed_at\)/,
    );
  });
});

describe("POST /v1/observations with a products repo", () => {
  it("stores canonical_id and canonical_cell_key so two retailers share a cell", async () => {
    const repo = new MemoryObservationRepo();
    const products = new MemoryProductsRepo();
    const app = createApp<Record<string, never>>({
      repo: () => repo,
      products: () => products,
      now: () => FIXED_NOW,
    });
    const post = (observations: PriceObservation[]) =>
      app.request("/v1/observations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ observations }),
      });

    const first = await post([seen("instacart", "20654983", GV_GAL, { sizeText: "1 gal" }, 1)]);
    expect(first.status).toBe(201);
    const second = await post([
      seen("walmart", "10450114", "Great Value Milk, Vitamin D, Whole, Gallon, 128 fl oz", {}, 2),
    ]);
    expect(second.status).toBe(201);

    const id = "fuzzy:d-great-milk-value-vitamin-whole@3785ml";
    const a = await repo.getById(uuidFor(1));
    const b = await repo.getById(uuidFor(2));
    expect(a?.canonicalId).toBe(id);
    expect(b?.canonicalId).toBe(id);
    expect(a?.cellKey).not.toBe(b?.cellKey);
    expect(a?.canonicalCellKey).toBe(`${id}|delivery|085`);
    expect(b?.canonicalCellKey).toBe(a?.canonicalCellKey);
    const cell = await repo.listByCanonicalCell(`${id}|delivery|085`, new Date(0), FIXED_NOW);
    expect(cell.map((r) => r.retailer).sort()).toEqual(["instacart", "walmart"]);
  });

  it("stores NULL identity when no products repo is configured", async () => {
    const repo = new MemoryObservationRepo();
    const app = createApp<Record<string, never>>({ repo: () => repo, now: () => FIXED_NOW });
    const res = await app.request("/v1/observations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ observations: [validObservation()] }),
    });
    expect(res.status).toBe(201);
    const row = await repo.getById(validObservation().observationId);
    expect(row?.canonicalId ?? null).toBeNull();
  });
});

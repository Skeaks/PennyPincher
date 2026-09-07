/**
 * Listing tiles (S17): the generic collector on a synthetic reader; the Instacart tile reader
 * on the recorded cross-retailer search for Milk (fixtures/instacart/walmart-search-milk: four
 * retailer rows, a Rollback tile) and on the recommendation carousels of a recorded product
 * page (the same tile markup, with store ids); and synthetic tiles for the remaining shapes.
 */
import { PriceObservation } from "@pennypincher/schema";
import { describe, expect, it } from "vitest";
import type { AdapterObservation, PageContext } from "../../src/capture/adapter";
import { instacartAdapter } from "../../src/capture/adapters/instacart";
import { evidenceHash } from "../../src/capture/evidence";
import { buildObservation } from "../../src/capture/run";
import { type TileReader, collectTiles } from "../../src/capture/tiles";
import { fragmentDocument, listFixtures, parseDocument } from "./dom";

const bananas = listFixtures("instacart").find((f) => f.slug === "wegmans-bananas");
if (!bananas) throw new Error("fixture wegmans-bananas missing");
const milkSearch = listFixtures("instacart").find((f) => f.slug === "walmart-search-milk");
if (!milkSearch) throw new Error("fixture walmart-search-milk missing");
const URL_SEARCH = "https://www.instacart.com/store/s?k=Milk&search_id=9558e849#results";

const URL_AISLE = "https://www.instacart.com/store/wegmans/collections/produce?page=2#top";
const ctx: PageContext = { url: URL_AISLE, surface: "web", device: "desktop" };

function extractTiles(doc: Document, context: PageContext = ctx) {
  if (!instacartAdapter.extractTiles) throw new Error("adapter has no tile extractor");
  return instacartAdapter.extractTiles(doc, context);
}

function minted(o: AdapterObservation, n: number): PriceObservation {
  return buildObservation(o, {
    observationId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    panelistId: "0b1c2d3e-4f50-4a61-9b72-83c4d5e6f7a8",
    observedAt: "2026-09-07T15:00:00.000Z",
    clientVersion: "0.1.0",
  });
}

describe("collectTiles", () => {
  function observation(sku: string): AdapterObservation {
    return {
      retailer: "instacart",
      product: { retailerSku: sku, title: `Item ${sku}`, url: `https://x.test/p/${sku}` },
      facts: {
        price: { amountMinor: 100, currency: "USD" },
        priceText: "$1.00",
        isEstimate: false,
        promoTags: [],
        memberPrice: false,
      },
      context: {
        fulfillment: "delivery",
        sessionState: "unknown",
        surface: "web",
        device: "desktop",
      },
      adapter: "instacart@0.0.0",
      evidenceHash: "a".repeat(64),
    };
  }

  function reader(skus: (string | Error | undefined)[]): TileReader {
    return {
      tiles: (doc) => skus.map((_, i) => doc.createElement(`div-${i}`)),
      read: (tile) => {
        const i = Number(tile.tagName.toLowerCase().replace("div-", ""));
        const sku = skus[i];
        if (sku instanceof Error) throw sku;
        if (sku === undefined) return { ok: false, reason: "no_price" };
        return { ok: true, observation: observation(sku) };
      },
    };
  }

  it("keeps one observation per SKU and counts what was skipped, by reason", () => {
    const doc = fragmentDocument("");
    const out = collectTiles(doc, reader(["1", undefined, "2", "1", new Error("boom"), undefined]));
    expect(out.observations.map((o) => o.product.retailerSku)).toEqual(["1", "2"]);
    expect(out.skipped).toEqual({ no_price: 2, adapter_threw: 1 });
  });

  it("a reader whose tile scan throws yields nothing rather than throwing", () => {
    const out = collectTiles(fragmentDocument(""), {
      tiles: () => {
        throw new Error("no DOM");
      },
      read: () => ({ ok: false, reason: "no_price" }),
    });
    expect(out).toEqual({ observations: [], skipped: {} });
  });
});

describe("instacart tiles on the recorded cross-retailer search for Milk", () => {
  const doc = parseDocument(milkSearch.html, URL_SEARCH);
  const out = extractTiles(doc, { url: URL_SEARCH, surface: "web", device: "desktop" });
  const byLabel = (label: string) => out.observations.filter((o) => o.store?.label === label);

  it("classifies the URL as a listing and reads the tiles in every retailer row", () => {
    expect(instacartAdapter.pageKind(URL_SEARCH)).toBe("listing");
    const rows = doc.querySelectorAll('[data-testid="CrossRetailerResultRowWrapper"]');
    expect(rows.length).toBe(4);
    expect(doc.querySelectorAll('[data-item-card="true"]').length).toBe(48);
    expect(out.observations.length).toBe(42);
    // Six tile links read `/products/[scrubbed]-…`: the scrubber treats a five-digit product
    // id as a ZIP (docs/fixtures.md, known limits). Those tiles name no SKU.
    expect(out.skipped).toEqual({ no_sku: 6 });
    expect(doc.body.innerHTML).toContain('href="/products/[scrubbed]-');
  });

  it("gives every tile its row's store label, slug and fulfilment line", () => {
    const labels = new Set(out.observations.map((o) => o.store?.label));
    expect(labels).toEqual(new Set(["Walmart", "GIANT", "Stop & Shop", "ALDI"]));
    for (const o of out.observations) {
      expect(o.store?.retailerStoreId).toBeUndefined();
      expect(o.context.fulfillmentInferred).toBeUndefined();
      expect(o.context.sessionState).toBe("logged_in");
      expect(o.facts.price.amountMinor).toBeGreaterThan(0);
      expect(o.product.title.length).toBeGreaterThan(0);
      expect(o.product.sizeText).toMatch(/^\d[\d.]* (?:fl oz|oz|gal|qt)$/);
    }
    for (const o of byLabel("Walmart")) {
      expect(o.product.url).toMatch(/\?retailerSlug=walmart$/);
      expect(o.context.fulfillment).toBe("delivery");
    }
    for (const o of byLabel("GIANT"))
      expect(o.product.url).toMatch(/retailerSlug=giant-food-stores$/);
    // Stop & Shop offers "Pickup available" only; the others "Delivery by …".
    for (const o of byLabel("Stop & Shop")) expect(o.context.fulfillment).toBe("pickup");
    for (const o of byLabel("ALDI")) expect(o.context.fulfillment).toBe("delivery");
  });

  it("reads the Rollback tile: price, struck-through was-price, both badges", () => {
    const o = byLabel("Walmart").find((x) => x.product.retailerSku === "1343109");
    expect(o).toMatchObject({
      product: {
        title: "fairlife Whole Ultra-Filtered Milk, Lactose Free",
        sizeText: "52 fl oz",
        url: "https://www.instacart.com/products/1343109-fairlife-whole-ultrafiltered-milk-lactose-free-52-fl-oz?retailerSlug=walmart",
      },
      facts: {
        price: { amountMinor: 478, currency: "USD" },
        priceText: "$4.78",
        wasPrice: { amountMinor: 532, currency: "USD" },
        promoTags: ["Rollback", "10% off"],
        isEstimate: false,
        memberPrice: false,
      },
      store: { label: "Walmart" },
    });
  });

  it("reads the sidecar's tile (the milk the modal fixture opens) with its Best seller badge", () => {
    const o = byLabel("Walmart").find(
      (x) => x.product.retailerSku === milkSearch.meta.expected.retailerSku,
    );
    expect(o).toMatchObject({
      product: { title: milkSearch.meta.expected.title, sizeText: "1 gal" },
      facts: {
        price: milkSearch.meta.expected.price,
        priceText: milkSearch.meta.expected.priceText,
        promoTags: ["Best seller"],
      },
    });
    expect(o?.facts.wasPrice).toBeUndefined();
  });

  it("a Great price badge is a promo tag; ratings and counts never become the size", () => {
    const o = byLabel("Walmart").find((x) => x.product.retailerSku === "16408615");
    expect(o).toMatchObject({
      product: { title: "Lactaid 2% Reduced Fat Milk", sizeText: "96 fl oz" },
      facts: { price: { amountMinor: 638 }, promoTags: ["Great price"] },
    });
    for (const x of out.observations) expect(x.product.sizeText).not.toMatch(/[★(]/);
  });

  it("every tile completes to a schema-valid PriceObservation", () => {
    out.observations.forEach((o, i) => {
      const parsed = PriceObservation.safeParse(minted(o, i + 1));
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(
        true,
      );
    });
  });

  it("the same product id under two stores is two observations, not a duplicate", () => {
    const skus = out.observations.map((o) => o.product.retailerSku);
    expect(new Set(skus).size).toBeLessThan(skus.length);
    expect(new Set(out.observations.map((o) => o.product.url)).size).toBe(skus.length);
  });
});

describe("instacart tiles on the recommendation carousels of a rendered page", () => {
  const doc = parseDocument(bananas.html, URL_AISLE);
  const out = extractTiles(doc);
  const skus = out.observations.map((o) => o.product.retailerSku);

  it("yields one observation per distinct tile that shows a price", () => {
    const rendered = new Set(
      Array.from(doc.querySelectorAll('[data-testid^="item_list_item_items_"]')).map((el) =>
        (el.getAttribute("data-testid") ?? "").replace(/^.*-/, ""),
      ),
    );
    expect(rendered.size).toBeGreaterThanOrEqual(10);
    expect(new Set(skus)).toEqual(rendered);
    expect(skus.length).toBe(rendered.size);
    expect(out.skipped).toEqual({});
  });

  it("every tile carries sku, title, price, the store from the tile id, and the page's context", () => {
    for (const o of out.observations) {
      expect(o.product.retailerSku).toMatch(/^\d+$/);
      expect(o.product.title.length).toBeGreaterThan(0);
      expect(o.facts.price.amountMinor).toBeGreaterThan(0);
      expect(o.facts.priceText).toMatch(/^\$\d+\.\d{2}$/);
      expect(o.store).toEqual({ retailerStoreId: "10769", label: "Wegmans" });
      expect(o.context).toEqual({
        fulfillment: "delivery",
        sessionState: "logged_in",
        surface: "web",
        device: "desktop",
      });
      expect(o.product.url).toBe(
        `https://www.instacart.com/products/${o.product.retailerSku}-${o.product.url.split("-").slice(1).join("-").split("?")[0]}?retailerSlug=wegmans`,
      );
      expect(o.adapter).toBe("instacart@0.2.0");
      expect(o.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("reads the strawberries tile: packaged, 16 oz, $6.89", () => {
    const o = out.observations.find((x) => x.product.retailerSku === "17327037");
    expect(o).toMatchObject({
      product: {
        title: "Organic Strawberries",
        sizeText: "16 oz",
        url: "https://www.instacart.com/products/17327037-organic-strawberries-package-16-oz?retailerSlug=wegmans",
      },
      facts: { price: { amountMinor: 689 }, priceText: "$6.89", isEstimate: false, promoTags: [] },
    });
    expect(o?.facts.wasPrice).toBeUndefined();
    expect(o?.facts.unitPriceText).toBeUndefined();
  });

  it("reads the organic bananas tile: by-weight estimate with a unit price", () => {
    const o = out.observations.find((x) => x.product.retailerSku === "3255474");
    expect(o).toMatchObject({
      product: { title: "Wegmans Organic Bananas, Bunch", sizeText: "About 2.0 lb each" },
      facts: { price: { amountMinor: 178 }, isEstimate: true, unitPriceText: "$0.89 / lb" },
    });
  });

  it("hashes each tile's own price container", () => {
    const tile = doc.querySelector('[data-testid="item_list_item_items_10769-17327037"]');
    const label = Array.from(tile?.querySelectorAll("span.screen-reader-only") ?? []).find((s) =>
      /^current price:/i.test(s.textContent ?? ""),
    );
    const container = label?.parentElement;
    expect(container).toBeDefined();
    if (!container) return;
    const o = out.observations.find((x) => x.product.retailerSku === "17327037");
    expect(o?.evidenceHash).toBe(evidenceHash(container));
  });

  it("every tile completes to a schema-valid PriceObservation", () => {
    out.observations.forEach((o, i) => {
      const parsed = PriceObservation.safeParse(minted(o, i + 1));
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(
        true,
      );
    });
  });

  it("honours context overrides like the hero does", () => {
    const o = extractTiles(doc, { ...ctx, sessionState: "logged_out", cleanSession: true });
    expect(o.observations[0]?.context).toMatchObject({
      sessionState: "logged_out",
      cleanSession: true,
    });
  });
});

describe("instacart tiles: the shapes the brief describes", () => {
  const header =
    '<div id="store-menu-wrapper"><a href="/store/walmart/storefront"><h2>Walmart</h2></a></div>';

  function tile(inner: string, testid = "item_list_item_items_151190-20654983"): string {
    return `<li data-testid="${testid}"><div data-item-card="true"><div aria-label="Product">${inner}</div></div></li>`;
  }

  const rollback = tile(
    '<a href="/products/20654983-great-value-milk-vitamin-d-whole-1-gl">' +
      '<div><span class="screen-reader-only">Current price: $4.78</span><span aria-hidden="true">$4.78</span></div>' +
      '<div><span class="screen-reader-only">Original price: $5.32</span><s aria-hidden="true">$5.32</s></div>' +
      "<div><span>Rollback</span></div>" +
      "<h3>Great Value Whole Vitamin D Milk</h3>" +
      "<div><div>1 gal</div><div>$0.04/fl oz</div></div>" +
      '</a><button aria-label="Add 1 ct Great Value Whole Vitamin D Milk">Add</button>',
  );

  it("a Rollback tile: price, struck-through was-price, the badge, store from the header and tile id", () => {
    const doc = fragmentDocument(
      `${header}<ul>${rollback}</ul>`,
      "https://www.instacart.com/store/walmart/s?k=milk",
    );
    const out = extractTiles(doc, {
      ...ctx,
      url: "https://www.instacart.com/store/walmart/s?k=milk",
    });
    expect(out.skipped).toEqual({});
    expect(out.observations).toHaveLength(1);
    const o = out.observations[0];
    expect(o).toMatchObject({
      product: {
        retailerSku: "20654983",
        title: "Great Value Whole Vitamin D Milk",
        sizeText: "1 gal",
        url: "https://www.instacart.com/products/20654983-great-value-milk-vitamin-d-whole-1-gl?retailerSlug=walmart",
      },
      facts: {
        price: { amountMinor: 478, currency: "USD" },
        priceText: "$4.78",
        wasPrice: { amountMinor: 532, currency: "USD" },
        promoTags: ["Rollback"],
        unitPriceText: "$0.04/fl oz",
        memberPrice: false,
      },
      store: { retailerStoreId: "151190", label: "Walmart" },
      context: { fulfillment: "delivery", fulfillmentInferred: true, sessionState: "unknown" },
    });
  });

  it("a was-price written as text, and a title only in the Add button", () => {
    const doc = fragmentDocument(
      `${header}${tile(
        '<a href="/products/2-eggs" aria-label="Eggs, 12 count">' +
          '<div><span class="screen-reader-only">Current price: $2.55</span></div>' +
          "<div>Rollback $2.55 was $3.10</div></a>" +
          '<button aria-label="Add 1 ct Free Range Eggs">Add</button>',
        "item_list_item_items_151190-2",
      )}`,
    );
    const o = extractTiles(doc).observations[0];
    expect(o).toMatchObject({
      product: { retailerSku: "2", title: "Free Range Eggs" },
      facts: { price: { amountMinor: 255 }, wasPrice: { amountMinor: 310 } },
    });
    // "Free" in the title is not an offer; the promo text next to the price is.
    expect(o?.facts.promoTags).toEqual(["Rollback $2.55 was $3.10"]);
  });

  it("tiles without a price, without a product link, or with a duplicate SKU are counted, not stored", () => {
    const doc = fragmentDocument(
      `${header}${tile('<a href="/products/1-a"><h3>No price</h3></a>', "x-1")}${tile(
        '<div><span class="screen-reader-only">Current price: $1.00</span></div><h3>No link</h3>',
        "x-2",
      )}${tile(
        '<a href="/products/3-c"><div><span class="screen-reader-only">Current price: $3.00</span></div><h3>C</h3></a>',
        "x-3",
      )}${tile(
        '<a href="/products/3-c"><div><span class="screen-reader-only">Current price: $3.00</span></div><h3>C again</h3></a>',
        "x-4",
      )}`,
    );
    const out = extractTiles(doc);
    expect(out.observations.map((o) => o.product.title)).toEqual(["C"]);
    expect(out.skipped).toEqual({ no_price: 1, no_sku: 1 });
  });

  it("falls back to li tiles when no data-item-card is rendered", () => {
    const li =
      '<li data-testid="item_list_item_items_5-9"><a href="/products/9-z">' +
      '<div><span class="screen-reader-only">Current price: $9.99</span></div><h3>Z</h3></a></li>';
    const doc = fragmentDocument(`${header}<ul>${li}</ul>`);
    const o = extractTiles(doc).observations[0];
    expect(o).toMatchObject({
      product: { retailerSku: "9", title: "Z" },
      store: { retailerStoreId: "5", label: "Walmart" },
    });
  });

  it("keeps a tile's own store path when its link already names one", () => {
    const doc = fragmentDocument(
      `${header}${tile(
        '<a href="/store/walmart/products/4-d"><div><span class="screen-reader-only">Current price: $4.00</span></div><h3>D</h3></a>',
      )}`,
    );
    expect(extractTiles(doc).observations[0]?.product.url).toBe(
      "https://www.instacart.com/store/walmart/products/4-d",
    );
  });

  it("a broken document yields an empty extraction, never a throw", () => {
    expect(extractTiles(undefined as unknown as Document)).toEqual({
      observations: [],
      skipped: { adapter_threw: 1 },
    });
  });
});

/**
 * The Product JSON-LD reader: every shape a retailer might serve, and the SKU guard that keeps
 * a stale block (a modal opened over the page that carried it) from being trusted.
 */
import { describe, expect, it } from "vitest";
import {
  allProductJsonLd,
  formatUsd,
  jsonLdEvidenceHash,
  moneyFromJsonLd,
  productJsonLd,
} from "../../src/capture/jsonld";
import { sha256Hex } from "../../src/capture/sha256";
import { parseDocument } from "./dom";

const skuInUrl = (url: string): string | undefined => /\/products\/(\d+)/.exec(url)?.[1];

function page(...blocks: string[]): Document {
  const scripts = blocks.map((b) => `<script type="application/ld+json">${b}</script>`).join("");
  return parseDocument(`<!doctype html><html><head>${scripts}</head><body></body></html>`);
}

const PRODUCT = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Whole Milk",
  brand: { "@type": "Brand", name: "Great Value" },
  size: "1 gal",
  offers: {
    "@type": "Offer",
    price: "4.95",
    priceCurrency: "USD",
    url: "https://www.instacart.com/products/20654983-great-value-milk",
  },
});

describe("moneyFromJsonLd", () => {
  it.each([
    ["4.95", 495],
    [4.95, 495],
    ["4", 400],
    ["12.5", 1250],
    ["$0.22", 22],
    [" 1,234.56 ", undefined],
    ["free", undefined],
    ["", undefined],
    [null, undefined],
  ])("%j -> %j", (input, minor) => {
    const money = moneyFromJsonLd(input);
    expect(money?.amountMinor).toBe(minor);
    if (money) expect(money.currency).toBe("USD");
  });

  it("formats back to the rendered dollar string", () => {
    expect(formatUsd({ amountMinor: 495, currency: "USD" })).toBe("$4.95");
    expect(formatUsd({ amountMinor: 5, currency: "USD" })).toBe("$0.05");
    expect(formatUsd({ amountMinor: 123400, currency: "USD" })).toBe("$1234.00");
  });
});

describe("productJsonLd", () => {
  it("reads a bare Product with an Offer, matched by the offer URL", () => {
    const product = productJsonLd(page(PRODUCT), "20654983", skuInUrl);
    expect(product).toMatchObject({
      name: "Whole Milk",
      brand: "Great Value",
      size: "1 gal",
      price: { amountMinor: 495, currency: "USD" },
      priceText: "$4.95",
      url: "https://www.instacart.com/products/20654983-great-value-milk",
    });
    expect(product?.scriptText).toBe(PRODUCT);
    expect(product && jsonLdEvidenceHash(product)).toBe(sha256Hex(PRODUCT));
  });

  it("reads a Product inside @graph, and an array of blocks", () => {
    const graph = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [{ "@type": "BreadcrumbList" }, JSON.parse(PRODUCT)],
    });
    expect(productJsonLd(page(graph), "20654983", skuInUrl)?.name).toBe("Whole Milk");
    const array = JSON.stringify([{ "@type": "WebSite" }, JSON.parse(PRODUCT)]);
    expect(productJsonLd(page(array), "20654983", skuInUrl)?.name).toBe("Whole Milk");
  });

  it("matches by sku / productID when the block carries no URL", () => {
    const bySku = JSON.stringify({
      "@type": "Product",
      name: "A",
      sku: "123",
      offers: { price: 1 },
    });
    expect(productJsonLd(page(bySku), "123", skuInUrl)?.price?.amountMinor).toBe(100);
    const byId = JSON.stringify({ "@type": "Product", name: "B", productID: 456 });
    expect(productJsonLd(page(byId), "456", skuInUrl)?.name).toBe("B");
  });

  it("returns nothing for a block that names another SKU, or no SKU at all", () => {
    expect(productJsonLd(page(PRODUCT), "1", skuInUrl)).toBeUndefined();
    const anonymous = JSON.stringify({ "@type": "Product", name: "C", offers: { price: "2.00" } });
    expect(productJsonLd(page(anonymous), "1", skuInUrl)).toBeUndefined();
  });

  it("picks the matching block when several are present", () => {
    const other = PRODUCT.replace("20654983", "1").replace("Whole Milk", "Other");
    expect(productJsonLd(page(other, PRODUCT), "20654983", skuInUrl)?.name).toBe("Whole Milk");
    expect(allProductJsonLd(page(other, PRODUCT)).map((p) => p.name)).toEqual([
      "Other",
      "Whole Milk",
    ]);
  });

  it("reads an array of offers and an AggregateOffer's low price", () => {
    const offers = JSON.stringify({
      "@type": "Product",
      name: "D",
      sku: "7",
      offers: [
        { "@type": "Offer", price: "3.10" },
        { "@type": "Offer", price: "3.50" },
      ],
    });
    expect(productJsonLd(page(offers), "7", skuInUrl)?.price?.amountMinor).toBe(310);
    const aggregate = JSON.stringify({
      "@type": "Product",
      name: "E",
      sku: "8",
      offers: { "@type": "AggregateOffer", lowPrice: "2.25", highPrice: "3.00" },
    });
    expect(productJsonLd(page(aggregate), "8", skuInUrl)?.price?.amountMinor).toBe(225);
  });

  it("drops a price in another currency, keeps the rest of the block", () => {
    const eur = JSON.stringify({
      "@type": "Product",
      name: "F",
      sku: "9",
      offers: { price: "4.00", priceCurrency: "EUR" },
    });
    const product = productJsonLd(page(eur), "9", skuInUrl);
    expect(product?.name).toBe("F");
    expect(product?.price).toBeUndefined();
    expect(product?.priceText).toBeUndefined();
  });

  it("accepts a plain-string brand and a typed @type array", () => {
    const block = JSON.stringify({
      "@type": ["Product", "Thing"],
      name: "G",
      sku: "10",
      brand: "  Acme  ",
    });
    expect(productJsonLd(page(block), "10", skuInUrl)?.brand).toBe("Acme");
  });

  it("skips malformed JSON and non-Product blocks without throwing", () => {
    expect(
      productJsonLd(page("{oops", '{"@type":"Organization"}', PRODUCT), "20654983", skuInUrl)?.name,
    ).toBe("Whole Milk");
    expect(allProductJsonLd(page("{oops"))).toEqual([]);
    expect(allProductJsonLd(parseDocument("<html><body></body></html>"))).toEqual([]);
  });
});

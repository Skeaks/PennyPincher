/**
 * The acceptance test for the Walmart adapter: every fixture under fixtures/walmart/ extracts
 * to an observation whose fields match its `.meta.json`. Same shape as instacart.test.ts.
 *
 * All four fixtures are product pages the browser rendered at the East Windsor Supercenter.
 * Walmart never renders its store number (the sidecar's 3266 is from the capture log), so the
 * store assertion is label-only, as the brief and the schema say. Every page shows Pickup
 * selected in the fulfilment radios and the hero price in `[data-testid="price-wrap"]`.
 */
import { PriceObservation } from "@pennypincher/schema";
import { describe, expect, it } from "vitest";
import type { PageContext } from "../../src/capture/adapter";
import { WALMART_ADAPTER_VERSION, walmartAdapter } from "../../src/capture/adapters/walmart";
import { evidenceHash } from "../../src/capture/evidence";
import { emptyHealthState, withOutcome } from "../../src/capture/health";
import { buildObservation, captureOnce } from "../../src/capture/run";
import { sha256Hex } from "../../src/capture/sha256";
import { type Fixture, fragmentDocument, listFixtures, parseDocument } from "./dom";

const fixtures = listFixtures("walmart");

function urlFor(f: Fixture): string {
  // The real Walmart URL shape, with query and fragment the adapter must strip.
  return `https://www.walmart.com/ip/${f.slug}/${f.meta.expected.retailerSku}?athbdg=L1600&from=%2Fsearch#top`;
}

function canonicalFor(f: Fixture): string {
  return urlFor(f).split("?")[0] ?? "";
}

function ctxFor(f: Fixture, overrides: Partial<PageContext> = {}): PageContext {
  return { url: urlFor(f), surface: "web", device: "desktop", ...overrides };
}

function extractFixture(f: Fixture, overrides: Partial<PageContext> = {}) {
  const result = walmartAdapter.extract(parseDocument(f.html, urlFor(f)), ctxFor(f, overrides));
  if (!result.ok) throw new Error(`${f.slug}: ${result.reason} ${result.detail ?? ""}`);
  return result.observation;
}

function byslug(slug: string): Fixture {
  const f = fixtures.find((x) => x.slug === slug);
  if (!f) throw new Error(`no fixture ${slug}`);
  return f;
}

describe("walmart adapter against every fixture", () => {
  it("has at least four fixtures to test against", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(4);
    expect(fixtures.every((f) => f.meta.retailer === "walmart")).toBe(true);
  });

  for (const f of fixtures) {
    describe(f.slug, () => {
      it("matches the product URL as a product surface", () => {
        expect(walmartAdapter.matches(urlFor(f))).toBe(true);
        expect(walmartAdapter.pageKind(urlFor(f))).toBe("product");
      });

      it("extracts the sidecar's expected block", () => {
        const o = extractFixture(f);
        expect(o.retailer).toBe("walmart");
        expect(o.product.retailerSku).toBe(f.meta.expected.retailerSku);
        expect(o.product.title).toBe(f.meta.expected.title);
        expect(o.facts.price).toEqual(f.meta.expected.price);
        expect(o.facts.priceText).toBe(f.meta.expected.priceText);
      });

      it("extracts the store label only: Walmart renders no store number", () => {
        const o = extractFixture(f);
        expect(o.store).toEqual({ label: f.meta.store.label });
        expect(f.html).not.toContain(f.meta.store.retailerStoreId);
      });

      it("extracts the selected fulfilment (never inferred: every page shows the radios)", () => {
        const o = extractFixture(f);
        expect(o.context.fulfillment).toBe(f.meta.fulfillment);
        expect(o.context.fulfillmentInferred).toBeUndefined();
      });

      it("extracts the session state the sidecar records", () => {
        expect(extractFixture(f).context.sessionState).toBe(f.meta.sessionState);
      });

      it("records no zip3 (the fixture's ZIP is scrubbed) and no cleanSession", () => {
        const o = extractFixture(f);
        expect(o.context.zip3).toBeUndefined();
        expect(o.context.cleanSession).toBeUndefined();
      });

      it("canonicalises the URL and carries surface, device and provenance", () => {
        const o = extractFixture(f);
        expect(o.product.url).toBe(canonicalFor(f));
        expect(o.context.surface).toBe("web");
        expect(o.context.device).toBe("desktop");
        expect(o.adapter).toBe(`walmart@${WALMART_ADAPTER_VERSION}`);
        expect(o.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
      });

      it("completes to a schema-valid PriceObservation", () => {
        const o = buildObservation(extractFixture(f), {
          observationId: "6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b",
          panelistId: "0b1c2d3e-4f50-4a61-9b72-83c4d5e6f7a8",
          observedAt: "2026-09-04T15:26:18.000Z",
          clientVersion: "0.1.0",
        });
        const parsed = PriceObservation.safeParse(o);
        expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(
          true,
        );
        expect(JSON.parse(JSON.stringify(o))).toEqual(o);
      });

      it("evidence hash is the SHA-256 of the scrubbed price-wrap (no JSON-LD survives scrubbing)", () => {
        const doc = parseDocument(f.html, urlFor(f));
        expect(doc.querySelector('script[type="application/ld+json"]')).toBeNull();
        const container = doc.querySelector('[data-testid="price-wrap"]');
        expect(container).not.toBeNull();
        if (!container) return;
        expect(extractFixture(f).evidenceHash).toBe(evidenceHash(container));
      });
    });
  }
});

describe("walmart adapter: fields beyond the sidecar", () => {
  it("fresh banana: by-weight estimate, cents-per-lb unit price, no brand (Unbranded), no promos", () => {
    const o = extractFixture(byslug("fresh-banana-each"));
    expect(o.facts.isEstimate).toBe(true);
    expect(o.facts.unitPriceText).toBe("16.0 ¢/lb");
    expect(o.product.brand).toBeUndefined();
    expect(o.product.sizeText).toBeUndefined();
    expect(o.product.upc).toBeUndefined();
    expect(o.facts.promoTags).toEqual([]);
    expect(o.facts.memberPrice).toBe(false);
    expect(o.facts.wasPrice).toBeUndefined();
  });

  it("frozen sliced bananas: packaged, not an estimate, per-lb unit price, Great Value brand", () => {
    const o = extractFixture(byslug("great-value-sliced-bananas-frozen-16oz"));
    expect(o.facts.isEstimate).toBe(false);
    expect(o.facts.unitPriceText).toBe("$2.47/lb");
    expect(o.product.brand).toBe("Great Value");
  });

  it("marketside bananas: estimate with a per-lb unit price and the Marketside brand", () => {
    const o = extractFixture(byslug("marketside-organic-bananas-bunch"));
    expect(o.facts.isEstimate).toBe(true);
    expect(o.facts.unitPriceText).toBe("74.0 ¢/lb");
    expect(o.product.brand).toBe("Marketside");
  });

  it("the logged-in and logged-out banana pages hash to the same evidence, same store", () => {
    const a = extractFixture(byslug("fresh-banana-each"));
    const b = extractFixture(byslug("fresh-banana-each-logged-out"));
    expect(a.evidenceHash).toBe(b.evidenceHash);
    expect(a.store).toEqual(b.store);
    expect(a.context.sessionState).toBe("logged_in");
    expect(b.context.sessionState).toBe("logged_out");
  });

  it("reads the hero price, not a sponsored tile's", () => {
    const f = byslug("fresh-banana-each");
    const doc = parseDocument(f.html, urlFor(f));
    // The "Frequently bought together" and sponsored carousels carry other prices.
    expect(doc.querySelectorAll('[data-test-id="gpt-main"]').length).toBeGreaterThan(0);
    expect(doc.body.textContent).toContain("$11.99");
    expect(extractFixture(f).facts.price.amountMinor).toBe(6);
  });

  it("reads zip3 from the store nudge when the page displays a ZIP", () => {
    const f = byslug("fresh-banana-each");
    const doc = parseDocument(f.html, urlFor(f));
    const nudge = doc.querySelector('[data-testid="depot-store-nudge"]');
    expect(nudge).not.toBeNull();
    if (!nudge) return;
    const zip = doc.createElement("span");
    zip.textContent = "Princeton, 08540";
    nudge.appendChild(zip);
    const result = walmartAdapter.extract(doc, ctxFor(f));
    expect(result.ok && result.observation.context.zip3).toBe("085");
  });

  it("context overrides win over the page (what the S06 probe needs)", () => {
    const o = extractFixture(byslug("fresh-banana-each"), {
      sessionState: "logged_out",
      cleanSession: true,
      fulfillment: "delivery",
      surface: "mobile_web",
      device: "mobile",
    });
    expect(o.context).toMatchObject({
      sessionState: "logged_out",
      cleanSession: true,
      fulfillment: "delivery",
      surface: "mobile_web",
      device: "mobile",
    });
    expect(o.context.fulfillmentInferred).toBeUndefined();
  });

  it("with no fulfilment radios, reads the zone-2 line; with neither, ships as inferred", () => {
    const f = byslug("fresh-banana-each");
    const doc = parseDocument(f.html, urlFor(f));
    doc.querySelector('[data-testid="fulfillment-zone-1"]')?.remove();
    const fromLine = walmartAdapter.extract(doc, ctxFor(f));
    expect(fromLine.ok && fromLine.observation.context).toMatchObject({ fulfillment: "pickup" });
    expect(fromLine.ok && fromLine.observation.context.fulfillmentInferred).toBeUndefined();

    doc.querySelector('[data-testid="fulfillment-zone-2"]')?.remove();
    const bare = walmartAdapter.extract(doc, ctxFor(f));
    expect(bare.ok && bare.observation.context).toMatchObject({
      fulfillment: "ship",
      fulfillmentInferred: true,
    });
    expect(bare.ok && bare.observation.store).toBeUndefined();
  });
});

describe("walmart adapter: graceful degradation", () => {
  const f = byslug("marketside-organic-bananas-bunch");

  it("a page with its price container removed fails as a value, counts as failed, stores nothing", async () => {
    const doc = parseDocument(f.html, urlFor(f));
    for (const el of Array.from(doc.querySelectorAll('[data-testid="price-wrap"]'))) el.remove();
    expect(walmartAdapter.extract(doc, ctxFor(f))).toEqual({ ok: false, reason: "no_price" });

    const appended: unknown[] = [];
    const outcome = await captureOnce(doc, ctxFor(f), {
      hasConsent: async () => true,
      append: async (o) => {
        appended.push(o);
        return 1;
      },
      panelistId: async () => "0b1c2d3e-4f50-4a61-9b72-83c4d5e6f7a8",
      clientVersion: "0.1.0",
      now: () => new Date("2026-09-07T15:00:00.000Z"),
      uuid: () => "6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b",
      adapters: [walmartAdapter],
    });
    expect(outcome).toEqual({
      status: "extract_failed",
      adapter: `walmart@${WALMART_ADAPTER_VERSION}`,
      reason: "no_price",
    });
    expect(appended).toEqual([]);
    const health = withOutcome(emptyHealthState(new Date("2026-09-07T15:00:00.000Z")), outcome);
    expect(health.adapters[`walmart@${WALMART_ADAPTER_VERSION}`]).toEqual({
      attempted: 1,
      extracted: 0,
      failed: { no_price: 1 },
    });
  });

  it("a price element without a dollar amount is unparseable_price", () => {
    const doc = parseDocument(f.html, urlFor(f));
    const price = doc.querySelector('[data-seo-id="hero-price"]');
    if (price) price.textContent = "Price in cart";
    expect(walmartAdapter.extract(doc, ctxFor(f))).toEqual({
      ok: false,
      reason: "unparseable_price",
      detail: "Price in cart",
    });
  });
});

/** A Walmart-shaped Product block naming the frozen bananas by offers.url, for the JSON-LD path. */
const FROZEN_JSON_LD = `
  {"@context":"https://schema.org","@type":"Product","name":"Great Value Sliced Bananas, 16 oz Bag","brand":{"@type":"Brand","name":"Great Value"},"offers":{"@type":"Offer","price":2.47,"priceCurrency":"USD","url":"https://www.walmart.com/ip/Great-Value-Sliced-Bananas-16-oz-Bag/14336395"}}
`;

function withJsonLd(html: string, jsonLd: string): string {
  return html.replace("</head>", `<script type="application/ld+json">${jsonLd}</script></head>`);
}

describe("walmart adapter: JSON-LD first", () => {
  const f = byslug("great-value-sliced-bananas-frozen-16oz");

  it("takes title, brand and price from the Product block and hashes its text; the DOM fills the rest", () => {
    const doc = parseDocument(withJsonLd(f.html, FROZEN_JSON_LD), urlFor(f));
    const result = walmartAdapter.extract(doc, ctxFor(f));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const o = result.observation;
    expect(o.product.title).toBe("Great Value Sliced Bananas, 16 oz Bag");
    expect(o.product.brand).toBe("Great Value");
    expect(o.facts.price).toEqual({ amountMinor: 247, currency: "USD" });
    expect(o.evidenceHash).toBe(sha256Hex(FROZEN_JSON_LD.trim()));
    expect(o.evidenceHash).not.toBe(extractFixture(f).evidenceHash);
    expect(o.facts.unitPriceText).toBe("$2.47/lb");
    expect(o.store).toEqual({ label: "East Windsor Supercenter" });
    expect(o.context).toMatchObject({ fulfillment: "pickup", sessionState: "logged_in" });
  });

  it("still extracts when the DOM shows no price at all (server-rendered HTML)", () => {
    const doc = parseDocument(withJsonLd(f.html, FROZEN_JSON_LD), urlFor(f));
    for (const el of Array.from(doc.querySelectorAll('[data-testid="price-wrap"]'))) el.remove();
    expect(walmartAdapter.extract(doc, ctxFor(f))).toMatchObject({
      ok: true,
      observation: { facts: { price: { amountMinor: 247 }, priceText: "$2.47" } },
    });
  });

  it("ignores a Product block for a different SKU", () => {
    const stale = FROZEN_JSON_LD.replace("14336395", "99999999");
    const doc = parseDocument(withJsonLd(f.html, stale), urlFor(f));
    const result = walmartAdapter.extract(doc, ctxFor(f));
    expect(result.ok && result.observation.evidenceHash).toBe(extractFixture(f).evidenceHash);
  });
});

describe("walmart adapter: matches and pageKind", () => {
  it.each([
    "https://www.walmart.com/ip/Fresh-Banana-Each/44390948",
    "https://www.walmart.com/ip/Fresh-Banana-Each/44390948?athbdg=L1600#top",
    "https://www.walmart.com/ip/44390948",
    "https://walmart.com/ip/Marketside-Fresh-Organic-Bananas-Bunch/51259338/",
    "http://m.walmart.com/ip/x/1?y=2",
  ])("accepts %s as a product surface", (url) => {
    expect(walmartAdapter.matches(url)).toBe(true);
    expect(walmartAdapter.pageKind(url)).toBe("product");
  });

  it.each([
    "https://www.walmart.com/",
    "https://www.walmart.com/search?q=bananas",
    "https://www.walmart.com/browse/food/fresh-fruit/976759_976793_9755771",
    "https://www.walmart.com/cp/great-value/3495493",
    "https://www.walmart.com/reviews/product/44390948",
    "https://www.walmart.com/ip/Fresh-Banana-Each/not-a-number",
    "https://www.target.com/p/fresh-banana/-/A-15013944",
    "https://evil.example/www.walmart.com/ip/x/1",
    "https://notwalmart.com/ip/x/1",
    "not a url",
    "",
  ])("rejects %s (no listing surface until a fixture shows one)", (url) => {
    expect(walmartAdapter.matches(url)).toBe(false);
    expect(walmartAdapter.pageKind(url)).toBeUndefined();
  });

  it("has no tile extractor yet: no Walmart listing fixture exists", () => {
    expect(walmartAdapter.extractTiles).toBeUndefined();
  });
});

describe("walmart adapter: failures are values, never throws", () => {
  const url = "https://www.walmart.com/ip/Fresh-Banana-Each/44390948";
  const ctx: PageContext = { url, surface: "web", device: "desktop" };

  it("a non-product URL is not_product_page", () => {
    const doc = parseDocument(byslug("fresh-banana-each").html);
    expect(
      walmartAdapter.extract(doc, { ...ctx, url: "https://www.walmart.com/search?q=x" }),
    ).toEqual({ ok: false, reason: "not_product_page" });
  });

  it("an empty page is no_title", () => {
    expect(walmartAdapter.extract(fragmentDocument(""), ctx)).toEqual({
      ok: false,
      reason: "no_title",
    });
  });

  it("a title without a price is no_price", () => {
    const doc = fragmentDocument('<h1 id="main-title">Bananas</h1>');
    expect(walmartAdapter.extract(doc, ctx)).toEqual({ ok: false, reason: "no_price" });
  });

  it("a bare product page records shipping as inferred, session unknown, no store", () => {
    const doc = fragmentDocument(
      '<h1 id="main-title">Bananas</h1><div><span data-testid="price-wrap"><span itemprop="price" data-seo-id="hero-price">$1.00</span></span></div>',
    );
    const result = walmartAdapter.extract(doc, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.context).toMatchObject({
      fulfillment: "ship",
      fulfillmentInferred: true,
      sessionState: "unknown",
    });
    expect(result.observation.store).toBeUndefined();
    expect(result.observation.product.retailerSku).toBe("44390948");
    expect(result.observation.facts.isEstimate).toBe(false);
  });

  it("a document that is not a document yields adapter_threw rather than an exception", () => {
    expect(walmartAdapter.extract(undefined as unknown as Document, ctx)).toMatchObject({
      ok: false,
      reason: "adapter_threw",
    });
  });
});

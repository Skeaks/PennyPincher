/**
 * The acceptance test for the Target adapter: every fixture under fixtures/target/ extracts
 * to an observation whose fields match its `.meta.json`. Same shape as instacart.test.ts.
 *
 * All four fixtures are product pages the browser rendered (Durham store, plus the Princeton
 * pair for the logged-out banana). Each renders the store id (`button#store-name-<id>`), a
 * selected Pickup cell, and the hero price twice: in the price module's rich-text span and in
 * the sticky add-to-cart bar's `[data-test="product-price"]`. The lazy-skeleton trap the brief
 * records (an empty `product-price` until scroll) is exercised by emptying the copies.
 */
import { PriceObservation } from "@pennypincher/schema";
import { describe, expect, it } from "vitest";
import type { PageContext } from "../../src/capture/adapter";
import { TARGET_ADAPTER_VERSION, targetAdapter } from "../../src/capture/adapters/target";
import { evidenceHash } from "../../src/capture/evidence";
import { emptyHealthState, withOutcome } from "../../src/capture/health";
import { buildObservation, captureOnce } from "../../src/capture/run";
import { sha256Hex } from "../../src/capture/sha256";
import { type Fixture, fragmentDocument, listFixtures, parseDocument } from "./dom";

const fixtures = listFixtures("target");

function urlFor(f: Fixture): string {
  // The real Target URL shape, with query and fragment the adapter must strip.
  return `https://www.target.com/p/${f.slug}/-/A-${f.meta.expected.retailerSku}?preselect=1&lnk=sametab#top`;
}

function canonicalFor(f: Fixture): string {
  return urlFor(f).split("?")[0] ?? "";
}

function ctxFor(f: Fixture, overrides: Partial<PageContext> = {}): PageContext {
  return { url: urlFor(f), surface: "web", device: "desktop", ...overrides };
}

function extractFixture(f: Fixture, overrides: Partial<PageContext> = {}) {
  const result = targetAdapter.extract(parseDocument(f.html, urlFor(f)), ctxFor(f, overrides));
  if (!result.ok) throw new Error(`${f.slug}: ${result.reason} ${result.detail ?? ""}`);
  return result.observation;
}

function byslug(slug: string): Fixture {
  const f = fixtures.find((x) => x.slug === slug);
  if (!f) throw new Error(`no fixture ${slug}`);
  return f;
}

describe("target adapter against every fixture", () => {
  it("has at least four fixtures to test against", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(4);
    expect(fixtures.every((f) => f.meta.retailer === "target")).toBe(true);
  });

  for (const f of fixtures) {
    describe(f.slug, () => {
      it("matches the product URL as a product surface", () => {
        expect(targetAdapter.matches(urlFor(f))).toBe(true);
        expect(targetAdapter.pageKind(urlFor(f))).toBe("product");
      });

      it("extracts the sidecar's expected block", () => {
        const o = extractFixture(f);
        expect(o.retailer).toBe("target");
        expect(o.product.retailerSku).toBe(f.meta.expected.retailerSku);
        expect(o.product.title).toBe(f.meta.expected.title);
        expect(o.facts.price).toEqual(f.meta.expected.price);
        expect(o.facts.priceText).toBe(f.meta.expected.priceText);
      });

      it("extracts the store id and label the sidecar records", () => {
        expect(extractFixture(f).store).toEqual(f.meta.store);
      });

      it("extracts the selected fulfilment (never inferred: every page shows the cells)", () => {
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
        expect(o.adapter).toBe(`target@${TARGET_ADAPTER_VERSION}`);
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

      it("evidence hash is the SHA-256 of the scrubbed price box (no JSON-LD survives scrubbing)", () => {
        const doc = parseDocument(f.html, urlFor(f));
        expect(doc.querySelector('script[type="application/ld+json"]')).toBeNull();
        const container = doc.querySelector(
          '[data-test="module-product-detail-price-v2"] [data-test="price-cdui"]',
        );
        expect(container).not.toBeNull();
        if (!container) return;
        expect(extractFixture(f).evidenceHash).toBe(evidenceHash(container));
      });
    });
  }
});

describe("target adapter: fields beyond the sidecar", () => {
  it("banana (each): no unit price, Good & Gather brand, not an estimate, no promos", () => {
    const o = extractFixture(byslug("banana-each"));
    expect(o.facts.unitPriceText).toBeUndefined();
    expect(o.product.brand).toBe("Good & Gather");
    expect(o.product.sizeText).toBeUndefined();
    expect(o.product.upc).toBeUndefined();
    expect(o.facts.isEstimate).toBe(false);
    expect(o.facts.promoTags).toEqual([]);
    expect(o.facts.memberPrice).toBe(false);
    expect(o.facts.wasPrice).toBeUndefined();
  });

  it("avocados: per-count unit price next to the price", () => {
    const o = extractFixture(byslug("hass-avocados-4ct"));
    expect(o.facts.unitPriceText).toBe("$0.75/count");
    expect(o.facts.price.amountMinor).toBe(299);
  });

  it("organic bananas: per-ounce unit price", () => {
    const o = extractFixture(byslug("organic-bananas-2lb"));
    expect(o.facts.unitPriceText).toBe("$0.06/ounce");
  });

  it("the banana pair was captured at different stores: the ids differ, so STORE_DIFFERS can fire", () => {
    const durham = extractFixture(byslug("banana-each"));
    const princeton = extractFixture(byslug("banana-each-logged-out"));
    expect(durham.store).toEqual({ retailerStoreId: "1872", label: "Durham" });
    expect(princeton.store).toEqual({ retailerStoreId: "1151", label: "Princeton" });
    expect(durham.context.sessionState).toBe("logged_in");
    expect(princeton.context.sessionState).toBe("logged_out");
    expect(durham.product.retailerSku).toBe(princeton.product.retailerSku);
  });

  it("reads zip3 from the Ship-to button when the page displays a ZIP", () => {
    const f = byslug("banana-each");
    expect(f.html).toContain("Ship to [scrubbed]");
    const unscrubbed = f.html.replace("Ship to [scrubbed]", "Ship to 08540");
    const result = targetAdapter.extract(parseDocument(unscrubbed, urlFor(f)), ctxFor(f));
    expect(result.ok && result.observation.context.zip3).toBe("085");
  });

  it("context overrides win over the page (what the S06 probe needs)", () => {
    const o = extractFixture(byslug("banana-each"), {
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

  it("with no selected fulfilment cell, records shipping as inferred", () => {
    const f = byslug("banana-each");
    const doc = parseDocument(f.html, urlFor(f));
    for (const el of Array.from(doc.querySelectorAll('[data-test^="fulfillment-cell-"]'))) {
      el.remove();
    }
    const result = targetAdapter.extract(doc, ctxFor(f));
    expect(result.ok && result.observation.context).toMatchObject({
      fulfillment: "ship",
      fulfillmentInferred: true,
    });
  });

  it("falls back to the add-to-cart id for the SKU only through the URL path (the URL names it first)", () => {
    const f = byslug("banana-each");
    const doc = parseDocument(f.html, urlFor(f));
    expect(doc.querySelector("#addToCartButtonOrTextIdFor15013944")).not.toBeNull();
    expect(extractFixture(f).product.retailerSku).toBe("15013944");
  });
});

describe("target adapter: the lazy price box", () => {
  const f = byslug("hass-avocados-4ct");

  it("takes the hero box's rich-text price and hashes the box", () => {
    const doc = parseDocument(f.html, urlFor(f));
    const box = doc.querySelector('[data-test="price-cdui"]');
    expect(box).not.toBeNull();
    expect(doc.querySelectorAll('[data-test="product-price"]').length).toBe(1);
    expect(
      doc.querySelector('[data-test="product-price"]')?.closest('[data-test="sticky-atc"]'),
    ).not.toBeNull();
    const o = extractFixture(f);
    expect(o.facts.price.amountMinor).toBe(299);
    if (box) expect(o.evidenceHash).toBe(evidenceHash(box));
  });

  it("falls back to the sticky bar's product-price when the hero box is still a skeleton", () => {
    const doc = parseDocument(f.html, urlFor(f));
    for (const el of Array.from(doc.querySelectorAll('[data-test^="text-quill-insert"]'))) {
      el.textContent = "";
    }
    const result = targetAdapter.extract(doc, ctxFor(f));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.facts.price.amountMinor).toBe(299);
    expect(result.observation.facts.unitPriceText).toBe("$0.75/count");
    const sticky = doc.querySelector('[data-test="product-price"]');
    const container = sticky?.closest('[data-test="@web/Price/PriceFull"]');
    expect(container).not.toBeNull();
    if (container) expect(result.observation.evidenceHash).toBe(evidenceHash(container));
  });

  it("an empty skeleton everywhere is no_price, with a detail saying the box is empty", () => {
    const doc = parseDocument(f.html, urlFor(f));
    for (const el of Array.from(
      doc.querySelectorAll('[data-test^="text-quill-insert"], [data-test="product-price"]'),
    )) {
      el.textContent = "";
    }
    expect(targetAdapter.extract(doc, ctxFor(f))).toEqual({
      ok: false,
      reason: "no_price",
      detail: "price box empty",
    });
  });

  it("a page with its price containers removed fails as a value, counts as failed, stores nothing", async () => {
    const doc = parseDocument(f.html, urlFor(f));
    for (const el of Array.from(
      doc.querySelectorAll(
        '[data-test="module-product-detail-price-v2"], [data-test="sticky-atc"]',
      ),
    )) {
      el.remove();
    }
    expect(targetAdapter.extract(doc, ctxFor(f))).toEqual({ ok: false, reason: "no_price" });

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
      adapters: [targetAdapter],
    });
    expect(outcome).toEqual({
      status: "extract_failed",
      adapter: `target@${TARGET_ADAPTER_VERSION}`,
      reason: "no_price",
    });
    expect(appended).toEqual([]);
    const health = withOutcome(emptyHealthState(new Date("2026-09-07T15:00:00.000Z")), outcome);
    expect(health.adapters[`target@${TARGET_ADAPTER_VERSION}`]).toEqual({
      attempted: 1,
      extracted: 0,
      failed: { no_price: 1 },
    });
  });
});

/** A Target-shaped Product block naming the avocados by SKU, for the JSON-LD path. */
const AVOCADO_JSON_LD = `
  {"@context":"https://schema.org","@type":"Product","name":"Hass Avocados - 4ct - Good & Gather","sku":"81957708","brand":{"@type":"Brand","name":"Good & Gather"},"offers":{"@type":"Offer","price":"2.99","priceCurrency":"USD","url":"https://www.target.com/p/hass-avocados-4ct-good-38-gather-8482/-/A-81957708"}}
`;

function withJsonLd(html: string, jsonLd: string): string {
  return html.replace("</head>", `<script type="application/ld+json">${jsonLd}</script></head>`);
}

describe("target adapter: JSON-LD first", () => {
  const f = byslug("hass-avocados-4ct");

  it("takes title, brand and price from the Product block and hashes its text; the DOM fills the rest", () => {
    const doc = parseDocument(withJsonLd(f.html, AVOCADO_JSON_LD), urlFor(f));
    const result = targetAdapter.extract(doc, ctxFor(f));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const o = result.observation;
    expect(o.product.title).toBe("Hass Avocados - 4ct - Good & Gather");
    expect(o.product.brand).toBe("Good & Gather");
    expect(o.facts.price).toEqual({ amountMinor: 299, currency: "USD" });
    expect(o.evidenceHash).toBe(sha256Hex(AVOCADO_JSON_LD.trim()));
    expect(o.evidenceHash).not.toBe(extractFixture(f).evidenceHash);
    expect(o.facts.unitPriceText).toBe("$0.75/count");
    expect(o.store).toEqual({ retailerStoreId: "1872", label: "Durham" });
    expect(o.context).toMatchObject({ fulfillment: "pickup", sessionState: "logged_in" });
  });

  it("still extracts when every DOM price is a skeleton (server-rendered HTML)", () => {
    const doc = parseDocument(withJsonLd(f.html, AVOCADO_JSON_LD), urlFor(f));
    for (const el of Array.from(
      doc.querySelectorAll('[data-test^="text-quill-insert"], [data-test="product-price"]'),
    )) {
      el.textContent = "";
    }
    expect(targetAdapter.extract(doc, ctxFor(f))).toMatchObject({
      ok: true,
      observation: { facts: { price: { amountMinor: 299 }, priceText: "$2.99" } },
    });
  });

  it("ignores a Product block for a different SKU", () => {
    const stale = AVOCADO_JSON_LD.replace(/81957708/g, "99999999");
    const doc = parseDocument(withJsonLd(f.html, stale), urlFor(f));
    const result = targetAdapter.extract(doc, ctxFor(f));
    expect(result.ok && result.observation.evidenceHash).toBe(extractFixture(f).evidenceHash);
  });
});

describe("target adapter: matches and pageKind", () => {
  it.each([
    "https://www.target.com/p/fresh-banana-each-good-38-gather-8482/-/A-15013944",
    "https://www.target.com/p/hass-avocados-4ct-good-38-gather-8482/-/A-81957708?preselect=1#lnk=sametab",
    "https://target.com/p/-/A-85759852",
    "http://m.target.com/p/x/-/A-1?y=2",
  ])("accepts %s as a product surface", (url) => {
    expect(targetAdapter.matches(url)).toBe(true);
    expect(targetAdapter.pageKind(url)).toBe("product");
  });

  it.each([
    "https://www.target.com/",
    "https://www.target.com/s?searchTerm=bananas",
    "https://www.target.com/c/fresh-fruit-produce-grocery/-/N-5xt1m",
    "https://www.target.com/b/good-gather/-/N-yfqzk",
    "https://www.target.com/p/fresh-banana/-/A-abc",
    "https://www.walmart.com/ip/Fresh-Banana-Each/44390948",
    "https://evil.example/www.target.com/p/x/-/A-1",
    "https://nottarget.com/p/x/-/A-1",
    "not a url",
    "",
  ])("rejects %s (no listing surface until a fixture shows one)", (url) => {
    expect(targetAdapter.matches(url)).toBe(false);
    expect(targetAdapter.pageKind(url)).toBeUndefined();
  });

  it("has no tile extractor yet: no Target listing fixture exists", () => {
    expect(targetAdapter.extractTiles).toBeUndefined();
  });
});

describe("target adapter: failures are values, never throws", () => {
  const url = "https://www.target.com/p/fresh-banana-each/-/A-15013944";
  const ctx: PageContext = { url, surface: "web", device: "desktop" };

  it("a non-product URL is not_product_page", () => {
    const doc = parseDocument(byslug("banana-each").html);
    expect(
      targetAdapter.extract(doc, { ...ctx, url: "https://www.target.com/s?searchTerm=x" }),
    ).toEqual({ ok: false, reason: "not_product_page" });
  });

  it("an empty page is no_title", () => {
    expect(targetAdapter.extract(fragmentDocument(""), ctx)).toEqual({
      ok: false,
      reason: "no_title",
    });
  });

  it("a title without a price is no_price", () => {
    const doc = fragmentDocument('<h1 data-test="product-title">Bananas</h1>');
    expect(targetAdapter.extract(doc, ctx)).toEqual({ ok: false, reason: "no_price" });
  });

  it("a price box without a dollar amount is no_price with the detail", () => {
    const doc = fragmentDocument(
      '<h1 data-test="product-title">Bananas</h1><div data-test="module-product-detail-price-v2"><div data-test="price-cdui"><span data-test="text-quill-insert-0">free</span></div></div>',
    );
    expect(targetAdapter.extract(doc, ctx)).toEqual({
      ok: false,
      reason: "no_price",
      detail: "price box empty",
    });
  });

  it("a bare product page records shipping as inferred, session unknown, no store", () => {
    const doc = fragmentDocument(
      '<h1 data-test="product-title">Bananas</h1><div data-test="module-product-detail-price-v2"><div data-test="price-cdui"><span data-test="text-quill-insert-0">$1.00</span></div></div>',
    );
    const result = targetAdapter.extract(doc, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.context).toMatchObject({
      fulfillment: "ship",
      fulfillmentInferred: true,
      sessionState: "unknown",
    });
    expect(result.observation.store).toBeUndefined();
    expect(result.observation.product.retailerSku).toBe("15013944");
  });

  it("a document that is not a document yields adapter_threw rather than an exception", () => {
    expect(targetAdapter.extract(undefined as unknown as Document, ctx)).toMatchObject({
      ok: false,
      reason: "adapter_threw",
    });
  });
});

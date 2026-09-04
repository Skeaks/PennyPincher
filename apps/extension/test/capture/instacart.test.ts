/**
 * The acceptance test for the Instacart adapter: every fixture under fixtures/instacart/
 * extracts to an observation whose fields match its `.meta.json`. A fixture that fails is a
 * failing test, never a skipped one (the `for` below enumerates the directory; an empty
 * directory would fail the "at least one fixture" assertion).
 */
import { PriceObservation } from "@pennypincher/schema";
import { describe, expect, it } from "vitest";
import type { PageContext } from "../../src/capture/adapter";
import { INSTACART_ADAPTER_VERSION, instacartAdapter } from "../../src/capture/adapters/instacart";
import { evidenceHash } from "../../src/capture/evidence";
import { buildObservation } from "../../src/capture/run";
import { type Fixture, fragmentDocument, listFixtures, parseDocument } from "./dom";

const fixtures = listFixtures("instacart");

function urlFor(f: Fixture): string {
  // A real Instacart product URL shape, with query and fragment the adapter must strip.
  return `https://www.instacart.com/store/wegmans/products/${f.meta.expected.retailerSku}-${f.slug}?utm_source=test#top`;
}

function ctxFor(f: Fixture, overrides: Partial<PageContext> = {}): PageContext {
  return { url: urlFor(f), surface: "web", device: "desktop", ...overrides };
}

function extractFixture(f: Fixture, overrides: Partial<PageContext> = {}) {
  const result = instacartAdapter.extract(parseDocument(f.html, urlFor(f)), ctxFor(f, overrides));
  if (!result.ok) throw new Error(`${f.slug}: ${result.reason} ${result.detail ?? ""}`);
  return result.observation;
}

function byslug(slug: string): Fixture {
  const f = fixtures.find((x) => x.slug === slug);
  if (!f) throw new Error(`no fixture ${slug}`);
  return f;
}

describe("instacart adapter against every fixture", () => {
  it("has fixtures to test against", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(4);
  });

  for (const f of fixtures) {
    describe(f.slug, () => {
      it("matches the product URL", () => {
        expect(instacartAdapter.matches(urlFor(f))).toBe(true);
      });

      it("extracts the sidecar's expected block", () => {
        const o = extractFixture(f);
        expect(o.retailer).toBe("instacart");
        expect(o.product.retailerSku).toBe(f.meta.expected.retailerSku);
        expect(o.product.title).toBe(f.meta.expected.title);
        expect(o.facts.price).toEqual(f.meta.expected.price);
        expect(o.facts.priceText).toBe(f.meta.expected.priceText);
      });

      it("extracts the store, fulfilment and session state the sidecar records", () => {
        const o = extractFixture(f);
        expect(o.store).toEqual(f.meta.store);
        expect(o.context.fulfillment).toBe(f.meta.fulfillment);
        expect(o.context.sessionState).toBe(f.meta.sessionState);
      });

      it("records no zip3 (the fixture's ZIP is scrubbed) and no cleanSession", () => {
        const o = extractFixture(f);
        expect(o.context.zip3).toBeUndefined();
        expect(o.context.cleanSession).toBeUndefined();
      });

      it("canonicalises the URL and carries surface, device and provenance", () => {
        const o = extractFixture(f);
        expect(o.product.url).toBe(urlFor(f).split("?")[0]);
        expect(o.context.surface).toBe("web");
        expect(o.context.device).toBe("desktop");
        expect(o.adapter).toBe(`instacart@${INSTACART_ADAPTER_VERSION}`);
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

      it("evidence hash is the SHA-256 of the scrubbed price container", () => {
        const doc = parseDocument(f.html, urlFor(f));
        const label = Array.from(
          doc.querySelectorAll("#item_details span.screen-reader-only"),
        ).find((s) => /^current price:/i.test(s.textContent ?? "") && !s.closest("li, ul"));
        const container = label?.parentElement;
        expect(container).toBeDefined();
        if (!container) return;
        expect(extractFixture(f).evidenceHash).toBe(evidenceHash(container));
      });
    });
  }
});

describe("instacart adapter: fields beyond the sidecar", () => {
  it("bananas: by-weight estimate with unit price and size text, no brand, no promos", () => {
    const o = extractFixture(byslug("wegmans-bananas"));
    expect(o.facts.isEstimate).toBe(true);
    expect(o.facts.unitPriceText).toBe("$0.59 / lb");
    expect(o.product.sizeText).toBe("About 0.38 lb each");
    expect(o.product.brand).toBeUndefined();
    expect(o.product.upc).toBeUndefined();
    expect(o.facts.promoTags).toEqual([]);
    expect(o.facts.memberPrice).toBe(false);
    expect(o.facts.wasPrice).toBeUndefined();
  });

  it("strawberries: packaged item, not an estimate, per-ounce unit price", () => {
    const o = extractFixture(byslug("wegmans-organic-strawberries-16oz"));
    expect(o.facts.isEstimate).toBe(false);
    expect(o.facts.unitPriceText).toBe("$0.43/oz");
    expect(o.product.sizeText).toBe("16 oz");
    expect(o.product.brand).toBeUndefined();
  });

  it("grapes: per-package estimate, unit price per lb, brand from the Shop all link", () => {
    const o = extractFixture(byslug("wegmans-red-seedless-grapes"));
    expect(o.facts.isEstimate).toBe(true);
    expect(o.facts.priceText).toBe("$4.58");
    expect(o.facts.unitPriceText).toBe("$2.29 / lb");
    expect(o.product.sizeText).toBe("About 2.0 lb / package");
    expect(o.product.brand).toBe("wegmans");
  });

  it("reads the hero price, not the carousel tiles' prices", () => {
    // wegmans-bananas carries "Current price: $9.19" etc. on its recommendation tiles.
    const o = extractFixture(byslug("wegmans-bananas"));
    expect(o.facts.price.amountMinor).toBe(22);
  });

  it("the logged-in and logged-out banana pages hash to the same evidence", () => {
    const a = extractFixture(byslug("wegmans-bananas"));
    const b = extractFixture(byslug("wegmans-bananas-logged-out"));
    expect(a.evidenceHash).toBe(b.evidenceHash);
    expect(a.context.sessionState).toBe("logged_in");
    expect(b.context.sessionState).toBe("logged_out");
  });

  it("reads zip3 from the header ZIP prompt when the page displays a ZIP", () => {
    const f = byslug("wegmans-bananas");
    expect(f.html).toContain("Is [scrubbed] your ZIP code?");
    const unscrubbed = f.html.replace("Is [scrubbed] your ZIP code?", "Is 08540 your ZIP code?");
    const result = instacartAdapter.extract(parseDocument(unscrubbed, urlFor(f)), ctxFor(f));
    expect(result.ok && result.observation.context.zip3).toBe("085");
  });

  it("context overrides win over the page (what the S06 probe needs)", () => {
    const o = extractFixture(byslug("wegmans-bananas"), {
      sessionState: "logged_out",
      cleanSession: true,
      fulfillment: "pickup",
      surface: "mobile_web",
      device: "mobile",
    });
    expect(o.context).toMatchObject({
      sessionState: "logged_out",
      cleanSession: true,
      fulfillment: "pickup",
      surface: "mobile_web",
      device: "mobile",
    });
  });

  it("falls back to the URL for the SKU when the details panel is missing", () => {
    const f = byslug("wegmans-bananas");
    const doc = parseDocument(f.html, urlFor(f));
    for (const el of Array.from(doc.querySelectorAll('[id^="item_details-items_"]'))) el.remove();
    const result = instacartAdapter.extract(doc, ctxFor(f));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.product.retailerSku).toBe("2748189");
    // The store id lived in the same panel; the label still names the store.
    expect(result.observation.store).toEqual({ label: "Wegmans" });
  });
});

describe("instacart adapter: matches", () => {
  it.each([
    "https://www.instacart.com/store/wegmans/products/2748189-bananas-sold-by-the-each",
    "https://www.instacart.com/products/2748189-bananas",
    "https://instacart.com/store/wegmans/products/17327037",
    "http://m.instacart.com/store/x/products/1?y=2",
  ])("accepts %s", (url) => {
    expect(instacartAdapter.matches(url)).toBe(true);
  });

  it.each([
    "https://www.instacart.com/store/wegmans/storefront",
    "https://www.instacart.com/store/wegmans/collections/produce",
    "https://www.instacart.com/",
    "https://www.target.com/p/banana/-/A-15013944",
    "https://evil.example/www.instacart.com/products/1",
    "https://notinstacart.com/products/1",
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(instacartAdapter.matches(url)).toBe(false);
  });
});

describe("instacart adapter: failures are values, never throws", () => {
  const url = "https://www.instacart.com/store/wegmans/products/2748189-bananas";
  const ctx: PageContext = { url, surface: "web", device: "desktop" };

  it("a non-product URL is not_product_page", () => {
    const doc = parseDocument(byslug("wegmans-bananas").html);
    expect(
      instacartAdapter.extract(doc, { ...ctx, url: "https://www.instacart.com/store/" }),
    ).toEqual({
      ok: false,
      reason: "not_product_page",
    });
  });

  it("an empty page is no_title", () => {
    expect(instacartAdapter.extract(fragmentDocument(""), ctx)).toEqual({
      ok: false,
      reason: "no_title",
    });
  });

  it("a title without a price is no_price", () => {
    const doc = fragmentDocument('<div id="item_details"><h1>Bananas</h1></div>');
    expect(instacartAdapter.extract(doc, ctx)).toEqual({ ok: false, reason: "no_price" });
  });

  it("a price label without a dollar amount is unparseable_price", () => {
    const doc = fragmentDocument(
      '<div id="item_details"><h1>Bananas</h1><div><span class="screen-reader-only">Current price: free</span></div></div>',
    );
    expect(instacartAdapter.extract(doc, ctx)).toMatchObject({
      ok: false,
      reason: "unparseable_price",
    });
  });

  it("no SKU on the page or in the URL is no_sku", () => {
    const doc = fragmentDocument(
      '<div id="item_details"><h1>Bananas</h1><div><span class="screen-reader-only">Current price: $1.00</span></div></div>',
    );
    const result = instacartAdapter.extract(doc, {
      ...ctx,
      url: "https://www.instacart.com/store/wegmans/products/abc-no-id",
    });
    // The URL has no numeric id, so matches() already says this is not a product page.
    expect(result).toEqual({ ok: false, reason: "not_product_page" });
  });

  it("a product page whose header lost its service-type toggle is no_fulfillment", () => {
    const doc = fragmentDocument(
      '<div id="item_details"><h1>Bananas</h1><div><span class="screen-reader-only">Current price: $1.00</span></div></div>',
    );
    expect(instacartAdapter.extract(doc, ctx)).toEqual({ ok: false, reason: "no_fulfillment" });
  });

  it("a fulfilment override rescues a page without the toggle, and session is then unknown", () => {
    const doc = fragmentDocument(
      '<div id="item_details"><h1>Bananas</h1><div><span class="screen-reader-only">Current price: $1.00</span></div></div>',
    );
    const result = instacartAdapter.extract(doc, { ...ctx, fulfillment: "delivery" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.context.sessionState).toBe("unknown");
    expect(result.observation.store).toBeUndefined();
    expect(result.observation.product.retailerSku).toBe("2748189");
  });

  it("a document that is not a document yields adapter_threw rather than an exception", () => {
    const result = instacartAdapter.extract(undefined as unknown as Document, ctx);
    expect(result).toMatchObject({ ok: false, reason: "adapter_threw" });
  });
});

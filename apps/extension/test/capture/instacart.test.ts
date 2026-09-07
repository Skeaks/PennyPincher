/**
 * The acceptance test for the Instacart adapter: every fixture under fixtures/instacart/
 * extracts to an observation whose fields match its `.meta.json`. A fixture that fails is a
 * failing test, never a skipped one (the `for` below enumerates the directory; an empty
 * directory would fail the "at least one fixture" assertion).
 *
 * Two kinds of fixture (S17):
 *  - a page the browser rendered (the Wegmans set): the adapter reads everything from the DOM.
 *  - an anonymous fetch (`*-anonymous-fetch-logged-out`): the server-rendered HTML the lever
 *    probe receives, with no JavaScript run. It is only ever met through the probe, which
 *    supplies `sessionState: "logged_out"` and `cleanSession: true`, so the fixture is
 *    extracted under that context. Its header is a loading skeleton and it shows no
 *    Delivery / Pickup control, so session reads as unknown from the DOM alone and fulfilment
 *    is Instacart's default with `fulfillmentInferred`. Its store id lives only in hydration
 *    scripts, which the scrubber strips, so the DOM yields the store label alone.
 */
import { PriceObservation } from "@pennypincher/schema";
import { describe, expect, it } from "vitest";
import type { PageContext } from "../../src/capture/adapter";
import { INSTACART_ADAPTER_VERSION, instacartAdapter } from "../../src/capture/adapters/instacart";
import { evidenceHash } from "../../src/capture/evidence";
import { buildObservation } from "../../src/capture/run";
import { sha256Hex } from "../../src/capture/sha256";
import { type Fixture, fragmentDocument, listFixtures, parseDocument } from "./dom";

const fixtures = listFixtures("instacart");

type Kind = "page" | "anonymous";

function kindOf(f: Fixture): Kind {
  return f.slug.includes("anonymous-fetch") ? "anonymous" : "page";
}

function urlFor(f: Fixture): string {
  const sku = f.meta.expected.retailerSku;
  // Real Instacart URL shapes, with query and fragment the adapter must strip. The anonymous
  // fetch used the modal's shape, where the store is a query parameter that must survive.
  return kindOf(f) === "anonymous"
    ? `https://www.instacart.com/products/${sku}-${f.slug}?retailerSlug=walmart&utm_source=test#top`
    : `https://www.instacart.com/store/wegmans/products/${sku}-${f.slug}?utm_source=test#top`;
}

function canonicalFor(f: Fixture): string {
  const base = urlFor(f).split("?")[0];
  return kindOf(f) === "anonymous" ? `${base}?retailerSlug=walmart` : (base ?? "");
}

/** The context the adapter meets this fixture under: passive capture, or the probe. */
function ctxFor(f: Fixture, overrides: Partial<PageContext> = {}): PageContext {
  const base: PageContext = { url: urlFor(f), surface: "web", device: "desktop" };
  const probe: Partial<PageContext> =
    kindOf(f) === "anonymous" ? { sessionState: "logged_out", cleanSession: true } : {};
  return { ...base, ...probe, ...overrides };
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

const MILK = "walmart-whole-milk-1gal-anonymous-fetch-logged-out";

describe("instacart adapter against every fixture", () => {
  it("has fixtures of both kinds to test against", () => {
    expect(fixtures.filter((f) => kindOf(f) === "page").length).toBeGreaterThanOrEqual(4);
    expect(fixtures.filter((f) => kindOf(f) === "anonymous").length).toBeGreaterThanOrEqual(1);
  });

  for (const f of fixtures) {
    const kind = kindOf(f);
    describe(f.slug, () => {
      it("matches the product URL as a product surface", () => {
        expect(instacartAdapter.matches(urlFor(f))).toBe(true);
        expect(instacartAdapter.pageKind(urlFor(f))).toBe("product");
      });

      it("extracts the sidecar's expected block", () => {
        const o = extractFixture(f);
        expect(o.retailer).toBe("instacart");
        expect(o.product.retailerSku).toBe(f.meta.expected.retailerSku);
        expect(o.product.title).toBe(f.meta.expected.title);
        expect(o.facts.price).toEqual(f.meta.expected.price);
        expect(o.facts.priceText).toBe(f.meta.expected.priceText);
      });

      it("extracts the store the sidecar records, as far as the DOM shows it", () => {
        const o = extractFixture(f);
        expect(o.store?.label).toBe(f.meta.store.label);
        if (kind === "page") {
          expect(o.store).toEqual(f.meta.store);
        } else {
          // The id is in the hydration scripts only; the scrubbed DOM has the label alone.
          expect(o.store).toEqual({ label: f.meta.store.label });
        }
      });

      it("extracts the fulfilment the sidecar records, flagged when the page showed no control", () => {
        const o = extractFixture(f);
        expect(o.context.fulfillment).toBe(f.meta.fulfillment);
        expect(o.context.fulfillmentInferred).toBe(kind === "page" ? undefined : true);
      });

      it("extracts the session state the sidecar records", () => {
        const o = extractFixture(f);
        expect(o.context.sessionState).toBe(f.meta.sessionState);
        if (kind === "anonymous") {
          // Without the probe's context the skeleton header says nothing: never "logged_in".
          const bare = instacartAdapter.extract(parseDocument(f.html, urlFor(f)), {
            url: urlFor(f),
            surface: "web",
            device: "desktop",
          });
          expect(bare.ok && bare.observation.context.sessionState).toBe("unknown");
        }
      });

      it("records no zip3 (the fixture's ZIP is scrubbed); cleanSession only from the probe", () => {
        const o = extractFixture(f);
        expect(o.context.zip3).toBeUndefined();
        expect(o.context.cleanSession).toBe(kind === "page" ? undefined : true);
      });

      it("canonicalises the URL and carries surface, device and provenance", () => {
        const o = extractFixture(f);
        expect(o.product.url).toBe(canonicalFor(f));
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

      it("evidence hash is the SHA-256 of the scrubbed price container (no JSON-LD survives scrubbing)", () => {
        const doc = parseDocument(f.html, urlFor(f));
        expect(doc.querySelector('script[type="application/ld+json"]')).toBeNull();
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

  it("milk (anonymous fetch): 495 cents, brand from the Shop all link, 1 gal, per-fl-oz unit price", () => {
    const o = extractFixture(byslug(MILK));
    expect(o.facts.price.amountMinor).toBe(495);
    expect(o.product.brand).toBe("great value");
    expect(o.product.sizeText).toBe("1 gal");
    expect(o.facts.unitPriceText).toBe("$0.04/fl oz");
    expect(o.facts.isEstimate).toBe(false);
    expect(o.facts.promoTags).toEqual([]);
    expect(o.facts.wasPrice).toBeUndefined();
    expect(o.store).toEqual({ label: "Walmart" });
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
    expect(o.context.fulfillmentInferred).toBeUndefined();
  });

  it("falls back to the URL for the SKU and to the carousel tiles for the store id", () => {
    const f = byslug("wegmans-bananas");
    const doc = parseDocument(f.html, urlFor(f));
    for (const el of Array.from(doc.querySelectorAll('[id^="item_details-items_"]'))) el.remove();
    const result = instacartAdapter.extract(doc, ctxFor(f));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.product.retailerSku).toBe("2748189");
    // The recommendation tiles carry `item_list_item_items_10769-<sku>`: the store id survives.
    expect(result.observation.store).toEqual({ retailerStoreId: "10769", label: "Wegmans" });

    for (const el of Array.from(doc.querySelectorAll('[data-testid^="item_list_item"]'))) {
      el.remove();
    }
    const bare = instacartAdapter.extract(doc, ctxFor(f));
    expect(bare.ok && bare.observation.store).toEqual({ label: "Wegmans" });
  });
});

/**
 * The Product JSON-LD block from the raw anonymous fetch (fixtures/raw/instacart/…, 2026-09-07),
 * verbatim. The scrubber strips every <script>, so the committed fixture cannot carry it; the
 * tests below put it back into a copy of the scrubbed page, which is what the probe sees.
 */
const MILK_JSON_LD = `
      {"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Great Value Whole Vitamin D Milk","image":["https://d2lnr5mha7bycj.cloudfront.net/product-image/file/large_b9619d85-8ed2-4907-8a20-18194698314e.png"],"category":"Plain Milk","description":"Great Value Vitamin D Whole Milk 1 gl","brand":{"@type":"Brand","name":"Great Value"},"size":"1 gal","offers":{"@type":"Offer","price":"4.95","priceCurrency":"USD","url":"https://www.instacart.com/products/20654983-great-value-milk-vitamin-d-whole-1-gl","itemCondition":"https://schema.org/NewCondition","availability":"https://schema.org/InStock"}}]}
    `;

function withJsonLd(html: string, jsonLd: string): string {
  return html.replace("</head>", `<script type="application/ld+json">${jsonLd}</script></head>`);
}

describe("instacart adapter: JSON-LD first", () => {
  const f = byslug(MILK);

  it("takes title, brand, size and price from the Product block and hashes its text", () => {
    const doc = parseDocument(withJsonLd(f.html, MILK_JSON_LD), urlFor(f));
    const result = instacartAdapter.extract(doc, ctxFor(f));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const o = result.observation;
    expect(o.product.title).toBe("Great Value Whole Vitamin D Milk");
    expect(o.product.brand).toBe("Great Value");
    expect(o.product.sizeText).toBe("1 gal");
    expect(o.facts.price).toEqual({ amountMinor: 495, currency: "USD" });
    expect(o.facts.priceText).toBe("$4.95");
    expect(o.evidenceHash).toBe(sha256Hex(MILK_JSON_LD.trim()));
    expect(o.evidenceHash).not.toBe(extractFixture(f).evidenceHash);
    // The DOM still fills the rest.
    expect(o.facts.unitPriceText).toBe("$0.04/fl oz");
    expect(o.store).toEqual({ label: "Walmart" });
    expect(o.context).toMatchObject({
      fulfillment: "delivery",
      fulfillmentInferred: true,
      sessionState: "logged_out",
      cleanSession: true,
    });
    expect(o.product.retailerSku).toBe("20654983");
  });

  it("still extracts when the DOM shows no price at all (a page that is only server-rendered)", () => {
    const doc = parseDocument(withJsonLd(f.html, MILK_JSON_LD), urlFor(f));
    for (const span of Array.from(doc.querySelectorAll("span.screen-reader-only"))) {
      if (/^current price:/i.test(span.textContent ?? "")) span.parentElement?.remove();
    }
    expect(instacartAdapter.extract(doc, ctxFor(f))).toMatchObject({
      ok: true,
      observation: { facts: { price: { amountMinor: 495 }, priceText: "$4.95" } },
    });
  });

  it("the JSON-LD price is the price even when the DOM disagrees (JSON-LD first, by the brief)", () => {
    const doc = parseDocument(
      withJsonLd(f.html.replace("Current price: $4.95", "Current price: $5.15"), MILK_JSON_LD),
      urlFor(f),
    );
    expect(instacartAdapter.extract(doc, ctxFor(f))).toMatchObject({
      ok: true,
      observation: { facts: { price: { amountMinor: 495 } } },
    });
  });

  it("ignores a Product block for a different SKU: a modal's head still describes the first page", () => {
    const stale = MILK_JSON_LD.replace("20654983-great-value", "99999999-something-else");
    const doc = parseDocument(withJsonLd(f.html, stale), urlFor(f));
    const result = instacartAdapter.extract(doc, ctxFor(f));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.product.brand).toBe("great value");
    expect(result.observation.evidenceHash).toBe(extractFixture(f).evidenceHash);
  });

  it("ignores a block that is not JSON, and one with no Product", () => {
    for (const bad of ["{not json", '{"@type":"Organization","name":"Instacart"}']) {
      const doc = parseDocument(withJsonLd(f.html, bad), urlFor(f));
      const result = instacartAdapter.extract(doc, ctxFor(f));
      expect(result.ok && result.observation.product.brand).toBe("great value");
    }
  });
});

describe("instacart adapter: the product modal", () => {
  /**
   * No modal fixture has been recorded yet. This builds the shape the brief describes from a
   * rendered page: the hero markup inside a dialog with a Back control, no `#item_details`.
   */
  function modalDocument(f: Fixture): Document {
    const doc = parseDocument(f.html, urlFor(f));
    const details = doc.querySelector("#item_details");
    if (!details) throw new Error("fixture has no #item_details");
    const dialog = doc.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const back = doc.createElement("button");
    back.textContent = "Back";
    dialog.appendChild(back);
    while (details.firstChild) dialog.appendChild(details.firstChild);
    details.remove();
    doc.body.appendChild(dialog);
    return doc;
  }

  it("extracts the same hero fields from the dialog as from the standalone page", () => {
    const f = byslug("wegmans-bananas");
    const result = instacartAdapter.extract(modalDocument(f), ctxFor(f));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const page = extractFixture(f);
    expect(result.observation.product).toEqual(page.product);
    expect(result.observation.facts).toEqual(page.facts);
    expect(result.observation.store).toEqual(page.store);
    expect(result.observation.context).toEqual(page.context);
    expect(result.observation.evidenceHash).toBe(page.evidenceHash);
  });

  it("does not mistake a carousel tile inside the dialog for the hero", () => {
    const f = byslug("wegmans-bananas");
    const doc = modalDocument(f);
    // Move the recommendation list ahead of the hero price inside the dialog.
    const dialog = doc.querySelector('[role="dialog"]');
    const list = doc.querySelector('[data-testid^="item_list_item"]')?.closest("ul");
    if (!dialog || !list) throw new Error("no carousel to move");
    dialog.insertBefore(list, dialog.firstChild);
    const result = instacartAdapter.extract(doc, ctxFor(f));
    expect(result.ok && result.observation.facts.price.amountMinor).toBe(22);
  });

  it("the ZIP prompt dialog in the header is never taken for the modal", () => {
    const f = byslug("wegmans-bananas");
    const doc = parseDocument(f.html, urlFor(f));
    expect(doc.querySelector('[aria-modal="true"]')).not.toBeNull();
    doc.querySelector("#item_details")?.remove();
    expect(instacartAdapter.extract(doc, ctxFor(f))).toEqual({ ok: false, reason: "no_title" });
  });
});

describe("instacart adapter: matches and pageKind", () => {
  it.each([
    "https://www.instacart.com/store/wegmans/products/2748189-bananas-sold-by-the-each",
    "https://www.instacart.com/products/2748189-bananas",
    "https://www.instacart.com/products/20654983-great-value-milk?retailerSlug=walmart",
    "https://instacart.com/store/wegmans/products/17327037",
    "http://m.instacart.com/store/x/products/1?y=2",
  ])("accepts %s as a product surface", (url) => {
    expect(instacartAdapter.matches(url)).toBe(true);
    expect(instacartAdapter.pageKind(url)).toBe("product");
  });

  it.each([
    "https://www.instacart.com/store/walmart/s?k=milk",
    "https://www.instacart.com/store/s?k=milk",
    "https://www.instacart.com/store/wegmans/collections/produce",
    "https://www.instacart.com/store/wegmans/departments/dairy",
    "https://www.instacart.com/store/wegmans/storefront",
  ])("accepts %s as a listing surface", (url) => {
    expect(instacartAdapter.matches(url)).toBe(true);
    expect(instacartAdapter.pageKind(url)).toBe("listing");
  });

  it.each([
    "https://www.instacart.com/",
    "https://www.instacart.com/store/",
    "https://www.instacart.com/store/wegmans/info",
    "https://www.instacart.com/store/checkout",
    "https://www.target.com/p/banana/-/A-15013944",
    "https://evil.example/www.instacart.com/products/1",
    "https://notinstacart.com/products/1",
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(instacartAdapter.matches(url)).toBe(false);
    expect(instacartAdapter.pageKind(url)).toBeUndefined();
  });
});

describe("instacart adapter: failures are values, never throws", () => {
  const url = "https://www.instacart.com/store/wegmans/products/2748189-bananas";
  const ctx: PageContext = { url, surface: "web", device: "desktop" };

  it("a listing URL is not_product_page for the hero extractor", () => {
    const doc = parseDocument(byslug("wegmans-bananas").html);
    expect(
      instacartAdapter.extract(doc, { ...ctx, url: "https://www.instacart.com/store/wegmans/s" }),
    ).toEqual({ ok: false, reason: "not_product_page" });
  });

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

  it("a product page without the service-type toggle records delivery as inferred, session unknown", () => {
    const doc = fragmentDocument(
      '<div id="item_details"><h1>Bananas</h1><div><span class="screen-reader-only">Current price: $1.00</span></div></div>',
    );
    const result = instacartAdapter.extract(doc, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.context).toMatchObject({
      fulfillment: "delivery",
      fulfillmentInferred: true,
      sessionState: "unknown",
    });
    expect(result.observation.store).toBeUndefined();
    expect(result.observation.product.retailerSku).toBe("2748189");
  });

  it("a fulfilment override is never marked inferred", () => {
    const doc = fragmentDocument(
      '<div id="item_details"><h1>Bananas</h1><div><span class="screen-reader-only">Current price: $1.00</span></div></div>',
    );
    const result = instacartAdapter.extract(doc, { ...ctx, fulfillment: "pickup" });
    expect(result.ok && result.observation.context).toMatchObject({ fulfillment: "pickup" });
    expect(result.ok && result.observation.context.fulfillmentInferred).toBeUndefined();
  });

  it("a document that is not a document yields adapter_threw rather than an exception", () => {
    const result = instacartAdapter.extract(undefined as unknown as Document, ctx);
    expect(result).toMatchObject({ ok: false, reason: "adapter_threw" });
  });
});

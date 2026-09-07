/**
 * Walmart adapter. Written against fixtures/walmart/* (four product pages at the East Windsor
 * Supercenter, 2026-09-04 snapshots). Product pages only: no fixture shows a Walmart search
 * page or a quick-view modal, so `pageKind` knows the product surface alone and there is no
 * `extractTiles` yet (S12 retro asks Jamie for a listing capture; selectors are not guessed).
 *
 * The trap the fixture sidecars record: Walmart never renders its store number. The page
 * shows "Pickup from East Windsor Supercenter" and nothing else, so `store` is label-only
 * here (schema 1.0.0 allows a StoreRef with a label alone; the sidecar's 3266 comes from the
 * capture log, not the DOM).
 *
 * Where each field lives (selectors use `data-testid`, `data-seo-id`, `itemprop` and stable
 * ids; the `ld_*` and Tachyons utility classes are never used):
 *
 *  - URL:          `/ip/<slug>/<sku>` or `/ip/<sku>`. The SKU is the trailing number. Query
 *                  and fragment are stripped (`canonicalUrl`).
 *  - JSON-LD:      `script[type="application/ld+json"]` with a schema.org Product naming the
 *                  page's SKU, when present (server-rendered HTML). Title, brand, size and
 *                  price come from it and the evidence hash covers its text; the DOM fills the
 *                  rest and is the fallback. No committed fixture carries one (the scrubber
 *                  strips scripts).
 *  - title:        `h1#main-title` (`itemprop="name"`), else `h1[itemprop="name"]`, else `h1`.
 *  - sku:          the URL. Cross-checked by nothing: the page's own id appears only in the
 *                  reviews link (`a[href^="/reviews/product/<sku>"]`), which is the fallback.
 *  - price:        `[data-seo-id="hero-price"]` (`itemprop="price"`) inside
 *                  `[data-testid="price-wrap"]`, the buy box's "Current price is USD$0.06"
 *                  line. Sponsored carousel tiles (`[data-test-id="gpt-main"]`, `[data-item-id]`)
 *                  carry their own prices and are never taken. The evidence hash is computed
 *                  over the closest `[data-testid="price-wrap"]`, else the price's parent.
 *  - isEstimate:   "each (est.)" next to the price, or "Final cost by weight" in the unit
 *                  line (the three fresh bananas); the frozen bag is not an estimate.
 *  - unitPriceText: `[data-testid="unit-price-string"]`'s first span ("16.0 ¢/lb"), else
 *                  `[data-seo-id="hero-unit-price"]` ("$2.47/lb").
 *  - wasPrice:     `<s>`/`<del>` in the buy box's price line, or "Was $X" text there.
 *  - promoTags:    short leaf text in the price line that reads like an offer ("Rollback",
 *                  "Clearance", "10% off"). Empty on every fixture.
 *  - memberPrice:  "Walmart+" or "member" in the price line itself. The site-wide "Try 30
 *                  days of Walmart+" banner is outside it and never counts.
 *  - brand:        `a[data-seo-id="brand-name"]` ("Great Value"; "Unbranded" is no brand).
 *  - store:        `[data-testid="fulfillment-zone-2"] button[aria-label^="Pickup from"]`'s
 *                  text ("East Windsor Supercenter"), else the "Pickup from <label>" line
 *                  itself. Label only; there is no id on the page.
 *  - fulfilment:   `[data-testid="fulfillment-zone-1"] input[id^="fulfillment-"][data-selected="true"]`
 *                  (Pickup / Delivery / Shipping -> pickup / delivery / ship). Every fixture
 *                  shows Pickup selected. Fallback: the zone-2 line ("Pickup from …",
 *                  "Delivery from …"). With neither (server-rendered HTML, the probe's
 *                  anonymous fetch) Walmart's default is shipping: `ship` with
 *                  `fulfillmentInferred`.
 *  - session:      `[data-testid="logged-in-account-button-name"]` in the header is logged
 *                  in; `[data-automation-id="headerSignIn"]` or `[data-testid="sign-in"]` is
 *                  logged out; neither is unknown.
 *  - zip3:         `[data-testid="depot-store-nudge"]` ("… 08540"), else the global header.
 *                  Fixtures scrub the digits, so on a fixture this is absent.
 */
import type { Fulfillment, SessionState, StoreRef } from "@pennypincher/schema";
import {
  type Adapter,
  type AdapterObservation,
  type ExtractResult,
  type PageContext,
  type PageKind,
  canonicalUrl,
  fail,
  textOf,
  withDefined,
} from "../adapter";
import { evidenceHash } from "../evidence";
import { jsonLdEvidenceHash, productJsonLd } from "../jsonld";
import { type ParsedMoney, parseMoney } from "../money";

export const WALMART_ADAPTER_VERSION = "0.1.0";

const PRODUCT_PATH = /^\/ip\/(?:[^/]+\/)?(\d+)\/?$/;
const REVIEWS_HREF = /^\/reviews\/product\/(\d+)(?:[/?#]|$)/;
const PICKUP_FROM = /^\s*pickup from\s+(.+?)(?:\s+selected\b.*)?$/i;
const FROM_LINE = /\b(pickup|delivery)\s+from\s+(.+?)(?:\s*(?:pickup|delivery)\b|\.|$)/i;
const ESTIMATE = /\(est\.?\)|\bestimated\b|\bfinal cost by weight\b/i;
const WAS_PRICE = /\bwas\s+(\$\s?\d[\d,]*(?:\.\d{2})?)/i;
const PROMO =
  /\b(?:rollback|clearance|reduced|price drop|deal|\d+% off|\$[\d.]+ off|buy \d+,? get|bogo|sale|coupon|free)\b/i;
const MEMBER = /walmart\+|\bmembers?\b/i;
const ZIP = /\b(\d{5})(?:-\d{4})?\b/;
const NOT_HERO = '[data-test-id="gpt-main"], [data-item-id], li, ul';

function hostMatches(host: string): boolean {
  return host === "walmart.com" || host.endsWith(".walmart.com");
}

/** The item id a product URL names, or undefined. Pure. */
export function skuInUrl(url: string): string | undefined {
  try {
    return PRODUCT_PATH.exec(new URL(url, "https://www.walmart.com/").pathname)?.[1];
  } catch {
    return undefined;
  }
}

function pageKind(url: string): PageKind | undefined {
  try {
    const u = new URL(url);
    if (!hostMatches(u.hostname)) return undefined;
    return PRODUCT_PATH.test(u.pathname) ? "product" : undefined;
  } catch {
    return undefined;
  }
}

function matches(url: string): boolean {
  return pageKind(url) !== undefined;
}

// ---------------------------------------------------------------------------------------------
// Page-level reads.
// ---------------------------------------------------------------------------------------------

/** The SKU from the URL, else from the reviews link. */
function findSku(doc: Document, url: string): string | undefined {
  const fromUrl = skuInUrl(url);
  if (fromUrl) return fromUrl;
  for (const link of Array.from(doc.querySelectorAll('a[href*="/reviews/product/"]'))) {
    let path: string;
    try {
      path = new URL(link.getAttribute("href") ?? "", "https://www.walmart.com/").pathname;
    } catch {
      continue;
    }
    const m = REVIEWS_HREF.exec(path);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/** Leaf texts joined with spaces: adjacent leaves have no separator in `textContent`. */
function leafText(scope: Element | null): string {
  if (!scope) return "";
  const parts: string[] = [];
  for (const el of Array.from(scope.querySelectorAll("*"))) {
    if (el.children.length === 0) parts.push(textOf(el));
  }
  return parts.filter((p) => p !== "").join(" ");
}

function findStore(doc: Document): StoreRef | undefined {
  const zone = doc.querySelector('[data-testid="fulfillment-zone-2"]');
  for (const button of Array.from(zone?.querySelectorAll("button[aria-label]") ?? [])) {
    if (!PICKUP_FROM.test(button.getAttribute("aria-label") ?? "")) continue;
    const label = textOf(button);
    if (label) return { label };
  }
  const m = FROM_LINE.exec(leafText(zone));
  if (m?.[2]) return { label: m[2].trim() };
  return undefined;
}

interface FulfillmentRead {
  fulfillment: Fulfillment;
  inferred: boolean;
}

function fulfillmentOf(word: string): Fulfillment | undefined {
  const w = word.toLowerCase();
  if (w === "pickup") return "pickup";
  if (w === "delivery") return "delivery";
  if (w === "shipping") return "ship";
  return undefined;
}

/** The selected fulfilment radio, else the zone-2 line, else Walmart's default (shipping). */
function findFulfillment(doc: Document, override: Fulfillment | undefined): FulfillmentRead {
  if (override) return { fulfillment: override, inferred: false };
  const zone1 = doc.querySelector('[data-testid="fulfillment-zone-1"]');
  for (const input of Array.from(
    zone1?.querySelectorAll('input[id^="fulfillment-"][data-selected="true"]') ?? [],
  )) {
    const f = fulfillmentOf(input.id.replace("fulfillment-", ""));
    if (f) return { fulfillment: f, inferred: false };
  }
  const m = FROM_LINE.exec(leafText(doc.querySelector('[data-testid="fulfillment-zone-2"]')));
  const f = m?.[1] ? fulfillmentOf(m[1]) : undefined;
  if (f) return { fulfillment: f, inferred: false };
  return { fulfillment: "ship", inferred: true };
}

function findSessionState(doc: Document): SessionState {
  if (doc.querySelector('[data-testid="logged-in-account-button-name"]')) return "logged_in";
  if (
    doc.querySelector('[data-automation-id="headerSignIn"]') ||
    doc.querySelector('[data-testid="sign-in"]')
  ) {
    return "logged_out";
  }
  return "unknown";
}

function findZip3(doc: Document): string | undefined {
  const nudge = textOf(doc.querySelector('[data-testid="depot-store-nudge"]'));
  const m = ZIP.exec(nudge) ?? ZIP.exec(textOf(doc.querySelector('[data-testid="global-header"]')));
  return m?.[1]?.slice(0, 3);
}

function findBrand(doc: Document): string | undefined {
  const brand = textOf(doc.querySelector('a[data-seo-id="brand-name"]'));
  if (!brand || /^unbranded$/i.test(brand)) return undefined;
  return brand;
}

// ---------------------------------------------------------------------------------------------
// The price and what sits next to it.
// ---------------------------------------------------------------------------------------------

interface PriceRead {
  element: Element;
  container: Element;
  price: ParsedMoney;
  priceLine: string;
}

/** The hero price element: never one inside a sponsored tile or a list. */
function findPriceElement(doc: Document): Element | undefined {
  const candidates = [
    ...Array.from(doc.querySelectorAll('[data-seo-id="hero-price"]')),
    ...Array.from(doc.querySelectorAll('[itemprop="price"]')),
    ...Array.from(doc.querySelectorAll('[data-testid="price-wrap"]')),
  ];
  return candidates.find((el) => !el.closest(NOT_HERO));
}

function findPrice(doc: Document): { read?: PriceRead; priceText?: string } {
  const element = findPriceElement(doc);
  if (!element) return {};
  const container =
    element.closest('[data-testid="price-wrap"]') ?? element.parentElement ?? element;
  const text = textOf(element);
  const price = parseMoney(text);
  if (!price) return { priceText: text };
  // The buy box line around the price: "Current price is USD$0.06 each (est.) 16.0 ¢/lb …".
  const priceLine = textOf(container.parentElement ?? container);
  return { read: { element, container, price, priceLine } };
}

interface PriceNeighbours {
  unitPriceText?: string;
  wasPrice?: ParsedMoney;
  promoTags: string[];
  memberPrice: boolean;
}

function readPriceNeighbours(doc: Document, read: PriceRead): PriceNeighbours {
  const line = read.container.parentElement ?? read.container;

  let unitPriceText: string | undefined;
  const unit =
    line.querySelector('[data-testid="unit-price-string"] span') ??
    doc.querySelector('[data-testid="unit-price-string"] span') ??
    line.querySelector('[data-seo-id="hero-unit-price"]') ??
    doc.querySelector('[data-seo-id="hero-unit-price"]');
  const unitText = textOf(unit);
  if (unitText && /\d/.test(unitText) && /\//.test(unitText)) unitPriceText = unitText;

  let wasPrice: ParsedMoney | undefined;
  const struck = line.querySelector("s, del");
  if (struck) wasPrice = parseMoney(textOf(struck));
  if (!wasPrice) {
    const m = WAS_PRICE.exec(read.priceLine);
    if (m?.[1]) wasPrice = parseMoney(m[1]);
  }

  const promoTags: string[] = [];
  let memberPrice = false;
  for (const el of Array.from(line.querySelectorAll("*"))) {
    if (el.children.length > 0 || read.element.contains(el)) continue;
    if (el.closest("h1, h2, h3, h4, button")) continue;
    const text = textOf(el);
    if (!text || text.length > 64) continue;
    if (PROMO.test(text) && !promoTags.includes(text)) promoTags.push(text);
    if (MEMBER.test(text)) memberPrice = true;
  }
  return withDefined({ unitPriceText, wasPrice, promoTags, memberPrice });
}

// ---------------------------------------------------------------------------------------------
// The hero.
// ---------------------------------------------------------------------------------------------

function extractHero(doc: Document, ctx: PageContext): ExtractResult {
  const url = canonicalUrl(ctx.url);
  if (url === undefined || pageKind(url) !== "product") return fail("not_product_page");

  const sku = findSku(doc, url);
  if (!sku) return fail("no_sku");

  const heading =
    doc.querySelector("h1#main-title") ??
    doc.querySelector('h1[itemprop="name"]') ??
    doc.querySelector("h1");
  const domTitle = textOf(heading);
  const jsonLd = productJsonLd(doc, sku, skuInUrl);
  const title = jsonLd?.name ?? domTitle;
  if (!title) return fail("no_title");

  const found = findPrice(doc);
  let price: ParsedMoney;
  let evidence: string;
  if (jsonLd?.price && jsonLd.priceText !== undefined) {
    price = { money: jsonLd.price, priceText: jsonLd.priceText };
    evidence = jsonLdEvidenceHash(jsonLd);
  } else {
    if (!found.read) {
      return found.priceText === undefined
        ? fail("no_price")
        : fail("unparseable_price", found.priceText);
    }
    price = found.read.price;
    evidence = evidenceHash(found.read.container);
  }

  const neighbours = found.read
    ? readPriceNeighbours(doc, found.read)
    : { promoTags: [], memberPrice: false };
  const isEstimate = found.read ? ESTIMATE.test(found.read.priceLine) : false;
  const fulfillment = findFulfillment(doc, ctx.fulfillment);

  const observation: AdapterObservation = {
    retailer: "walmart",
    product: withDefined({
      retailerSku: sku,
      title,
      brand: jsonLd?.brand ?? findBrand(doc),
      sizeText: jsonLd?.size,
      url,
      upc: undefined,
    }),
    facts: withDefined({
      price: price.money,
      priceText: price.priceText,
      isEstimate,
      wasPrice: neighbours.wasPrice?.money,
      unitPriceText: neighbours.unitPriceText,
      promoTags: neighbours.promoTags,
      memberPrice: neighbours.memberPrice,
    }),
    context: withDefined({
      fulfillment: fulfillment.fulfillment,
      sessionState: ctx.sessionState ?? findSessionState(doc),
      surface: ctx.surface,
      zip3: findZip3(doc),
      device: ctx.device,
      cleanSession: ctx.cleanSession,
      fulfillmentInferred: fulfillment.inferred ? true : undefined,
    }),
    adapter: `walmart@${WALMART_ADAPTER_VERSION}`,
    evidenceHash: evidence,
  };
  const store = findStore(doc);
  if (store) observation.store = store;
  return { ok: true, observation };
}

export const walmartAdapter: Adapter = {
  name: "walmart",
  version: WALMART_ADAPTER_VERSION,
  matches,
  pageKind,
  extract(doc, ctx) {
    try {
      return extractHero(doc, ctx);
    } catch (e) {
      return fail("adapter_threw", e instanceof Error ? e.message : String(e));
    }
  },
};

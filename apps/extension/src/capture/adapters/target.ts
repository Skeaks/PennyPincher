/**
 * Target adapter. Written against fixtures/target/* (four product pages, Durham and Princeton
 * stores, 2026-09-04 snapshots) and the search results for "banana" (search-banana,
 * 2026-09-07, Durham). Two surfaces: the product page (`/p/<slug>/-/A-<sku>`) and listings
 * (search `/s?searchTerm=…` and `/s/<term>`, categories `/c/…`, brands `/b/…`). No fixture
 * shows a quick-view modal, so none is handled.
 *
 * The trap the fixture sidecars record: Target renders the hero price box lazily.
 * `[data-test="product-price"]` inside the price module is an empty skeleton until the page
 * is scrolled, while the sticky add-to-cart bar (`[data-test="sticky-atc"]`, `aria-hidden`
 * until scroll) carries the same price from the first paint. The price is therefore read
 * from the first of several candidates that actually holds a dollar amount, and an empty
 * skeleton everywhere is a counted `no_price`, never a partial observation.
 *
 * Where each field lives (selectors use `data-test` ids and stable element ids; the hashed
 * `styles_*__xxxx` and `sc-*` classes change per build and are never used):
 *
 *  - URL:          `/p/<slug>/-/A-<sku>`. The SKU (Target's TCIN) is the `A-` number. Query
 *                  and fragment are stripped (`canonicalUrl`).
 *  - JSON-LD:      `script[type="application/ld+json"]` with a schema.org Product naming the
 *                  page's SKU, when present (server-rendered HTML). Title, brand, size and
 *                  price come from it and the evidence hash covers its text; the DOM fills the
 *                  rest and is the fallback. No committed fixture carries one (the scrubber
 *                  strips scripts).
 *  - title:        `h1[data-test="product-title"]` (`#pdp-product-title-id`), else the first
 *                  `h1`.
 *  - sku:          the URL first; else `[id^="addToCartButtonOrTextIdFor"]` (the digits).
 *  - price:        in order, the first with a dollar amount:
 *                    1. `[data-test="module-product-detail-price-v2"] [data-test="product-price"]`
 *                       (the hero box once hydrated),
 *                    2. `[data-test="price-cdui"] [data-test="text-quill-insert-0"]` (the hero
 *                       box's rich-text rendering: "$2.99", with "($0.75/count)" in insert-1),
 *                    3. any `[data-test="product-price"]` on the page (the sticky bar).
 *                  The evidence hash is computed over the price container: the closest
 *                  `[data-test="price-cdui"]` or `[data-test="@web/Price/PriceFull"]`
 *                  ancestor, else the price element's parent.
 *  - unitPriceText: "$0.75/count", "$0.06/ounce" next to the price (parentheses dropped).
 *  - isEstimate:   "(est.)" / "estimated" / "price varies" in the price container; Target
 *                  sells produce by the each, so none of the fixtures is an estimate.
 *  - wasPrice:     `<s>`/`<del>` in the price container, or "reg $X" / "was $X" text.
 *  - promoTags:    short leaf text in the price module, the Circle offers block
 *                  (`[data-test="circle-offers-pdp"]`) and the promotions block
 *                  (`[data-test="promotions-message-only-pdp"]`) that reads like an offer
 *                  ("Sale", "Buy 2 get 1", "10% off"). Empty on every fixture.
 *  - memberPrice:  "Circle" membership pricing next to the price ("with Target Circle",
 *                  "Circle 360"). None on the fixtures.
 *  - brand:        `[data-test="shopAllBrandLink"]` ("Shop all Good & Gather", prefix dropped).
 *  - store:        `[data-test="storeNameWithAddressPopover"] button[id^="store-name-"]`: the
 *                  id's digits are the store id (1872 Durham, 1151 Princeton) and the text is
 *                  the label. Fallback label: `[data-test="@web/StoreName/StoreName"]`, else
 *                  the header button's `aria-label="Store: Durham"`.
 *  - fulfilment:   `[data-test^="fulfillment-cell-"]` whose `aria-label` reads "… - selected -"
 *                  (pickup / delivery / shipping -> pickup / delivery / ship). Every fixture
 *                  shows Pickup selected. With no selected cell (server-rendered HTML, the
 *                  probe's anonymous fetch) Target's default is shipping: `ship` with
 *                  `fulfillmentInferred`.
 *  - session:      `[data-test="@web/AccountLink"]` (`#account-sign-in`): `aria-label`
 *                  "Account, sign in" (or text "Sign in") is logged out; any other account
 *                  link ("<name>, 1 notification …") is logged in; no link is unknown.
 *  - zip3:         `[data-test="@web/ZipCodeButton/ZipCodeNumber"]` ("Ship to 08540").
 *                  Fixtures scrub the digits, so on a fixture this is absent.
 *  - tiles:        two shapes on a listing. The results grid's
 *                  `[data-test="ListingPageProductListing"]`: an `a[data-test="content"]`
 *                  link to `/p/…/A-<sku>` whose `aria-label` is the title in product-page
 *                  form ("Fresh Banana - each - Good & Gather™"), the price in the first
 *                  `[data-test="text-quill-insert-0"]` under that link that holds a dollar
 *                  amount (the `h3` title and the rating block are skipped), a unit price in
 *                  the same rich-text block ("($0.06/ounce)"), and "Pickup ready within 2
 *                  hours" / "Delivery as soon as 5pm" lines. And the carousel card
 *                  `[data-test="productCardVariantMini"]` (in-grid sponsored row,
 *                  recommendations): the link is any `a[href*="/p/"]`, the title
 *                  `[data-test="productCardVariantMiniTitle"]`, the price the first span in
 *                  `[data-test="@web/Price/PriceAndPromoMinimal"]`, the was-price
 *                  `[data-test="strikethroughFormattedRegPrice"]` with a "Sale" message and
 *                  a `PromoDetails` line. A listing shows no selected fulfilment cell and no
 *                  `store-name-<id>` button: the store is the header label alone and a tile's
 *                  fulfilment is the first line it shows, flagged `fulfillmentInferred`.
 */
import type { Fulfillment, SessionState, StoreRef } from "@pennypincher/schema";
import {
  type Adapter,
  type AdapterObservation,
  type ExtractResult,
  type PageContext,
  type PageKind,
  type TileExtraction,
  canonicalUrl,
  fail,
  textOf,
  withDefined,
} from "../adapter";
import { evidenceHash } from "../evidence";
import { jsonLdEvidenceHash, productJsonLd } from "../jsonld";
import { type ParsedMoney, parseMoney } from "../money";
import { type TileReader, collectTiles } from "../tiles";

export const TARGET_ADAPTER_VERSION = "0.1.0";

const PRODUCT_PATH = /\/p\/(?:[^/]+\/)?-\/A-(\d+)(?:[/?#]|$)/i;
const LISTING_PATH = /^\/(?:s|c|b)(?:\/|$)/;
const TILE_FULFILLMENT = /^(pickup|delivery|shipping)\b/i;
const NOT_TILE_PRICE = 'h3, [data-test="rating-stars"], [data-test="cdui-marker-v2"]';
const ADD_TO_CART_ID = /^addToCartButtonOrTextIdFor(\d+)$/;
const STORE_NAME_ID = /^store-name-(\d+)$/;
const STORE_ARIA = /^\s*store:\s*(.+?)\s*$/i;
const SHOP_ALL = /^\s*shop all\s+/i;
const UNIT_PRICE = /\$\d[\d,]*(?:\.\d+)?\s*\/\s*(?:fl\s?oz|[a-z]+)/i;
const ESTIMATE = /\(est\.?\)|\bestimated\b|\bprice varies\b/i;
const WAS_PRICE = /\b(?:was|reg\.?|regular)\s+(\$\s?\d[\d,]*(?:\.\d{2})?)/i;
/** Offers, not shipping terms: "Ships free" and "Lactose-Free" are not price promotions. */
const PROMO =
  /\b(?:sale|clearance|price drop|deal|\d+% off|\$[\d.]+ off|buy \d+,? get|bogo|coupon)\b/i;
const MEMBER = /\bcircle\b/i;
const ZIP = /\b(\d{5})(?:-\d{4})?\b/;
const SIGN_IN = /\bsign in\b/i;
/** "pickup - selected - 1 of 3 - …", never "unselected". */
const SELECTED_CELL = /(?<!un)selected\b/i;
const PRICE_CONTAINER = '[data-test="price-cdui"], [data-test="@web/Price/PriceFull"]';
const PRICE_MODULE = '[data-test="module-product-detail-price-v2"]';

function hostMatches(host: string): boolean {
  return host === "target.com" || host.endsWith(".target.com");
}

/** The TCIN a product URL names, or undefined. Pure. */
export function skuInUrl(url: string): string | undefined {
  try {
    return PRODUCT_PATH.exec(new URL(url, "https://www.target.com/").pathname)?.[1];
  } catch {
    return undefined;
  }
}

function pageKind(url: string): PageKind | undefined {
  try {
    const u = new URL(url);
    if (!hostMatches(u.hostname)) return undefined;
    if (PRODUCT_PATH.test(u.pathname)) return "product";
    if (LISTING_PATH.test(u.pathname)) return "listing";
    return undefined;
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

function findStore(doc: Document): StoreRef | undefined {
  let storeId: string | undefined;
  let label: string | undefined;
  const popover = doc.querySelector('[data-test="storeNameWithAddressPopover"]');
  for (const button of Array.from(popover?.querySelectorAll('button[id^="store-name-"]') ?? [])) {
    const m = STORE_NAME_ID.exec(button.id);
    if (!m?.[1]) continue;
    storeId = m[1];
    label = textOf(button) || undefined;
    break;
  }
  if (label === undefined) {
    label = textOf(doc.querySelector('[data-test="@web/StoreName/StoreName"]')) || undefined;
  }
  if (label === undefined) {
    const header = doc.querySelector('[data-test="@web/StoreName/Button"]');
    const m = STORE_ARIA.exec(header?.getAttribute("aria-label") ?? "");
    if (m?.[1]) label = m[1];
  }
  if (storeId === undefined && label === undefined) return undefined;
  return withDefined<StoreRef>({ retailerStoreId: storeId, label });
}

interface FulfillmentRead {
  fulfillment: Fulfillment;
  inferred: boolean;
}

/** The selected fulfilment cell, else Target's default (shipping) flagged as inferred. */
function findFulfillment(doc: Document, override: Fulfillment | undefined): FulfillmentRead {
  if (override) return { fulfillment: override, inferred: false };
  for (const cell of Array.from(doc.querySelectorAll('[data-test^="fulfillment-cell-"]'))) {
    if (!SELECTED_CELL.test(cell.getAttribute("aria-label") ?? "")) continue;
    const kind = (cell.getAttribute("data-test") ?? "").replace("fulfillment-cell-", "");
    if (kind === "pickup") return { fulfillment: "pickup", inferred: false };
    if (kind === "delivery") return { fulfillment: "delivery", inferred: false };
    if (kind === "shipping") return { fulfillment: "ship", inferred: false };
  }
  return { fulfillment: "ship", inferred: true };
}

function findSessionState(doc: Document): SessionState {
  const link =
    doc.querySelector('[data-test="@web/AccountLink"]') ?? doc.querySelector("#account-sign-in");
  if (!link) return "unknown";
  const label = link.getAttribute("aria-label") ?? "";
  if (SIGN_IN.test(label) || SIGN_IN.test(textOf(link))) return "logged_out";
  return "logged_in";
}

function findZip3(doc: Document): string | undefined {
  const text = textOf(doc.querySelector('[data-test="@web/ZipCodeButton/ZipCodeNumber"]'));
  return ZIP.exec(text)?.[1]?.slice(0, 3);
}

function findBrand(doc: Document): string | undefined {
  const link = doc.querySelector('[data-test="shopAllBrandLink"]');
  const brand = textOf(link).replace(SHOP_ALL, "");
  return brand || undefined;
}

/** The SKU from the URL, else from the add-to-cart button id. */
function findSku(doc: Document, url: string): string | undefined {
  const fromUrl = skuInUrl(url);
  if (fromUrl) return fromUrl;
  for (const el of Array.from(doc.querySelectorAll('[id^="addToCartButtonOrTextIdFor"]'))) {
    const m = ADD_TO_CART_ID.exec(el.id);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/** Everything read once per page and shared by the hero and every tile. */
interface PageFacts {
  store: StoreRef | undefined;
  fulfillment: FulfillmentRead;
  sessionState: SessionState;
  zip3: string | undefined;
}

function readPage(doc: Document, ctx: PageContext): PageFacts {
  return {
    store: findStore(doc),
    fulfillment: findFulfillment(doc, ctx.fulfillment),
    sessionState: ctx.sessionState ?? findSessionState(doc),
    zip3: findZip3(doc),
  };
}

function contextOf(
  page: PageFacts,
  ctx: PageContext,
  fulfillment: FulfillmentRead,
): AdapterObservation["context"] {
  return withDefined({
    fulfillment: fulfillment.fulfillment,
    sessionState: page.sessionState,
    surface: ctx.surface,
    zip3: page.zip3,
    device: ctx.device,
    cleanSession: ctx.cleanSession,
    fulfillmentInferred: fulfillment.inferred ? true : undefined,
  });
}

// ---------------------------------------------------------------------------------------------
// The price and what sits next to it.
// ---------------------------------------------------------------------------------------------

interface PriceRead {
  element: Element;
  container: Element;
  price: ParsedMoney;
}

/** The first candidate that holds a dollar amount; the lazy skeleton (empty text) is skipped. */
function findPrice(doc: Document): { read?: PriceRead; sawCandidate: boolean } {
  const module = doc.querySelector(PRICE_MODULE);
  const candidates: Element[] = [
    ...Array.from(module?.querySelectorAll('[data-test="product-price"]') ?? []),
    ...Array.from(
      doc.querySelectorAll('[data-test="price-cdui"] [data-test="text-quill-insert-0"]'),
    ),
    ...Array.from(doc.querySelectorAll('[data-test="product-price"]')),
  ];
  let sawCandidate = false;
  for (const element of candidates) {
    sawCandidate = true;
    const price = parseMoney(textOf(element));
    if (!price) continue;
    const container = element.closest(PRICE_CONTAINER) ?? element.parentElement ?? element;
    return { read: { element, container, price }, sawCandidate };
  }
  return { sawCandidate };
}

interface PriceNeighbours {
  unitPriceText?: string;
  wasPrice?: ParsedMoney;
  promoTags: string[];
  memberPrice: boolean;
}

/** Short leaves of `scope` outside the price element itself, for badges and unit prices. */
function leavesOf(scope: Element, except: Element): string[] {
  const out: string[] = [];
  for (const el of Array.from(scope.querySelectorAll("*"))) {
    if (el.children.length > 0 || el === except || except.contains(el)) continue;
    if (el.closest("h1, h2, h3, h4, button")) continue;
    const text = textOf(el);
    if (text && text.length <= 64) out.push(text);
  }
  return out;
}

function readPriceNeighbours(doc: Document, read: PriceRead): PriceNeighbours {
  const containerText = textOf(read.container);
  let unitPriceText: string | undefined;
  const unit = UNIT_PRICE.exec(containerText.replace(textOf(read.element), " "));
  if (unit?.[0]) unitPriceText = unit[0].replace(/\s+/g, " ").trim();

  let wasPrice: ParsedMoney | undefined;
  const struck = read.container.querySelector("s, del");
  if (struck) wasPrice = parseMoney(textOf(struck));
  if (!wasPrice) {
    const m = WAS_PRICE.exec(containerText);
    if (m?.[1]) wasPrice = parseMoney(m[1]);
  }

  const scopes: Element[] = [read.container];
  const module = doc.querySelector(PRICE_MODULE);
  if (module && !module.contains(read.container)) scopes.push(module);
  for (const block of Array.from(
    doc.querySelectorAll(
      '[data-test="circle-offers-pdp"], [data-test="promotions-message-only-pdp"]',
    ),
  )) {
    scopes.push(block);
  }
  const promoTags: string[] = [];
  let memberPrice = false;
  for (const scope of scopes) {
    for (const text of leavesOf(scope, read.element)) {
      if (PROMO.test(text) && !promoTags.includes(text)) promoTags.push(text);
      if (MEMBER.test(text)) memberPrice = true;
    }
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

  const heading = doc.querySelector('h1[data-test="product-title"]') ?? doc.querySelector("h1");
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
      // An empty skeleton is `no_price` too: the box exists, the number has not rendered.
      return found.sawCandidate ? fail("no_price", "price box empty") : fail("no_price");
    }
    price = found.read.price;
    evidence = evidenceHash(found.read.container);
  }

  const neighbours = found.read
    ? readPriceNeighbours(doc, found.read)
    : { promoTags: [], memberPrice: false };
  const isEstimate = found.read ? ESTIMATE.test(textOf(found.read.container)) : false;
  const page = readPage(doc, ctx);

  const observation: AdapterObservation = {
    retailer: "target",
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
    context: contextOf(page, ctx, page.fulfillment),
    adapter: `target@${TARGET_ADAPTER_VERSION}`,
    evidenceHash: evidence,
  };
  if (page.store) observation.store = page.store;
  return { ok: true, observation };
}

// ---------------------------------------------------------------------------------------------
// Tiles.
// ---------------------------------------------------------------------------------------------

/** "Pickup ready within 2 hours" -> pickup; "Shipping …" -> ship. */
function fulfillmentOfLine(text: string): Fulfillment | undefined {
  const word = TILE_FULFILLMENT.exec(text)?.[1]?.toLowerCase();
  if (word === "pickup") return "pickup";
  if (word === "delivery") return "delivery";
  if (word === "shipping") return "ship";
  return undefined;
}

/** The first fulfilment line a tile shows, else the page's; a listing has no selection. */
function tileFulfillment(tile: Element, page: FulfillmentRead): FulfillmentRead {
  if (!page.inferred) return page;
  for (const block of Array.from(tile.querySelectorAll('[data-test="text-quill"]'))) {
    const f = fulfillmentOfLine(textOf(block));
    if (f) return { fulfillment: f, inferred: true };
  }
  return page;
}

interface TilePrice {
  element: Element;
  container: Element;
  price: ParsedMoney;
  /** The price block's text, for the unit price, estimate and was-price reads. */
  text: string;
}

/** The mini card's price block, else the listing tile's first rich-text dollar amount. */
function tilePrice(tile: Element): TilePrice | undefined {
  const minimal = tile.querySelector('[data-test="@web/Price/PriceAndPromoMinimal"]');
  if (minimal) {
    for (const span of Array.from(minimal.querySelectorAll("span"))) {
      if (span.closest('[data-test*="Strikethrough"], [data-test*="PromoDetails"]')) continue;
      const price = parseMoney(textOf(span));
      if (price) return { element: span, container: minimal, price, text: textOf(minimal) };
    }
    return undefined;
  }
  const content = tile.querySelector('a[data-test="content"]') ?? tile;
  for (const el of Array.from(content.querySelectorAll('[data-test="text-quill-insert-0"]'))) {
    if (el.closest(NOT_TILE_PRICE)) continue;
    const price = parseMoney(textOf(el));
    if (!price) continue;
    const container = el.closest('[data-test="text-quill"]') ?? el.parentElement ?? el;
    const wrapper = container.closest('[data-test="container-cdui-item-wrapper"]') ?? container;
    return { element: el, container, price, text: textOf(wrapper) };
  }
  return undefined;
}

function tileTitle(tile: Element): string {
  const content = tile.querySelector('a[data-test="content"]');
  const label = content?.getAttribute("aria-label")?.replace(/\s+/g, " ").trim();
  if (label) return label;
  const mini = textOf(tile.querySelector('[data-test="productCardVariantMiniTitle"]'));
  if (mini) return mini;
  return textOf(tile.querySelector("h3"));
}

function tileReader(doc: Document, ctx: PageContext): TileReader {
  const page = readPage(doc, ctx);
  return {
    tiles(d) {
      // Grid tiles first: a product shown both in the "Inspired by recent activity" carousel
      // and in the results keeps the results rendering (with its fulfilment lines).
      return [
        ...Array.from(d.querySelectorAll('[data-test="ListingPageProductListing"]')),
        ...Array.from(d.querySelectorAll('[data-test="productCardVariantMini"]')),
      ];
    },
    read(tile): ExtractResult {
      const link = tile.querySelector('a[href*="/p/"]');
      const href = link?.getAttribute("href") ?? "";
      const sku = link ? skuInUrl(href) : undefined;
      if (!link || !sku) return fail("no_sku");
      let url: string | undefined;
      try {
        url = canonicalUrl(new URL(href, ctx.url).href);
      } catch {
        url = undefined;
      }
      if (url === undefined) return fail("no_sku");

      const read = tilePrice(tile);
      if (!read) return fail("no_price");
      const title = tileTitle(tile);
      if (!title) return fail("no_title");

      const unit = UNIT_PRICE.exec(read.text.replace(read.price.priceText, " "));
      let wasPrice: ParsedMoney | undefined;
      const reg = tile.querySelector('[data-test="strikethroughFormattedRegPrice"], s, del');
      if (reg) wasPrice = parseMoney(textOf(reg));
      if (!wasPrice) {
        const m = WAS_PRICE.exec(read.text);
        if (m?.[1]) wasPrice = parseMoney(m[1]);
      }
      const promoTags: string[] = [];
      let memberPrice = false;
      for (const el of Array.from(tile.querySelectorAll("*"))) {
        if (el.children.length > 0 || read.element.contains(el)) continue;
        if (el.closest("h3, button") || el.closest('[data-test="rating-stars"]')) continue;
        const text = textOf(el);
        if (!text || text.length > 64) continue;
        if (PROMO.test(text) && !promoTags.includes(text)) promoTags.push(text);
        if (MEMBER.test(text)) memberPrice = true;
      }
      const fulfillment = tileFulfillment(tile, page.fulfillment);

      const observation: AdapterObservation = {
        retailer: "target",
        product: withDefined({
          retailerSku: sku,
          title,
          brand: undefined,
          sizeText: undefined,
          url,
          upc: undefined,
        }),
        facts: withDefined({
          price: read.price.money,
          priceText: read.price.priceText,
          isEstimate: ESTIMATE.test(read.text),
          wasPrice: wasPrice?.money,
          unitPriceText: unit?.[0]?.replace(/\s+/g, " ").trim(),
          promoTags,
          memberPrice,
        }),
        context: contextOf(page, ctx, fulfillment),
        adapter: `target@${TARGET_ADAPTER_VERSION}`,
        evidenceHash: evidenceHash(read.container),
      };
      if (page.store) observation.store = page.store;
      return { ok: true, observation };
    },
  };
}

export const targetAdapter: Adapter = {
  name: "target",
  version: TARGET_ADAPTER_VERSION,
  matches,
  pageKind,
  extract(doc, ctx) {
    try {
      return extractHero(doc, ctx);
    } catch (e) {
      return fail("adapter_threw", e instanceof Error ? e.message : String(e));
    }
  },
  extractTiles(doc, ctx): TileExtraction {
    try {
      return collectTiles(doc, tileReader(doc, ctx));
    } catch {
      return { observations: [], skipped: { adapter_threw: 1 } };
    }
  },
};

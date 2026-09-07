/**
 * Instacart adapter. Written against fixtures/instacart/* (Wegmans, 2026-09-04 snapshots) and,
 * since S17, the Walmart storefront milk page as the probe fetches it (2026-09-07).
 *
 * Three surfaces:
 *  - the standalone product page (`#item_details`),
 *  - the product modal that opens over a listing when a tile is clicked (URL becomes
 *    `/products/<sku>-…?retailerSlug=<slug>`): `div[aria-modal="true"][aria-label="item
 *    details"]` holding the same `#item_details`, with a Back button and an `h2` title
 *    (fixtures/instacart/walmart-whole-milk-1gal-modal). `role` and `hidden` are not kept by
 *    the scrubber, so nothing here depends on them,
 *  - listings: search, aisles, storefront. The cross-retailer search (`/store/s?k=…`,
 *    fixtures/instacart/walmart-search-milk) groups tiles in
 *    `li[data-testid="CrossRetailerResultRowWrapper"]` rows, each with an
 *    `[aria-label="retailer"]` header (store link, label, "Delivery by …"); a tile's store and
 *    fulfilment come from its row.
 *
 * Where each field lives (selectors avoid the hashed `e-…` emotion classes, which change per
 * build, and use ids, data-testids, aria attributes and text shapes instead):
 *
 *  - JSON-LD:      `script[type="application/ld+json"]` with a schema.org Product. Present in
 *                  the server-rendered HTML the probe fetches. When it names the page's SKU,
 *                  title, brand, size and price come from it and the evidence hash covers its
 *                  text; the DOM fills everything else and is the fallback.
 *  - title:        `h1` in `#item_details`, else its first `h2` (the modal).
 *  - price:        `span.screen-reader-only` reading "Current price: $0.22 each (est.)", inside
 *                  the hero root and outside any carousel item. Its parent `<div>` is the
 *                  price container the evidence hash is computed over. The sticky header
 *                  (`#pdp-scroll-state`) repeats the price without the label; ignored.
 *  - isEstimate:   "(est.)" in the price line, or "Final cost by weight" under the title.
 *  - sku, storeId: `#item_details-items_<storeId>-<sku>-Details`; the sku falls back to the
 *                  URL's `/products/<sku>-…`, the store id to any tile's
 *                  `data-testid="item_list_item_items_<storeId>-…"` on the page.
 *  - store label:  `#store-menu-wrapper h2` ("Wegmans"), else the retailer link for the
 *                  store slug, `a[href="/store/<slug>/s"] span[aria-level]` ("Walmart"), which
 *                  the search rows and the "Shop all" link under the modal title share.
 *  - sizeText:     the first leaf after the title that reads like a size ("16 oz", "1 gal",
 *                  "About 0.38 lb each", "52 fl oz"), skipping star ratings and prices. Never
 *                  derived from the title.
 *  - unitPriceText: "$0.59 / lb", "$0.04/fl oz" in the same block, "•" dropped.
 *  - brand:        the "Shop all <brand>" link under the title (rendered lower case).
 *  - fulfilment:   `[aria-label="service type"] button[aria-current="true"]` ("Delivery" /
 *                  "Pickup"), else "Delivery by …" / "Pickup ready by …" in the header or, for
 *                  a tile, in its retailer row. Absent on server-rendered HTML and in the
 *                  modal: then `delivery`, Instacart's default, with `fulfillmentInferred`.
 *  - session:      logged out when the auth modal is open (`body.body--auth-modal-open`), a
 *                  `[data-testid="nav-login"]` exists, or the header has a "Log in" button.
 *                  Logged in when the header rendered its search form or cart button without
 *                  one. Unknown when there is no header, or only its loading skeleton (the
 *                  server-rendered HTML the probe fetches).
 *  - zip3:         "Is 08540 your ZIP code?" in the header. Fixtures scrub the digits, so on a
 *                  fixture this is absent; the test un-scrubs a copy to cover the path.
 *  - wasPrice:     an "Original price: $X" screen-reader span, <s>/<del>, or "was $X" text
 *                  next to the price. No hero fixture shows one.
 *  - promoTags:    badge text next to the price that reads like an offer ("Rollback",
 *                  "10% off", "Best seller", "Great price").
 *  - memberPrice:  "Instacart+" or "member" next to the price. None on the fixtures.
 *  - tiles:        `[data-item-card="true"]` (or `li[data-testid^="item_list_item"]`), each
 *                  with an `a[href*="/products/"]`, the same "Current price:" label, an `h3`
 *                  title (or the "Add 1 ct <title>" button label), and a size / unit block.
 *                  Tile product URLs carry `?retailerSlug=<slug>` (the row's, else the
 *                  page's) so the probe fetches the same store.
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

export const INSTACART_ADAPTER_VERSION = "0.2.0";

const PRODUCT_PATH = /\/products\/(\d+)(?:[-/]|$)/;
const LISTING_PATH =
  /^\/store(?:\/[^/]+)?\/(?:s|search|collections|departments|storefront|browse)(?:\/|$)/;
const DETAILS_ID = /^item_details-items_(\d+)-(\d+)-/;
const TILE_ID = /(?:^|_)items_(\d+)-(\d+)$/;
const UNIT_PRICE = /\$\d[\d,]*(?:\.\d+)?\s*\/\s*(?:fl\s?oz|[a-z]+)/i;
const CURRENT_PRICE = /^\s*current price:\s*/i;
const ORIGINAL_PRICE = /^\s*original price:\s*/i;
const WAS_PRICE = /\bwas\s+(\$\s?\d[\d,]*(?:\.\d{2})?)/i;
const ESTIMATE = /\(est\.?\)|\bestimated\b/i;
const PROMO =
  /\b(?:rollback|clearance|reduced|price drop|low price|great price|best seller|\d+% off|\$[\d.]+ off|buy \d+,? get|bogo|sale|deal|coupon|free)\b/i;
/** Reads like a size: a number, or "each" / "per", and not a price, a rating or a count. */
const SIZE_TEXT = /(?:\d|\b(?:each|per|bunch)\b)/i;
const NOT_SIZE = /^[★☆(]|\$|\bsizes?\b|\bstock\b|\bsponsored\b/i;
const MEMBER = /instacart\+|\bmembers?\b/i;
const ZIP_PROMPT = /\bis\s+(\d{5})(?:-\d{4})?\s+your\s+zip\s+code\b/i;
const ZIP_FALLBACK = /\bzip code\b[^0-9]{0,30}(\d{5})\b/i;
const STOREFRONT_HREF = /^\/store\/([^/]+)\/storefront\/?$/;
const STORE_SEARCH_HREF = /^\/store\/([^/]+)\/s\/?$/;
const ITEM_DETAILS_MODAL = '[aria-modal="true"][aria-label="item details" i]';
const RETAILER_ROW = '[data-testid="CrossRetailerResultRowWrapper"], section[data-item-list]';
const ADD_LABEL = /^add\s+(?:\d+\s*(?:ct|count|each|lb|oz)?\s+)?(.+)$/i;
const NOT_IN_HERO = 'li, ul, [data-testid^="item_list_item"], [data-item-card]';

function hostMatches(host: string): boolean {
  return host === "instacart.com" || host.endsWith(".instacart.com");
}

/** The SKU a product URL names, or undefined. Pure. */
export function skuInUrl(url: string): string | undefined {
  try {
    return PRODUCT_PATH.exec(new URL(url, "https://www.instacart.com/").pathname)?.[1];
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
// Page-level reads, shared by the hero and the tiles.
// ---------------------------------------------------------------------------------------------

function hrefPath(link: Element): string | undefined {
  try {
    return new URL(link.getAttribute("href") ?? "", "https://www.instacart.com/").pathname;
  } catch {
    return undefined;
  }
}

/** The label a retailer link renders: its `[aria-level]` span, else its text unless "Shop all …". */
function retailerLinkLabel(link: Element): string | undefined {
  const level = textOf(link.querySelector("[aria-level]"));
  if (level) return level;
  const text = textOf(link);
  return text && !/^shop all\b/i.test(text) ? text : undefined;
}

/**
 * The store label: the storefront header (`#store-menu-wrapper h2`), else the retailer link
 * for `slug` (`a[href="/store/<slug>/s"]`, as the search rows and the modal's "Shop all"
 * link render it).
 */
function findStoreLabel(scope: ParentNode, slug: string | undefined): string | undefined {
  const header =
    textOf(scope.querySelector('#store-menu-wrapper a[href*="/storefront"] h2')) ||
    textOf(scope.querySelector('a[href$="/storefront"] h2'));
  if (header) return header;
  if (slug === undefined) return undefined;
  for (const link of Array.from(scope.querySelectorAll("a[href]"))) {
    const m = STORE_SEARCH_HREF.exec(hrefPath(link) ?? "");
    if (m?.[1] !== slug) continue;
    const label = retailerLinkLabel(link);
    if (label) return label;
  }
  return undefined;
}

/**
 * The store slug: the storefront link (`/store/walmart/storefront`), else a store search link
 * (`/store/walmart/s`, which the "Shop all" link under a title and the search rows use).
 */
function findStoreSlug(scope: ParentNode): string | undefined {
  for (const link of Array.from(scope.querySelectorAll('a[href*="/storefront"]'))) {
    const m = STOREFRONT_HREF.exec(hrefPath(link) ?? "");
    if (m?.[1]) return m[1];
  }
  for (const link of Array.from(scope.querySelectorAll('a[href*="/store/"]'))) {
    const m = STORE_SEARCH_HREF.exec(hrefPath(link) ?? "");
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/** Store id from the details panel id, else from any tile id on the page. */
function findStoreId(doc: Document): string | undefined {
  const details = doc.querySelector('[id^="item_details-items_"]');
  const m = details ? DETAILS_ID.exec(details.id) : null;
  if (m?.[1]) return m[1];
  const tile = doc.querySelector('[data-testid^="item_list_item_items_"]');
  const t = tile ? TILE_ID.exec(tile.getAttribute("data-testid") ?? "") : null;
  return t?.[1];
}

function storeRef(storeId: string | undefined, label: string | undefined): StoreRef | undefined {
  if (storeId === undefined && label === undefined) return undefined;
  return withDefined<StoreRef>({ retailerStoreId: storeId, label });
}

interface FulfillmentRead {
  fulfillment: Fulfillment;
  inferred: boolean;
}

/** The selected service type, else the header's delivery / pickup line, else Instacart's default. */
function findFulfillment(doc: Document, override: Fulfillment | undefined): FulfillmentRead {
  if (override) return { fulfillment: override, inferred: false };
  const selected = doc.querySelector('[aria-label="service type"] button[aria-current="true"]');
  const label = textOf(selected).toLowerCase();
  if (label.includes("delivery")) return { fulfillment: "delivery", inferred: false };
  if (label.includes("pickup")) return { fulfillment: "pickup", inferred: false };
  return fulfillmentInText(leafText(doc.querySelector("#commonHeader")));
}

/** "Delivery by 1:45pm" / "Pickup ready …" in a header or a retailer row; else the default. */
function fulfillmentInText(text: string): FulfillmentRead {
  if (/\bdelivery by\b/i.test(text)) return { fulfillment: "delivery", inferred: false };
  if (/\bpickup (?:at|by|from|ready|available|only)\b/i.test(text)) {
    return { fulfillment: "pickup", inferred: false };
  }
  return { fulfillment: "delivery", inferred: true };
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

function findSessionState(doc: Document): SessionState {
  const body = doc.body;
  if (body?.classList.contains("body--auth-modal-open")) return "logged_out";
  if (doc.querySelector('[data-testid="nav-login"]')) return "logged_out";
  const header = doc.querySelector("#commonHeader");
  if (!header) return "unknown";
  for (const button of Array.from(header.querySelectorAll("button"))) {
    if (/^log in$/i.test(textOf(button))) return "logged_out";
  }
  // The server-rendered header is a loading skeleton: no search form, no cart. It says
  // nothing about the session, so neither do we.
  const hydrated =
    header.querySelector('form[data-identifier="search_input"], input#search-bar-input') ||
    header.querySelector('[data-testid="floating-cart-button"], [aria-controls="cart_dialog"]');
  return hydrated ? "logged_in" : "unknown";
}

function findZip3(doc: Document): string | undefined {
  const header = textOf(doc.querySelector("#commonHeader"));
  const m = ZIP_PROMPT.exec(header) ?? ZIP_FALLBACK.exec(header);
  return m?.[1]?.slice(0, 3);
}

/** Everything read once per page and shared by every observation the page yields. */
interface PageFacts {
  storeId: string | undefined;
  storeLabel: string | undefined;
  storeSlug: string | undefined;
  fulfillment: FulfillmentRead;
  sessionState: SessionState;
  zip3: string | undefined;
}

function readPage(doc: Document, ctx: PageContext, slugScope: ParentNode = doc): PageFacts {
  const storeSlug = findStoreSlug(slugScope) ?? findStoreSlug(doc);
  return {
    storeId: findStoreId(doc),
    storeLabel: findStoreLabel(doc, storeSlug),
    storeSlug,
    fulfillment: findFulfillment(doc, ctx.fulfillment),
    sessionState: ctx.sessionState ?? findSessionState(doc),
    zip3: findZip3(doc),
  };
}

function contextOf(page: PageFacts, ctx: PageContext): AdapterObservation["context"] {
  return withDefined({
    fulfillment: page.fulfillment.fulfillment,
    sessionState: page.sessionState,
    surface: ctx.surface,
    zip3: page.zip3,
    device: ctx.device,
    cleanSession: ctx.cleanSession,
    fulfillmentInferred: page.fulfillment.inferred ? true : undefined,
  });
}

// ---------------------------------------------------------------------------------------------
// Price-adjacent signals, shared by the hero and the tiles.
// ---------------------------------------------------------------------------------------------

/**
 * The first "Current price:" screen-reader span under `root`. With `exclude`, spans inside a
 * matching element below `root` (a carousel tile on the product page) are passed over.
 */
function findPriceLabel(root: Element, exclude: string | undefined): Element | undefined {
  for (const span of Array.from(root.querySelectorAll("span.screen-reader-only"))) {
    if (!CURRENT_PRICE.test(span.textContent ?? "")) continue;
    if (exclude !== undefined) {
      const hit = span.closest(exclude);
      if (hit && hit !== root && root.contains(hit)) continue;
    }
    return span;
  }
  return undefined;
}

interface PriceNeighbours {
  wasPrice?: ParsedMoney;
  promoTags: string[];
  memberPrice: boolean;
}

/**
 * Signals that sit next to the price: strike-through, offer badges, membership gating.
 * `scope` is the element the neighbours are searched in; for the hero that is the price
 * container's parent, for a tile the whole card.
 */
function readPriceNeighbours(priceContainer: Element, scope: Element): PriceNeighbours {
  let wasPrice: ParsedMoney | undefined;
  for (const span of Array.from(scope.querySelectorAll("span.screen-reader-only"))) {
    if (ORIGINAL_PRICE.test(span.textContent ?? "")) {
      wasPrice = parseMoney(textOf(span).replace(ORIGINAL_PRICE, ""));
      break;
    }
  }
  if (!wasPrice) {
    const struck = scope.querySelector("s, del");
    if (struck) wasPrice = parseMoney(textOf(struck));
  }
  if (!wasPrice) {
    const m = WAS_PRICE.exec(textOf(scope));
    if (m?.[1]) wasPrice = parseMoney(m[1]);
  }
  // Badges are short leaves near the price. Titles and buttons are skipped so "Free Range
  // Eggs" or "Member's Mark" never read as an offer or a membership gate.
  const promoTags: string[] = [];
  let memberPrice = false;
  for (const el of Array.from(scope.querySelectorAll("*"))) {
    if (el.children.length > 0 || priceContainer.contains(el)) continue;
    if (el.closest("h1, h2, h3, h4, button")) continue;
    const text = textOf(el);
    if (!text || text.length > 64) continue;
    if (PROMO.test(text) && !promoTags.includes(text)) promoTags.push(text);
    if (MEMBER.test(text)) memberPrice = true;
  }
  return withDefined({ wasPrice, promoTags, memberPrice });
}

/** Leaves of the blocks that follow `title`, in order, skipping rating widgets and the price. */
function leavesAfter(title: Element): Element[] {
  const out: Element[] = [];
  for (let el = title.nextElementSibling; el; el = el.nextElementSibling) {
    if (el.querySelector("span.screen-reader-only")) break;
    for (const leaf of Array.from(el.querySelectorAll("*"))) {
      if (leaf.children.length > 0) continue;
      if (leaf.closest('[aria-label^="Average rating" i], button, a[aria-label]')) continue;
      out.push(leaf);
    }
  }
  return out;
}

/**
 * Size and unit price sit in the blocks after the title: on the hero right after the h1,
 * on a tile after the h3 and (on search) a star-rating block.
 */
function findSizeAndUnit(title: Element): { sizeText?: string; unitPriceText?: string } {
  let sizeText: string | undefined;
  let unitPriceText: string | undefined;
  // Match per leaf, not on a block's joined text: adjacent leaves have no separator, so
  // "$0.89 / lb" followed by "About 2.0 lb each" would read "lbAbout".
  for (const leaf of leavesAfter(title)) {
    const text = textOf(leaf);
    if (!text) continue;
    if (unitPriceText === undefined) {
      const m = UNIT_PRICE.exec(text);
      if (m?.[0]) unitPriceText = m[0].replace(/\s+/g, " ").trim();
    }
    if (sizeText === undefined && SIZE_TEXT.test(text) && !NOT_SIZE.test(text)) {
      sizeText = text;
    }
    if (sizeText !== undefined && unitPriceText !== undefined) break;
  }
  return withDefined({ sizeText, unitPriceText });
}

function findBrand(root: Element): string | undefined {
  for (const link of Array.from(root.querySelectorAll("a"))) {
    const spans = Array.from(link.querySelectorAll("span"));
    if (spans.length >= 2 && /^shop all$/i.test(textOf(spans[0]))) {
      const brand = textOf(spans[1]);
      if (brand) return brand;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// The hero: standalone page or modal.
// ---------------------------------------------------------------------------------------------

interface Hero {
  root: Element;
  heading: Element | null;
}

/**
 * The element the hero lives in: `#item_details`, preferring the one inside the product
 * modal (`[aria-modal="true"][aria-label="item details"]`) when a modal is open over a page
 * that has its own. The standalone page titles with an `h1`, the modal with an `h2`; the
 * modal's first `h2` is the title (Nutrition, Ingredients follow). Failing everything, the
 * page itself, so a bare page still fails with a precise reason.
 */
function findHero(doc: Document): Hero | undefined {
  const details =
    doc.querySelector(`${ITEM_DETAILS_MODAL} #item_details`) ?? doc.querySelector("#item_details");
  if (details) {
    return { root: details, heading: details.querySelector("h1") ?? details.querySelector("h2") };
  }
  const root = doc.body;
  return root ? { root, heading: root.querySelector("h1") } : undefined;
}

/** The SKU from the details panel id, else from the URL. */
function findHeroSku(doc: Document, url: string): string | undefined {
  const details = doc.querySelector('[id^="item_details-items_"]');
  const m = details ? DETAILS_ID.exec(details.id) : null;
  return m?.[2] ?? skuInUrl(url);
}

function extractHero(doc: Document, ctx: PageContext): ExtractResult {
  const url = canonicalUrl(ctx.url);
  if (url === undefined || pageKind(url) !== "product") return fail("not_product_page");

  const hero = findHero(doc);
  const root = hero?.root;
  const heading = hero?.heading ?? null;
  const domTitle = textOf(heading);

  const sku = findHeroSku(doc, url);
  if (!sku) return fail("no_sku");

  const jsonLd = productJsonLd(doc, sku, skuInUrl);
  const priceLabel = root ? findPriceLabel(root, NOT_IN_HERO) : undefined;
  const priceContainer = priceLabel?.parentElement ?? undefined;
  const priceLine = priceLabel ? textOf(priceLabel).replace(CURRENT_PRICE, "") : "";
  const domPrice = priceLabel ? parseMoney(priceLine) : undefined;

  const title = jsonLd?.name ?? domTitle;
  if (!title) return fail("no_title");

  let price: ParsedMoney | undefined;
  let evidence: string;
  if (jsonLd?.price && jsonLd.priceText !== undefined) {
    price = { money: jsonLd.price, priceText: jsonLd.priceText };
    evidence = jsonLdEvidenceHash(jsonLd);
  } else {
    if (!priceLabel || !priceContainer) return fail("no_price");
    if (!domPrice) return fail("unparseable_price", priceLine);
    price = domPrice;
    evidence = evidenceHash(priceContainer);
  }

  const page = readPage(doc, ctx, root ?? doc);
  const detailsText = textOf(root);
  const isEstimate = ESTIMATE.test(priceLine) || /final cost by weight/i.test(detailsText);
  const neighbours = priceContainer
    ? readPriceNeighbours(priceContainer, priceContainer.parentElement ?? priceContainer)
    : { promoTags: [], memberPrice: false };
  const { sizeText, unitPriceText } = heading ? findSizeAndUnit(heading) : {};

  const observation: AdapterObservation = {
    retailer: "instacart",
    product: withDefined({
      retailerSku: sku,
      title,
      brand: jsonLd?.brand ?? (root ? findBrand(root) : undefined),
      sizeText: jsonLd?.size ?? sizeText,
      url,
      upc: undefined,
    }),
    facts: withDefined({
      price: price.money,
      priceText: price.priceText,
      isEstimate,
      wasPrice: neighbours.wasPrice?.money,
      unitPriceText,
      promoTags: neighbours.promoTags,
      memberPrice: neighbours.memberPrice,
    }),
    context: contextOf(page, ctx),
    adapter: `instacart@${INSTACART_ADAPTER_VERSION}`,
    evidenceHash: evidence,
  };
  const store = storeRef(page.storeId, page.storeLabel);
  if (store) observation.store = store;
  return { ok: true, observation };
}

// ---------------------------------------------------------------------------------------------
// Tiles.
// ---------------------------------------------------------------------------------------------

function tileTitle(tile: Element, link: Element): string {
  const heading = textOf(tile.querySelector("h3, h2, h4"));
  if (heading) return heading;
  for (const button of Array.from(tile.querySelectorAll("button[aria-label]"))) {
    const m = ADD_LABEL.exec(button.getAttribute("aria-label") ?? "");
    if (m?.[1]) return m[1].trim();
  }
  return link.getAttribute("aria-label") ?? "";
}

/** `/products/3255474-organic-bananas-each` on the page's origin, plus the store slug. */
function tileUrl(
  href: string,
  ctx: PageContext,
  storeSlug: string | undefined,
): string | undefined {
  let u: URL;
  try {
    u = new URL(href, ctx.url);
  } catch {
    return undefined;
  }
  if (
    storeSlug !== undefined &&
    !u.searchParams.has("retailerSlug") &&
    !/^\/store\//.test(u.pathname)
  ) {
    u.searchParams.set("retailerSlug", storeSlug);
  }
  return canonicalUrl(u.href);
}

/** What a tile inherits from its retailer row on a cross-retailer search, if it sits in one. */
interface RowFacts {
  storeSlug: string | undefined;
  storeLabel: string | undefined;
  fulfillment: FulfillmentRead | undefined;
}

function readRow(tile: Element): RowFacts | undefined {
  const row = tile.closest(RETAILER_ROW);
  const header = row?.querySelector('[aria-label="retailer" i]');
  if (!row || !header) return undefined;
  let storeSlug: string | undefined;
  let storeLabel: string | undefined;
  for (const link of Array.from(header.querySelectorAll("a[href]"))) {
    const m = STORE_SEARCH_HREF.exec(hrefPath(link) ?? "");
    if (!m?.[1]) continue;
    storeSlug = m[1];
    storeLabel = retailerLinkLabel(link);
    break;
  }
  const read = fulfillmentInText(leafText(header));
  return { storeSlug, storeLabel, fulfillment: read.inferred ? undefined : read };
}

function tileReader(doc: Document, ctx: PageContext): TileReader {
  const page = readPage(doc, ctx);
  const pageContext = contextOf(page, ctx);
  return {
    tiles(d) {
      const cards = Array.from(d.querySelectorAll('[data-item-card="true"]'));
      if (cards.length > 0) return cards;
      return Array.from(d.querySelectorAll('li[data-testid^="item_list_item"]'));
    },
    read(tile): ExtractResult {
      const link = tile.querySelector('a[href*="/products/"]');
      const href = link?.getAttribute("href") ?? "";
      const sku = link ? skuInUrl(href) : undefined;
      if (!link || !sku) return fail("no_sku");
      const row = readRow(tile);
      const storeSlug = row?.storeSlug ?? page.storeSlug;
      const storeLabel = row?.storeLabel ?? page.storeLabel;
      const context =
        row?.fulfillment && ctx.fulfillment === undefined
          ? contextOf({ ...page, fulfillment: row.fulfillment }, ctx)
          : pageContext;
      const url = tileUrl(href, ctx, storeSlug);
      if (url === undefined) return fail("no_sku");

      const priceLabel = findPriceLabel(tile, undefined);
      const priceContainer = priceLabel?.parentElement;
      if (!priceLabel || !priceContainer) return fail("no_price");
      const priceLine = textOf(priceLabel).replace(CURRENT_PRICE, "");
      const price = parseMoney(priceLine);
      if (!price) return fail("unparseable_price", priceLine);

      const title = tileTitle(tile, link);
      if (!title) return fail("no_title");

      const tileId =
        tile.closest('[data-testid^="item_list_item"]')?.getAttribute("data-testid") ?? "";
      const storeId = TILE_ID.exec(tileId)?.[1] ?? page.storeId;
      const neighbours = readPriceNeighbours(priceContainer, tile);
      const heading = tile.querySelector("h3, h2, h4");
      const { sizeText, unitPriceText } = heading ? findSizeAndUnit(heading) : {};

      const observation: AdapterObservation = {
        retailer: "instacart",
        product: withDefined({
          retailerSku: sku,
          title,
          brand: undefined,
          sizeText,
          url,
          upc: undefined,
        }),
        facts: withDefined({
          price: price.money,
          priceText: price.priceText,
          isEstimate: ESTIMATE.test(priceLine),
          wasPrice: neighbours.wasPrice?.money,
          unitPriceText,
          promoTags: neighbours.promoTags,
          memberPrice: neighbours.memberPrice,
        }),
        context: { ...context },
        adapter: `instacart@${INSTACART_ADAPTER_VERSION}`,
        evidenceHash: evidenceHash(priceContainer),
      };
      const store = storeRef(storeId, storeLabel);
      if (store) observation.store = store;
      return { ok: true, observation };
    },
  };
}

function extractTilesUnsafe(doc: Document, ctx: PageContext): TileExtraction {
  return collectTiles(doc, tileReader(doc, ctx));
}

export const instacartAdapter: Adapter = {
  name: "instacart",
  version: INSTACART_ADAPTER_VERSION,
  matches,
  pageKind,
  extract(doc, ctx) {
    try {
      return extractHero(doc, ctx);
    } catch (e) {
      return fail("adapter_threw", e instanceof Error ? e.message : String(e));
    }
  },
  extractTiles(doc, ctx) {
    try {
      return extractTilesUnsafe(doc, ctx);
    } catch {
      return { observations: [], skipped: { adapter_threw: 1 } };
    }
  },
};

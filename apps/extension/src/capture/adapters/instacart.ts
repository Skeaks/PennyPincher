/**
 * Instacart adapter. Written against fixtures/instacart/* (Wegmans, 2026-09-04 snapshots).
 *
 * Where each field lives on the page (selectors avoid the hashed `e-…` emotion classes, which
 * change per build, and use ids, data-testids, aria attributes and text shapes instead):
 *
 *  - title:        `#item_details h1`
 *  - price:        `span.screen-reader-only` reading "Current price: $0.22 each (est.)", inside
 *                  `#item_details` and outside any carousel item. Its parent `<div>` is the
 *                  price container the evidence hash is computed over. The sticky header
 *                  (`#pdp-scroll-state`) repeats the price without the label; ignored.
 *  - isEstimate:   "(est.)" in the price line, or "Final cost by weight" under the title.
 *  - sku, storeId: `#item_details-items_<storeId>-<sku>-Details` (falls back to the URL's
 *                  `/products/<sku>-…` for the sku).
 *  - store label:  `#store-menu-wrapper h2` ("Wegmans").
 *  - sizeText:     the first `<span>` of the block right after the h1 ("16 oz",
 *                  "About 0.38 lb each"). Never derived from the title.
 *  - unitPriceText: "$0.59 / lb" in the same block, with the "•" separator dropped.
 *  - brand:        the "Shop all <brand>" link under the title (only the grapes fixture has one).
 *  - fulfilment:   `[aria-label="service type"] button[aria-current="true"]` ("Delivery" / "Pickup").
 *  - session:      logged out when the auth modal is open (`body.body--auth-modal-open`), a
 *                  `[data-testid="nav-login"]` exists, or the header has a "Log in" button.
 *                  Otherwise logged in when the header rendered at all; else unknown.
 *  - zip3:         "Is 08540 your ZIP code?" in the header. Fixtures scrub the digits, so on a
 *                  fixture this is absent; the test un-scrubs a copy to cover the path.
 *  - wasPrice:     a "Original price: $X" screen-reader span, or <s>/<del>, next to the price.
 *                  No fixture shows one; shape is a best guess and is marked as such.
 *  - promoTags:    badge text next to the price that reads like an offer. None on the fixtures.
 *  - memberPrice:  "Instacart+" or "member" next to the price. None on the fixtures.
 */
import type { Fulfillment, SessionState, StoreRef } from "@pennypincher/schema";
import {
  type Adapter,
  type AdapterObservation,
  type ExtractResult,
  type PageContext,
  canonicalUrl,
  fail,
  textOf,
  withDefined,
} from "../adapter";
import { evidenceHash } from "../evidence";
import { parseMoney } from "../money";

export const INSTACART_ADAPTER_VERSION = "0.1.0";

const PRODUCT_PATH = /\/products\/(\d+)(?:[-/]|$)/;
const DETAILS_ID = /^item_details-items_(\d+)-(\d+)-/;
const UNIT_PRICE = /\$\d[\d,]*(?:\.\d+)?\s*\/\s*[a-z]+/i;
const CURRENT_PRICE = /^\s*current price:\s*/i;
const ORIGINAL_PRICE = /^\s*original price:\s*/i;
const ESTIMATE = /\(est\.?\)/i;
const PROMO = /\b(?:\d+% off|\$[\d.]+ off|buy \d+,? get|bogo|sale|deal|coupon|free)\b/i;
const MEMBER = /instacart\+|\bmembers?\b/i;
const ZIP_PROMPT = /\bis\s+(\d{5})(?:-\d{4})?\s+your\s+zip\s+code\b/i;
const ZIP_FALLBACK = /\bzip code\b[^0-9]{0,30}(\d{5})\b/i;

function hostMatches(host: string): boolean {
  return host === "instacart.com" || host.endsWith(".instacart.com");
}

function matches(url: string): boolean {
  try {
    const u = new URL(url);
    return hostMatches(u.hostname) && PRODUCT_PATH.test(u.pathname);
  } catch {
    return false;
  }
}

/** The hero price's screen-reader span: first "Current price:" outside any list/carousel. */
function findPriceLabel(doc: Document): Element | undefined {
  const details = doc.querySelector("#item_details") ?? doc.body ?? doc.documentElement;
  if (!details) return undefined;
  for (const span of Array.from(details.querySelectorAll("span.screen-reader-only"))) {
    if (!CURRENT_PRICE.test(span.textContent ?? "")) continue;
    if (span.closest('li, ul, [data-testid^="item_list_item"]')) continue;
    return span;
  }
  return undefined;
}

function findSku(doc: Document, url: string): { sku?: string; storeId?: string } {
  const details = doc.querySelector('[id^="item_details-items_"]');
  const m = details ? DETAILS_ID.exec(details.id) : null;
  if (m?.[1] && m[2]) return { storeId: m[1], sku: m[2] };
  try {
    const fromUrl = PRODUCT_PATH.exec(new URL(url).pathname);
    if (fromUrl?.[1]) return { sku: fromUrl[1] };
  } catch {
    // fall through
  }
  return {};
}

function findStore(doc: Document, storeId: string | undefined): StoreRef | undefined {
  const label =
    textOf(doc.querySelector("#store-menu-wrapper h2")) ||
    textOf(doc.querySelector('a[href$="/storefront"] h2')) ||
    undefined;
  if (storeId === undefined && label === undefined) return undefined;
  return withDefined<StoreRef>({ retailerStoreId: storeId, label });
}

function findFulfillment(doc: Document): Fulfillment | undefined {
  const selected = doc.querySelector('[aria-label="service type"] button[aria-current="true"]');
  const label = textOf(selected).toLowerCase();
  if (label.includes("delivery")) return "delivery";
  if (label.includes("pickup")) return "pickup";
  const header = textOf(doc.querySelector("#commonHeader"));
  if (/\bdelivery by\b/i.test(header)) return "delivery";
  if (/\bpickup (?:at|by|from|ready)\b/i.test(header)) return "pickup";
  return undefined;
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
  return "logged_in";
}

function findZip3(doc: Document): string | undefined {
  const header = textOf(doc.querySelector("#commonHeader"));
  const m = ZIP_PROMPT.exec(header) ?? ZIP_FALLBACK.exec(header);
  return m?.[1]?.slice(0, 3);
}

/** Size and unit price sit in the block right after the h1. */
function findSizeAndUnit(h1: Element): { sizeText?: string; unitPriceText?: string } {
  const block = h1.nextElementSibling;
  if (!block) return {};
  const sizeText = textOf(block.querySelector("span")) || undefined;
  // Match per element, not on the block's joined text: adjacent leaves have no separator, so
  // "$0.59 / lb" followed by "Final cost by weight" would read "lbFinal".
  let unitPriceText: string | undefined;
  for (const el of Array.from(block.querySelectorAll("*"))) {
    const m = UNIT_PRICE.exec(textOf(el));
    if (m?.[0]) {
      unitPriceText = m[0].replace(/\s+/g, " ").trim();
      break;
    }
  }
  return withDefined({ sizeText, unitPriceText });
}

function findBrand(doc: Document): string | undefined {
  const details = doc.querySelector("#item_details") ?? doc;
  for (const link of Array.from(details.querySelectorAll("a"))) {
    const spans = Array.from(link.querySelectorAll("span"));
    if (spans.length >= 2 && /^shop all$/i.test(textOf(spans[0]))) {
      const brand = textOf(spans[1]);
      if (brand) return brand;
    }
  }
  return undefined;
}

interface PriceNeighbours {
  wasPrice?: ReturnType<typeof parseMoney>;
  promoTags: string[];
  memberPrice: boolean;
}

/** Signals that sit next to the price: strike-through, offer badges, membership gating. */
function readPriceNeighbours(priceContainer: Element): PriceNeighbours {
  const scope = priceContainer.parentElement ?? priceContainer;
  let wasPrice: ReturnType<typeof parseMoney>;
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
  const promoTags: string[] = [];
  for (const el of Array.from(scope.children)) {
    if (el === priceContainer) continue;
    const text = textOf(el);
    if (text && text.length <= 64 && PROMO.test(text) && !promoTags.includes(text)) {
      promoTags.push(text);
    }
  }
  const memberPrice = MEMBER.test(textOf(scope));
  return withDefined({ wasPrice, promoTags, memberPrice });
}

function extractUnsafe(doc: Document, ctx: PageContext): ExtractResult {
  const url = canonicalUrl(ctx.url);
  if (url === undefined || !matches(url)) return fail("not_product_page");

  const h1 = doc.querySelector("#item_details h1") ?? doc.querySelector("h1");
  const title = textOf(h1);
  if (!h1 || !title) return fail("no_title");

  const priceLabel = findPriceLabel(doc);
  const priceContainer = priceLabel?.parentElement;
  if (!priceLabel || !priceContainer) return fail("no_price");
  const priceLine = textOf(priceLabel).replace(CURRENT_PRICE, "");
  const parsed = parseMoney(priceLine);
  if (!parsed) return fail("unparseable_price", priceLine);

  const { sku, storeId } = findSku(doc, url);
  if (!sku) return fail("no_sku");

  const fulfillment = ctx.fulfillment ?? findFulfillment(doc);
  if (!fulfillment) return fail("no_fulfillment");

  const detailsText = textOf(doc.querySelector("#item_details"));
  const isEstimate = ESTIMATE.test(priceLine) || /final cost by weight/i.test(detailsText);
  const neighbours = readPriceNeighbours(priceContainer);
  const { sizeText, unitPriceText } = findSizeAndUnit(h1);

  const observation: AdapterObservation = {
    retailer: "instacart",
    product: withDefined({
      retailerSku: sku,
      title,
      brand: findBrand(doc),
      sizeText,
      url,
      upc: undefined,
    }),
    facts: withDefined({
      price: parsed.money,
      priceText: parsed.priceText,
      isEstimate,
      wasPrice: neighbours.wasPrice?.money,
      unitPriceText,
      promoTags: neighbours.promoTags,
      memberPrice: neighbours.memberPrice,
    }),
    context: withDefined({
      fulfillment,
      sessionState: ctx.sessionState ?? findSessionState(doc),
      surface: ctx.surface,
      zip3: findZip3(doc),
      device: ctx.device,
      cleanSession: ctx.cleanSession,
    }),
    adapter: `instacart@${INSTACART_ADAPTER_VERSION}`,
    evidenceHash: evidenceHash(priceContainer),
  };
  const store = findStore(doc, storeId);
  if (store) observation.store = store;
  return { ok: true, observation };
}

export const instacartAdapter: Adapter = {
  name: "instacart",
  version: INSTACART_ADAPTER_VERSION,
  matches,
  extract(doc, ctx) {
    try {
      return extractUnsafe(doc, ctx);
    } catch (e) {
      return fail("adapter_threw", e instanceof Error ? e.message : String(e));
    }
  },
};

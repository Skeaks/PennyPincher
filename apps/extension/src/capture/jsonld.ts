/**
 * Product JSON-LD (S17). Retailers embed `<script type="application/ld+json">` blocks with a
 * schema.org `Product` for search engines. Instacart's server-rendered product HTML carries
 * one with `name`, `brand`, `size` and `offers.price`, and it survives without JavaScript,
 * which is exactly the HTML the lever probe fetches. Any adapter can use this file; nothing
 * here is Instacart-specific.
 *
 * The block is only trusted when it names the product on the page: a single-page app keeps
 * the `<head>` of the page it first loaded, so after the shopper navigates in place (opens a
 * product modal, say) the JSON-LD may describe a different product, or none. `productJsonLd`
 * therefore takes the SKU the caller already knows from the URL and returns a block only when
 * its `offers.url`, `url`, `sku` or `productID` agrees.
 *
 * Read only, never throws: a malformed block is skipped.
 */
import type { Money } from "@pennypincher/schema";
import { sha256Hex } from "./sha256";

export interface ProductJsonLd {
  name?: string;
  brand?: string;
  size?: string;
  price?: Money;
  /** The price as JSON-LD gave it, formatted the way the page renders dollars: "$4.95". */
  priceText?: string;
  /** `offers.url` or `url`, whichever names the product. */
  url?: string;
  /** The script's text content as found, before any trimming. Evidence for the hash. */
  scriptText: string;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.replace(/\s+/g, " ").trim();
    return trimmed === "" ? undefined : trimmed;
  }
  return undefined;
}

/** "4.95", 4.95, "4", "12.5" to minor units without floating-point arithmetic. */
export function moneyFromJsonLd(value: unknown): Money | undefined {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const m = /^\s*\$?\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!m?.[1]) return undefined;
  const dollars = Number.parseInt(m[1], 10);
  const cents = m[2] === undefined ? 0 : Number.parseInt(m[2].padEnd(2, "0"), 10);
  return { amountMinor: dollars * 100 + cents, currency: "USD" };
}

export function formatUsd(money: Money): string {
  return `$${Math.floor(money.amountMinor / 100)}.${String(money.amountMinor % 100).padStart(2, "0")}`;
}

function typeOf(node: Json): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

/** Every node of `@type` Product reachable from a parsed block: bare, in an array, in `@graph`. */
function productNodes(value: unknown): Json[] {
  if (Array.isArray(value)) return value.flatMap(productNodes);
  if (!isObject(value)) return [];
  const here = typeOf(value).includes("Product") ? [value] : [];
  const graph = value["@graph"];
  return graph === undefined ? here : [...here, ...productNodes(graph)];
}

/** The first Offer-like object: `offers` may be one Offer, an array, or an AggregateOffer. */
function firstOffer(node: Json): Json | undefined {
  const offers = node.offers;
  if (Array.isArray(offers)) return offers.find(isObject);
  return isObject(offers) ? offers : undefined;
}

function offerPrice(offer: Json | undefined): unknown {
  if (!offer) return undefined;
  if (offer.price !== undefined) return offer.price;
  // AggregateOffer: the low price is what a visitor is shown first.
  return offer.lowPrice;
}

function offerCurrency(offer: Json | undefined): string | undefined {
  return str(offer?.priceCurrency);
}

function brandOf(node: Json): string | undefined {
  const brand = node.brand;
  if (isObject(brand)) return str(brand.name);
  return str(brand);
}

function toProduct(node: Json, scriptText: string): ProductJsonLd {
  const offer = firstOffer(node);
  const currency = offerCurrency(offer);
  const price =
    currency === undefined || currency === "USD" ? moneyFromJsonLd(offerPrice(offer)) : undefined;
  const out: ProductJsonLd = { scriptText };
  const name = str(node.name);
  if (name !== undefined) out.name = name;
  const brand = brandOf(node);
  if (brand !== undefined) out.brand = brand;
  const size = str(node.size);
  if (size !== undefined) out.size = size;
  if (price) {
    out.price = price;
    out.priceText = formatUsd(price);
  }
  const url = str(offer?.url) ?? str(node.url);
  if (url !== undefined) out.url = url;
  return out;
}

/** Identifiers a block may carry, for matching against the SKU the URL gave. */
function identifiersOf(node: Json): string[] {
  const out: string[] = [];
  for (const key of ["sku", "productID", "productId", "mpn"]) {
    const v = node[key];
    if (typeof v === "string" || typeof v === "number") out.push(String(v));
  }
  return out;
}

/** Every Product block on the page, in document order, whether or not it matches anything. */
export function allProductJsonLd(doc: Document): ProductJsonLd[] {
  const out: ProductJsonLd[] = [];
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of Array.from(scripts)) {
    const text = script.textContent ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    for (const node of productNodes(parsed)) out.push(toProduct(node, text));
  }
  return out;
}

/**
 * The Product block for `sku`, if the page has one that names it. `skuInUrl` says whether a
 * URL names that SKU; the caller knows its retailer's URL shape.
 */
export function productJsonLd(
  doc: Document,
  sku: string,
  skuInUrl: (url: string) => string | undefined,
): ProductJsonLd | undefined {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of Array.from(scripts)) {
    const text = script.textContent ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    for (const node of productNodes(parsed)) {
      const product = toProduct(node, text);
      const byUrl = product.url !== undefined && skuInUrl(product.url) === sku;
      const byId = identifiersOf(node).includes(sku);
      if (byUrl || byId) return product;
    }
  }
  return undefined;
}

/** Evidence hash for a JSON-LD source: the script text as served, whitespace-trimmed. */
export function jsonLdEvidenceHash(product: ProductJsonLd): string {
  return sha256Hex(product.scriptText.trim());
}

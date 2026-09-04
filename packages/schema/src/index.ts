/**
 * @pennypincher/schema — the observation contract.
 *
 * DESIGN RULES (see docs/decisions/0002-observation-schema.md):
 *  1. No PII, ever. No emails, names, addresses, full ZIPs, cookies, or credentials.
 *  2. The panelist is a rotating pseudonymous ID minted client-side; the server never learns
 *     which browser it came from beyond what the ID reveals.
 *  3. Everything a retailer might use as a pricing lever is recorded as CONTEXT so we can
 *     measure which levers actually move the price.
 *  4. Breaking changes bump SCHEMA_VERSION and get an entry in docs/migrations/.
 *
 * FIELD PROVENANCE (S03). Every field below carries a comment saying where it is observable:
 *  - "fixtures: <retailer>/<slug> (<selector or text>)" means the value is on that recorded
 *    page under fixtures/. An adapter test can assert it.
 *  - "context" means the value is not on the page: the client knows it (its own clock, its
 *    own version, the URL bar, the device class) or mints it (ids).
 *  - Optional fields that no fixture shows say why they are kept.
 * The 12 pages audited are the 2026-09-04 snapshots listed in docs/fixtures.md.
 */
import { z } from "zod";

export const SCHEMA_VERSION = "1.0.0" as const;

/**
 * Retailers we have fixtures for, and therefore can write adapters against. Adding a value is
 * additive (minor bump); the reserved names from 0.1.0 (amazon, safeway, kroger) were dropped
 * because nothing could produce them. fixtures: instacart/*, target/*, walmart/*.
 */
export const Retailer = z.enum(["instacart", "target", "walmart"]);
export type Retailer = z.infer<typeof Retailer>;

/**
 * How the shopper would receive the item. Fees and prices differ by path.
 * fixtures: instacart/* ("Delivery" / "Pickup" toggle); target/* (`data-test=fulfillment-cell-
 * {pickup,delivery,shipping}`, the selected one carries `aria-label="pickup - selected ..."`);
 * walmart/* (`data-testid=ip-fulfillment-container-div`: Shipping / Pickup / Delivery).
 * 0.1.0 also had `in_store`; a browser extension can never observe an in-store price, so it
 * was removed.
 */
export const Fulfillment = z.enum(["delivery", "pickup", "ship"]);
export type Fulfillment = z.infer<typeof Fulfillment>;

/**
 * Whether the retailer could tie the page view to an account, read from the page's own
 * indicator (never from cookies; see ADR 0003).
 * fixtures: instacart/wegmans-bananas-logged-out (`body.body--auth-modal-open`, "Log in")
 * vs wegmans-bananas (neither); target/banana-each-logged-out ("Sign in") vs banana-each
 * (greeting, scrubbed); walmart/fresh-banana-each-logged-out ("Sign In") vs fresh-banana-each.
 * `unknown` is for an adapter that finds neither indicator.
 */
export const SessionState = z.enum(["logged_in", "logged_out", "unknown"]);
export type SessionState = z.infer<typeof SessionState>;

/**
 * Where the price was rendered. context: the extension knows whether it is running in a
 * desktop or mobile browser. 0.1.0 also had `app`; an extension cannot run inside a native
 * app, so it was removed. All 12 fixtures are `web`.
 */
export const Surface = z.enum(["web", "mobile_web"]);
export type Surface = z.infer<typeof Surface>;

/**
 * Which retail banner / physical store the price belongs to. At least one of the two fields
 * must be present: the pages always name the store but do not always expose its id.
 */
export const StoreRef = z
  .object({
    /**
     * Retailer-assigned store identifier.
     * fixtures: target/* (`button#store-name-1872`, `#store-name-1151`); instacart/*
     * (`#item_details-items_10769-<sku>-Details`, 10769 = Wegmans). Optional because
     * walmart/* never renders its store number (3266 is only in the capture log; see
     * walmart/marketside-organic-bananas-bunch.meta.json).
     */
    retailerStoreId: z.string().min(1).max(128).optional(),
    /**
     * Human label as shown on the page. Never a street address or full ZIP.
     * fixtures: target/* (`data-test=@web/StoreName/StoreName`: "Durham", "Princeton");
     * walmart/* (`data-testid=fulfillment-zone-2`: "East Windsor Supercenter"); instacart/*
     * (`h2` "Wegmans" in the store header).
     */
    label: z.string().min(1).max(256).optional(),
  })
  .refine((s) => s.retailerStoreId !== undefined || s.label !== undefined, {
    message: "store needs retailerStoreId or label",
  });
export type StoreRef = z.infer<typeof StoreRef>;

/** Identity of the product as the retailer presented it. Normalisation happens downstream. */
export const ProductRef = z.object({
  /**
   * The retailer-assigned SKU / item id. Always present.
   * fixtures: instacart/* (`/products/2748189-banana-each` hrefs,
   * `#item_details-items_10769-2748189-Details`); target/* (`#addToCartButtonOrTextIdFor81957708`);
   * walmart/* (`#pt-card-select-44390948`, `/ip/.../44390948` in the URL).
   */
  retailerSku: z.string().min(1).max(128),
  /**
   * Universal Product Code, 8 to 14 digits. Optional: no fixture renders one. Walmart's and
   * Target's "Specifications" panels are collapsed in the captures and Instacart's "Details"
   * has none. Kept because S13 (product identity) matches on it whenever a page does show it.
   */
  upc: z
    .string()
    .regex(/^\d{8,14}$/, "UPC must be 8 to 14 digits")
    .optional(),
  /**
   * fixtures: instacart/* (`h1`); target/* (`h1[data-test=product-title]`, `[itemprop=name]`);
   * walmart/* (`h1#main-title[itemprop=name]`).
   */
  title: z.string().min(1).max(512),
  /**
   * Brand as a separate element. Optional: only Target renders one
   * (fixtures: target/* `a[data-test=shopAllBrandLink]` "Shop all Good & Gather"). Walmart
   * shows "Unbranded" above the title for produce; Instacart folds the brand into the title
   * ("Wegmans Red Seedless Grapes, Bagged").
   */
  brand: z.string().max(128).optional(),
  /**
   * Size / pack text as a separate element, e.g. "16 oz". Optional: on all 12 fixtures the
   * size is only inside the title ("Hass Avocados - 4ct", "Great Value Sliced Bananas, 16 oz
   * Bag"). Kept for retailers or categories that render a size selector; adapters must not
   * derive it from the title.
   */
  sizeText: z.string().max(128).optional(),
  /**
   * Canonical product page URL with query string and fragment stripped. context: the URL bar.
   * Fixtures keep only the path (the scrubber drops origins): instacart `/products/<sku>-<slug>`,
   * target `/p/<slug>/-/A-<sku>`, walmart `/ip/<slug>/<sku>`.
   */
  url: z.string().url().max(2048),
});
export type ProductRef = z.infer<typeof ProductRef>;

/** Money is stored in minor units (cents) as an integer. Never floats. */
export const Money = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: z.literal("USD"),
});
export type Money = z.infer<typeof Money>;

/** The price as rendered, plus every price-adjacent signal on the page. */
export const PriceFacts = z.object({
  /**
   * The price the shopper would pay for one unit before fees/tax, parsed to minor units.
   * fixtures: instacart/* ("Current price: $0.22 each (est.)"); target/*
   * (`span[data-test=product-price]` "$0.29"); walmart/* (`span[itemprop=price]` "$0.06").
   */
  price: Money,
  /**
   * The price string exactly as rendered, so a parse can be re-checked without the DOM.
   * New in 1.0.0: every fixture sidecar carries `expected.priceText`, and the Instacart
   * qualifier ("each (est.)") is not recoverable from the integer alone.
   * fixtures: instacart/wegmans-bananas ("$0.22 each (est.)"); target/hass-avocados-4ct
   * ("$2.99"); walmart/fresh-banana-each ("$0.06").
   */
  priceText: z.string().min(1).max(64),
  /**
   * True when the page marks the price as a weight estimate whose final cost is settled at
   * fulfilment. New in 1.0.0. The stats engine must not treat an estimate as a fixed tier.
   * fixtures: instacart/wegmans-bananas, wegmans-red-seedless-grapes ("(est.)", "Final cost
   * by weight"); walmart/fresh-banana-each, marketside-organic-bananas-bunch ("each (est.)",
   * "Final cost by weight"). False on the packaged items (strawberries, frozen bananas).
   */
  isEstimate: z.boolean().default(false),
  /**
   * Struck-through "was" price if shown. Optional: no fixture's hero price has one. Walmart
   * renders it as "Was $2.34" next to a "Rollback" badge on carousel tiles in
   * walmart/fresh-banana-each, so the shape is known and the adapter can be tested on it once
   * a hero capture shows one.
   */
  wasPrice: Money.optional(),
  /**
   * Unit price as shown, kept as text. Parsing happens downstream.
   * fixtures: instacart/wegmans-bananas ("$0.59 / lb"); target/hass-avocados-4ct
   * ("($0.75/count)"), organic-bananas-2lb ("($0.06/ounce)"); walmart/fresh-banana-each
   * (`data-testid=unit-price-string` "16.0 ¢/lb"), great-value-sliced-bananas-frozen-16oz
   * (`data-seo-id=hero-unit-price` "$2.47/lb").
   */
  unitPriceText: z.string().max(64).optional(),
  /**
   * Promotional labels visible on the product's own tile, as rendered.
   * fixtures: walmart/* (`span[data-testid=badgeTagComponent]`: "Rollback", "Best seller",
   * "SNAP EBT eligible"); target/hass-avocados-4ct ("Only at target"). Instacart's fixtures
   * show none on the hero.
   */
  promoTags: z.array(z.string().max(64)).max(16).default([]),
  /**
   * True when the page marked the price as requiring a loyalty/membership login. Defaults to
   * false; no fixture shows a member-gated price. Kept because all three retailers run a
   * programme that can gate prices (Target Circle, Walmart+, Instacart+; the nav links are on
   * target/* and walmart/*) and the lever probe (S06) needs the slot when one appears.
   */
  memberPrice: z.boolean().default(false),
});
export type PriceFacts = z.infer<typeof PriceFacts>;

/**
 * Everything that might be a pricing lever. Recording this per observation is what lets the
 * stats engine attribute variance to a lever instead of to noise.
 */
export const CaptureContext = z.object({
  /** See `Fulfillment`. The selected option on the page, not the shopper's preference. */
  fulfillment: Fulfillment,
  /** See `SessionState`. */
  sessionState: SessionState,
  /** See `Surface`. context. */
  surface: Surface,
  /**
   * First 3 digits of the ZIP the retailer was serving. Coarse by design (roughly a metro).
   * Optional: only recorded when the page displays a ZIP. All three retailers do:
   * fixtures: instacart/wegmans-bananas ("Is [scrubbed] your ZIP code?"); target/*
   * (`data-test=@web/ZipCodeButton/ZipCodeNumber` "Ship to [scrubbed]"); walmart/*
   * (`data-testid=depot-store-nudge`). The scrubber replaces the digits; the sidecars keep
   * the zip3 ("085").
   */
  zip3: z
    .string()
    .regex(/^\d{3}$/)
    .optional(),
  /** Coarse device class. Never a user-agent string. context. */
  device: z.enum(["desktop", "mobile", "tablet"]),
  /**
   * Was this a fresh profile / private window (no prior retailer cookies)? context: only the
   * client can know; the page shows nothing. Optional because passive capture (S05) does not
   * set it; the lever probe (S06) does.
   */
  cleanSession: z.boolean().optional(),
});
export type CaptureContext = z.infer<typeof CaptureContext>;

/** Provenance so a bad adapter release can be quarantined without touching good data. context. */
export const Provenance = z.object({
  /** Adapter name + semver, e.g. "instacart@0.3.1". context. */
  adapter: z.string().regex(/^[a-z0-9_-]+@\d+\.\d+\.\d+$/),
  /** Extension package version. context. */
  clientVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** SHA-256 of the scrubbed DOM fragment the price was read from. Re-verifies parses. context. */
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type Provenance = z.infer<typeof Provenance>;

/**
 * ONE price, seen by ONE panelist, at ONE moment. The atomic unit of the panel.
 */
export const PriceObservation = z.object({
  /** context. */
  schemaVersion: z.literal(SCHEMA_VERSION),
  /** Client-minted UUID v4. Idempotency key on ingest. context. */
  observationId: z.string().uuid(),
  /**
   * Rotating pseudonymous panelist id (UUID v4). Rotated client-side on a schedule so the
   * server can count distinct observers per cell without building a long-lived profile. context.
   */
  panelistId: z.string().uuid(),
  /** ISO-8601 UTC timestamp of when the price was rendered. context (client clock). */
  observedAt: z.string().datetime({ offset: false }),
  /** See `Retailer`. context: chosen by which adapter matched the page origin. */
  retailer: Retailer,
  /** See `StoreRef`. Optional only for a page that names no store at all; all 12 fixtures do. */
  store: StoreRef.optional(),
  product: ProductRef,
  facts: PriceFacts,
  context: CaptureContext,
  provenance: Provenance,
});
export type PriceObservation = z.infer<typeof PriceObservation>;

/** What the ingest endpoint accepts: a small batch from one client. */
export const ObservationBatch = z.object({
  observations: z.array(PriceObservation).min(1).max(200),
});
export type ObservationBatch = z.infer<typeof ObservationBatch>;

/**
 * Field names that must NEVER appear anywhere in an observation payload.
 * Ingest rejects any batch whose serialised JSON contains one of these keys.
 * Kept here so the extension and the API agree on the list.
 */
export const FORBIDDEN_KEYS = [
  "email",
  "password",
  "passwd",
  "token",
  "cookie",
  "cookies",
  "authorization",
  "phone",
  "address",
  "firstName",
  "lastName",
  "fullName",
  "userAgent",
  "ip",
  "ipAddress",
] as const;

/** Returns the paths of forbidden keys found anywhere in an arbitrary JSON value (deep). */
export function findForbiddenKeys(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => findForbiddenKeys(v, `${path}[${i}]`));
  }
  if (value && typeof value === "object") {
    const found: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const here = path ? `${path}.${k}` : k;
      if ((FORBIDDEN_KEYS as readonly string[]).includes(k)) found.push(here);
      found.push(...findForbiddenKeys(v, here));
    }
    return found;
  }
  return [];
}

export type ParseResult = { ok: true; batch: ObservationBatch } | { ok: false; errors: string[] };

/** Parse + PII guard in one call. Use this at every trust boundary. */
export function parseObservationBatch(input: unknown): ParseResult {
  const forbidden = findForbiddenKeys(input);
  if (forbidden.length > 0) {
    return { ok: false, errors: forbidden.map((p) => `forbidden key at ${p}`) };
  }
  const result = ObservationBatch.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  return { ok: true, batch: result.data };
}

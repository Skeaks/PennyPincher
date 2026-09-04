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
 */
import { z } from "zod";

export const SCHEMA_VERSION = "0.1.0" as const;

/** Retailers we have capture adapters for. Add here first; adapters reference this. */
export const Retailer = z.enum(["instacart", "amazon", "target", "walmart", "safeway", "kroger"]);
export type Retailer = z.infer<typeof Retailer>;

/** How the shopper would receive the item. Fees and prices differ by path. */
export const Fulfillment = z.enum(["delivery", "pickup", "in_store", "ship"]);
export type Fulfillment = z.infer<typeof Fulfillment>;

/** Whether the retailer could tie the page view to an account. */
export const SessionState = z.enum(["logged_in", "logged_out", "unknown"]);
export type SessionState = z.infer<typeof SessionState>;

/** Where the price was rendered. */
export const Surface = z.enum(["web", "mobile_web", "app"]);
export type Surface = z.infer<typeof Surface>;

/** Which retail banner / physical store the price belongs to, if the retailer exposes it. */
export const StoreRef = z.object({
  /** Retailer-assigned store identifier, e.g. an Instacart retailer slug or a Target store number. */
  retailerStoreId: z.string().min(1).max(128),
  /** Human label as shown on the page, e.g. "Safeway - 4th St". Optional. */
  label: z.string().max(256).optional(),
});
export type StoreRef = z.infer<typeof StoreRef>;

/** Identity of the product as the retailer presented it. Normalisation happens downstream. */
export const ProductRef = z.object({
  /** The retailer-assigned SKU / item id. Always present. */
  retailerSku: z.string().min(1).max(128),
  /** Universal Product Code if visible on the page. 8 to 14 digits. */
  upc: z
    .string()
    .regex(/^\d{8,14}$/, "UPC must be 8 to 14 digits")
    .optional(),
  title: z.string().min(1).max(512),
  brand: z.string().max(128).optional(),
  /** Size / pack text exactly as shown, e.g. "12 fl oz", "6 ct". */
  sizeText: z.string().max(128).optional(),
  /** Canonical product page URL with query string and fragment stripped. */
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
  /** The price the shopper would pay for one unit before fees/tax. */
  price: Money,
  /** Struck-through "was" price if shown. */
  wasPrice: Money.optional(),
  /** Unit price as shown ("$0.42/oz"), kept as text. Parsing happens downstream. */
  unitPriceText: z.string().max(64).optional(),
  /** Promotional labels visible on the tile: "Sale", "Buy 2 get 1", "Member price", etc. */
  promoTags: z.array(z.string().max(64)).max(16).default([]),
  /** True when the page marked the price as requiring a loyalty/membership login. */
  memberPrice: z.boolean().default(false),
});
export type PriceFacts = z.infer<typeof PriceFacts>;

/**
 * Everything that might be a pricing lever. Recording this per observation is what lets the
 * stats engine attribute variance to a lever instead of to noise.
 */
export const CaptureContext = z.object({
  fulfillment: Fulfillment,
  sessionState: SessionState,
  surface: Surface,
  /** First 3 digits of the ZIP the retailer was serving. Coarse by design (roughly a metro). */
  zip3: z
    .string()
    .regex(/^\d{3}$/)
    .optional(),
  /** Coarse device class. Never a user-agent string. */
  device: z.enum(["desktop", "mobile", "tablet"]),
  /** Was this a fresh profile / private window (no prior retailer cookies)? */
  cleanSession: z.boolean().optional(),
});
export type CaptureContext = z.infer<typeof CaptureContext>;

/** Provenance so a bad adapter release can be quarantined without touching good data. */
export const Provenance = z.object({
  /** Adapter name + semver, e.g. "instacart@0.3.1". */
  adapter: z.string().regex(/^[a-z0-9_-]+@\d+\.\d+\.\d+$/),
  /** Extension package version. */
  clientVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** SHA-256 of the scrubbed DOM fragment the price was read from. Lets us re-verify parses. */
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type Provenance = z.infer<typeof Provenance>;

/**
 * ONE price, seen by ONE panelist, at ONE moment. The atomic unit of the panel.
 */
export const PriceObservation = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  /** Client-minted UUID v4. Idempotency key on ingest. */
  observationId: z.string().uuid(),
  /**
   * Rotating pseudonymous panelist id (UUID v4). Rotated client-side on a schedule so the
   * server can count distinct observers per cell without building a long-lived profile.
   */
  panelistId: z.string().uuid(),
  /** ISO-8601 UTC timestamp of when the price was rendered. */
  observedAt: z.string().datetime({ offset: false }),
  retailer: Retailer,
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

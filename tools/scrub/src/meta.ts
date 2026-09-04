/**
 * The `.meta.json` sidecar every committed fixture carries. Filled by hand from
 * `fixtures/raw/CAPTURE-LOG.md`; validated by `--check` and by the gate test.
 */
import { z } from "zod";

/** Vocabulary mirrors packages/schema so S05 can compare an extracted observation directly. */
export const FixtureRetailer = z.enum(["instacart", "target", "walmart"]);
export const FixtureFulfillment = z.enum(["delivery", "pickup", "in_store", "ship"]);
export const FixtureSessionState = z.enum(["logged_in", "logged_out"]);

export const FixtureMeta = z
  .object({
    retailer: FixtureRetailer,
    /** ISO 8601 instant the raw page was captured. */
    capturedAt: z.string().datetime({ offset: true }),
    /** The fulfilment mode the page was showing the price for. */
    fulfillment: FixtureFulfillment,
    sessionState: FixtureSessionState,
    /** First three digits of the ZIP the page was serving. Never the full ZIP. */
    zip3: z.string().regex(/^\d{3}$/),
    /**
     * Required. A login can reassign the store (Target: Princeton to Durham), so any test that
     * compares two fixtures must see whether they were priced at the same store.
     */
    store: z.object({
      /** Retailer's own store / location id as shown on the page or in its state. */
      retailerStoreId: z.string().min(1),
      /** City or name as the page shows it. Never a street address or full ZIP. */
      label: z.string().min(1),
    }),
    /** What an adapter is expected to extract. Checked against the scrubbed page. */
    expected: z.object({
      /** Money in minor units, the shape packages/schema uses. */
      price: z.object({
        amountMinor: z.number().int().nonnegative(),
        currency: z.literal("USD"),
      }),
      /** The price exactly as rendered ("$0.22"). `--check` fails if this text is absent. */
      priceText: z.string().min(1),
      /** Product title as rendered. `--check` fails if this text is absent. */
      title: z.string().min(1),
      /** Retailer SKU / item id from the URL or page. */
      retailerSku: z.string().min(1),
    }),
    /** Anything a test author needs to know that the fields above cannot say. */
    notes: z.string().optional(),
  })
  .strict();

export type FixtureMeta = z.infer<typeof FixtureMeta>;

/** Written next to a freshly scrubbed page when no sidecar exists. Fails `--check` until filled. */
export function metaTemplate(retailer: string, slug: string): Record<string, unknown> {
  return {
    retailer,
    capturedAt: "TODO ISO-8601, from fixtures/raw/CAPTURE-LOG.md",
    fulfillment: "TODO delivery|pickup|in_store|ship",
    sessionState: slug.endsWith("-logged-out") ? "logged_out" : "logged_in",
    zip3: "TODO",
    store: { retailerStoreId: "TODO", label: "TODO city or store name" },
    expected: {
      price: { amountMinor: -1, currency: "USD" },
      priceText: "TODO e.g. $0.22",
      title: "TODO title exactly as rendered",
      retailerSku: "TODO",
    },
  };
}

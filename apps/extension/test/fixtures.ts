import { type PriceObservation, SCHEMA_VERSION } from "@pennypincher/schema";

/** A valid observation for store tests. Mirrors packages/schema/test/fixtures.ts. */
export function validObservation(overrides: Partial<PriceObservation> = {}): PriceObservation {
  return {
    schemaVersion: SCHEMA_VERSION,
    observationId: "6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    panelistId: "0b1c2d3e-4f50-4a61-9b72-83c4d5e6f7a8",
    observedAt: "2026-09-04T14:03:22.000Z",
    retailer: "instacart",
    store: { retailerStoreId: "safeway", label: "Safeway" },
    product: {
      retailerSku: "item_123456",
      upc: "041220787346",
      title: "Organic Bananas, 1 lb",
      brand: "Signature Farms",
      sizeText: "1 lb",
      url: "https://www.instacart.com/store/items/item_123456",
    },
    facts: {
      price: { amountMinor: 89, currency: "USD" },
      priceText: "$0.89",
      isEstimate: false,
      promoTags: [],
      memberPrice: false,
    },
    context: {
      fulfillment: "delivery",
      sessionState: "logged_in",
      surface: "web",
      zip3: "941",
      device: "desktop",
    },
    provenance: {
      adapter: "instacart@0.1.0",
      clientVersion: "0.1.0",
      evidenceHash: "a".repeat(64),
    },
    ...overrides,
  };
}

/** Deterministic UUID v4-shaped id from a counter, for bulk inserts. */
export function idFor(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

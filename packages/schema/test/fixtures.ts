import { type PriceObservation, SCHEMA_VERSION } from "../src/index";

/**
 * A valid observation to build test cases from. Spread + override. Values mirror
 * fixtures/instacart/wegmans-bananas (.meta.json) so the shape is one a real page produces.
 */
export function validObservation(overrides: Partial<PriceObservation> = {}): PriceObservation {
  return {
    schemaVersion: SCHEMA_VERSION,
    observationId: "6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    panelistId: "0b1c2d3e-4f50-4a61-9b72-83c4d5e6f7a8",
    observedAt: "2026-09-04T15:26:18.000Z",
    retailer: "instacart",
    store: { retailerStoreId: "10769", label: "Wegmans" },
    product: {
      retailerSku: "2748189",
      title: "Bananas, Sold by the Each",
      url: "https://www.instacart.com/products/2748189-banana-each",
    },
    facts: {
      price: { amountMinor: 22, currency: "USD" },
      priceText: "$0.22 each (est.)",
      isEstimate: true,
      unitPriceText: "$0.59 / lb",
      promoTags: [],
      memberPrice: false,
    },
    context: {
      fulfillment: "delivery",
      sessionState: "logged_in",
      surface: "web",
      zip3: "085",
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

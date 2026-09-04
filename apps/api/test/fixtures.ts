import { type PriceObservation, SCHEMA_VERSION } from "@pennypincher/schema";
import { createApp } from "../src/app";
import { MemoryObservationRepo } from "../src/repo/memory";

/**
 * A valid observation to build cases from. Mirrors packages/schema/test/fixtures.ts (values
 * from fixtures/instacart/wegmans-bananas). Spread + override.
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

/** Deterministic UUID v4 for the n-th observation in a generated batch. */
export function uuidFor(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

export const FIXED_NOW = new Date("2026-09-04T16:00:00.000Z");

/** The app wired to a fresh in-memory repo and a fixed clock. */
export function testApp() {
  const repo = new MemoryObservationRepo();
  const app = createApp<Record<string, never>>({ repo: () => repo, now: () => FIXED_NOW });
  const post = (body: unknown) =>
    app.request("/v1/observations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return { app, repo, post };
}

import { describe, expect, it } from "vitest";
import {
  PriceObservation,
  SCHEMA_VERSION,
  findForbiddenKeys,
  parseObservationBatch,
} from "../src/index";
import { validObservation } from "./fixtures";

describe("PriceObservation", () => {
  it("accepts a complete valid observation", () => {
    expect(PriceObservation.safeParse(validObservation()).success).toBe(true);
  });

  it.skip("pins the schema version", () => {
    const bad = { ...validObservation(), schemaVersion: "9.9.9" };
    expect(PriceObservation.safeParse(bad).success).toBe(false);
    expect(SCHEMA_VERSION).toBe("0.1.0");
  });

  it("rejects float money", () => {
    const bad = validObservation({
      facts: { price: { amountMinor: 0.89, currency: "USD" }, promoTags: [], memberPrice: false },
    });
    expect(PriceObservation.safeParse(bad).success).toBe(false);
  });

  it("rejects a full ZIP; only zip3 is allowed", () => {
    const bad = validObservation({
      context: { ...validObservation().context, zip3: "94110" },
    });
    expect(PriceObservation.safeParse(bad).success).toBe(false);
  });

  it("rejects a product URL that is not a URL", () => {
    const bad = validObservation({
      product: { ...validObservation().product, url: "not a url" },
    });
    expect(PriceObservation.safeParse(bad).success).toBe(false);
  });

  it("rejects an adapter tag without a version", () => {
    const bad = validObservation({
      provenance: { ...validObservation().provenance, adapter: "instacart" },
    });
    expect(PriceObservation.safeParse(bad).success).toBe(false);
  });

  it("defaults promoTags and memberPrice", () => {
    const parsed = PriceObservation.parse({
      ...validObservation(),
      facts: { price: { amountMinor: 89, currency: "USD" } },
    });
    expect(parsed.facts.promoTags).toEqual([]);
    expect(parsed.facts.memberPrice).toBe(false);
  });
});

describe("findForbiddenKeys", () => {
  it("finds forbidden keys at any depth", () => {
    const payload = { a: { b: [{ email: "x" }], cookie: "y" }, ok: 1 };
    expect(findForbiddenKeys(payload).sort()).toEqual(["a.b[0].email", "a.cookie"]);
  });

  it("returns nothing for a clean observation", () => {
    expect(findForbiddenKeys(validObservation())).toEqual([]);
  });
});

describe("parseObservationBatch", () => {
  it("accepts a batch of valid observations", () => {
    const r = parseObservationBatch({ observations: [validObservation(), validObservation()] });
    expect(r.ok).toBe(true);
  });

  it("rejects an empty batch", () => {
    expect(parseObservationBatch({ observations: [] }).ok).toBe(false);
  });

  it("rejects a batch carrying PII before schema validation runs", () => {
    const r = parseObservationBatch({
      observations: [{ ...validObservation(), email: "someone@example.com" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/forbidden key/);
  });

  it("reports the field path on schema failure", () => {
    const r = parseObservationBatch({
      observations: [validObservation({ retailer: "costco" as never })],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/observations\.0\.retailer/);
  });
});

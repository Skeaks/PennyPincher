/**
 * The comparison and the same-store rule, on fixture pairs: Instacart (same store, same
 * price), Target (login reassigns the store: STORE_DIFFERS), Walmart (same store; the store id
 * is never rendered, so the label carries the match).
 */
import { describe, expect, it } from "vitest";
import {
  compare,
  formatUsd,
  pricePoint,
  sameStore,
  verdictDetail,
  verdictText,
} from "../../src/probe/compare";
import {
  URL_BANANAS,
  URL_TARGET_BANANA,
  URL_WALMART_BANANA,
  fixture,
  ownInstacartObservation,
  sidecarObservation,
} from "./helpers";

const instacartIn = fixture("instacart", "wegmans-bananas");
const instacartOut = fixture("instacart", "wegmans-bananas-logged-out");
const targetIn = fixture("target", "banana-each");
const targetOut = fixture("target", "banana-each-logged-out");
const walmartIn = fixture("walmart", "fresh-banana-each");
const walmartOut = fixture("walmart", "fresh-banana-each-logged-out");

describe("compare on fixture pairs", () => {
  it("Instacart bananas, logged in vs logged out: same store, same price", () => {
    const mine = ownInstacartObservation(instacartIn, URL_BANANAS);
    const anon = ownInstacartObservation(instacartOut, URL_BANANAS);
    expect(mine.store?.retailerStoreId).toBe("10769");
    expect(anon.store?.retailerStoreId).toBe("10769");
    expect(compare(mine, anon)).toEqual({ verdict: "SAME", deltaMinor: 0 });
  });

  it("Target banana: login moved the store from Princeton to Durham, so STORE_DIFFERS", () => {
    const mine = sidecarObservation(targetIn, URL_TARGET_BANANA);
    const anon = sidecarObservation(targetOut, URL_TARGET_BANANA);
    expect(mine.store).toEqual({ retailerStoreId: "1872", label: "Durham" });
    expect(anon.store).toEqual({ retailerStoreId: "1151", label: "Princeton" });
    // The prices differ ($0.29 vs $0.39) but that is not a price difference; it is a store.
    expect(mine.facts.price.amountMinor).not.toBe(anon.facts.price.amountMinor);
    expect(compare(mine, anon)).toEqual({ verdict: "STORE_DIFFERS" });
  });

  it("Walmart banana: same store by id, same price", () => {
    const mine = sidecarObservation(walmartIn, URL_WALMART_BANANA);
    const anon = sidecarObservation(walmartOut, URL_WALMART_BANANA);
    expect(compare(mine, anon)).toEqual({ verdict: "SAME", deltaMinor: 0 });
  });

  it("Walmart without a store id (the page never renders one) matches on the label", () => {
    const mine = sidecarObservation(walmartIn, URL_WALMART_BANANA);
    const anon = sidecarObservation(walmartOut, URL_WALMART_BANANA);
    mine.store = { label: "East Windsor Supercenter" };
    anon.store = { label: "East Windsor Supercenter" };
    expect(compare(mine, anon)).toEqual({ verdict: "SAME", deltaMinor: 0 });
    anon.store = { label: "Princeton Supercenter" };
    expect(compare(mine, anon)).toEqual({ verdict: "STORE_DIFFERS" });
  });

  it("a pair whose stores cannot be matched is not a comparison", () => {
    const mine = sidecarObservation(walmartIn, URL_WALMART_BANANA);
    const anon = sidecarObservation(walmartOut, URL_WALMART_BANANA);
    mine.store = undefined;
    expect(compare(mine, anon)).toEqual({ verdict: "UNCHECKED", reason: "store_unknown" });
    mine.store = { retailerStoreId: "3266" };
    anon.store = { label: "East Windsor Supercenter" };
    expect(compare(mine, anon)).toEqual({ verdict: "UNCHECKED", reason: "store_unknown" });
  });

  it("MORE and LESS carry the signed delta (mine minus anonymous)", () => {
    const mine = ownInstacartObservation(instacartIn, URL_BANANAS);
    const anon = ownInstacartObservation(instacartOut, URL_BANANAS);
    anon.facts = { ...anon.facts, price: { amountMinor: 12, currency: "USD" } };
    expect(compare(mine, anon)).toEqual({ verdict: "MORE", deltaMinor: 10 });
    anon.facts = { ...anon.facts, price: { amountMinor: 31, currency: "USD" } };
    expect(compare(mine, anon)).toEqual({ verdict: "LESS", deltaMinor: -9 });
  });
});

describe("sameStore", () => {
  it("prefers ids, falls back to labels, and is undefined with nothing to match", () => {
    expect(
      sameStore({ retailerStoreId: "1", label: "A" }, { retailerStoreId: "1", label: "B" }),
    ).toBe(true);
    expect(
      sameStore({ retailerStoreId: "1", label: "A" }, { retailerStoreId: "2", label: "A" }),
    ).toBe(false);
    expect(sameStore({ label: "A" }, { label: "A" })).toBe(true);
    expect(sameStore(undefined, { label: "A" })).toBeUndefined();
    expect(sameStore({ retailerStoreId: "1" }, { label: "A" })).toBeUndefined();
  });
});

describe("pricePoint", () => {
  it("keeps only what the popup shows", () => {
    const mine = ownInstacartObservation(instacartIn, URL_BANANAS);
    expect(pricePoint(mine)).toEqual({
      observationId: mine.observationId,
      amountMinor: 22,
      priceText: "$0.22",
      fulfillment: "delivery",
      storeId: "10769",
      storeLabel: "Wegmans",
    });
  });
});

describe("verdict copy", () => {
  it("formats minor units as dollars", () => {
    expect(formatUsd(10)).toBe("$0.10");
    expect(formatUsd(-9)).toBe("$0.09");
    expect(formatUsd(1234)).toBe("$12.34");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("is exactly the five lines the brief allows", () => {
    expect(verdictText("SAME")).toBe("Same");
    expect(verdictText("MORE", 10)).toBe("You pay $0.10 more");
    expect(verdictText("LESS", -9)).toBe("You pay $0.09 less");
    expect(verdictText("STORE_DIFFERS")).toBe("Store differs");
    expect(verdictText("UNCHECKED")).toBe("Could not check");
    expect(verdictDetail("STORE_DIFFERS")).toBe("Anonymous visitors are served a different store.");
  });
});

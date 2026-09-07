import type { ProductRef } from "@pennypincher/schema";
import { describe, expect, it } from "vitest";
import {
  FUZZY_THRESHOLD,
  compareSignatures,
  matchProducts,
  tokenSetSimilarity,
} from "../src/match";
import { signature } from "../src/tokens";
import { gs1CheckDigit } from "../src/upc";

const upc = (body: string) => `${body}${gs1CheckDigit(body)}`;

describe("tokenSetSimilarity", () => {
  it("is the Dice coefficient over sets, order-free and duplicate-free", () => {
    expect(tokenSetSimilarity(["a", "b", "c"], ["c", "b", "a"])).toBe(1);
    expect(tokenSetSimilarity(["a", "b", "c"], ["a", "b", "c", "d", "e"])).toBe(0.75);
    expect(tokenSetSimilarity(["a", "a", "b"], ["a", "b"])).toBe(1);
    expect(tokenSetSimilarity(["a"], ["b"])).toBe(0);
  });

  it("is 1 for two empty sets and 0 for one empty set", () => {
    expect(tokenSetSimilarity([], [])).toBe(1);
    expect(tokenSetSimilarity([], ["a"])).toBe(0);
  });
});

describe("compareSignatures", () => {
  it("matches a reordered title with a size written in another unit", () => {
    const r = compareSignatures(
      signature({ title: "Great Value Whole Vitamin D Milk", sizeText: "1 gal" }),
      signature({ title: "Great Value Milk, Vitamin D, Whole, 128 fl oz" }),
    );
    expect(r).toMatchObject({ same: true, method: "fuzzy", score: 1, sizes: "agree" });
    expect(r.reason).toBeUndefined();
  });

  it("gates on size before anything else", () => {
    const r = compareSignatures(
      signature({ title: "Great Value 2% Reduced Fat Milk", sizeText: "128 oz" }),
      signature({ title: "Great Value 2% Reduced Fat Milk", sizeText: "64 oz" }),
    );
    expect(r).toMatchObject({ same: false, reason: "size_conflict", sizes: "conflict", score: 1 });
  });

  it("gates on two explicit brands that share no token", () => {
    const r = compareSignatures(
      signature({ title: "Whole Milk - 1gal", brand: "Good & Gather" }),
      signature({ title: "Whole Milk - 1gal", brand: "Great Value" }),
    );
    expect(r).toMatchObject({ same: false, reason: "brand_conflict" });
  });

  it("does not treat one explicit brand against none as a conflict", () => {
    const r = compareSignatures(
      signature({ title: "Fresh Banana - each", brand: "Good & Gather" }),
      signature({ title: "Fresh Banana, Each" }),
    );
    expect(r.reason).not.toBe("brand_conflict");
  });

  it("gates on a variant attribute present on one side only", () => {
    const organic = compareSignatures(
      signature({ title: "Simply Nature Organic Whole Milk", sizeText: "64 fl oz" }),
      signature({ title: "Simply Nature Whole Milk", sizeText: "64 fl oz" }),
    );
    expect(organic).toMatchObject({ same: false, reason: "variant_conflict" });
    const flavour = compareSignatures(
      signature({ title: "NOKA Superfood Smoothie Super Berry - 16.9oz/4pk" }),
      signature({ title: "NOKA Superfood Smoothie Strawberry Banana - 16.9oz/4pk" }),
    );
    expect(flavour).toMatchObject({ same: false, reason: "variant_conflict" });
  });

  it("gates on the threshold last, and the threshold is overridable", () => {
    const a = signature({ title: "Fresh Banana, Each" });
    const b = signature({ title: "Fresh Banana - each - Good & Gather" });
    const strict = compareSignatures(a, b);
    expect(strict).toMatchObject({ same: false, reason: "below_threshold" });
    expect(strict.score).toBeCloseTo(2 / 3, 5);
    expect(strict.score).toBeLessThan(FUZZY_THRESHOLD);
    expect(compareSignatures(a, b, 0.6).same).toBe(true);
  });

  it("never matches when either side has no tokens", () => {
    const r = compareSignatures(signature({ title: "- & -" }), signature({ title: "Bananas" }));
    expect(r).toMatchObject({ same: false, reason: "no_tokens" });
  });
});

describe("matchProducts", () => {
  const code = upc("07874235100");

  it("decides by UPC when both sides carry a valid one", () => {
    const same = matchProducts(
      { title: "Great Value Whole Vitamin D Milk, Gallon", upc: code },
      { title: "Whole Milk Gallon", upc: `00${code}` },
    );
    expect(same).toEqual({ same: true, method: "upc", score: 1, sizes: "unknown" });
    const different = matchProducts(
      { title: "Great Value Whole Vitamin D Milk", upc: code },
      { title: "Great Value Whole Vitamin D Milk", upc: upc("07874235101") },
    );
    expect(different).toMatchObject({ same: false, method: "upc", reason: "upc_conflict" });
  });

  it("falls back to fuzzy when a UPC is missing or invalid on either side", () => {
    const r = matchProducts(
      { title: "Great Value Whole Vitamin D Milk", upc: "07874235100" },
      { title: "Great Value Whole Vitamin D Milk" },
    );
    expect(r).toMatchObject({ same: true, method: "fuzzy", score: 1 });
  });

  it("accepts a full ProductRef (extra fields ignored)", () => {
    const a: ProductRef = {
      retailerSku: "81957708",
      title: "Hass Avocados - 4ct - Good & Gather™",
      brand: "Good & Gather",
      url: "https://www.target.com/p/hass-avocados-4ct-good-gather/-/A-81957708",
    };
    const b: ProductRef = {
      retailerSku: "81957708",
      title: "Good & Gather™ Hass Avocados - 4ct",
      url: "https://www.target.com/p/hass-avocados-4ct-good-gather/-/A-81957708",
    };
    expect(matchProducts(a, b).same).toBe(true);
  });
});

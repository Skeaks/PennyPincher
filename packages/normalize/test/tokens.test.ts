import { describe, expect, it } from "vitest";
import { VARIANT_ATTRIBUTES, signature, tokenize } from "../src/tokens";

describe("tokenize", () => {
  it("lower-cases, strips marks and punctuation, drops stopwords, folds plurals", () => {
    expect(tokenize("Fresh Banana - each - Good & Gather™")).toEqual([
      "fresh",
      "banana",
      "each",
      "good",
      "gather",
    ]);
    expect(tokenize("Bananas, Sold by the Each")).toEqual(["banana", "each"]);
    expect(tokenize("Wegmans Red Seedless Grapes, Bagged")).toEqual([
      "wegman",
      "red",
      "seedless",
      "grape",
      "bagged",
    ]);
  });

  it("keeps digits and spells a percent sign so the token can live in an id", () => {
    expect(tokenize("Great Value 2% Reduced Fat Milk")).toEqual([
      "great",
      "value",
      "2pct",
      "reduced",
      "fat",
      "milk",
    ]);
    expect(tokenize("Gerber 1st Foods Stage 2")).toEqual(["gerber", "1st", "food", "stage", "2"]);
  });

  it("does not turn a trademark sign into a token", () => {
    expect(tokenize("Good & Gather™")).toEqual(["good", "gather"]);
    expect(tokenize("Organic Valley® Whole Milk")).toEqual(["organic", "valley", "whole", "milk"]);
  });

  it("removes diacritics and does not fold short words or -ss words", () => {
    expect(tokenize("Crème Fraîche")).toEqual(["creme", "fraiche"]);
    expect(tokenize("gas glass bus")).toEqual(["gas", "glass", "bus"]);
  });

  it("returns nothing for text that is all punctuation or stopwords", () => {
    expect(tokenize("- & -")).toEqual([]);
    expect(tokenize("of the and")).toEqual([]);
  });
});

describe("signature", () => {
  it("unions brand and title tokens, sorted and deduplicated, with the size taken out", () => {
    const sig = signature({
      title: "Fresh Organic Bananas - 2lb - Good & Gather™",
      brand: "Good & Gather",
    });
    expect(sig.tokens).toEqual(["banana", "fresh", "gather", "good", "organic"]);
    expect(sig.brandTokens).toEqual(["good", "gather"]);
    expect(Math.round(sig.size.g ?? 0)).toBe(907);
  });

  it("prefers an explicit sizeText over the size in the title", () => {
    const sig = signature({ title: "Great Value Whole Milk 64 fl oz", sizeText: "1 gal" });
    expect(Math.round(sig.size.ml ?? 0)).toBe(3785);
  });

  it("reads the title size when there is no sizeText and no brand", () => {
    const sig = signature({ title: "Hass Avocados - 4ct" });
    expect(sig.size).toEqual({ ct: 4 });
    expect(sig.brandTokens).toEqual([]);
    expect(sig.tokens).toEqual(["avocado", "hass"]);
  });
});

describe("VARIANT_ATTRIBUTES", () => {
  it("is expressed in the tokeniser's own vocabulary", () => {
    for (const word of VARIANT_ATTRIBUTES) {
      expect(tokenize(word), word).toEqual([word]);
    }
  });
});

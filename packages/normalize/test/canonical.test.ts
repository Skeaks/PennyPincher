import { describe, expect, it } from "vitest";
import {
  type KnownProduct,
  MAX_KEY_TOKENS,
  canonicalize,
  fuzzyKey,
  standaloneConfidence,
} from "../src/canonical";
import { signature } from "../src/tokens";
import { gs1CheckDigit } from "../src/upc";

const upc = (body: string) => `${body}${gs1CheckDigit(body)}`;

describe("fuzzyKey", () => {
  it("is the sorted tokens and the size, deterministic across orderings and units", () => {
    const a = fuzzyKey(signature({ title: "Great Value Whole Vitamin D Milk", sizeText: "1 gal" }));
    const b = fuzzyKey(signature({ title: "Great Value Milk, Vitamin D, Whole, 128 fl oz" }));
    expect(a).toBe("fuzzy:d-great-milk-value-vitamin-whole@3785ml");
    expect(b).toBe(a);
  });

  it("omits the size part when there is no size, and is undefined with no tokens", () => {
    expect(fuzzyKey(signature({ title: "Organic Strawberries" }))).toBe(
      "fuzzy:organic-strawberrie",
    );
    expect(fuzzyKey(signature({ title: "- & -" }))).toBeUndefined();
  });

  it("caps the token count", () => {
    const title = Array.from(
      { length: MAX_KEY_TOKENS + 10 },
      (_, i) => `w${String(i).padStart(3, "0")}`,
    ).join(" ");
    const key = fuzzyKey(signature({ title })) ?? "";
    expect(key.slice("fuzzy:".length).split("-")).toHaveLength(MAX_KEY_TOKENS);
  });

  it("contains only id-safe characters", () => {
    const key = fuzzyKey(
      signature({ title: "Great Value 2% Reduced Fat Milk, 64 fl oz — Gallon™" }),
    );
    expect(key).toMatch(/^fuzzy:[a-z0-9-]+(@[a-z0-9+]+)?$/);
  });
});

describe("standaloneConfidence", () => {
  it("rises with brand, size and token count, capped at 0.9", () => {
    expect(standaloneConfidence(signature({ title: "Bananas" }))).toBeCloseTo(0.5);
    expect(standaloneConfidence(signature({ title: "Fresh Banana, Each" }))).toBeCloseTo(0.7);
    expect(standaloneConfidence(signature({ title: "Bananas", brand: "Dole" }))).toBeCloseTo(0.7);
    expect(
      standaloneConfidence(signature({ title: "Hass Avocados - 4ct", brand: "Good & Gather" })),
    ).toBeCloseTo(0.9);
    expect(
      standaloneConfidence(
        signature({
          title: "Great Value Whole Vitamin D Milk",
          brand: "Great Value",
          sizeText: "1 gal",
        }),
      ),
    ).toBeCloseTo(0.9);
  });
});

describe("canonicalize", () => {
  const code = upc("07874235100");

  it("returns a GTIN-14 id with full confidence for a valid UPC, whatever the title", () => {
    expect(canonicalize({ title: "Whatever", upc: code })).toEqual({
      canonicalId: `gtin:00${code}`,
      method: "upc",
      confidence: 1,
    });
    expect(canonicalize({ title: "Whatever", upc: `0${code}` }).canonicalId).toBe(`gtin:00${code}`);
  });

  it("ignores an invalid UPC and falls through to fuzzy", () => {
    const r = canonicalize({ title: "Fresh Banana, Each", upc: "1234" });
    expect(r.method).toBe("fuzzy");
    expect(r.canonicalId).toBe("fuzzy:banana-fresh@1ct");
  });

  it("mints a deterministic fuzzy id with a heuristic confidence when nothing is known", () => {
    const a = canonicalize({
      title: "Hass Avocados - 4ct - Good & Gather™",
      brand: "Good & Gather",
    });
    const b = canonicalize({ title: "Good & Gather™ Hass Avocados - 4ct" });
    expect(a).toEqual({
      canonicalId: "fuzzy:avocado-gather-good-hass@4ct",
      method: "fuzzy",
      confidence: 0.9,
    });
    expect(b.canonicalId).toBe(a.canonicalId);
    expect(b.confidence).toBeCloseTo(0.8);
  });

  it("returns none when the title normalises to nothing", () => {
    expect(canonicalize({ title: "- & -" })).toEqual({
      canonicalId: null,
      method: "none",
      confidence: 0,
    });
  });

  it("attaches to the best matching candidate and reports the match score", () => {
    const title = "Great Value Whole Vitamin D Milk, Gallon, 128 fl oz";
    const known: KnownProduct[] = [
      { canonicalId: `gtin:00${code}`, title, upc: code },
      {
        canonicalId: "fuzzy:d-great-milk-value-vitamin-whole@1893ml",
        title: "Great Value Whole Vitamin D Milk",
        sizeText: "0.5 gal",
      },
      { canonicalId: "fuzzy:d-gallon-great-milk-value-vitamin-whole@3785ml", title },
    ];
    const r = canonicalize({ title }, { candidates: known });
    // Two candidates score 1.0 (the GTIN row and the fuzzy row share the title); the lexically
    // smaller id wins so the answer does not depend on candidate order.
    expect(r).toEqual({
      canonicalId: "fuzzy:d-gallon-great-milk-value-vitamin-whole@3785ml",
      method: "fuzzy",
      confidence: 1,
    });
    expect(canonicalize({ title }, { candidates: [...known].reverse() })).toEqual(r);
  });

  it("prefers a higher-scoring candidate over a lexically smaller one", () => {
    const known: KnownProduct[] = [
      { canonicalId: "a", title: "Horizon Organic Whole Milk, 64 fl oz Half Gallon Carton" },
      { canonicalId: "b", title: "Horizon Organic Whole Milk", sizeText: "0.5 gal" },
    ];
    const r = canonicalize({ title: "Horizon Organic Whole Milk - 0.5gal" }, { candidates: known });
    expect(r.canonicalId).toBe("b");
    expect(r.confidence).toBe(1);
  });

  it("mints a fresh id when no candidate clears the threshold, and honours a custom one", () => {
    const known: KnownProduct[] = [
      { canonicalId: "banana", title: "Fresh Banana - each - Good & Gather" },
    ];
    const strict = canonicalize({ title: "Fresh Banana, Each" }, { candidates: known });
    expect(strict).toMatchObject({ canonicalId: "fuzzy:banana-fresh@1ct", confidence: 0.7 });
    const loose = canonicalize(
      { title: "Fresh Banana, Each" },
      { candidates: known, threshold: 0.6 },
    );
    expect(loose).toMatchObject({ canonicalId: "banana", method: "fuzzy" });
    expect(loose.confidence).toBeCloseTo(2 / 3, 5);
  });

  it("never attaches a UPC product to a fuzzy candidate", () => {
    const known: KnownProduct[] = [{ canonicalId: "fuzzy:x", title: "Whatever" }];
    expect(canonicalize({ title: "Whatever", upc: code }, { candidates: known }).canonicalId).toBe(
      `gtin:00${code}`,
    );
  });
});

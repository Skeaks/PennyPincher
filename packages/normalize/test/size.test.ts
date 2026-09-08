import { describe, expect, it } from "vitest";
import { compareSizes, mergeSizes, parseSize, sizeKey } from "../src/size";

const near = (actual: number | undefined, expected: number) => {
  expect(actual).toBeDefined();
  expect(Math.abs((actual ?? 0) - expected) / expected).toBeLessThan(0.001);
};

describe("parseSize", () => {
  it("reads weight units into grams", () => {
    near(parseSize("Great Value Sliced Bananas, 16 oz Bag").size.g, 453.59);
    near(parseSize("Fresh Organic Bananas - 2lb").size.g, 907.18);
    near(parseSize("Organic Dried Banana Slices, 1.5 Pounds").size.g, 680.39);
    near(parseSize("Tesco Chewy Dried Banana 200G").size.g, 200);
    near(parseSize("1.5 Ounce Bag").size.g, 42.52);
    near(parseSize("Bare Simply Dried Banana - 2.7oz").size.g, 76.54);
  });

  it("reads volume units into millilitres, fl oz before oz", () => {
    near(parseSize("Horizon Organic Whole Milk, 64 fl oz").size.ml, 1892.7);
    expect(parseSize("64 fl oz").size.g).toBeUndefined();
    near(parseSize("1 gal").size.ml, 3785.41);
    near(parseSize("0.5 gal").size.ml, 1892.7);
    near(parseSize("Half Gallon Carton").size.ml, 1892.7);
    near(parseSize("1 qt").size.ml, 946.35);
    near(parseSize("Milk 1/2 gallon").size.ml, 1892.7);
    near(parseSize("2 L").size.ml, 2000);
    near(parseSize("500ml").size.ml, 500);
  });

  it("reads counts from ct, count, pack of N, N pack, pack N and each", () => {
    expect(parseSize("Hass Avocados - 4ct").size.ct).toBe(4);
    expect(parseSize("Gerber Banana Puree Stage 2 - 4oz/2ct").size).toMatchObject({ ct: 2 });
    expect(parseSize("Made in Nature, Organic Dried Banana, 4 oz Pack of 4").size.ct).toBe(4);
    expect(parseSize("Trader Joes Freeze Dried Bananas (4 Pack)").size.ct).toBe(4);
    expect(parseSize("3 Packs Trader Joes Dried Baby Bananas").size.ct).toBe(3);
    expect(parseSize("Healthy Chewy Snack - Pack 5").size.ct).toBe(5);
    expect(parseSize("Value Packs of 6").size.ct).toBe(6);
    expect(parseSize("5 lb - Case of 2").size).toMatchObject({ ct: 2 });
    expect(parseSize("30 Ounce -- 6 per case").size.ct).toBe(6);
    expect(parseSize("Fresh Banana, Each").size.ct).toBe(1);
    expect(parseSize("Bananas, Sold by the Each").size.ct).toBe(1);
    expect(parseSize("Smoothie - 16.9oz/4pk").size).toMatchObject({ ct: 4 });
  });

  it("keeps the first value per dimension and reads several dimensions", () => {
    const { size } = parseSize("Mavuno Harvest, Organic Dried Banana, 2 oz (56 g) Pack of 2");
    near(size.g, 56.7);
    expect(size.ct).toBe(2);
    const bags = parseSize("Bfruitful Freeze-Dried Bananas, 12 Bags, 0.56 oz Each").size;
    expect(bags.ct).toBe(1);
    near(bags.g, 15.88);
  });

  it("does not read a unit fused to a following word, a bare number, or a year", () => {
    expect(parseSize("Mavuno Harvest Organic Dried Fruit, Banana, 2 Ozbag").size).toEqual({});
    expect(parseSize("Gerber 1st Foods Stage 2").size).toEqual({});
    expect(parseSize("25-yr Shelf Life").size).toEqual({});
    expect(parseSize("Bananas 13 Bunch").size).toEqual({});
  });

  it("blanks the size expressions out of the rest", () => {
    const { rest } = parseSize("Hass Avocados - 4ct - Good & Gather");
    expect(rest).not.toMatch(/4ct/);
    expect(rest).toMatch(/Hass Avocados/);
    expect(rest).toMatch(/Good & Gather/);
    expect(parseSize("Fresh Banana - each").rest).not.toMatch(/each/i);
  });
});

describe("mergeSizes", () => {
  it("takes the first defined value per dimension in order", () => {
    expect(mergeSizes({ ml: 1 }, { ml: 2, g: 3 }, { ct: 4 })).toEqual({ ml: 1, g: 3, ct: 4 });
    expect(mergeSizes()).toEqual({});
  });
});

describe("compareSizes", () => {
  it("agrees within tolerance across unit systems", () => {
    expect(compareSizes(parseSize("2lb").size, parseSize("32 oz").size)).toBe("agree");
    expect(compareSizes(parseSize("1 gal").size, parseSize("128 fl oz").size)).toBe("agree");
    expect(compareSizes(parseSize("200G").size, parseSize("7.05 oz").size)).toBe("agree");
    expect(compareSizes({ ct: 4 }, { ct: 4 })).toBe("agree");
  });

  it("conflicts on a disagreeing dimension", () => {
    expect(compareSizes(parseSize("1 gal").size, parseSize("0.5 gal").size)).toBe("conflict");
    expect(compareSizes(parseSize("96 fl oz").size, parseSize("64 fl oz").size)).toBe("conflict");
    expect(compareSizes({ g: 100, ct: 2 }, { g: 100, ct: 3 })).toBe("conflict");
  });

  it("treats a missing count as one", () => {
    expect(compareSizes({ g: 42 }, { g: 42, ct: 3 })).toBe("conflict");
    expect(compareSizes({ g: 42 }, { g: 42, ct: 1 })).toBe("agree");
    expect(compareSizes({}, { ct: 1 })).toBe("unknown");
    expect(compareSizes({}, { ct: 4 })).toBe("conflict");
  });

  it("is unknown when no dimension is shared", () => {
    expect(compareSizes({}, {})).toBe("unknown");
    expect(compareSizes({ ml: 100 }, { g: 100 })).toBe("unknown");
  });
});

describe("sizeKey", () => {
  it("rounds and joins the dimensions in a fixed order", () => {
    expect(sizeKey(parseSize("1 gal").size)).toBe("3785ml");
    expect(sizeKey(parseSize("4 oz Pack of 4").size)).toBe("113g+4ct");
    expect(sizeKey({ ml: 1.4, g: 2.6, ct: 3 })).toBe("1ml+3g+3ct");
    expect(sizeKey({})).toBe("");
  });
});

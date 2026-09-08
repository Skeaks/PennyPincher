import { describe, expect, it } from "vitest";
import { expandUpcE, gs1CheckDigit, hasValidCheckDigit, normalizeUpc } from "../src/upc";

describe("gs1CheckDigit", () => {
  it("computes the published examples", () => {
    // GS1 worked examples: UPC-A 03600029145 -> 2; EAN-13 400638133393 -> 1.
    expect(gs1CheckDigit("03600029145")).toBe(2);
    expect(gs1CheckDigit("400638133393")).toBe(1);
    expect(hasValidCheckDigit("036000291452")).toBe(true);
    expect(hasValidCheckDigit("036000291453")).toBe(false);
  });
});

describe("expandUpcE", () => {
  it("expands each of the six last-digit patterns", () => {
    expect(expandUpcE("01234505")).toBe("012000003455");
    expect(expandUpcE("01234515")).toBe("012100003455");
    expect(expandUpcE("01234525")).toBe("012200003455");
    expect(expandUpcE("01234535")).toBe("012300000455");
    expect(expandUpcE("01234545")).toBe("012340000055");
    expect(expandUpcE("01234595")).toBe("012345000095");
  });

  it("returns undefined for anything that is not an 8-digit code in number system 0", () => {
    expect(expandUpcE("1234567")).toBeUndefined();
    expect(expandUpcE("11234567")).toBeUndefined();
    expect(expandUpcE("036000291452")).toBeUndefined();
  });
});

describe("normalizeUpc", () => {
  it("pads a valid UPC-A, EAN-13 or GTIN-14 to 14 digits", () => {
    expect(normalizeUpc("036000291452")).toBe("00036000291452");
    expect(normalizeUpc("0036000291452")).toBe("00036000291452");
    expect(normalizeUpc("00036000291452")).toBe("00036000291452");
    expect(normalizeUpc("4006381333931")).toBe("04006381333931");
  });

  it("expands a UPC-E before padding", () => {
    // 0 12345 6 pattern "5": 012345000095 needs check digit 5.
    const expanded = "01234500009";
    const check = gs1CheckDigit(expanded);
    expect(normalizeUpc(`0123459${check}`)).toBe(`00${expanded}${check}`);
  });

  it("tolerates spaces and hyphens", () => {
    expect(normalizeUpc("0 36000 29145 2")).toBe("00036000291452");
    expect(normalizeUpc("036000-291452")).toBe("00036000291452");
  });

  it("rejects a bad check digit, a bad width, non-digits, all zeros and undefined", () => {
    expect(normalizeUpc("036000291453")).toBeUndefined();
    expect(normalizeUpc("07874235100")).toBeUndefined();
    expect(normalizeUpc("03600029145x")).toBeUndefined();
    expect(normalizeUpc("000000000000")).toBeUndefined();
    expect(normalizeUpc("")).toBeUndefined();
    expect(normalizeUpc(undefined)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { parseMoney } from "../../src/capture/money";

describe("parseMoney", () => {
  it.each([
    ["$0.22 each (est.)", 22, "$0.22"],
    ["$4.58 /pkg (est.)", 458, "$4.58"],
    ["$6.89", 689, "$6.89"],
    ["Current price: $1,234.56", 123456, "$1,234.56"],
    ["$5", 500, "$5"],
    ["$ 0.99", 99, "$0.99"],
    ["was $2.34 now $1.99", 234, "$2.34"],
  ])("%s -> %i minor units, priceText %s", (text, amountMinor, priceText) => {
    expect(parseMoney(text)).toEqual({ money: { amountMinor, currency: "USD" }, priceText });
  });

  it.each(["", "free", "0.22", "22 cents", "€1.00"])("%s has no dollar amount", (text) => {
    expect(parseMoney(text)).toBeUndefined();
  });

  it("never produces a float", () => {
    for (const cents of [1, 9, 10, 29, 99]) {
      const parsed = parseMoney(`$0.${String(cents).padStart(2, "0")}`);
      expect(parsed?.money.amountMinor).toBe(cents);
      expect(Number.isInteger(parsed?.money.amountMinor)).toBe(true);
    }
  });
});

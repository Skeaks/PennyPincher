import { describe, expect, it } from "vitest";
import {
  PAIR_LOOKBACK_MS,
  PAIR_SLACK_MS,
  compareRows,
  median,
  pairProbes,
  probeRates,
  sameStore,
} from "../src/probe";
import { probeTwin, row } from "./helpers";

describe("sameStore (mirrors apps/extension/src/probe/compare.ts)", () => {
  it("matches on store id when both sides have one", () => {
    expect(sameStore(row({ retailerStoreId: "1" }), row({ retailerStoreId: "1" }))).toBe(true);
    expect(sameStore(row({ retailerStoreId: "1" }), row({ retailerStoreId: "2" }))).toBe(false);
  });

  it("falls back to the label for Target and Walmart", () => {
    const a = row({ retailer: "walmart", retailerStoreId: null, storeLabel: "East Windsor" });
    expect(sameStore(a, { ...a, retailerStoreId: null })).toBe(true);
    expect(sameStore(a, { ...a, storeLabel: "Princeton" })).toBe(false);
  });

  it("never matches Instacart on the label alone", () => {
    const a = row({ retailer: "instacart", retailerStoreId: null, storeLabel: "Walmart" });
    expect(sameStore(a, { ...a })).toBeUndefined();
  });

  it("has nothing to match on without ids or labels", () => {
    const a = row({ retailer: "target", retailerStoreId: null, storeLabel: null });
    expect(sameStore(a, a)).toBeUndefined();
  });
});

describe("compareRows", () => {
  const mine = row({ priceMinor: 249 });
  it("SAME / MORE / LESS carry the delta", () => {
    expect(compareRows(mine, probeTwin(mine))).toEqual({ verdict: "SAME", deltaMinor: 0 });
    expect(compareRows(mine, probeTwin(mine, { priceMinor: 199 }))).toEqual({
      verdict: "MORE",
      deltaMinor: 50,
    });
    expect(compareRows(mine, probeTwin(mine, { priceMinor: 299 }))).toEqual({
      verdict: "LESS",
      deltaMinor: -50,
    });
  });

  it("STORE_DIFFERS and STORE_UNKNOWN carry no delta", () => {
    expect(compareRows(mine, probeTwin(mine, { retailerStoreId: "1151" }))).toEqual({
      verdict: "STORE_DIFFERS",
    });
    const nameless = row({ retailer: "instacart", retailerStoreId: null });
    expect(compareRows(nameless, probeTwin(nameless))).toEqual({ verdict: "STORE_UNKNOWN" });
  });
});

describe("pairProbes", () => {
  it("pairs an anonymous row with the nearest logged-in row of the same panelist and SKU", () => {
    const early = row({ observedAt: "2026-09-15T11:30:00.000Z", priceMinor: 100 });
    const mine = row({ observedAt: "2026-09-15T12:00:00.000Z", priceMinor: 249 });
    const anon = probeTwin(mine, { priceMinor: 199 });
    const other = row({ panelistId: "panelist-2", observedAt: mine.observedAt });
    const { pairs, unpaired } = pairProbes([early, other, anon, mine]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.mine).toBe(mine);
    expect(pairs[0]?.verdict).toBe("MORE");
    expect(unpaired).toEqual({});
  });

  it("counts an anonymous row with no logged-in row inside the hour as unpaired", () => {
    const mine = row({ observedAt: "2026-09-15T12:00:00.000Z" });
    const late = probeTwin(mine, {
      observedAt: new Date(Date.parse(mine.observedAt) + PAIR_LOOKBACK_MS + 1).toISOString(),
    });
    const skewed = probeTwin(mine, {
      observedAt: new Date(Date.parse(mine.observedAt) - PAIR_SLACK_MS - 1).toISOString(),
    });
    const { pairs, unpaired } = pairProbes([mine, late, skewed]);
    expect(pairs).toHaveLength(0);
    expect(unpaired).toEqual({ instacart: 2 });
  });

  it("lets one logged-in row anchor several probes", () => {
    const mine = row({ observedAt: "2026-09-15T12:00:00.000Z" });
    const first = probeTwin(mine);
    const second = probeTwin(mine, {
      observedAt: new Date(Date.parse(mine.observedAt) + 30 * 60_000).toISOString(),
    });
    expect(pairProbes([mine, first, second]).pairs).toHaveLength(2);
  });

  it("ignores panelists who simply shop logged out", () => {
    const out = row({ sessionState: "logged_out" });
    expect(pairProbes([row(), out]).pairs).toHaveLength(0);
  });
});

describe("probeRates", () => {
  it("reports per retailer, sorted, with the rate over comparable checks only", () => {
    const t = row({ retailer: "target", retailerStoreId: "1872", cellKey: "t" });
    const w = row({ retailer: "walmart", retailerStoreId: null, storeLabel: "East Windsor" });
    const rows = [
      t,
      probeTwin(t),
      probeTwin(t, { priceMinor: 299 }),
      probeTwin(t, { priceMinor: 149 }),
      probeTwin(t, { retailerStoreId: "1151" }),
      w,
      probeTwin(w, { storeLabel: null }),
      probeTwin(row({ retailer: "walmart", panelistId: "lonely" })),
    ];
    const rates = probeRates(pairProbes(rows));
    expect(rates.map((r) => r.retailer)).toEqual(["target", "walmart"]);
    expect(rates[0]).toMatchObject({
      checks: 4,
      comparable: 3,
      same: 1,
      more: 1,
      less: 1,
      storeDiffers: 1,
      storeUnknown: 0,
      unpaired: 0,
      medianAbsDeltaMinor: 75,
    });
    expect(rates[0]?.differenceRate).toBeCloseTo(2 / 3);
    expect(rates[1]).toMatchObject({
      checks: 1,
      comparable: 0,
      storeUnknown: 1,
      unpaired: 1,
      differenceRate: null,
      medianAbsDeltaMinor: null,
    });
  });

  it("median handles empty, odd and even", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

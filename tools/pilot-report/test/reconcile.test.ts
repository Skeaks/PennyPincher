import { MIN_TIER_SIGHTINGS, RESOLVE_SAFETY_FACTOR } from "@pennypincher/stats";
import { describe, expect, it } from "vitest";
import { buildCells } from "../src/metrics";
import {
  PREMATURE_FLOOR_BUDGET,
  SAFETY_FACTORS,
  SIGHTINGS_SWEEP,
  countTwiceSeen,
  firstResolution,
  reconcile,
} from "../src/reconcile";
import { ladderRows } from "./helpers";

const WEEK = { from: "2026-09-14T00:00:00.000Z", to: "2026-09-21T00:00:00.000Z" };
const NONE = new Set<string>();

describe("firstResolution", () => {
  it("resolves a one-price cell once the price has its sightings", () => {
    expect(firstResolution([5, 5, 5, 5], 1.5, 3)).toEqual({ at: 3, k: 1, floor: 5 });
    expect(firstResolution([5, 5], 1.5, 3)).toBeNull();
  });

  it("needs ceil(k * H_k * factor) votes and every tier seen `sightings` times", () => {
    // Two tiers: 3 * 1.5 = 4.5 -> 5 votes, and each tier three times -> six votes here.
    const prices = [1, 2, 1, 2, 1, 2, 1, 2];
    expect(firstResolution(prices, 1.5, 3)).toEqual({ at: 6, k: 2, floor: 1 });
    expect(firstResolution(prices, 1.5, 2)).toEqual({ at: 5, k: 2, floor: 1 });
    // Factor 3 wants 9 votes; there are 8.
    expect(firstResolution(prices, 3, 3)).toBeNull();
    expect(firstResolution(prices, 2.5, 3)).toEqual({ at: 8, k: 2, floor: 1 });
  });

  it("reports the tier count and floor as of the resolving prefix, not the end", () => {
    // Resolves with one tier at 3, then a lower price appears.
    const prices = [9, 9, 9, 1, 1, 1];
    expect(firstResolution(prices, 1.5, 3)).toEqual({ at: 3, k: 1, floor: 9 });
  });
});

describe("countTwiceSeen", () => {
  it("counts prices that reached two sightings and whether they reached three", () => {
    expect(countTwiceSeen([[1, 1, 1, 2, 2, 3]])).toEqual({ tiers: 2, persisted: 1, share: 0.5 });
    expect(countTwiceSeen([[1]])).toEqual({ tiers: 0, persisted: 0, share: null });
  });
});

describe("reconcile on synthetic cells", () => {
  const cells = buildCells(
    Array.from({ length: 60 }, (_, i) =>
      ladderRows({ seed: `recon-${i}`, n: 40, observers: 40, sku: `sku-${i}` }),
    ).flat(),
    "instacart",
    NONE,
    WEEK,
  );
  const r = reconcile(cells);

  it("judges against the real resolver's final answer", () => {
    expect(r.finalResolved).toBe(60);
    expect(r.finalMultiTier).toBe(60);
    expect(r.shares).toHaveLength(1);
    expect(r.shares[0]?.k).toBe(3);
    expect(r.shares[0]?.cells).toBe(60);
    // Uniform three-tier ladders: the rarest share sits near 1/3.
    expect(r.shares[0]?.rarestShareMedian).toBeGreaterThan(0.2);
    expect(r.shares[0]?.rarestShareMedian).toBeLessThan(1 / 3 + 1e-9);
  });

  it("sweeps every factor and sightings value", () => {
    expect(r.factors.map((f) => f.factor)).toEqual([...SAFETY_FACTORS]);
    expect(r.factors.every((f) => f.sightings === MIN_TIER_SIGHTINGS)).toBe(true);
    expect(r.sightings.map((s) => s.sightings)).toEqual([...SIGHTINGS_SWEEP]);
    expect(r.sightings.every((s) => s.factor === RESOLVE_SAFETY_FACTOR)).toBe(true);
  });

  it("premature resolutions fall as the factor rises (each cell resolves no earlier)", () => {
    for (let i = 1; i < r.factors.length; i++) {
      const prev = r.factors[i - 1];
      const cur = r.factors[i];
      if (!prev || !cur) throw new Error("sweep row missing");
      expect(cur.prematureTiers).toBeLessThanOrEqual(prev.prematureTiers);
      expect(cur.prematureFloor).toBeLessThanOrEqual(prev.prematureFloor);
      expect(cur.medianVotesAtResolve ?? 0).toBeGreaterThanOrEqual(prev.medianVotesAtResolve ?? 0);
    }
    // Every cell has 40 votes, enough to resolve under every factor in the sweep.
    expect(r.factors.every((f) => f.resolvedCells === 60)).toBe(true);
  });

  it("at the current constants the premature-floor rate is inside synth's budget", () => {
    const current = r.factors.find((f) => f.factor === RESOLVE_SAFETY_FACTOR);
    expect(current?.prematureFloorRate).not.toBeNull();
    expect(current?.prematureFloorRate ?? 1).toBeLessThanOrEqual(PREMATURE_FLOOR_BUDGET);
    expect(r.recommendations[0]).toMatch(/within the 15.0% budget/);
    expect(r.recommendations[0]).toMatch(/Keep RESOLVE_SAFETY_FACTOR = 1.5/);
  });

  it("says so when there are too few cells to move a constant", () => {
    const few = reconcile(cells.slice(0, 5));
    expect(few.finalResolved).toBe(5);
    expect(few.recommendations).toHaveLength(1);
    expect(few.recommendations[0]).toMatch(/Only 5 cells resolved/);
  });

  it("recommends the smallest factor that holds when the current one does not", () => {
    // Sticky panels resolve too early: hash-assigned shoppers repeat their tier, so the
    // effective sample is smaller than N and the rarest tier shows up late.
    const sticky = buildCells(
      Array.from({ length: 60 }, (_, i) =>
        ladderRows({
          seed: `sticky-${i}`,
          n: 200,
          observers: 40,
          stickiness: 1,
          sku: `sku-${i}`,
          floorRarity: 0.08,
        }),
      ).flat(),
      "instacart",
      NONE,
      WEEK,
    );
    const s = reconcile(sticky);
    const current = s.factors.find((f) => f.factor === RESOLVE_SAFETY_FACTOR);
    if (current === undefined) throw new Error("factor row missing");
    // Whatever the rate came out to, the recommendation matches the table.
    if ((current.prematureFloorRate ?? 0) <= PREMATURE_FLOOR_BUDGET) {
      expect(s.recommendations[0]).toMatch(/Keep RESOLVE_SAFETY_FACTOR/);
    } else {
      expect(s.recommendations[0]).toMatch(/15.0% budget/);
      expect(s.recommendations[0]).toMatch(/propose RESOLVE_SAFETY_FACTOR = |a panel-size problem/);
    }
  });
});

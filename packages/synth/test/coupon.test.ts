import { describe, expect, it } from "vitest";
import {
  expectedDrawsForRareTier,
  expectedDrawsToSeeAll,
  expectedDrawsUniform,
  floorLadderProbabilities,
  harmonic,
} from "../src/coupon";

describe("coupon collector", () => {
  it("H_k", () => {
    expect(harmonic(1)).toBe(1);
    expect(harmonic(2)).toBe(1.5);
    expect(harmonic(4)).toBeCloseTo(25 / 12, 12);
  });

  it("k * H_k for k = 2..5", () => {
    expect(expectedDrawsUniform(2)).toBeCloseTo(3, 12);
    expect(expectedDrawsUniform(3)).toBeCloseTo(5.5, 12);
    expect(expectedDrawsUniform(4)).toBeCloseTo(25 / 3, 12);
    expect(expectedDrawsUniform(5)).toBeCloseTo(137 / 12, 12);
  });

  it("inclusion-exclusion agrees with k * H_k on uniform ladders", () => {
    for (let k = 1; k <= 8; k++) {
      const uniform = Array.from({ length: k }, () => 1 / k);
      expect(expectedDrawsToSeeAll(uniform)).toBeCloseTo(expectedDrawsUniform(k), 9);
    }
  });

  it("inclusion-exclusion on a 2-tier ladder is 1/p + 1/(1-p) - 1", () => {
    for (const p of [0.02, 0.1, 0.3]) {
      expect(expectedDrawsToSeeAll([p, 1 - p])).toBeCloseTo(1 / p + 1 / (1 - p) - 1, 9);
    }
  });

  it("~3/p for the rare tier", () => {
    expect(expectedDrawsForRareTier(0.02)).toBeCloseTo(150, 12);
    expect(expectedDrawsForRareTier(0.5)).toBeCloseTo(6, 12);
    expect(expectedDrawsForRareTier(0.1, 1)).toBeCloseTo(10, 12);
  });

  it("floor ladder shape: floor at p, the rest equal", () => {
    expect(floorLadderProbabilities(4, 0.1)).toEqual([0.1, 0.3, 0.3, 0.3]);
    expect(floorLadderProbabilities(2, 0.5)).toEqual([0.5, 0.5]);
  });

  it("README table values (k = tiers, p = floor rarity): expected draws to see every tier", () => {
    // These are the numbers printed in README.md. If they change, the README is wrong.
    const ps = [0.02, 0.05, 0.1, 0.2, 0.5];
    const rows: Record<number, number[]> = {
      2: [50.0, 20.1, 10.1, 5.3, 3.0],
      3: [50.1, 20.3, 10.7, 6.4, 6.3],
      4: [50.4, 21.0, 11.9, 8.5, 11.1],
      5: [50.9, 22.0, 13.7, 11.4, 16.7],
    };
    for (const [k, row] of Object.entries(rows)) {
      row.forEach((expected, i) => {
        const p = ps[i] ?? 0;
        const actual = expectedDrawsToSeeAll(floorLadderProbabilities(Number(k), p));
        expect(Number(actual.toFixed(1)), `k=${k}, p=${p}`).toBe(expected);
      });
    }
    expect(ps.map((p) => expectedDrawsForRareTier(p))).toEqual([150, 60, 30, 15, 6]);
  });

  it("rejects nonsense", () => {
    expect(() => harmonic(0)).toThrow();
    expect(() => expectedDrawsToSeeAll([])).toThrow();
    expect(() => expectedDrawsToSeeAll([0, 1])).toThrow();
    expect(() => expectedDrawsForRareTier(0)).toThrow();
    expect(() => floorLadderProbabilities(1, 0.5)).toThrow();
  });
});

import { expectedDrawsToSeeAll, expectedDrawsUniform as synthUniform } from "@pennypincher/synth";
import { describe, expect, it } from "vitest";
import { expectedDrawsUniform, harmonic, probabilityAllSeen } from "../src/coupon";
import { RESOLVE_SAFETY_FACTOR, requiredObservations } from "../src/resolve";

describe("coupon collector (stats copy)", () => {
  it("agrees with synth on k * H_k for k = 1..8", () => {
    for (let k = 1; k <= 8; k++) {
      expect(expectedDrawsUniform(k)).toBeCloseTo(synthUniform(k), 12);
    }
    expect(harmonic(4)).toBeCloseTo(25 / 12, 12);
  });

  it("P(all seen) is 0 at n = 0, monotone in n, and tends to 1", () => {
    const p = [0.2, 0.3, 0.5];
    expect(probabilityAllSeen(p, 0)).toBe(0);
    let prev = 0;
    for (let n = 1; n <= 60; n++) {
      const cur = probabilityAllSeen(p, n);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
    expect(prev).toBeGreaterThan(0.999);
  });

  it("two equal tiers: P(all seen in n) = 1 - 2 * 0.5^n", () => {
    for (const n of [1, 2, 5, 10]) {
      expect(probabilityAllSeen([0.5, 0.5], n)).toBeCloseTo(1 - 2 * 0.5 ** n, 12);
    }
  });

  it("sums to the expectation: E[T] = sum over n >= 0 of (1 - P(T <= n))", () => {
    for (const p of [
      [0.5, 0.5],
      [0.2, 0.8],
      [0.1, 0.3, 0.6],
      [0.25, 0.25, 0.25, 0.25],
    ]) {
      let e = 0;
      for (let n = 0; n < 2000; n++) e += 1 - probabilityAllSeen(p, n);
      expect(e).toBeCloseTo(expectedDrawsToSeeAll(p), 6);
    }
  });

  it("at the RESOLVED threshold the uniform collector has finished 85 to 95% of the time (k = 2..8)", () => {
    // This is what RESOLVE_SAFETY_FACTOR buys; the comment on the constant quotes it.
    for (let k = 2; k <= 8; k++) {
      const uniform = Array.from({ length: k }, () => 1 / k);
      const atThreshold = probabilityAllSeen(uniform, requiredObservations(k));
      expect(atThreshold).toBeGreaterThanOrEqual(0.85);
      expect(atThreshold).toBeLessThanOrEqual(0.95);
      // And at the bare expectation it is noticeably worse.
      const atExpectation = probabilityAllSeen(uniform, Math.ceil(expectedDrawsUniform(k)));
      expect(atExpectation).toBeLessThan(atThreshold);
    }
    expect(RESOLVE_SAFETY_FACTOR).toBe(1.5);
  });

  it("rejects bad input", () => {
    expect(() => harmonic(0)).toThrow(RangeError);
    expect(() => probabilityAllSeen([], 1)).toThrow(RangeError);
    expect(() => probabilityAllSeen([0.5, 0.5], -1)).toThrow(RangeError);
    expect(() => probabilityAllSeen([0, 1], 1)).toThrow(RangeError);
  });
});

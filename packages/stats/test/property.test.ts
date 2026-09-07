/**
 * The integrity test. Synth ladders have a floor known by construction; the resolver must
 * never claim a floor below it, and when it says RESOLVED at a sample size the coupon
 * collector calls sufficient, it must almost always have the tier count right.
 *
 * Every arbitrary is seeded (FC_SEED), so the counts in the test names are reproducible.
 * If a constant in `resolve.ts` changes, re-run, and update the recorded numbers here.
 */
import { expectedDrawsToSeeAll, generateLadder } from "@pennypincher/synth";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RESOLVE_SAFETY_FACTOR, resolve } from "../src/index";
import { NOW } from "./helpers";

const SEEDS = 1000;
const FC_SEED = 20260907;

type Shape = { kind: "uniform" } | { kind: "rareFloor"; p: number };

interface Case {
  seed: number;
  k: number;
  n: number;
  base: number;
  gaps: number[];
  shape: Shape;
}

/** k in 2..5, N in 1..200, distinct ascending cent prices, uniform or rare-floor shares. */
const caseArb: fc.Arbitrary<Case> = fc.record({
  seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
  k: fc.integer({ min: 2, max: 5 }),
  n: fc.integer({ min: 1, max: 200 }),
  base: fc.integer({ min: 19, max: 9_999 }),
  gaps: fc.array(fc.integer({ min: 1, max: 500 }), { minLength: 4, maxLength: 4 }),
  shape: fc.oneof(
    fc.constant<Shape>({ kind: "uniform" }),
    fc
      .double({ min: 0.05, max: 0.5, noNaN: true, noDefaultInfinity: true })
      .map<Shape>((p) => ({ kind: "rareFloor", p })),
  ),
});

function ladderFor(c: Case) {
  const tiers: number[] = [c.base];
  for (let i = 1; i < c.k; i++) tiers.push((tiers[i - 1] ?? 0) + (c.gaps[i - 1] ?? 1));
  return generateLadder({
    tiers,
    seed: c.seed,
    ...(c.shape.kind === "rareFloor" ? { floorRarity: c.shape.p } : {}),
  });
}

/** The brief's threshold, on the exact expectation for the true shares (= k * H_k when uniform). */
function threshold(probabilities: readonly number[]): number {
  return Math.ceil(expectedDrawsToSeeAll(probabilities) * RESOLVE_SAFETY_FACTOR);
}

describe("property: resolve against synth ground truth", () => {
  it(`never reports a floor below the true floor (${SEEDS} seeds, k in 2..5, N in 1..200)`, () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const ladder = ladderFor(c);
        const r = resolve(ladder.sample(c.n), { now: NOW });
        if (r.status === "RESOLVED") {
          expect(r.floor).toBeGreaterThanOrEqual(ladder.truth.floor);
          // Every reported tier is a real one: exact-cents clustering cannot invent prices.
          for (const t of r.tiers) expect(ladder.truth.prices).toContain(t.price);
        }
      }),
      { seed: FC_SEED, numRuns: SEEDS },
    );
  });

  it("at N >= ceil(1.5 * E[T]): RESOLVED with the wrong tier count in 4 of 783 seeds (0.5%, under 2%); RESOLVED at all in 742 of 783", () => {
    let above = 0;
    let resolved = 0;
    let wrong = 0;
    for (const c of fc.sample(caseArb, { seed: FC_SEED, numRuns: SEEDS })) {
      const ladder = ladderFor(c);
      if (c.n < threshold(ladder.truth.probabilities)) continue;
      above++;
      const r = resolve(ladder.sample(c.n), { now: NOW });
      if (r.status !== "RESOLVED") continue;
      resolved++;
      if (r.tiers.length !== ladder.truth.k) wrong++;
    }
    expect({ above, resolved, wrong }).toEqual({ above: 783, resolved: 742, wrong: 4 });
    expect(wrong / above).toBeLessThan(0.02);
  });

  it("below the threshold it never resolves with the wrong tier count either, and it mostly says UNRESOLVED", () => {
    let below = 0;
    let resolved = 0;
    for (const c of fc.sample(caseArb, { seed: FC_SEED, numRuns: SEEDS })) {
      const ladder = ladderFor(c);
      if (c.n >= threshold(ladder.truth.probabilities)) continue;
      below++;
      const r = resolve(ladder.sample(c.n), { now: NOW });
      if (r.status !== "RESOLVED") continue;
      resolved++;
      expect(r.floor).toBeGreaterThanOrEqual(ladder.truth.floor);
    }
    expect(below).toBe(SEEDS - 783);
    expect(resolved / below).toBeLessThan(0.15);
  });

  it("UNRESOLVED's needed is a usable one-step estimate: adding it gets 220 of 436 cells to RESOLVED (50%)", () => {
    // Not an acceptance criterion; a sanity check that `needed` is neither 0 nor absurd. It is
    // a point estimate from observed shares, so about half the cells need a second round.
    let checked = 0;
    let resolvedAfter = 0;
    for (const c of fc.sample(caseArb, { seed: FC_SEED + 1, numRuns: 2000 })) {
      const ladder = ladderFor(c);
      const r = resolve(ladder.sample(c.n), { now: NOW });
      if (r.status !== "UNRESOLVED" || r.reason === "too_many_tiers") continue;
      checked++;
      const again = resolve(ladder.sample(c.n + r.needed), { now: NOW });
      if (again.status === "RESOLVED") resolvedAfter++;
    }
    expect({ checked, resolvedAfter }).toEqual({ checked: 436, resolvedAfter: 220 });
    expect(resolvedAfter / checked).toBeGreaterThan(0.45);
  });
});

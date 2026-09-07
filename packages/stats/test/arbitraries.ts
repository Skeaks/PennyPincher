/**
 * The synth ladder arbitrary shared by the property tests. `property.test.ts` (S09) carries
 * its own copy so its recorded numbers stay tied to the file that records them; this one
 * exists for the S10 tests that vary the sampling (stickiness) over the same case space.
 */
import { expectedDrawsToSeeAll, generateLadder } from "@pennypincher/synth";
import fc from "fast-check";
import { RESOLVE_SAFETY_FACTOR } from "../src/index";

export type Shape = { kind: "uniform" } | { kind: "rareFloor"; p: number };

export interface Case {
  seed: number;
  k: number;
  n: number;
  base: number;
  gaps: number[];
  shape: Shape;
}

/** k in 2..5, N in 1..200, distinct ascending cent prices, uniform or rare-floor shares. */
export const caseArb: fc.Arbitrary<Case> = fc.record({
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

export interface Sampling {
  stickiness: number;
  observers: number;
}

export function ladderFor(c: Case, sampling?: Sampling) {
  const tiers: number[] = [c.base];
  for (let i = 1; i < c.k; i++) tiers.push((tiers[i - 1] ?? 0) + (c.gaps[i - 1] ?? 1));
  return generateLadder({
    tiers,
    seed: c.seed,
    ...(c.shape.kind === "rareFloor" ? { floorRarity: c.shape.p } : {}),
    ...(sampling ?? {}),
  });
}

/** The resolver's threshold on the exact expectation for the true shares. */
export function threshold(probabilities: readonly number[]): number {
  return Math.ceil(expectedDrawsToSeeAll(probabilities) * RESOLVE_SAFETY_FACTOR);
}

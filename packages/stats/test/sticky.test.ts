/**
 * Serial correlation. Real panels are not i.i.d.: retailers hash-assign a shopper to a tier
 * and keep them there, so a panelist who checks twice is one draw, not two. Synth models this
 * with `stickiness` (probability a repeat observer sees their previous tier) and `observers`
 * (how many distinct panelists the observations are dealt to).
 *
 * The resolver's threshold is calibrated on i.i.d. draws and reads nothing about who observed
 * what, so on a sticky panel it resolves too early. What must still hold is the integrity
 * invariant: never a floor below the truth. What degrades, and by how much, is recorded in
 * the test names below. Same FC_SEED as property.test.ts, so the two are directly comparable.
 */
import { generateLadder } from "@pennypincher/synth";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { resolve } from "../src/index";
import { type Sampling, caseArb, ladderFor, threshold } from "./arbitraries";
import { NOW } from "./helpers";

const SEEDS = 1000;
const FC_SEED = 20260907;

/** The i.i.d. baseline from property.test.ts: 783 cases above threshold, 4 wrong. */
const IID = { above: 783, resolved: 742, wrong: 4 };

function sweep(sampling: Sampling) {
  let above = 0;
  let resolved = 0;
  let wrong = 0;
  for (const c of fc.sample(caseArb, { seed: FC_SEED, numRuns: SEEDS })) {
    const ladder = ladderFor(c, sampling);
    if (c.n < threshold(ladder.truth.probabilities)) continue;
    above++;
    const r = resolve(ladder.sample(c.n), { now: NOW });
    if (r.status !== "RESOLVED") continue;
    resolved++;
    if (r.tiers.length !== ladder.truth.k) wrong++;
  }
  return { above, resolved, wrong };
}

describe("property: sticky panels", () => {
  it(`never reports a floor below the true floor at stickiness 0.9 over 10 observers (${SEEDS} seeds)`, () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const ladder = ladderFor(c, { stickiness: 0.9, observers: 10 });
        const r = resolve(ladder.sample(c.n), { now: NOW });
        if (r.status === "RESOLVED") {
          expect(r.floor).toBeGreaterThanOrEqual(ladder.truth.floor);
          for (const t of r.tiers) expect(ladder.truth.prices).toContain(t.price);
        }
      }),
      { seed: FC_SEED, numRuns: SEEDS },
    );
  });

  it("never reports a floor below the true floor even when every observer is pinned (stickiness 1, 5 observers)", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const ladder = ladderFor(c, { stickiness: 1, observers: 5 });
        const r = resolve(ladder.sample(c.n), { now: NOW });
        if (r.status === "RESOLVED") expect(r.floor).toBeGreaterThanOrEqual(ladder.truth.floor);
      }),
      { seed: FC_SEED, numRuns: SEEDS },
    );
  });

  it("the i.i.d. baseline is 4 wrong of 783 above threshold (0.5%); stickiness 0.8 over 10 observers makes it 36 (4.6%)", () => {
    expect(sweep({ stickiness: 0, observers: 10 })).toEqual(IID);
    expect(sweep({ stickiness: 0.8, observers: 10 })).toEqual({
      above: 783,
      resolved: 723,
      wrong: 36,
    });
  });

  it("stickiness 0.9 over 10 observers: 69 wrong of 783 (8.8%); over 20 observers: 25 (3.2%); over 5: 120 (15.3%)", () => {
    expect(sweep({ stickiness: 0.9, observers: 10 })).toEqual({
      above: 783,
      resolved: 722,
      wrong: 69,
    });
    expect(sweep({ stickiness: 0.9, observers: 20 })).toEqual({
      above: 783,
      resolved: 735,
      wrong: 25,
    });
    expect(sweep({ stickiness: 0.9, observers: 5 })).toEqual({
      above: 783,
      resolved: 722,
      wrong: 120,
    });
  });

  it("stickiness 1 (every observer pinned for good) over 10 observers: 178 wrong of 783 (22.7%); over 20: 45 (5.7%)", () => {
    // With stickiness 1 a cell holds at most `observers` independent draws, however many
    // observations it has. The 2% wrong-tier budget is met only once the panel itself is wide
    // enough; more observations from the same people never get it there.
    expect(sweep({ stickiness: 1, observers: 10 })).toEqual({
      above: 783,
      resolved: 753,
      wrong: 178,
    });
    expect(sweep({ stickiness: 1, observers: 20 })).toEqual({
      above: 783,
      resolved: 744,
      wrong: 45,
    });
  });
});

/**
 * How much more N a sticky panel takes: the smallest N (step 5) at which 90% of 100 seeds
 * return RESOLVED with the right tier count. -1 means never within 400 observations.
 */
function n90(tiers: number[], floorRarity: number | undefined, sampling?: Sampling): number {
  const MAX_N = 400;
  const SAMPLE_SEEDS = 100;
  const samples: { prefix: ReturnType<ReturnType<typeof generateLadder>["sample"]>; k: number }[] =
    [];
  for (let seed = 0; seed < SAMPLE_SEEDS; seed++) {
    const ladder = generateLadder({
      tiers,
      seed,
      ...(floorRarity === undefined ? {} : { floorRarity }),
      ...(sampling ?? {}),
    });
    samples.push({ prefix: ladder.sample(MAX_N), k: ladder.truth.k });
  }
  for (let n = 5; n <= MAX_N; n += 5) {
    let ok = 0;
    for (const s of samples) {
      const r = resolve(s.prefix.slice(0, n), { now: NOW });
      if (r.status === "RESOLVED" && r.tiers.length === s.k) ok++;
    }
    if (ok >= 0.9 * SAMPLE_SEEDS) return n;
  }
  return -1;
}

describe("how much more N a sticky panel takes (N at which 90% of seeds resolve correctly)", () => {
  it("three uniform tiers: 20 i.i.d.; 25 at stickiness 0.5 over 10 observers; 30 at 0.9 over 10; back to 20 with 20 observers", () => {
    const tiers = [199, 249, 299];
    expect(n90(tiers, undefined)).toBe(20);
    expect(n90(tiers, undefined, { stickiness: 0.5, observers: 10 })).toBe(25);
    expect(n90(tiers, undefined, { stickiness: 0.9, observers: 10 })).toBe(30);
    expect(n90(tiers, undefined, { stickiness: 0.9, observers: 20 })).toBe(20);
  });

  it("three tiers, floor at 10%: 50 i.i.d.; 80 at stickiness 0.5 over 10; 180 at 0.9 over 10; 150 at 0.9 over 20", () => {
    const tiers = [199, 249, 299];
    expect(n90(tiers, 0.1)).toBe(50);
    expect(n90(tiers, 0.1, { stickiness: 0.5, observers: 10 })).toBe(80);
    expect(n90(tiers, 0.1, { stickiness: 0.9, observers: 10 })).toBe(180);
    expect(n90(tiers, 0.1, { stickiness: 0.9, observers: 20 })).toBe(150);
  });

  it("three tiers, floor at 10%, stickiness 1: never with 10 or 20 observers; 60 with 40", () => {
    // 3/p = 30 independent draws are needed to confirm the floor; 10 or 20 pinned observers
    // are 10 or 20 draws, so the rare floor is confirmed only by luck.
    const tiers = [199, 249, 299];
    expect(n90(tiers, 0.1, { stickiness: 1, observers: 10 })).toBe(-1);
    expect(n90(tiers, 0.1, { stickiness: 1, observers: 20 })).toBe(-1);
    expect(n90(tiers, 0.1, { stickiness: 1, observers: 40 })).toBe(60);
  });
});

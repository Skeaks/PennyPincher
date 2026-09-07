/**
 * detectShift against synth: a stable ladder never alarms, a planted shift is found at the
 * block it happened in, and ladders whose block medians are unstable come back inconclusive
 * rather than as a coin flip. Rates are over 200 seeds and are recorded in the test names.
 */
import { generateLadder } from "@pennypincher/synth";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHIFT_PARAMETERS,
  SHIFT_BLOCK_SIZE,
  SHIFT_MIN_MEDIAN_SHARE,
  SHIFT_MIN_SCALE,
  SHIFT_REFERENCE_BLOCKS,
  SHIFT_SLACK,
  SHIFT_THRESHOLD,
  detectShift,
} from "../src/index";
import { SYNTH_START, obs } from "./helpers";

const SEEDS = 200;

interface LadderShape {
  tiers: number[];
  probabilities?: number[];
}

const DOMINANT: LadderShape = { tiers: [199, 249, 299], probabilities: [0.1, 0.8, 0.1] };

/** `n1` observations of ladder A, then `n2` of ladder B starting where A left off. */
function planted(a: LadderShape, b: LadderShape, seed: number, n1: number, n2: number) {
  const before = generateLadder({ ...a, seed }).sample(n1);
  const shiftAt = new Date(Date.parse(SYNTH_START) + n1 * 60_000).toISOString();
  const after = generateLadder({ ...b, seed: seed + 7, shell: { startAt: shiftAt } }).sample(n2);
  return { observations: [...before, ...after], shiftAt };
}

function raised(ladder: LadderShape, fraction: number): LadderShape {
  return { ...ladder, tiers: ladder.tiers.map((t) => Math.round(t * (1 + fraction))) };
}

/** Minutes from the true shift to the reported `at`; observations are one minute apart. */
function lagMinutes(at: string | undefined, shiftAt: string): number {
  return (Date.parse(at ?? "") - Date.parse(shiftAt)) / 60_000;
}

describe("constants", () => {
  it("are the documented ones", () => {
    expect(DEFAULT_SHIFT_PARAMETERS).toEqual({
      blockSize: 10,
      minScale: 0.02,
      slack: 0.5,
      threshold: 4,
      minMedianShare: 0.7,
      referenceBlocks: 3,
    });
    expect([
      SHIFT_BLOCK_SIZE,
      SHIFT_MIN_SCALE,
      SHIFT_SLACK,
      SHIFT_THRESHOLD,
      SHIFT_MIN_MEDIAN_SHARE,
      SHIFT_REFERENCE_BLOCKS,
    ]).toEqual([10, 0.02, 0.5, 4, 0.7, 3]);
  });
});

describe("detectShift: stable ladders", () => {
  it("a single price never alarms (0 of 200 seeds, 200 observations each)", () => {
    let alarms = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const d = detectShift(generateLadder({ tiers: [299], seed }).sample(200));
      if (d.shifted) alarms++;
      expect(d.inconclusive).toBeUndefined();
    }
    expect(alarms).toBe(0);
  });

  it("a dominant-tier ladder (10/80/10) never alarms (0 of 200 seeds) and is never inconclusive", () => {
    let alarms = 0;
    let inconclusive = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const d = detectShift(generateLadder({ ...DOMINANT, seed }).sample(200));
      if (d.shifted) alarms++;
      if (d.inconclusive) inconclusive++;
    }
    expect({ alarms, inconclusive }).toEqual({ alarms: 0, inconclusive: 0 });
  });

  it("returns exactly { shifted: false } when it ran and saw nothing", () => {
    expect(detectShift(obs(Array(40).fill(499)))).toEqual({ shifted: false });
  });
});

/** Run `planted` over every seed and tally where the alarm was placed relative to the truth. */
function lags(a: LadderShape, b: LadderShape, n1: number, n2: number) {
  const byLag = new Map<number, number>();
  let found = 0;
  for (let seed = 0; seed < SEEDS; seed++) {
    const { observations, shiftAt } = planted(a, b, seed, n1, n2);
    const d = detectShift(observations);
    if (!d.shifted) continue;
    found++;
    const lag = lagMinutes(d.at, shiftAt);
    byLag.set(lag, (byLag.get(lag) ?? 0) + 1);
  }
  const exact = byLag.get(0) ?? 0;
  const all = [...byLag.keys()];
  return { found, exact, earliest: Math.min(...all), latest: Math.max(...all) };
}

describe("detectShift: planted shifts on a dominant-tier ladder (200 seeds)", () => {
  // `at` is the start of the CUSUM run that alarmed. A post-shift block whose median fell back
  // to the old level restarts the run, so `at` can land a block or two late; a pre-shift block
  // whose median strayed toward the new level can start the run early. Both are rare and both
  // are bounded by the block size; the counts below pin how rare.
  it.each([
    [0.05, 194, 192],
    [0.1, 200, 198],
    [0.25, 200, 199],
  ])(
    "every tier raised by %d (100 then 100): found in %d of 200, at the exact block in %d, never more than two blocks late",
    (fraction, found, exact) => {
      const r = lags(DOMINANT, raised(DOMINANT, fraction), 100, 100);
      expect(r).toMatchObject({ found, exact });
      expect(r.earliest).toBe(0);
      expect(r.latest).toBeLessThanOrEqual(2 * SHIFT_BLOCK_SIZE);
    },
  );

  it("a price cut (every tier lowered by 10%): found in 200 of 200, exact in 198, the other two up to five blocks early", () => {
    const r = lags(DOMINANT, raised(DOMINANT, -0.1), 100, 100);
    expect(r).toMatchObject({ found: 200, exact: 198, latest: 0 });
    expect(r.earliest).toBeGreaterThanOrEqual(-5 * SHIFT_BLOCK_SIZE);
  });

  it("a late shift (150 then 50) and an early one (30 then 170): found in 200 of 200, exact in 198", () => {
    for (const [n1, n2] of [
      [150, 50],
      [30, 170],
    ] as const) {
      const r = lags(DOMINANT, raised(DOMINANT, 0.1), n1, n2);
      expect(r).toMatchObject({ found: 200, exact: 198, earliest: 0 });
      expect(r.latest).toBeLessThanOrEqual(2 * SHIFT_BLOCK_SIZE);
    }
  });

  it("a shift inside a block (105 then 95) is placed at that block's start or the next one's: found in 199, within half a block in 197", () => {
    let found = 0;
    let halfBlock = 0;
    let worst = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const { observations, shiftAt } = planted(DOMINANT, raised(DOMINANT, 0.1), seed, 105, 95);
      const d = detectShift(observations);
      if (!d.shifted) continue;
      found++;
      const lag = lagMinutes(d.at, shiftAt);
      if (Math.abs(lag) === SHIFT_BLOCK_SIZE / 2) halfBlock++;
      worst = Math.max(worst, Math.abs(lag));
    }
    expect({ found, halfBlock }).toEqual({ found: 199, halfBlock: 197 });
    expect(worst).toBeLessThanOrEqual(2.5 * SHIFT_BLOCK_SIZE);
  });

  it("does not care about input order: reversed observations give the same answer", () => {
    const { observations, shiftAt } = planted(DOMINANT, raised(DOMINANT, 0.1), 5, 100, 100);
    const reversed = [...observations].reverse();
    expect(detectShift(reversed)).toEqual({ shifted: true, at: shiftAt });
  });
});

describe("detectShift: inconclusive", () => {
  it("fewer than two full blocks is too_few_blocks", () => {
    expect(detectShift([])).toEqual({ shifted: false, inconclusive: "too_few_blocks" });
    expect(detectShift(obs(Array(19).fill(499)))).toEqual({
      shifted: false,
      inconclusive: "too_few_blocks",
    });
    expect(detectShift(obs(Array(20).fill(499)))).toEqual({ shifted: false });
  });

  it("observations with unparseable dates are ignored", () => {
    const o = obs(Array(25).fill(499));
    for (const item of o.slice(20)) item.observedAt = "not a date";
    expect(detectShift(o)).toEqual({ shifted: false });
  });

  it.each<[string, LadderShape]>([
    ["three uniform tiers", { tiers: [199, 249, 299] }],
    ["two tiers at 50/50", { tiers: [199, 299] }],
    [
      "floor at 10%, the rest split 45/45",
      { tiers: [199, 249, 299], probabilities: [0.1, 0.45, 0.45] },
    ],
  ])("%s: no_dominant_price in 200 of 200 seeds, shifted or not", (_name, ladder) => {
    let inconclusive = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const stable = detectShift(generateLadder({ ...ladder, seed }).sample(200));
      const { observations } = planted(ladder, raised(ladder, 0.25), seed, 100, 100);
      const moved = detectShift(observations);
      if (
        stable.inconclusive === "no_dominant_price" &&
        moved.inconclusive === "no_dominant_price"
      ) {
        inconclusive++;
      }
      expect(stable.shifted).toBe(false);
      expect(moved.shifted).toBe(false);
    }
    expect(inconclusive).toBe(SEEDS);
  });

  it("a 70/15/15 ladder sits on the guard: inconclusive in some seeds, never a false alarm", () => {
    let alarms = 0;
    let inconclusive = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const d = detectShift(
        generateLadder({ tiers: [199, 249, 299], probabilities: [0.15, 0.7, 0.15], seed }).sample(
          200,
        ),
      );
      if (d.shifted) alarms++;
      if (d.inconclusive) inconclusive++;
    }
    expect(alarms).toBe(0);
    expect(inconclusive).toBeGreaterThan(0);
    expect(inconclusive).toBeLessThan(SEEDS);
  });
});

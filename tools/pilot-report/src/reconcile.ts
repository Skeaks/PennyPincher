/**
 * Reconciliation: do real tier shares look like synth's assumptions, and would the resolver's
 * constants have held up on them?
 *
 * The two constants under test (packages/stats/src/resolve.ts):
 *  - `RESOLVE_SAFETY_FACTOR` (1.5): RESOLVED needs N >= ceil(k * H_k * factor). Tuned so that
 *    on synth's uniform ladders the collector has seen every tier 85 to 90% of the time when
 *    the cell resolves; the rest is what the rare-tier guard is for.
 *  - `MIN_TIER_SIGHTINGS` (3): every tier must have been seen three times.
 *
 * Real data lets us replay each cell's votes in order and ask, for a sweep of constants: at
 * the first prefix where the resolver would have said RESOLVED, did it have the right tier
 * count and the right floor, judged against the same cell over the whole pilot? A cell that
 * would have resolved with fewer tiers than it finally shows is a premature resolution; one
 * with a higher floor is a premature floor, the one the engine must not get wrong. If the
 * premature-floor rate at 1.5 is above what synth promised (10 to 15%), the factor is too low
 * for real panels and the sweep says which value would have held.
 *
 * The replay emulates the resolver's two guards on the votes as they arrived (no singleton
 * rule: it starts at N = 100, above any pilot cell). "Final" is `resolve()` itself over the
 * whole window, so the judge is the real engine.
 */
import {
  MIN_TIER_SIGHTINGS,
  RESOLVE_SAFETY_FACTOR,
  expectedDrawsUniform,
} from "@pennypincher/stats";
import type { CellSummary } from "./metrics";
import { median } from "./probe";

export const SAFETY_FACTORS: readonly number[] = [1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export const SIGHTINGS_SWEEP: readonly number[] = [2, 3, 4];
/** The premature-floor rate synth's tuning promised; above it the factor is too low. */
export const PREMATURE_FLOOR_BUDGET = 0.15;

export interface FactorRow {
  factor: number;
  sightings: number;
  /** Cells that would have resolved at some prefix under these constants. */
  resolvedCells: number;
  prematureTiers: number;
  prematureFloor: number;
  prematureTierRate: number | null;
  prematureFloorRate: number | null;
  medianVotesAtResolve: number | null;
}

export interface ShareRow {
  k: number;
  cells: number;
  rarestShareMedian: number;
  rarestShareMin: number;
}

export interface TwiceSeen {
  /** Prices that reached exactly two sightings at some prefix. */
  tiers: number;
  /** Of those, how many reached MIN_TIER_SIGHTINGS by the end of the window. */
  persisted: number;
  share: number | null;
}

export interface Reconciliation {
  finalResolved: number;
  finalMultiTier: number;
  factors: FactorRow[];
  sightings: FactorRow[];
  shares: ShareRow[];
  twiceSeen: TwiceSeen;
  recommendations: string[];
}

export interface FirstResolution {
  /** Number of votes at the first RESOLVED prefix. */
  at: number;
  k: number;
  floor: number;
}

/**
 * Replay prices in arrival order; the first prefix where N >= ceil(k * H_k * factor) for the
 * k distinct prices seen so far and the rarest of them has `sightings` sightings.
 */
export function firstResolution(
  prices: readonly number[],
  factor: number,
  sightings: number,
): FirstResolution | null {
  const counts = new Map<number, number>();
  for (let i = 0; i < prices.length; i++) {
    const price = prices[i] ?? 0;
    counts.set(price, (counts.get(price) ?? 0) + 1);
    const n = i + 1;
    const k = counts.size;
    if (n < Math.ceil(expectedDrawsUniform(k) * factor)) continue;
    let rarest = Number.POSITIVE_INFINITY;
    let floor = Number.POSITIVE_INFINITY;
    for (const [p, c] of counts) {
      if (c < rarest) rarest = c;
      if (p < floor) floor = p;
    }
    if (rarest < sightings) continue;
    return { at: n, k, floor };
  }
  return null;
}

function sweepRow(
  finals: ReadonlyArray<{ prices: number[]; k: number; floor: number }>,
  factor: number,
  sightings: number,
): FactorRow {
  let resolvedCells = 0;
  let prematureTiers = 0;
  let prematureFloor = 0;
  const at: number[] = [];
  for (const cell of finals) {
    const first = firstResolution(cell.prices, factor, sightings);
    if (first === null) continue;
    resolvedCells++;
    at.push(first.at);
    if (first.k < cell.k) prematureTiers++;
    if (first.floor > cell.floor) prematureFloor++;
  }
  return {
    factor,
    sightings,
    resolvedCells,
    prematureTiers,
    prematureFloor,
    prematureTierRate: resolvedCells === 0 ? null : prematureTiers / resolvedCells,
    prematureFloorRate: resolvedCells === 0 ? null : prematureFloor / resolvedCells,
    medianVotesAtResolve: median(at),
  };
}

export function reconcile(cells: readonly CellSummary[]): Reconciliation {
  const finals: Array<{ prices: number[]; k: number; floor: number; rarest: number }> = [];
  for (const cell of cells) {
    if (cell.resolution.status !== "RESOLVED") continue;
    finals.push({
      prices: cell.votes.map((v) => v.priceMinor),
      k: cell.resolution.tiers.length,
      floor: cell.resolution.floor,
      rarest: Math.min(...cell.resolution.tiers.map((t) => t.share)),
    });
  }

  const factors = SAFETY_FACTORS.map((f) => sweepRow(finals, f, MIN_TIER_SIGHTINGS));
  const sightings = SIGHTINGS_SWEEP.map((m) => sweepRow(finals, RESOLVE_SAFETY_FACTOR, m));

  const byK = new Map<number, number[]>();
  for (const cell of finals) {
    const list = byK.get(cell.k);
    if (list) list.push(cell.rarest);
    else byK.set(cell.k, [cell.rarest]);
  }
  const shares: ShareRow[] = [...byK.entries()]
    .sort(([a], [b]) => a - b)
    .map(([k, rarest]) => ({
      k,
      cells: rarest.length,
      rarestShareMedian: median(rarest) ?? 0,
      rarestShareMin: Math.min(...rarest),
    }));

  const twiceSeen = countTwiceSeen(finals.map((c) => c.prices));

  return {
    finalResolved: finals.length,
    finalMultiTier: finals.filter((c) => c.k > 1).length,
    factors,
    sightings,
    shares,
    twiceSeen,
    recommendations: recommend(factors, twiceSeen, finals.length),
  };
}

/** Prices that reached two sightings at some prefix, and whether they reached three by the end. */
export function countTwiceSeen(cells: ReadonlyArray<readonly number[]>): TwiceSeen {
  let tiers = 0;
  let persisted = 0;
  for (const prices of cells) {
    const counts = new Map<number, number>();
    for (const price of prices) counts.set(price, (counts.get(price) ?? 0) + 1);
    for (const count of counts.values()) {
      if (count < 2) continue;
      tiers++;
      if (count >= MIN_TIER_SIGHTINGS) persisted++;
    }
  }
  return { tiers, persisted, share: tiers === 0 ? null : persisted / tiers };
}

function recommend(factors: readonly FactorRow[], twice: TwiceSeen, resolved: number): string[] {
  const out: string[] = [];
  if (resolved < 20) {
    out.push(
      `Only ${resolved} cells resolved over the window; fewer than 20 is not enough to move a constant either way. Keep RESOLVE_SAFETY_FACTOR = ${RESOLVE_SAFETY_FACTOR} and MIN_TIER_SIGHTINGS = ${MIN_TIER_SIGHTINGS}.`,
    );
    return out;
  }
  const current = factors.find((f) => f.factor === RESOLVE_SAFETY_FACTOR);
  const rate = current?.prematureFloorRate ?? null;
  if (rate === null) {
    out.push("No cell would have resolved at the current factor; nothing to recalibrate.");
  } else if (rate <= PREMATURE_FLOOR_BUDGET) {
    out.push(
      `Premature-floor rate at factor ${RESOLVE_SAFETY_FACTOR} is ${pct(rate)}, within the ${pct(PREMATURE_FLOOR_BUDGET)} budget synth was tuned to. Keep RESOLVE_SAFETY_FACTOR = ${RESOLVE_SAFETY_FACTOR}.`,
    );
  } else {
    const enough = factors.find(
      (f) =>
        f.factor > RESOLVE_SAFETY_FACTOR &&
        f.prematureFloorRate !== null &&
        f.prematureFloorRate <= PREMATURE_FLOOR_BUDGET,
    );
    out.push(
      enough
        ? `Premature-floor rate at factor ${RESOLVE_SAFETY_FACTOR} is ${pct(rate)}, above the ${pct(PREMATURE_FLOOR_BUDGET)} budget. The smallest factor in the sweep that holds is ${enough.factor} (${pct(enough.prematureFloorRate ?? 0)}); propose RESOLVE_SAFETY_FACTOR = ${enough.factor} in packages/stats with this table as the evidence, and re-run the S09 property test.`
        : `Premature-floor rate at factor ${RESOLVE_SAFETY_FACTOR} is ${pct(rate)} and no factor up to 3 brings it inside the ${pct(PREMATURE_FLOOR_BUDGET)} budget: the rarest tier arrives too late for any factor to wait for it. That is a panel-size problem (more panelists per cell), not a constant; look at the cells before touching one.`,
    );
  }
  if (twice.share !== null && twice.tiers >= 20) {
    if (twice.share < 0.8) {
      out.push(
        `Of ${twice.tiers} prices seen twice, only ${pct(twice.share)} were seen a third time: two sightings are often noise here, which is what MIN_TIER_SIGHTINGS = ${MIN_TIER_SIGHTINGS} assumes. Keep it, or consider 4 if the sightings sweep shows fewer premature floors at 4 for an acceptable cost in resolved cells.`,
      );
    } else {
      out.push(
        `Of ${twice.tiers} prices seen twice, ${pct(twice.share)} were seen a third time: a twice-seen price is usually real. MIN_TIER_SIGHTINGS = ${MIN_TIER_SIGHTINGS} costs resolution time for little; the sightings sweep shows what 2 would have cost in premature floors.`,
      );
    }
  }
  return out;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

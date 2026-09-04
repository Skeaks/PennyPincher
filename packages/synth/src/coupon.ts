/**
 * Coupon-collector arithmetic. How many i.i.d. draws does it take to see every tier of a
 * ladder, and how many to see a rare tier enough times to trust it? These are the numbers the
 * stats engine (S09) turns into "N needed" and that the README table is generated from.
 */

/** H_k = 1 + 1/2 + ... + 1/k. */
export function harmonic(k: number): number {
  assertPositiveInt(k, "k");
  let h = 0;
  for (let i = 1; i <= k; i++) h += 1 / i;
  return h;
}

/**
 * Expected draws to see all k tiers when every tier is equally likely: k * H_k.
 * k=2 -> 3, k=3 -> 5.5, k=4 -> 8.33, k=5 -> 11.42.
 */
export function expectedDrawsUniform(k: number): number {
  return k * harmonic(k);
}

/**
 * Expected draws to see every tier of an arbitrary discrete distribution, by
 * inclusion-exclusion over subsets:  E[T] = sum over non-empty S of (-1)^(|S|+1) / P(S).
 * Exact; cost is 2^k, fine for the k <= 8 tiers the stats engine caps at.
 * Reduces to k * H_k when the probabilities are equal.
 */
export function expectedDrawsToSeeAll(probabilities: readonly number[]): number {
  const k = probabilities.length;
  if (k === 0) throw new RangeError("probabilities must not be empty");
  if (k > 20) throw new RangeError("inclusion-exclusion over more than 20 tiers is not supported");
  for (const p of probabilities) {
    if (!(p > 0 && p <= 1)) throw new RangeError(`each probability must be in (0, 1], got ${p}`);
  }
  let total = 0;
  for (let mask = 1; mask < 1 << k; mask++) {
    let pS = 0;
    let size = 0;
    for (let i = 0; i < k; i++) {
      if (mask & (1 << i)) {
        pS += probabilities[i] ?? 0;
        size++;
      }
    }
    total += (size % 2 === 1 ? 1 : -1) / pS;
  }
  return total;
}

/**
 * Expected draws until a tier of probability p has been seen `times` times: times / p
 * (mean of a negative binomial). With times = 3 this is the "~3/p" rule: a floor at 2% needs
 * about 150 observations before it has shown up three times.
 */
export function expectedDrawsForRareTier(p: number, times = 3): number {
  if (!(p > 0 && p <= 1)) throw new RangeError(`p must be in (0, 1], got ${p}`);
  assertPositiveInt(times, "times");
  return times / p;
}

/**
 * The ladder shape the README table and the floor-detection tests use: one floor tier at
 * rarity p and k-1 other tiers sharing the remaining 1-p equally. Returns the probabilities,
 * floor first.
 */
export function floorLadderProbabilities(k: number, p: number): number[] {
  assertPositiveInt(k, "k");
  if (k < 2) throw new RangeError("a floor ladder needs at least 2 tiers");
  if (!(p > 0 && p < 1)) throw new RangeError(`p must be in (0, 1), got ${p}`);
  const rest = (1 - p) / (k - 1);
  return [p, ...Array.from({ length: k - 1 }, () => rest)];
}

function assertPositiveInt(n: number, name: string): void {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`${name} must be a positive integer`);
}

/**
 * Coupon-collector arithmetic the resolver needs. `packages/synth` has a superset of this for
 * generating ground truth; the resolver must not depend on a test-data package, so the two
 * functions it uses at runtime live here and are cross-checked against synth in the tests.
 */

/** H_k = 1 + 1/2 + ... + 1/k. */
export function harmonic(k: number): number {
  if (!Number.isInteger(k) || k < 1) throw new RangeError("k must be a positive integer");
  let h = 0;
  for (let i = 1; i <= k; i++) h += 1 / i;
  return h;
}

/**
 * Expected draws to see all k tiers when every tier is equally likely: k * H_k.
 * k=2 -> 3, k=3 -> 5.5, k=4 -> 8.33, k=5 -> 11.42, k=8 -> 21.74.
 */
export function expectedDrawsUniform(k: number): number {
  return k * harmonic(k);
}

/**
 * P(T <= n): the probability that n i.i.d. draws from a discrete distribution have shown every
 * outcome at least once. Inclusion-exclusion over the set of outcomes still missing:
 *
 *   P(T <= n) = sum over subsets S of (-1)^|S| * (1 - P(S))^n
 *
 * Exact; cost is 2^k, which is nothing for the k <= 8 tiers the resolver caps at.
 * With n = 0 it is 0 (nothing seen); as n grows it tends to 1.
 */
export function probabilityAllSeen(probabilities: readonly number[], n: number): number {
  const k = probabilities.length;
  if (k === 0) throw new RangeError("probabilities must not be empty");
  if (k > 20) throw new RangeError("inclusion-exclusion over more than 20 tiers is not supported");
  if (!Number.isInteger(n) || n < 0) throw new RangeError("n must be a non-negative integer");
  for (const p of probabilities) {
    if (!(p > 0 && p <= 1)) throw new RangeError(`each probability must be in (0, 1], got ${p}`);
  }
  let total = 0;
  for (let mask = 0; mask < 1 << k; mask++) {
    let pS = 0;
    let size = 0;
    for (let i = 0; i < k; i++) {
      if (mask & (1 << i)) {
        pS += probabilities[i] ?? 0;
        size++;
      }
    }
    const remaining = Math.max(0, 1 - pS);
    total += (size % 2 === 0 ? 1 : -1) * remaining ** n;
  }
  // Floating error can push the alternating sum a hair outside [0, 1].
  return Math.min(1, Math.max(0, total));
}

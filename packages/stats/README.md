# @pennypincher/stats

Tier resolution for one cell. Give it the observations panelists were shown and it answers
with the discrete price set, each tier's share, the floor, and a confidence, or with
`UNRESOLVED` and how many more observations it would take. Tested against
`packages/synth` ground truth; it must never claim a floor below the true one.

```ts
import { explain, resolve } from "@pennypincher/stats";

const r = resolve(observations, { windowHours: 72, now: Date.now() });
// { status: "RESOLVED", tiers: [{ price, share, n }], floor, confidence, n, currency, windowHours }
// { status: "UNRESOLVED", reason, n, needed, tiersSeen, currency, windowHours }
explain(r);
// "3 prices in the last 3 days across 20 observations: $1.99 (20%), $2.49 (30%), $2.99 (50%).
//  Floor: $1.99, seen 4 times. Confidence 99% that no tier is still hidden."
```

## Rules, in the order they run

1. **Window.** Only observations with `observedAt` in `[now - windowHours, now]` count.
   Default 72 h. `now` defaults to the wall clock; pass it explicitly for as-of queries.
2. **Tiers.** Exact match on integer cents. No clustering across prices.
3. **Noise.** A price seen once is dropped when the cell has at least
   `SINGLETON_NOISE_MIN_N = 100` observations and the price sits above the lowest repeated
   one. A lone sighting *below* the floor is never dropped; it blocks resolution instead.
4. **Cap.** More than `MAX_TIERS = 8` surviving prices is `UNRESOLVED / too_many_tiers`,
   with `needed = 0` because more data will not fix a mixed cell.
5. **Coupon collector.** With k tiers seen, `RESOLVED` needs
   `N >= ceil(k * H_k * RESOLVE_SAFETY_FACTOR)` with the factor at 1.5. Otherwise
   `UNRESOLVED / insufficient_n`.
6. **Rare-tier guard.** Every tier needs `MIN_TIER_SIGHTINGS = 3` observations. Otherwise
   `UNRESOLVED / rare_tier_unconfirmed`.
7. **Confidence** is `P(all k tiers seen in N draws)` under the observed shares, by
   inclusion-exclusion. At the threshold it sits between 85% and 95% for uniform ladders.

`needed` is the larger of the two shortfalls (coupon threshold and `3/p` for the rarest
tier), so the number does not creep upward one guard at a time.

## What the property test records

Seeded fast-check over synth ladders, k in 2..5, N in 1..200, uniform and rare-floor shapes.
The counts are in the test names in `test/property.test.ts`; re-run and update them if a
constant changes.

- Floor below truth: never, in 1,000 seeds.
- At `N >= ceil(1.5 * E[T])` for the true shares: wrong tier count in 4 of 783 seeds (0.5%).

Formulas, failure modes, and a worked example are S10's README job.

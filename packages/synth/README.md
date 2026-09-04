# @pennypincher/synth

Synthetic price ladders with known ground truth. The stats engine (S09) is tested against
these long before real panel data exists, because a ladder built here has an answer known by
construction: the tiers, their shares, and the floor.

This package only generates. Resolution logic lives in `packages/stats`.

## Usage

```ts
import { generateLadder } from "@pennypincher/synth";

const ladder = generateLadder({
  tiers: [199, 249, 299],          // cents
  probabilities: [0.2, 0.3, 0.5],  // optional, default uniform
  plantFloor: { price: 149, p: 0.02 }, // optional: add a rare floor below every tier
  seed: "s09-floor-at-2pct",
});

ladder.truth;
// { prices: [149, 199, 249, 299], probabilities: [0.02, 0.196, 0.294, 0.49],
//   floor: 149, floorProbability: 0.02, k: 4 }

const observations = ladder.sample(300); // PriceObservation[], valid at SCHEMA_VERSION
```

- `sample(n)` is pure in `(options, n)`: the same call returns the same array, and
  `sample(n)` is a prefix of `sample(n + m)`. Different seeds give different streams.
- `sampleTiers(n)` returns the tier index of each observation, for tests that need labels.
- `floorRarity: p` pins the share of the lowest *existing* tier to `p` and rescales the rest.
  `plantFloor: { price, p }` adds a *new* lowest tier at `p`. Use one or the other.
- `observers: m` deals observations to `m` distinct panelists round-robin (default: every
  observation has its own panelist). `panelistId` is distinct per observer and stable per seed.
- `shell` overrides the constant parts of the observation (retailer, store, product, context).
  The default mirrors `fixtures/instacart/wegmans-bananas`.
- `validateSample(observations)` runs `parseObservationBatch` over ingest-sized batches.

### `stickiness`: real panels are worse than i.i.d.

Retailers that run price tests usually hash-assign a shopper to a tier and keep them there.
A panelist who checks a product twice is one draw, not two. `stickiness: s` in `[0, 1]`
models this: an observer's later observations repeat their previous tier with probability
`s`, and draw fresh otherwise. The marginal distribution is unchanged (the first draw is
i.i.d. and a repeat preserves the marginal), so `truth` still describes what the panel sees
in aggregate. What shrinks is the effective sample size: a stats engine tuned on i.i.d. draws
will resolve too early on a sticky panel. Test with `stickiness` around 0.8 to 1.0 and a
small `observers` count to see how much earlier. `stickiness` does nothing unless
`observers` is set, because by default nobody observes twice.

## How many observations does a ladder need?

Two coupon-collector results drive the stats engine's "N needed". Both are exported.

**Seeing every tier.** With `k` equally likely tiers, the expected number of i.i.d. draws to
see all of them is

    k · H_k,   where H_k = 1 + 1/2 + … + 1/k

so 3 draws for k = 2, 5.5 for k = 3, 8.3 for k = 4, 11.4 for k = 5 (`expectedDrawsUniform`).
For unequal shares the exact answer is inclusion-exclusion over subsets of tiers,

    E[T] = Σ_{S ≠ ∅} (−1)^{|S|+1} / P(S)

(`expectedDrawsToSeeAll(probabilities)`), which reduces to `k · H_k` when shares are equal.

**Confirming a rare tier.** A tier seen once could be a parse error. Seeing it `m` times
takes `m / p` draws in expectation (negative binomial mean). With `m = 3`, the rule is

    ~3 / p

so a floor that 2% of shoppers see needs about 150 observations before it has appeared
three times (`expectedDrawsForRareTier(p, times = 3)`).

### Expected draws to see every tier, floor at rarity `p`

Ladder shape: one floor tier at share `p`, the other `k − 1` tiers sharing `1 − p` equally
(`floorLadderProbabilities(k, p)`). Values are `expectedDrawsToSeeAll`, rounded to one
decimal. `test/coupon.test.ts` asserts these numbers, so the table cannot drift from the code.

| k \ p | 0.02 | 0.05 | 0.1 | 0.2 | 0.5 |
|---|---|---|---|---|---|
| 2 | 50.0 | 20.1 | 10.1 | 5.3 | 3.0 |
| 3 | 50.1 | 20.3 | 10.7 | 6.4 | 6.3 |
| 4 | 50.4 | 21.0 | 11.9 | 8.5 | 11.1 |
| 5 | 50.9 | 22.0 | 13.7 | 11.4 | 16.7 |
| **3 / p** | **150** | **60** | **30** | **15** | **6** |

Two things to read off it. When the floor is rare, `N` is governed by `1 / p` and barely
depends on `k`: the other tiers show up long before the floor does. When the floor is common
(`p = 0.5`), the floor is no longer the bottleneck and `N` grows with `k` because the
remaining tiers are each rarer. And the last row is always the larger number: seeing every
tier once is not the same as trusting the rare one. S09's `RESOLVED` requires both.

# @pennypincher/stats

Tier resolution for one cell. Give it the observations panelists were shown and it answers
with the discrete price set, each tier's share, the floor, and a confidence, or with
`UNRESOLVED` and how many more observations it would take. Tested against
`packages/synth` ground truth; it must never claim a floor below the true one.

```ts
import { detectShift, explain, resolve } from "@pennypincher/stats";

const r = resolve(observations, { windowHours: 72, now: Date.now() });
// { status: "RESOLVED", tiers: [{ price, share, n }], floor, confidence, n, currency, windowHours }
// { status: "UNRESOLVED", reason, n, needed, tiersSeen, currency, windowHours }
explain(r);
// "3 prices in the last 3 days across 20 observations: $1.99 (20%), $2.49 (30%), $2.99 (50%).
//  Floor: $1.99, seen 4 times. Confidence 99% that no tier is still hidden."

detectShift(observations); // EXPERIMENTAL: { shifted: boolean, at?: ISO, inconclusive?: reason }
```

Only `facts.price.amountMinor` and `observedAt` are read. Nothing here looks at who observed
what; see "Failure modes" for why that matters.

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

## The formulas

**Expected draws to see every tier.** With `k` equally likely tiers, the expected number of
i.i.d. draws until every one has appeared is the coupon-collector mean

    E[T] = k · H_k,   H_k = 1 + 1/2 + … + 1/k

so 3 for k = 2, 5.5 for k = 3, 8.3 for k = 4, 11.4 for k = 5, 21.7 for k = 8
(`expectedDrawsUniform`). The resolver uses the uniform formula on the *observed* k because
it does not know the true shares; the property test checks it against the exact expectation
for the true shares (`expectedDrawsToSeeAll` in synth, inclusion-exclusion over subsets),
which is larger whenever the shares are unequal.

**Required N.** `requiredObservations(k) = ceil(k · H_k · 1.5)`: 2, 5, 9, 13, 18 for
k = 1..5, 33 for k = 8.

**Confirming a rare tier.** A tier of share `p` takes `m / p` draws in expectation to be seen
`m` times (negative binomial mean). With `m = MIN_TIER_SIGHTINGS = 3` this is the `~3/p`
rule. The resolver estimates `p` as `rarest.n / N` and projects `ceil(3 · N / rarest.n)`.

**Confidence.** The probability that `N` i.i.d. draws from shares `p_1..p_k` have shown every
tier:

    P(T ≤ N) = Σ_{S ⊆ tiers} (−1)^|S| · (1 − P(S))^N

(`probabilityAllSeen`). Exact, cost `2^k`, nothing at `k ≤ 8`. It is a statement about the
ladder as observed: *if* these are the tiers at these shares, this is how likely `N` draws
were to reveal them all. It says nothing about a tier that has never been seen, which is why
the coupon threshold and the rare-tier guard exist alongside it.

## The constants and why

| Constant | Value | Why this value |
|---|---|---|
| `RESOLVE_SAFETY_FACTOR` | 1.5 | At exactly `E[T]` the collector has finished only 55 to 60% of the time. 1.5× lifts that to 85 to 90% for k in 2..8. Tuned against synth: 0.5% wrong tier counts above threshold, under the 2% budget. |
| `MIN_TIER_SIGHTINGS` | 3 | One sighting is a misparse; two can be the same shopper twice. Three is the smallest count that is not explained by either. |
| `SINGLETON_NOISE_MIN_N` | 100 | At N ≥ 100 a singleton is at most a 1% share, which is below what 3 sightings could confirm inside a 72 h window anyway. Below 100, dropping singletons is how a real rare tier disappears from the answer (S09 measured this: far above the 2% budget). |
| `MAX_TIERS` | 8 | Real ladders have two to five prices. More than eight distinct repeated prices is a mixed cell, not a ladder. |
| `DEFAULT_WINDOW_HOURS` | 72 | Long enough for a small panel to fill a cell, short enough that a mid-window price change does not blend two ladders for long. |

The property tests pin the numbers these produce. Changing a constant means re-running them
and updating the counts in the test names, and saying why in the PR.

## Worked example, from synth

A three-tier ladder at 199, 249, 299 cents with the floor pinned to a 10% share
(`generateLadder({ tiers: [199, 249, 299], floorRarity: 0.1, seed })`), so the true shares are
0.10, 0.45, 0.45.

- The exact expectation to see all three is `expectedDrawsToSeeAll([0.1, 0.45, 0.45]) ≈ 10.7`,
  and `3/p` for the floor is 30. The floor, not the tier count, is the bottleneck.
- Seed 2 at N = 20 has shown the floor twice: `UNRESOLVED / rare_tier_unconfirmed`,
  `needed: 40` (the projection `3 · 20 / 2 − 20`). `explain` says: *"20 observations in the
  last 3 days show 3 distinct prices, but the rarest has been seen fewer than 3 times. About
  40 more needed to confirm it."*
- The same seed at N = 50 has shown the floor exactly three times and resolves:

  ```
  3 prices in the last 3 days across 50 observations: $1.99 (6%), $2.49 (42%), $2.99 (52%).
  Floor: $1.99, seen 3 times. Confidence 95% that no tier is still hidden.
  ```

  The 95% is `probabilityAllSeen([0.06, 0.42, 0.52], 50)`: under the shares as observed,
  a 5% chance that 50 draws would have missed a tier this rare. Seeds 1 and 3 resolve
  already at N = 20 because their floor happened to show up 3 and 4 times; that is what the
  rare-tier guard is for, and why `needed` is a point estimate that sometimes needs a second
  round.
- At N = 50, 90% of seeds return `RESOLVED` with all three tiers (`test/sticky.test.ts`,
  the i.i.d. column).
- Across 1,000 seeded cases (k in 2..5, N in 1..200, uniform and rare-floor shapes), the
  resolver never reports a floor below the truth, and above threshold it reports the wrong
  tier count in 4 of 783 cases (0.5%). In two of the four a rare floor (6% and 5% shares)
  had not appeared yet and the reported floor is *above* the truth; in the other two a middle
  tier of a five-tier uniform ladder was still missing at N = 22 and N = 30. Never below.

## Failure modes

**A wrong floor is always a floor that is too high, never too low.** Exact-cents tiers cannot
invent a price, so a reported floor is always a price someone was shown. What the engine can
get wrong is *missing* a rare tier and calling the cell resolved above it. Everything below
is a way that happens more often.

**Serial correlation (sticky panels).** The threshold is calibrated on i.i.d. draws. Real
panels are not: retailers hash-assign a shopper to a tier and keep them there, so a panelist
who checks twice is one draw, not two. Synth models this as `stickiness` (probability a
repeat observer sees their previous tier) over `observers` distinct panelists. The resolver
reads nothing about who observed what, so on a sticky panel it counts repeats as evidence and
resolves too early. Measured over the same 1,000 cases as above (`test/sticky.test.ts`):

| Sampling | Wrong tier count above threshold |
|---|---|
| i.i.d. | 4 of 783 (0.5%) |
| stickiness 0.8, 10 observers | 36 (4.6%) |
| stickiness 0.9, 20 observers | 25 (3.2%) |
| stickiness 0.9, 10 observers | 69 (8.8%) |
| stickiness 0.9, 5 observers | 120 (15.3%) |
| stickiness 1.0, 20 observers | 45 (5.7%) |
| stickiness 1.0, 10 observers | 178 (22.7%) |

The floor is still never below the truth. How much more N it takes, as the smallest N at
which 90% of seeds resolve with the right tier count:

| Ladder | i.i.d. | 0.5 / 10 obs. | 0.9 / 10 obs. | 0.9 / 20 obs. | 1.0 / 10 obs. | 1.0 / 20 obs. | 1.0 / 40 obs. |
|---|---|---|---|---|---|---|---|
| 3 uniform tiers | 20 | 25 | 30 | 20 | 30 | 20 | 20 |
| 3 tiers, floor at 10% | 50 | 80 | 180 | 150 | never | never | 60 |

Two things to read off it. A common floor is barely affected: the panel sees it regardless.
A rare floor is governed by *independent* draws, roughly `observers + (N − observers)(1 − s)`,
so at stickiness 0.9 the same 3/p = 30 independent looks cost about 3.6× the observations,
and at stickiness 1.0 a cell holds at most `observers` draws no matter how long it runs: with
10 or 20 pinned observers a 10% floor is confirmed only by luck. **The fix is not more
observations; it is counting distinct panelists per tier.** That needs `panelistId` in the
input, which `ObservationLike` deliberately does not carry yet. Follow-up for S11 (the query
endpoint can dedupe per panelist per cell before calling `resolve`) or S14.

**A price change inside the window.** Two ladders blend into one: the old floor stays in the
tier list after the retailer has raised it. The window bounds how long; `detectShift` is the
first attempt at seeing it.

**Mixed cells.** Two products, two units, or two stores under one key show up as too many
tiers (`too_many_tiers`) when the mix is wide, and as a plausible ladder when it is narrow.
The resolver cannot tell the difference; product identity (S13) has to.

**Estimates.** `facts.isEstimate` observations (by-weight produce) are not filtered. Flagged
in S09, still open.

## `detectShift`: change-point stub (EXPERIMENTAL)

`detectShift(observations)` asks whether the price level moved during the data given. It
returns `{ shifted: true, at }` with `at` the `observedAt` of the first observation of the
block the change is placed in, `{ shifted: false }` when it ran and saw nothing, or
`{ shifted: false, inconclusive }` when it could not run. Nothing consumes it yet; S11
decides how, and should not show it for a cell where it is inconclusive.

How it works: a two-sided CUSUM on the median price of consecutive blocks.

1. Sort by `observedAt`; cut into blocks of `SHIFT_BLOCK_SIZE = 10`. Fewer than two full
   blocks is `inconclusive: "too_few_blocks"`.
2. Each block's statistic is its lower median, so it is always a real price. If the mean share
   of that median inside its block is below `SHIFT_MIN_MEDIAN_SHARE = 0.7`, the medians are
   flipping between tiers on ordinary A/B noise and the answer is
   `inconclusive: "no_dominant_price"`.
3. Reference level `μ0` = median of the first `SHIFT_REFERENCE_BLOCKS = 3` block medians.
   Each block becomes `x_j = (m_j − μ0) / μ0`, a relative move.
4. Noise scale `σ = max(SHIFT_MIN_SCALE = 0.02, sd(x))`. The floor stops a ladder whose medians
   never move from treating a one-cent wobble as an infinite-sigma event.
5. Textbook CUSUM in sigma units: `S⁺ = max(0, S⁺ + z − k)`, `S⁻ = max(0, S⁻ − z − k)` with
   slack `k = SHIFT_SLACK = 0.5` and alarm at `h = SHIFT_THRESHOLD = 4`. `at` is the start of
   the run that alarmed, the usual CUSUM change-point estimate.

What it does on synth (`test/shift.test.ts`, 200 seeds each, a 10/80/10 ladder):

- Stable, 200 observations: 0 alarms. A single price: 0 alarms.
- Every tier raised 5% / 10% / 25% after 100 observations: found in 194 / 200 / 200 seeds,
  at the exact block in 192 / 198 / 199, never more than two blocks late.
- Every tier cut 10%: found in 200, exact in 198, the other two up to five blocks early.
- Late (150 then 50) and early (30 then 170) shifts: found in 200, exact in 198.

Where it fails, by design rather than by accident:

- **Near-uniform ladders.** Three uniform tiers, two tiers at 50/50, a 10/45/45 ladder: the
  block median is a coin flip, and before the guard existed the false-alarm rate on a
  *stable* ladder was 46%, 92% and 76%. With the guard these come back `no_dominant_price`
  in 200 of 200 seeds, shifted or not. The detector simply does not work on them; a 70/15/15
  ladder sits on the guard and is inconclusive in some seeds.
- **The scale is estimated from all blocks, shift included.** That inflates `σ` when a big
  shift covers half the data, which costs sensitivity in the direction of *fewer* alarms.
- **Blocks are counts, not time.** Ten observations can span a minute of synth or a day of a
  thin cell. `at` is only as fine as the block.
- **A run that restarts.** A post-shift block whose median falls back to the old level resets
  the CUSUM, so `at` lands a block or two late in about 1% of seeds.

## What the property tests record

Seeded fast-check over synth ladders, k in 2..5, N in 1..200, uniform and rare-floor shapes.
The counts are in the test names; re-run and update them if a constant changes.

- `test/property.test.ts` (S09): floor below truth, never, in 1,000 seeds. Wrong tier count
  above threshold: 4 of 783 (0.5%). `needed` gets 220 of 436 UNRESOLVED cells to RESOLVED in
  one step.
- `test/sticky.test.ts` (S10): floor below truth, never, at stickiness 0.9 over 10 observers
  and at stickiness 1 over 5. The degradation and N tables above.
- `test/shift.test.ts` (S10): the `detectShift` numbers above.

## Mutation testing

`pnpm --filter @pennypincher/stats mutation` runs Stryker over `src/` with the Vitest runner
(`stryker.config.json`). It runs in `nightly.yml`, never on the PR gate. For the first two
weeks from 2026-09-07 the score is reported (`low: 60`) and does not fail the run
(`break: null`); after that, set `break` to the observed score minus 5. The report is the
console summary only for now: the html and json reporters write to `reports/`, which the
root Biome config does not ignore, so the gate would fail after a local run; switch them on
once `biome.json` ignores that directory (a gate PR, Jamie). First measurement,
2026-09-07: 88.4% (412 mutants, 360 killed, 39 survived, 9 without coverage), 5 minutes at
concurrency 6, so `break: 83` is the number to set around 2026-09-21. The HTML report lands
in `reports/mutation/` (gitignored). `packages/normalize` does not exist yet (S13); add it to
the nightly step when it does.

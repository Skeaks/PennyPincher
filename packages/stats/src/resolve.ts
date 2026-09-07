/**
 * Tier resolution for one cell (one product, one retailer, one store, one context).
 *
 * Given the observations panelists were shown, infer the discrete set of prices the retailer
 * is running, the share of shoppers landing on each, and the floor. When the data cannot
 * support that answer, say UNRESOLVED and how many more observations it would take. A
 * confidently wrong floor is the worst output this product can produce, so every rule below
 * errs toward UNRESOLVED.
 *
 * Only the price and the timestamp are read. Nothing here looks at who observed what.
 */
import { expectedDrawsUniform, probabilityAllSeen } from "./coupon";

/**
 * The slice of a `PriceObservation` the resolver reads. Structural, so callers can pass full
 * observations from `@pennypincher/schema` or the narrower rows a query endpoint selects.
 */
export interface ObservationLike {
  /** ISO-8601 instant. Observations outside the window are ignored. */
  observedAt: string;
  facts: {
    price: {
      /** Integer minor units (cents). Tiers are exact matches on this number. */
      amountMinor: number;
      /** ISO-4217 code. Reported back so `explain` can format prices. */
      currency?: string;
    };
  };
}

export interface ResolveOptions {
  /**
   * Only observations within this many hours before `now` count. Default 72: long enough
   * for a small panel to accumulate a cell, short enough that a price change (S10 detects
   * those) does not blend two ladders into one for long.
   */
  windowHours?: number;
  /**
   * The instant the window ends at. Default: the current wall clock. Tests and as-of queries
   * pass a fixed instant. Accepts an ISO string, epoch milliseconds, or a Date. Observations
   * dated after `now` do not count.
   */
  now?: string | number | Date;
}

export interface Tier {
  /** Integer minor units. */
  price: number;
  /** Fraction of the tier observations that landed here. Shares across tiers sum to 1. */
  share: number;
  /** Observations at exactly this price. */
  n: number;
}

export interface Resolved {
  status: "RESOLVED";
  /** Ascending by price. Between 1 and MAX_TIERS entries. */
  tiers: Tier[];
  /** `tiers[0].price`: the lowest confirmed tier. */
  floor: number;
  /**
   * Coupon-collector confidence in [0, 1]: if the ladder really is these tiers at these
   * shares, the probability that `n` draws would have revealed every one of them. Low when
   * the cell only just cleared the threshold, near 1 well past it.
   */
  confidence: number;
  /** Observations inside the window, including any dropped as noise. */
  n: number;
  currency: string;
  windowHours: number;
}

export type UnresolvedReason =
  /** No observations in the window at all. */
  | "no_observations"
  /** Fewer than the coupon-collector threshold for the number of tiers seen. */
  | "insufficient_n"
  /** The rarest tier (often the floor) has been seen fewer than MIN_TIER_SIGHTINGS times. */
  | "rare_tier_unconfirmed"
  /** More than MAX_TIERS distinct repeated prices. More data will not fix this. */
  | "too_many_tiers";

export interface Unresolved {
  status: "UNRESOLVED";
  reason: UnresolvedReason;
  /** Observations inside the window. */
  n: number;
  /**
   * Estimated additional observations before this cell can resolve. 0 when more data cannot
   * help (`too_many_tiers`).
   */
  needed: number;
  /** Distinct prices seen after noise dropping. Informational. */
  tiersSeen: number;
  currency: string;
  windowHours: number;
}

export type Resolution = Resolved | Unresolved;

export const DEFAULT_WINDOW_HOURS = 72;

/**
 * The resolver never reports more tiers than this. Real ladders have two to five prices; a
 * cell with more than eight distinct repeated prices is mixing products, units, or a price
 * that moved during the window, and no amount of data makes that a ladder.
 */
export const MAX_TIERS = 8;

/**
 * Safety factor on the coupon-collector expectation. E[T] = k * H_k is the AVERAGE number of
 * draws to see all k equally likely tiers; at exactly E[T] the collector has finished only
 * about 55 to 60% of the time. Requiring 1.5 * E[T] lifts that to roughly 85 to 90% for
 * k in 2..8 (see `probabilityAllSeen`), which is where "RESOLVED" starts to mean something.
 * The rare-tier guard below covers the rest. Tuned against synth ground truth by the
 * property test; do not change without re-running it and updating its recorded numbers.
 */
export const RESOLVE_SAFETY_FACTOR = 1.5;

/**
 * Every reported tier, and in particular the floor, must have been seen at least this many
 * times. One sighting is a misparse or a one-off; two can be the same shopper twice. Three
 * is the "~3/p" rule the synth README table is built on.
 */
export const MIN_TIER_SIGHTINGS = 3;

/**
 * Noise threshold. A price seen exactly once (a singleton) in a cell with at least this many
 * observations is dropped as noise: at N >= 100 it is at most a 1% share, adapter misparses
 * and one-off coupons look exactly like it, and a genuine tier that rare is below what this
 * resolver can confirm anyway (MIN_TIER_SIGHTINGS at 1% needs ~300 observations).
 *
 * Below this N a singleton is kept as a tier, which through the rare-tier guard keeps the
 * cell UNRESOLVED until the price repeats or the cell grows. That is deliberate: dropping a
 * singleton early is how a real rare tier disappears from the answer.
 *
 * A singleton BELOW the floor is never dropped, at any N. It might be the real floor, and the
 * floor is the one number this engine must not get wrong; it blocks resolution instead.
 */
export const SINGLETON_NOISE_MIN_N = 100;

/** N required for k tiers: ceil(k * H_k * RESOLVE_SAFETY_FACTOR). */
export function requiredObservations(k: number): number {
  return Math.ceil(expectedDrawsUniform(k) * RESOLVE_SAFETY_FACTOR);
}

export function resolve(
  observations: readonly ObservationLike[],
  options: ResolveOptions = {},
): Resolution {
  const windowHours = options.windowHours ?? DEFAULT_WINDOW_HOURS;
  if (!(Number.isFinite(windowHours) && windowHours > 0)) {
    throw new RangeError(`windowHours must be a positive number, got ${windowHours}`);
  }
  const nowMs = toEpochMs(options.now ?? Date.now());
  const startMs = nowMs - windowHours * 3_600_000;

  const inWindow = observations.filter((o) => {
    const t = Date.parse(o.observedAt);
    return !Number.isNaN(t) && t >= startMs && t <= nowMs;
  });
  const n = inWindow.length;
  const currency = inWindow[0]?.facts.price.currency ?? "USD";

  if (n === 0) {
    return {
      status: "UNRESOLVED",
      reason: "no_observations",
      n,
      needed: requiredObservations(2),
      tiersSeen: 0,
      currency,
      windowHours,
    };
  }

  const counts = new Map<number, number>();
  for (const o of inWindow) {
    const price = o.facts.price.amountMinor;
    if (!Number.isInteger(price) || price < 0) {
      throw new RangeError(`amountMinor must be a non-negative integer, got ${price}`);
    }
    counts.set(price, (counts.get(price) ?? 0) + 1);
  }
  const kept = dropNoise(counts, n);

  if (kept.length > MAX_TIERS) {
    return {
      status: "UNRESOLVED",
      reason: "too_many_tiers",
      n,
      needed: 0,
      tiersSeen: kept.length,
      currency,
      windowHours,
    };
  }

  const k = kept.length;
  const required = requiredObservations(k);
  const rarest = kept.reduce((a, b) => (b.n < a.n ? b : a));
  // Under the observed share p = rarest.n / n, seeing it MIN_TIER_SIGHTINGS times takes
  // about MIN_TIER_SIGHTINGS / p draws in total (the ~3/p rule).
  const rareProjected = Math.ceil((MIN_TIER_SIGHTINGS * n) / rarest.n);
  // Both guards must clear before RESOLVED, so the shortfall is the larger of the two;
  // reporting only the first would make "needs N more" creep upward one guard at a time.
  const needed = Math.max(required, rarest.n < MIN_TIER_SIGHTINGS ? rareProjected : 0) - n;

  if (n < required) {
    return {
      status: "UNRESOLVED",
      reason: "insufficient_n",
      n,
      needed,
      tiersSeen: k,
      currency,
      windowHours,
    };
  }

  if (rarest.n < MIN_TIER_SIGHTINGS) {
    return {
      status: "UNRESOLVED",
      reason: "rare_tier_unconfirmed",
      n,
      needed: Math.max(1, needed),
      tiersSeen: k,
      currency,
      windowHours,
    };
  }

  const total = kept.reduce((sum, t) => sum + t.n, 0);
  const tiers: Tier[] = kept.map((t) => ({ price: t.price, share: t.n / total, n: t.n }));
  const confidence = probabilityAllSeen(
    tiers.map((t) => t.share),
    n,
  );
  return {
    status: "RESOLVED",
    tiers,
    floor: tiers[0]?.price ?? 0,
    confidence,
    n,
    currency,
    windowHours,
  };
}

interface Counted {
  price: number;
  n: number;
}

/**
 * Apply the singleton rule (see SINGLETON_NOISE_MIN_N) and return the surviving tiers
 * ascending by price.
 */
function dropNoise(counts: Map<number, number>, n: number): Counted[] {
  const all: Counted[] = [...counts.entries()]
    .map(([price, c]) => ({ price, n: c }))
    .sort((a, b) => a.price - b.price);
  if (n < SINGLETON_NOISE_MIN_N) return all;

  const candidateFloor = all.find((t) => t.n >= 2)?.price;
  // Every price is a singleton: nothing is confirmed, so drop nothing.
  if (candidateFloor === undefined) return all;

  return all.filter((t) => t.n >= 2 || t.price < candidateFloor);
}

function toEpochMs(value: string | number | Date): number {
  let ms: number;
  if (value instanceof Date) ms = value.getTime();
  else if (typeof value === "number") ms = value;
  else ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new RangeError(`now is not a valid instant: ${String(value)}`);
  return ms;
}

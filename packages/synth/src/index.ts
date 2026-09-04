/**
 * @pennypincher/synth — synthetic price ladders with known ground truth.
 *
 * A "ladder" is the discrete set of prices a retailer is showing for one product in one cell,
 * with the share of shoppers who see each. Real ladders will not exist as data until the
 * panel runs (S16). This package builds ladders whose answer is known by construction so the
 * stats engine (S09) can be tested against them: "did it find the floor at ~3/p draws", "did
 * it say UNRESOLVED below k * H_k".
 *
 * It only generates. No resolution logic lives here (S09).
 */
import {
  type Fulfillment,
  type PriceObservation,
  type Retailer,
  SCHEMA_VERSION,
  type SessionState,
  parseObservationBatch,
} from "@pennypincher/schema";
import { hexFrom, mulberry32, seedState, uuidFrom } from "./prng";

export {
  expectedDrawsForRareTier,
  expectedDrawsToSeeAll,
  expectedDrawsUniform,
  floorLadderProbabilities,
  harmonic,
} from "./coupon";
export { uuidFrom } from "./prng";

/** Version stamped into `provenance.adapter` as `synth@<SYNTH_VERSION>`. */
export const SYNTH_VERSION = "0.1.0" as const;

export interface LadderOptions {
  /** Tier prices in minor units (cents). Distinct positive integers, any order. */
  tiers: number[];
  /**
   * Share of observations that land on each tier, aligned with `tiers`. Must sum to 1.
   * Default: uniform.
   */
  probabilities?: number[];
  /**
   * Pin the share of the lowest tier to this rarity p in (0, 1); the other tiers are rescaled
   * to share 1 - p in their existing proportions. Use when the floor is one of `tiers`.
   */
  floorRarity?: number;
  /**
   * Add a NEW tier below every existing one, at rarity p. The existing tiers are rescaled to
   * share 1 - p. Floor-detection tests use this to ask "did we find it at ~3/p draws".
   */
  plantFloor?: { price: number; p: number };
  /** Any number or string. Same seed, same options, same observations. */
  seed: number | string;
  /**
   * Serial correlation for repeat observers, in [0, 1]. 0 (default) is i.i.d. At s, an
   * observer's later observations repeat their previous tier with probability s and draw
   * fresh otherwise. The marginal distribution is unchanged; the effective sample size
   * shrinks. Real panels are worse than i.i.d.: retailers hash-assign shoppers to a price
   * and keep them there, so a panelist who checks twice is one draw, not two. Set `observers`
   * to make anyone observe more than once.
   */
  stickiness?: number;
  /**
   * Number of distinct panelists. Observations are dealt to them round-robin. Default: every
   * observation comes from its own panelist (no repeats, so `stickiness` has no effect).
   */
  observers?: number;
  /** Shell of the observation. Defaults mirror fixtures/instacart/wegmans-bananas. */
  shell?: Partial<ObservationShell>;
}

/** The parts of an observation the ladder does not vary. */
export interface ObservationShell {
  retailer: Retailer;
  store: { retailerStoreId?: string; label?: string };
  retailerSku: string;
  title: string;
  url: string;
  fulfillment: Fulfillment;
  sessionState: SessionState;
  zip3: string;
  /** First `observedAt`; observation i is `i` minutes later. */
  startAt: string;
}

export interface LadderTruth {
  /** Ascending. `prices[i]` is seen with probability `probabilities[i]`. */
  prices: number[];
  probabilities: number[];
  /** `prices[0]`. */
  floor: number;
  /** `probabilities[0]`. */
  floorProbability: number;
  /** Number of tiers, k. */
  k: number;
}

export interface Ladder {
  truth: LadderTruth;
  /**
   * `n` observations. Pure in (options, n): the same call returns the same array, and
   * `sample(n)` is a prefix of `sample(n + m)`.
   */
  sample(n: number): PriceObservation[];
  /** The tier index of each observation in `sample(n)`, for tests that need the label. */
  sampleTiers(n: number): number[];
}

const DEFAULT_SHELL: ObservationShell = {
  retailer: "instacart",
  store: { retailerStoreId: "10769", label: "Wegmans" },
  retailerSku: "2748189",
  title: "Bananas, Sold by the Each",
  url: "https://www.instacart.com/products/2748189-banana-each",
  fulfillment: "delivery",
  sessionState: "logged_in",
  zip3: "085",
  startAt: "2026-09-04T15:26:18.000Z",
};

const PROBABILITY_TOLERANCE = 1e-9;

export function generateLadder(options: LadderOptions): Ladder {
  const truth = buildTruth(options);
  const stickiness = options.stickiness ?? 0;
  if (!(stickiness >= 0 && stickiness <= 1)) {
    throw new RangeError(`stickiness must be in [0, 1], got ${stickiness}`);
  }
  const observers = options.observers ?? Number.POSITIVE_INFINITY;
  if (observers !== Number.POSITIVE_INFINITY && !(Number.isInteger(observers) && observers > 0)) {
    throw new RangeError(`observers must be a positive integer, got ${observers}`);
  }
  const shell: ObservationShell = { ...DEFAULT_SHELL, ...options.shell };
  const startMs = Date.parse(shell.startAt);
  if (Number.isNaN(startMs)) throw new RangeError(`shell.startAt is not a date: ${shell.startAt}`);

  const cumulative: number[] = [];
  let acc = 0;
  for (const p of truth.probabilities) {
    acc += p;
    cumulative.push(acc);
  }
  const draw = (u: number): number => {
    for (let i = 0; i < cumulative.length; i++) {
      if (u < (cumulative[i] ?? 1)) return i;
    }
    return cumulative.length - 1;
  };

  const sampleTiers = (n: number): number[] => {
    if (!Number.isInteger(n) || n < 0) throw new RangeError("n must be a non-negative integer");
    const rng = mulberry32(seedState(options.seed, "tiers"));
    const last = new Map<number, number>();
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const observer = observers === Number.POSITIVE_INFINITY ? i : i % observers;
      const prev = last.get(observer);
      // Two draws per observation regardless of branch, so the stream stays aligned.
      const uStick = rng();
      const uTier = rng();
      const tier = prev !== undefined && uStick < stickiness ? prev : draw(uTier);
      last.set(observer, tier);
      out.push(tier);
    }
    return out;
  };

  const sample = (n: number): PriceObservation[] => {
    const tiers = sampleTiers(n);
    return tiers.map((tier, i) => {
      const observer = observers === Number.POSITIVE_INFINITY ? i : i % observers;
      const price = truth.prices[tier] ?? truth.floor;
      return {
        schemaVersion: SCHEMA_VERSION,
        observationId: uuidFrom(options.seed, `observation:${i}`),
        panelistId: uuidFrom(options.seed, `panelist:${observer}`),
        observedAt: new Date(startMs + i * 60_000).toISOString(),
        retailer: shell.retailer,
        store: shell.store,
        product: { retailerSku: shell.retailerSku, title: shell.title, url: shell.url },
        facts: {
          price: { amountMinor: price, currency: "USD" },
          priceText: formatUsd(price),
          isEstimate: false,
          promoTags: [],
          memberPrice: false,
        },
        context: {
          fulfillment: shell.fulfillment,
          sessionState: shell.sessionState,
          surface: "web",
          zip3: shell.zip3,
          device: "desktop",
        },
        provenance: {
          adapter: `synth@${SYNTH_VERSION}`,
          clientVersion: "0.0.0",
          evidenceHash: hexFrom(mulberry32(seedState(options.seed, `evidence:${i}`)), 64),
        },
      };
    });
  };

  return { truth, sample, sampleTiers };
}

/** Resolve tiers + probabilities + floorRarity + plantFloor into the sorted truth. */
export function buildTruth(options: LadderOptions): LadderTruth {
  const { tiers } = options;
  if (tiers.length === 0) throw new RangeError("tiers must not be empty");
  for (const t of tiers) {
    if (!Number.isInteger(t) || t <= 0) {
      throw new RangeError(`tier prices are positive integers in minor units, got ${t}`);
    }
  }
  if (new Set(tiers).size !== tiers.length) throw new RangeError("tier prices must be distinct");

  let probabilities: number[];
  if (options.probabilities === undefined) {
    probabilities = tiers.map(() => 1 / tiers.length);
  } else {
    if (options.probabilities.length !== tiers.length) {
      throw new RangeError("probabilities must have one entry per tier");
    }
    for (const p of options.probabilities) {
      if (!(p > 0 && p <= 1)) throw new RangeError(`each probability must be in (0, 1], got ${p}`);
    }
    const sum = options.probabilities.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > PROBABILITY_TOLERANCE) {
      throw new RangeError(`probabilities must sum to 1, got ${sum}`);
    }
    probabilities = [...options.probabilities];
  }

  // Sort ascending, carrying probabilities along.
  const order = tiers.map((_, i) => i).sort((a, b) => (tiers[a] ?? 0) - (tiers[b] ?? 0));
  let prices = order.map((i) => tiers[i] ?? 0);
  probabilities = order.map((i) => probabilities[i] ?? 0);

  if (options.floorRarity !== undefined) {
    const p = options.floorRarity;
    if (!(p > 0 && p < 1)) throw new RangeError(`floorRarity must be in (0, 1), got ${p}`);
    if (prices.length < 2) throw new RangeError("floorRarity needs at least 2 tiers");
    const restSum = probabilities.slice(1).reduce((a, b) => a + b, 0);
    probabilities = [p, ...probabilities.slice(1).map((q) => (q / restSum) * (1 - p))];
  }

  if (options.plantFloor !== undefined) {
    const { price, p } = options.plantFloor;
    if (!Number.isInteger(price) || price <= 0) {
      throw new RangeError(`plantFloor.price must be a positive integer, got ${price}`);
    }
    if (price >= (prices[0] ?? 0)) {
      throw new RangeError(`plantFloor.price ${price} must be below the lowest tier ${prices[0]}`);
    }
    if (!(p > 0 && p < 1)) throw new RangeError(`plantFloor.p must be in (0, 1), got ${p}`);
    prices = [price, ...prices];
    probabilities = [p, ...probabilities.map((q) => q * (1 - p))];
  }

  return {
    prices,
    probabilities,
    floor: prices[0] ?? 0,
    floorProbability: probabilities[0] ?? 0,
    k: prices.length,
  };
}

/** "$0.22", "$12.00". */
export function formatUsd(amountMinor: number): string {
  const dollars = Math.floor(amountMinor / 100);
  const cents = amountMinor % 100;
  return `$${dollars}.${String(cents).padStart(2, "0")}`;
}

/**
 * Run the schema over a sample in ingest-sized batches. Convenience for tests: returns the
 * error strings, empty when everything validates.
 */
export function validateSample(observations: PriceObservation[]): string[] {
  const errors: string[] = [];
  for (let i = 0; i < observations.length; i += 200) {
    const r = parseObservationBatch({ observations: observations.slice(i, i + 200) });
    if (!r.ok) errors.push(...r.errors);
  }
  return errors;
}

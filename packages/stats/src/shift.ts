/**
 * Change-point stub: did the price level move during the window?
 *
 * EXPERIMENTAL. `resolve` assumes one ladder for the whole window; when the retailer moves
 * the price mid-window, two ladders blend and the result is wrong in a way the coupon
 * collector cannot see. This is the first, deliberately simple detector for that: a two-sided
 * CUSUM on the median price of consecutive blocks of observations.
 *
 * Nothing consumes it yet (S11 decides how to show it). Read `README.md` for the constants,
 * the failure modes, and why a near-uniform ladder fools it.
 */

export interface ShiftDetection {
  shifted: boolean;
  /**
   * When `shifted`: the `observedAt` of the first observation of the block where the
   * alarming CUSUM run began, i.e. the estimated change point. Undefined otherwise.
   */
  at?: string;
  /**
   * When not `shifted` because the detector could not run, why. Absent when it ran and saw
   * no shift. `no_dominant_price`: the block medians are not stable enough to compare (a
   * near-uniform ladder); `too_few_blocks`: fewer than two full blocks.
   */
  inconclusive?: "too_few_blocks" | "no_dominant_price";
}

export interface ShiftParameters {
  /** Observations per block. */
  blockSize: number;
  /** Floor on the noise scale, in relative price units. */
  minScale: number;
  /** Slack, in units of the noise scale. */
  slack: number;
  /** Alarm threshold, in units of the noise scale. */
  threshold: number;
  /** Minimum mean within-block share of the block median for the medians to be trusted. */
  minMedianShare: number;
  /** Blocks at the start whose medians set the reference (pre-change) level. */
  referenceBlocks: number;
}

/**
 * Observations per block. Ten is the smallest block whose median is stable on a ladder with a
 * dominant tier; smaller blocks flip between tiers on ordinary A/B noise.
 */
export const SHIFT_BLOCK_SIZE = 10;
/**
 * Floor on the noise scale, as a fraction of the reference median. Without it a ladder whose
 * block medians never move would treat a one-cent wobble as an infinite-sigma event. 2% is
 * below any price move worth flagging.
 */
export const SHIFT_MIN_SCALE = 0.02;
/** CUSUM slack k = delta / 2 with delta = 1 sigma: the smallest shift worth accumulating. */
export const SHIFT_SLACK = 0.5;
/** CUSUM alarm threshold h, in sigmas. 4 is the textbook choice for ARL ~ hundreds of blocks. */
export const SHIFT_THRESHOLD = 4;

/**
 * The block median is only a stable statistic when one price holds most of each block. Below
 * this mean within-block share the medians flip between tiers on ordinary A/B noise and the
 * detector reports `inconclusive` rather than guess. 0.7 sits between a dominant-tier ladder
 * (about 0.8 at an 80% control price) and a two-tier 50/50 ladder (about 0.62).
 */
export const SHIFT_MIN_MEDIAN_SHARE = 0.7;

/**
 * The reference level is the median of the first this-many block medians. Three: enough that
 * one odd block does not set the level, few enough that a shift 30 observations in is still
 * seen against the level before it.
 */
export const SHIFT_REFERENCE_BLOCKS = 3;

export const DEFAULT_SHIFT_PARAMETERS: ShiftParameters = {
  blockSize: SHIFT_BLOCK_SIZE,
  minScale: SHIFT_MIN_SCALE,
  slack: SHIFT_SLACK,
  threshold: SHIFT_THRESHOLD,
  minMedianShare: SHIFT_MIN_MEDIAN_SHARE,
  referenceBlocks: SHIFT_REFERENCE_BLOCKS,
};

interface PricePoint {
  observedAt: string;
  facts: { price: { amountMinor: number } };
}

export function detectShift(
  observations: readonly PricePoint[],
  parameters: ShiftParameters = DEFAULT_SHIFT_PARAMETERS,
): ShiftDetection {
  const { blockSize, minScale, slack, threshold, minMedianShare, referenceBlocks } = parameters;
  const ordered = observations
    .map((o) => ({
      t: Date.parse(o.observedAt),
      price: o.facts.price.amountMinor,
      at: o.observedAt,
    }))
    .filter((o) => !Number.isNaN(o.t))
    .sort((a, b) => a.t - b.t);

  const blockCount = Math.floor(ordered.length / blockSize);
  if (blockCount < 2) return { shifted: false, inconclusive: "too_few_blocks" };

  const blocks: { median: number; share: number; at: string }[] = [];
  for (let b = 0; b < blockCount; b++) {
    const slice = ordered.slice(b * blockSize, (b + 1) * blockSize);
    const first = slice[0];
    if (first === undefined) break;
    const prices = slice.map((o) => o.price);
    const median = lowerMedian(prices);
    const share = prices.filter((p) => p === median).length / prices.length;
    blocks.push({ median, share, at: first.at });
  }
  const meanShare = blocks.reduce((a, b) => a + b.share, 0) / blocks.length;
  if (meanShare < minMedianShare) return { shifted: false, inconclusive: "no_dominant_price" };

  // The reference level is the median of the first few block medians: the pre-change level,
  // as in any CUSUM. Not the median of every block, which would sit on the post-change level
  // whenever the change came early, and not the first block alone, which the dominance guard
  // makes safe enough but which a single odd block could still bias.
  const reference = lowerMedian(blocks.slice(0, referenceBlocks).map((b) => b.median));
  if (reference <= 0) return { shifted: false, inconclusive: "no_dominant_price" };

  const x = blocks.map((b) => (b.median - reference) / reference);
  const sigma = Math.max(minScale, standardDeviation(x));

  let up = 0;
  let down = 0;
  let upStart = 0;
  let downStart = 0;
  for (let j = 0; j < x.length; j++) {
    const z = (x[j] ?? 0) / sigma;
    const nextUp = up + z - slack;
    const nextDown = down - z - slack;
    if (nextUp <= 0) {
      up = 0;
      upStart = j + 1;
    } else up = nextUp;
    if (nextDown <= 0) {
      down = 0;
      downStart = j + 1;
    } else down = nextDown;
    if (up > threshold) return { shifted: true, at: blocks[upStart]?.at ?? blocks[j]?.at ?? "" };
    if (down > threshold)
      return { shifted: true, at: blocks[downStart]?.at ?? blocks[j]?.at ?? "" };
  }
  return { shifted: false };
}

/** The lower median: always one of the input values, so a block median is a real price. */
function lowerMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

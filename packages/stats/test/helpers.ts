import type { ObservationLike } from "../src/resolve";

/** Synth's default `shell.startAt` is 2026-09-04T15:26:18Z; observation i is i minutes later. */
export const SYNTH_START = "2026-09-04T15:26:18.000Z";
/** Well after any sample of up to 200 minutes, well inside the default 72 h window. */
export const NOW = "2026-09-05T00:00:00.000Z";

/** Build minimal observations from a list of prices, one minute apart starting at `startAt`. */
export function obs(prices: number[], startAt = SYNTH_START): ObservationLike[] {
  const start = Date.parse(startAt);
  return prices.map((amountMinor, i) => ({
    observedAt: new Date(start + i * 60_000).toISOString(),
    facts: { price: { amountMinor, currency: "USD" } },
  }));
}

/** `count` copies of each price, interleaved so the order carries no information. */
export function repeated(counts: Record<number, number>): number[] {
  const out: number[] = [];
  const entries = Object.entries(counts).map(([p, c]) => [Number(p), c] as const);
  const max = Math.max(...entries.map(([, c]) => c));
  for (let i = 0; i < max; i++) {
    for (const [price, c] of entries) if (i < c) out.push(price);
  }
  return out;
}

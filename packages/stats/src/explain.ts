/**
 * The one line the UI shows under a ladder. Plain English, always says how many observations
 * it rests on, never uses savings language (CLAUDE.md rule 10; the test enforces the list).
 */
import { MAX_TIERS, MIN_TIER_SIGHTINGS, type Resolution } from "./resolve";

export function explain(resolution: Resolution): string {
  const { n, windowHours, currency } = resolution;
  const window = `in the last ${formatHours(windowHours)}`;
  const observations = plural(n, "observation");

  if (resolution.status === "RESOLVED") {
    const { tiers, floor, confidence } = resolution;
    const floorSeen = plural(tiers[0]?.n ?? 0, "time");
    if (tiers.length === 1) {
      return `One price ${window}: ${formatMinor(floor, currency)}, seen ${floorSeen} across ${observations}. Everyone we observed was shown the same price.`;
    }
    const list = tiers
      .map((t) => `${formatMinor(t.price, currency)} (${formatPercent(t.share)})`)
      .join(", ");
    return `${plural(tiers.length, "price")} ${window} across ${observations}: ${list}. Floor: ${formatMinor(floor, currency)}, seen ${floorSeen}. Confidence ${formatPercent(confidence)} that no tier is still hidden.`;
  }

  const distinct = plural(resolution.tiersSeen, "distinct price");
  switch (resolution.reason) {
    case "no_observations":
      return `${observations} ${window}. About ${resolution.needed} needed before price tiers can be resolved.`;
    case "insufficient_n":
      return `Not enough data yet: ${observations} ${window} showing ${distinct}. About ${resolution.needed} more needed before the tiers can be resolved.`;
    case "rare_tier_unconfirmed":
      return `${observations} ${window} show ${distinct}, but the rarest has been seen fewer than ${MIN_TIER_SIGHTINGS} times. About ${resolution.needed} more needed to confirm it.`;
    case "too_many_tiers":
      return `${observations} ${window} show ${distinct}, more than the ${MAX_TIERS} this tool can resolve. More observations will not help; this cell may be mixing products, or the price may have changed during the window.`;
  }
}

/** "$0.22", "$12.00"; other currencies as "12.00 EUR". */
export function formatMinor(amountMinor: number, currency: string): string {
  const major = Math.floor(amountMinor / 100);
  const minor = amountMinor % 100;
  const body = `${major}.${String(minor).padStart(2, "0")}`;
  return currency === "USD" ? `$${body}` : `${body} ${currency}`;
}

function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function formatHours(hours: number): string {
  if (hours % 24 === 0) return plural(hours / 24, "day");
  return plural(hours, "hour");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

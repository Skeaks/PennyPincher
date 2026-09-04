/**
 * The comparison itself: pure over two observations. The same-store rule lives here.
 *
 * Retailers assign a store on login (Target moved the S02 recorder from Princeton to Durham on
 * sign-in, and the banana went from $0.39 to $0.29 with it), so two prices are only comparable
 * when both pages resolved to the same store. Store identity is the retailer's store id when
 * both sides have one; Walmart never renders its store number, so the human label is the
 * fallback there. When neither side can be matched the result is `store_unknown`, not a
 * comparison.
 */
import type { PriceObservation, StoreRef } from "@pennypincher/schema";
import type { PricePoint, ProbeFailureReason, ProbeVerdict } from "./types";

export type Comparison =
  | { verdict: "SAME" | "MORE" | "LESS"; deltaMinor: number }
  | { verdict: "STORE_DIFFERS" }
  | { verdict: "UNCHECKED"; reason: Extract<ProbeFailureReason, "store_unknown"> };

/** True / false when the two stores can be matched; undefined when there is nothing to match on. */
export function sameStore(a: StoreRef | undefined, b: StoreRef | undefined): boolean | undefined {
  if (a?.retailerStoreId !== undefined && b?.retailerStoreId !== undefined) {
    return a.retailerStoreId === b.retailerStoreId;
  }
  if (a?.label !== undefined && b?.label !== undefined) return a.label === b.label;
  return undefined;
}

export function compare(mine: PriceObservation, anon: PriceObservation): Comparison {
  const same = sameStore(mine.store, anon.store);
  if (same === undefined) return { verdict: "UNCHECKED", reason: "store_unknown" };
  if (!same) return { verdict: "STORE_DIFFERS" };
  const deltaMinor = mine.facts.price.amountMinor - anon.facts.price.amountMinor;
  if (deltaMinor === 0) return { verdict: "SAME", deltaMinor };
  return { verdict: deltaMinor > 0 ? "MORE" : "LESS", deltaMinor };
}

export function pricePoint(o: PriceObservation): PricePoint {
  const point: PricePoint = {
    observationId: o.observationId,
    amountMinor: o.facts.price.amountMinor,
    priceText: o.facts.priceText,
    fulfillment: o.context.fulfillment,
  };
  if (o.store?.retailerStoreId !== undefined) point.storeId = o.store.retailerStoreId;
  if (o.store?.label !== undefined) point.storeLabel = o.store.label;
  return point;
}

/** "$0.10" from minor units. Absolute value; the caller says which way. */
export function formatUsd(amountMinor: number): string {
  const abs = Math.abs(amountMinor);
  return `$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * The one line the popup shows for a verdict. Exactly the five strings the brief allows.
 * No claim language: nothing here says what the user should do or what they might gain.
 */
export function verdictText(verdict: ProbeVerdict, deltaMinor = 0): string {
  switch (verdict) {
    case "SAME":
      return "Same";
    case "MORE":
      return `You pay ${formatUsd(deltaMinor)} more`;
    case "LESS":
      return `You pay ${formatUsd(deltaMinor)} less`;
    case "STORE_DIFFERS":
      return "Store differs";
    case "UNCHECKED":
      return "Could not check";
  }
}

/** A second, longer line for verdicts that need one. */
export function verdictDetail(verdict: ProbeVerdict): string | undefined {
  if (verdict === "STORE_DIFFERS") return "Anonymous visitors are served a different store.";
  if (verdict === "UNCHECKED") return "The anonymous page showed no price this time.";
  return undefined;
}

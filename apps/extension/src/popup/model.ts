/**
 * What the popup shows for the current tab, computed from data only (no DOM, no browser
 * APIs) so every state is testable. The popup reads the tab's URL, the observation store and
 * the probe state, hands them here, and renders the view.
 */
import type { PriceObservation } from "@pennypincher/schema";
import { canonicalUrl } from "../capture/adapter";
import { ADAPTERS, findAdapter } from "../capture/registry";
import { pricePoint } from "../probe/compare";
import { type PricePoint, type ProbeResult, type ProbeState, probeKey } from "../probe/types";

export type PopupView =
  /** No consent: nothing is captured or checked. */
  | { kind: "off" }
  /** The tab is not a product page of a supported retailer. */
  | { kind: "unsupported" }
  /** A supported product page, but no price has been recorded for it yet. */
  | { kind: "no_observation" }
  /**
   * The recorded price came from a session that was not signed in, so there is nothing to
   * compare against: the probe only runs for `logged_in` observations and will never run here.
   */
  | { kind: "not_signed_in"; mine: PricePoint }
  /** The user's price is recorded; the anonymous check has not produced a result yet. */
  | { kind: "pending"; mine: PricePoint }
  /** A probe result exists for this product. */
  | { kind: "result"; result: ProbeResult };

export interface PopupInputs {
  consented: boolean;
  tabUrl: string | undefined;
  observations: readonly PriceObservation[];
  probe: ProbeState;
}

/** The user's own most recent observation of `url`: never a probe's anonymous row. */
export function latestOwnObservation(
  observations: readonly PriceObservation[],
  url: string,
): PriceObservation | undefined {
  let latest: PriceObservation | undefined;
  for (const o of observations) {
    if (o.product.url !== url || o.context.cleanSession === true) continue;
    if (!latest || o.observedAt >= latest.observedAt) latest = o;
  }
  return latest;
}

export function popupView(inputs: PopupInputs): PopupView {
  if (!inputs.consented) return { kind: "off" };
  const url = inputs.tabUrl === undefined ? undefined : canonicalUrl(inputs.tabUrl);
  if (url === undefined || !findAdapter(url, ADAPTERS)) return { kind: "unsupported" };
  const mine = latestOwnObservation(inputs.observations, url);
  if (!mine) return { kind: "no_observation" };
  if (mine.context.sessionState !== "logged_in")
    return { kind: "not_signed_in", mine: pricePoint(mine) };
  const result = inputs.probe.results[probeKey(mine.retailer, mine.product.retailerSku)];
  // A result is only shown for the price the user is looking at now. Capture stores a fresh row
  // on every load while the probe runs once an hour, so a cached pair can predate a price change;
  // the observation id changes on every reload, so the price itself is the match.
  if (result && result.url === url && result.mine.amountMinor === mine.facts.price.amountMinor) {
    return { kind: "result", result };
  }
  return { kind: "pending", mine: pricePoint(mine) };
}

/**
 * The popup: "Your price", "Anonymous price", one of the five verdict lines (S06), the panel
 * ladder for the product's cell (S11), and "You contributed N observations this week". No
 * claim language anywhere in this file (CLAUDE.md rule 10).
 */
import { browser } from "wxt/browser";
import { canonicalUrl } from "../capture/adapter";
import { loadListingTally } from "../capture/tally";
import { hasConsent } from "../lib/consent";
import { el, mount } from "../lib/dom";
import { verdictDetail, verdictText } from "../probe/compare";
import { loadProbeState } from "../probe/state";
import type { PricePoint } from "../probe/types";
import { list } from "../store";
import { isConfigured, syncConfigFromEnv } from "../sync/config";
import { contributedSince, loadSyncState } from "../sync/state";
import { getCell } from "../sync/transport";
import { cellKeyOf, contributionText, ladderElement, ladderView } from "./ladder";
import { type PopupView, latestOwnObservation, popupView } from "./model";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function priceRow(label: string, point: PricePoint | undefined): HTMLElement[] {
  const value = point
    ? point.storeLabel
      ? `${point.priceText} (${point.storeLabel})`
      : point.priceText
    : "Not available";
  return [el("dt", { text: label }), el("dd", { text: value })];
}

/** "No prices recorded on this page yet." / "1 price on this page recorded." / "12 prices …" */
export function listingText(recorded: number): string {
  if (recorded === 0) return "No prices recorded on this page yet.";
  return `${recorded} ${recorded === 1 ? "price" : "prices"} on this page recorded.`;
}

/** The body of the popup for a view. Exported so the states can be rendered in isolation. */
export function viewElement(view: PopupView): HTMLElement {
  switch (view.kind) {
    case "off":
      return el("p", { text: "Off until you consent." });
    case "unsupported":
      return el("p", { class: "muted", text: "Open a product page on a supported retailer." });
    case "listing":
      return el("div", {}, [
        el("p", { text: listingText(view.recorded) }),
        el("p", { class: "muted", text: "Open a product to compare its price." }),
      ]);
    case "no_observation":
      return el("p", { class: "muted", text: "No price recorded for this page yet." });
    case "not_signed_in":
      return el("div", {}, [
        el("dl", {}, [
          ...priceRow("Your price", view.mine),
          ...priceRow("Anonymous price", undefined),
        ]),
        el("p", {
          class: "muted",
          text: "Nothing to compare: this price was recorded while you were not signed in.",
        }),
      ]);
    case "pending":
      return el("div", {}, [
        el("dl", {}, [
          ...priceRow("Your price", view.mine),
          ...priceRow("Anonymous price", undefined),
        ]),
        el("p", { class: "muted", text: "Anonymous check not run yet." }),
      ]);
    case "result": {
      const { result } = view;
      const detail = verdictDetail(result.verdict);
      const children: Node[] = [
        el("dl", {}, [
          ...priceRow("Your price", result.mine),
          ...priceRow("Anonymous price", result.anon),
        ]),
        el("p", { class: "verdict", text: verdictText(result.verdict, result.deltaMinor) }),
      ];
      if (detail) children.push(el("p", { class: "muted", text: detail }));
      return el("div", {}, children);
    }
  }
}

/** The ladder is shown whenever the popup has the user's own price for the page. */
export function showsLadder(view: PopupView): boolean {
  return view.kind === "not_signed_in" || view.kind === "pending" || view.kind === "result";
}

/** The active tab's URL. Available without the `tabs` permission on hosts we have permission for. */
async function activeTabUrl(): Promise<string | undefined> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.url ?? undefined;
  } catch {
    return undefined;
  }
}

export async function renderPopup(now: Date = new Date()): Promise<void> {
  const [consented, tabUrl, observations, probe, listingTally, sync] = await Promise.all([
    hasConsent(),
    activeTabUrl(),
    list(),
    loadProbeState(),
    loadListingTally(),
    loadSyncState(),
  ]);
  const view = popupView({ consented, tabUrl, observations, probe, listingTally });
  const children: Node[] = [el("h1", { text: "PennyPincher" }), viewElement(view)];

  const config = syncConfigFromEnv();
  const pageUrl = showsLadder(view) && tabUrl !== undefined ? canonicalUrl(tabUrl) : undefined;
  const mine = pageUrl === undefined ? undefined : latestOwnObservation(observations, pageUrl);
  let ladder: HTMLElement | undefined;
  if (mine) {
    ladder = ladderElement({ kind: isConfigured(config) ? "loading" : "unconfigured" });
    children.push(ladder);
  }
  if (consented) {
    children.push(
      el("p", {
        class: "muted contributed",
        text: contributionText(contributedSince(sync, now.getTime() - WEEK_MS)),
      }),
    );
  }

  const options = el("button", { type: "button", text: "Options" });
  options.addEventListener("click", () => {
    void browser.runtime.openOptionsPage();
  });
  children.push(options);
  mount(el("section", {}, children));

  if (mine && ladder && isConfigured(config)) {
    const fetched = await getCell(config, cellKeyOf(mine));
    ladder.replaceWith(ladderElement(ladderView(fetched, mine.facts.price.amountMinor)));
  }
}

/**
 * The popup (S06 minimal): "Your price", "Anonymous price", and one of the five verdict lines.
 * The ladder arrives in S11. No claim language anywhere in this file (CLAUDE.md rule 10).
 */
import { browser } from "wxt/browser";
import { hasConsent } from "../lib/consent";
import { el, mount } from "../lib/dom";
import { verdictDetail, verdictText } from "../probe/compare";
import { loadProbeState } from "../probe/state";
import type { PricePoint } from "../probe/types";
import { list } from "../store";
import { type PopupView, popupView } from "./model";

function priceRow(label: string, point: PricePoint | undefined): HTMLElement[] {
  const value = point
    ? point.storeLabel
      ? `${point.priceText} (${point.storeLabel})`
      : point.priceText
    : "Not available";
  return [el("dt", { text: label }), el("dd", { text: value })];
}

/** The body of the popup for a view. Exported so the states can be rendered in isolation. */
export function viewElement(view: PopupView): HTMLElement {
  switch (view.kind) {
    case "off":
      return el("p", { text: "Off until you consent." });
    case "unsupported":
      return el("p", { class: "muted", text: "Open a product page on a supported retailer." });
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

/** The active tab's URL. Available without the `tabs` permission on hosts we have permission for. */
async function activeTabUrl(): Promise<string | undefined> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.url ?? undefined;
  } catch {
    return undefined;
  }
}

export async function renderPopup(): Promise<void> {
  const [consented, tabUrl, observations, probe] = await Promise.all([
    hasConsent(),
    activeTabUrl(),
    list(),
    loadProbeState(),
  ]);
  const view = popupView({ consented, tabUrl, observations, probe });
  const options = el("button", { type: "button", text: "Options" });
  options.addEventListener("click", () => {
    void browser.runtime.openOptionsPage();
  });
  mount(el("section", {}, [el("h1", { text: "PennyPincher" }), viewElement(view), options]));
}

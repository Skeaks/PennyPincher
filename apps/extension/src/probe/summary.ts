/** The "probes" table on the options page: per retailer, checks run, differences, failures. */
import { el } from "../lib/dom";
import type { ProbeState, RetailerProbeStats } from "./types";

/** "no_price 3, redirected 1" for the failures cell; "" when there were none. */
export function failureBreakdown(stats: RetailerProbeStats): string {
  return Object.entries(stats.failuresByReason)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${reason} ${n}`)
    .join(", ");
}

export function probeSummaryElement(state: ProbeState): HTMLElement {
  const rows = Object.entries(state.stats)
    .filter((entry): entry is [string, RetailerProbeStats] => entry[1] !== undefined)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (rows.length === 0) {
    return el("p", { class: "muted", text: "No anonymous price checks have run yet." });
  }
  const head = el("tr", {}, [
    el("th", { text: "Retailer" }),
    el("th", { text: "Checks run" }),
    el("th", { text: "Differences found" }),
    el("th", { text: "Failures" }),
  ]);
  const body = rows.map(([retailer, stats]) => {
    const breakdown = failureBreakdown(stats);
    return el("tr", {}, [
      el("td", { text: retailer }),
      el("td", { text: String(stats.checks) }),
      el("td", { text: String(stats.differences) }),
      el("td", { text: breakdown ? `${stats.failures} (${breakdown})` : String(stats.failures) }),
    ]);
  });
  return el("table", { class: "probes" }, [el("thead", {}, [head]), el("tbody", {}, body)]);
}

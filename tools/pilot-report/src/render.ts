/**
 * Markdown for `docs/pilot/`. Plain tables, no charts, nothing a reviewer cannot diff. The
 * files are internal records, but the regulated words (CLAUDE.md rule 10) stay out anyway:
 * "floor", "tier" and "difference" say everything these reports need to say.
 */
import { MIN_TIER_SIGHTINGS, RESOLVE_SAFETY_FACTOR, formatMinor } from "@pennypincher/stats";
import type { PilotConfig, WeekWindow } from "./config";
import type { Decision, DecisionInputs } from "./decide";
import type { SkuCount } from "./metrics";
import type { Reconciliation } from "./reconcile";
import type { WeekReport } from "./report";

export function pct(x: number | null): string {
  return x === null ? "n/a" : `${(x * 100).toFixed(1)}%`;
}

function usd(minor: number): string {
  return formatMinor(minor, "USD");
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

/** `[from, to)` as two dates; the exclusive end shown as the last day included. */
function windowText(window: WeekWindow): string {
  const lastDay = new Date(Date.parse(window.to) - 1).toISOString();
  return `${day(window.from)} to ${day(lastDay)} (UTC)`;
}

function table(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

function counts(record: Record<string, number>, label: string): string {
  const entries = Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return `No ${label}.`;
  return table(
    [label, "rows"],
    entries.map(([key, value]) => [key === "" ? "(none)" : key, String(value)]),
  );
}

export function renderWeek(report: WeekReport): string {
  const out: string[] = [];
  out.push(`# Pilot week ${report.week}: ${windowText(report.window)}`);
  out.push("");
  out.push(
    `Metro: ${report.metro}. Retailer: ${report.retailer}. Generated ${report.generatedAt} by \`tools/pilot-report\` from the D1 export of the week (${report.rows} rows) and the query API. Cell metrics are the pilot retailer's; panel totals and probe rates cover every retailer.`,
  );
  out.push("");

  out.push("## Panel");
  out.push("");
  out.push(
    table(
      ["measure", "all retailers", report.retailer],
      [
        [
          "panelists active",
          String(report.panel.panelistsAll),
          String(report.panel.panelistsRetailer),
        ],
        [
          "observations",
          String(report.panel.observationsAll),
          String(report.panel.observationsRetailer),
        ],
      ],
    ),
  );
  out.push("");
  out.push(
    `Of the observations, ${report.panel.probeRows} are the lever probe's anonymous rows and ${report.panel.estimateRows} are by-weight estimates (unfiltered, S09). Abuse flags on file: ${report.flags.suspects} suspect (excluded from every cell below), ${report.flags.cleared} cleared.`,
  );
  out.push("");
  out.push(counts(report.panel.byAdapter, "adapter"));
  out.push("");
  out.push(counts(report.panel.byZip3, "zip3"));
  out.push("");
  out.push(counts(report.panel.byFulfillment, "fulfillment"));
  out.push("");

  const c = report.cells;
  out.push(`## Cells (${report.retailer}, one vote per panelist, whole week)`);
  out.push("");
  out.push(
    table(
      ["measure", "value"],
      [
        ["cells observed", String(c.cells)],
        [`cells with N >= ${c.threshold}`, String(c.withThreshold)],
        ["cells RESOLVED", String(c.resolved)],
        ["resolved cells with more than one tier", `${c.multiTier} (${pct(c.multiTierShare)})`],
        ["suspect rows excluded", String(c.suspectsExcluded)],
      ],
    ),
  );
  out.push("");
  out.push(counts(c.unresolvedByReason, "UNRESOLVED reason"));
  out.push("");
  out.push(
    Object.keys(c.tierHistogram).length === 0
      ? "No RESOLVED cells, so no tier-count distribution."
      : table(
          ["tiers", "resolved cells"],
          Object.entries(c.tierHistogram)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([k, n]) => [k, String(n)]),
        ),
  );
  out.push("");
  if (c.maxSpread === null) {
    out.push("Max spread: no resolved cell shows more than one tier.");
  } else {
    out.push(
      `Max spread: ${pct(c.maxSpread.spread)} (${usd(c.maxSpread.floorMinor)} to ${usd(c.maxSpread.topMinor)}) in \`${c.maxSpread.cellKey}\` (${c.maxSpread.title}). Median spread over multi-tier cells: ${pct(c.medianSpread)}.`,
    );
  }
  out.push("");

  out.push("## Cells as the API sees them (72 h window)");
  out.push("");
  if (report.apiView === null) {
    out.push("Not queried (`--no-api`).");
  } else {
    const v = report.apiView;
    const errors = Object.keys(v.errors).length;
    out.push(
      `Queried ${v.queried} cells (those at or above the threshold above) at ${v.at ?? "n/a"}: ${v.resolved} RESOLVED, ${v.multiTier} with more than one tier, ${errors} errors.`,
    );
    if (errors > 0) {
      out.push("");
      out.push(
        table(
          ["cell", "status"],
          Object.entries(v.errors).map(([key, status]) => [`\`${key}\``, String(status)]),
        ),
      );
    }
  }
  out.push("");

  out.push("## Lever probe (logged-in vs anonymous, by retailer)");
  out.push("");
  if (report.probes.length === 0) {
    out.push("No probe rows in the window.");
  } else {
    out.push(
      table(
        [
          "retailer",
          "checks",
          "comparable",
          "same",
          "more",
          "less",
          "difference rate",
          "median |delta|",
          "store differs",
          "store unknown",
          "unpaired",
        ],
        report.probes.map((r) => [
          r.retailer,
          String(r.checks),
          String(r.comparable),
          String(r.same),
          String(r.more),
          String(r.less),
          pct(r.differenceRate),
          r.medianAbsDeltaMinor === null ? "n/a" : usd(r.medianAbsDeltaMinor),
          String(r.storeDiffers),
          String(r.storeUnknown),
          String(r.unpaired),
        ]),
      ),
    );
    out.push("");
    out.push(
      "A check is an anonymous row paired with the same panelist's logged-in row for the same SKU within the hour before it. Comparable means both resolved to one store (`compare.ts` rule; Instacart needs a location id on both sides). The difference rate is MORE + LESS over comparable.",
    );
  }
  out.push("");

  out.push("## Adapter health (last 7 days per the API)");
  out.push("");
  if (report.health === null) {
    out.push("Not queried (`--no-api`).");
  } else if (report.health.error !== null) {
    out.push(report.health.error);
  } else if (report.health.lines.length === 0) {
    out.push("No health reports received.");
  } else {
    out.push(
      table(
        ["adapter", "attempted", "extracted", "rate", "failures by reason"],
        report.health.lines.map((line) => [
          line.adapter,
          String(line.attempted),
          String(line.extracted),
          pct(line.extractionRate),
          line.failed.length === 0
            ? "none"
            : line.failed.map(([reason, n]) => `${reason} ${n}`).join(", "),
        ]),
      ),
    );
  }
  out.push("");

  out.push(`## Top SKUs (${report.retailer}, by observations)`);
  out.push("");
  out.push(renderSkuTable(report.topSkus));
  out.push("");
  return out.join("\n");
}

function renderSkuTable(skus: readonly SkuCount[]): string {
  if (skus.length === 0) return "No observations for the pilot retailer.";
  return table(
    ["#", "SKU", "title", "observations", "panelists"],
    skus.map((s, i) => [
      String(i + 1),
      s.retailerSku,
      s.title,
      String(s.observations),
      String(s.panelists),
    ]),
  );
}

export interface SkusPage {
  config: PilotConfig;
  window: WeekWindow;
  generatedAt: string;
  skus: SkuCount[];
}

export function renderSkus(page: SkusPage): string {
  return [
    `# Pilot SKU list: ${page.config.retailer}, top ${page.skus.length} by observations`,
    "",
    `Window ${windowText(page.window)}, generated ${page.generatedAt} by \`pnpm --filter @pennypincher/pilot-report report skus\`. Planned size: ${page.config.skuCount}. Cells are per store, fulfilment and zip3, so one SKU here can be several cells.`,
    "",
    renderSkuTable(page.skus),
    "",
  ].join("\n");
}

export interface ReconcilePage {
  config: PilotConfig;
  window: WeekWindow;
  generatedAt: string;
  reconciliation: Reconciliation;
}

export function renderReconcile(page: ReconcilePage): string {
  const r = page.reconciliation;
  const out: string[] = [];
  out.push("# Reconciliation: real tier shares vs synth's assumptions");
  out.push("");
  out.push(
    `${page.config.retailer}, ${windowText(page.window)}, generated ${page.generatedAt}. ${r.finalResolved} cells RESOLVED over the window, ${r.finalMultiTier} of them with more than one tier. Constants under test: \`RESOLVE_SAFETY_FACTOR\` = ${RESOLVE_SAFETY_FACTOR}, \`MIN_TIER_SIGHTINGS\` = ${MIN_TIER_SIGHTINGS} (packages/stats).`,
  );
  out.push("");
  out.push("## Rarest-tier share by tier count");
  out.push("");
  out.push(
    "Synth's property test assumed uniform shares and planted floors at 2%. A uniform k-tier ladder has rarest share 1/k.",
  );
  out.push("");
  out.push(
    r.shares.length === 0
      ? "No RESOLVED cells."
      : table(
          ["tiers", "cells", "rarest share, median", "rarest share, min", "uniform would be"],
          r.shares.map((s) => [
            String(s.k),
            String(s.cells),
            pct(s.rarestShareMedian),
            pct(s.rarestShareMin),
            pct(1 / s.k),
          ]),
        ),
  );
  out.push("");
  out.push("## Safety factor sweep (sightings held at 3)");
  out.push("");
  out.push(
    "Each cell's votes replayed in arrival order. \"Premature\" compares the first prefix that would have RESOLVED with the cell's final resolution: fewer tiers, or a higher floor.",
  );
  out.push("");
  out.push(renderSweep(r.factors, "factor"));
  out.push("");
  out.push(`## Sightings sweep (factor held at ${RESOLVE_SAFETY_FACTOR})`);
  out.push("");
  out.push(renderSweep(r.sightings, "sightings"));
  out.push("");
  out.push(
    `Prices seen twice at some point: ${r.twiceSeen.tiers}; seen a third time by the end: ${r.twiceSeen.persisted} (${pct(r.twiceSeen.share)}).`,
  );
  out.push("");
  out.push("## Recommendation");
  out.push("");
  for (const line of r.recommendations) out.push(`- ${line}`);
  out.push("");
  out.push(
    "A constant changes only by a PR to `packages/stats` that quotes this file, re-runs the S09 property test and updates its recorded numbers (resolve.ts, the comment above each constant).",
  );
  out.push("");
  return out.join("\n");
}

function renderSweep(rows: Reconciliation["factors"], key: "factor" | "sightings"): string {
  return table(
    [key, "cells resolved", "premature tiers", "premature floor", "median votes at resolve"],
    rows.map((row) => [
      String(row[key]),
      String(row.resolvedCells),
      `${row.prematureTiers} (${pct(row.prematureTierRate)})`,
      `${row.prematureFloor} (${pct(row.prematureFloorRate)})`,
      row.medianVotesAtResolve === null ? "n/a" : String(row.medianVotesAtResolve),
    ]),
  );
}

export interface DecisionPage {
  config: PilotConfig;
  window: WeekWindow;
  generatedAt: string;
  inputs: DecisionInputs;
  decision: Decision;
}

export function renderDecision(page: DecisionPage): string {
  const t = page.config.thresholds;
  const d = page.decision;
  const out: string[] = [];
  out.push("# S16 decision");
  out.push("");
  out.push(
    `**Verdict: ${d.verdict}${d.final ? "" : " (not final)"}.** ${page.config.metro}, ${page.config.retailer}, ${windowText(page.window)}. Generated ${page.generatedAt} by \`pnpm --filter @pennypincher/pilot-report report decide\`; the numbers come from the D1 exports of every pilot week, the rules from \`docs/sessions/S16-closed-pilot.md\`.`,
  );
  out.push("");
  out.push("## The rule");
  out.push("");
  out.push(
    `- If >= ${pct(t.multiTierShare)} of RESOLVED cells show multiple tiers: Track B is real. Phase 2 briefs are the basket optimizer and the receipt.`,
  );
  out.push(
    `- If the lever probe finds logged-in vs logged-out differences on >= ${pct(t.probeDifferenceRate)} of comparable checks but cells are single-tier: Track A is the product. Phase 2 briefs are the ZIP / fulfilment probes and the subscription.`,
  );
  out.push(
    '- If neither: the pivot. Phase 2 briefs are "one-price certified" and the conventional levers from the research doc.',
  );
  out.push(
    `- Minimums (this session's addition, \`pilot.json\`): ${t.minResolvedCells} RESOLVED cells before the share counts, ${t.minProbeChecks} comparable checks before the rate counts. Below either, INCONCLUSIVE.`,
  );
  out.push("");
  out.push("## The numbers");
  out.push("");
  out.push(
    table(
      ["measure", "value"],
      [
        [
          "RESOLVED cells (pilot retailer, whole pilot, one vote per panelist)",
          String(page.inputs.resolvedCells),
        ],
        ["of which more than one tier", `${page.inputs.multiTierCells} (${pct(d.multiTierShare)})`],
        ["comparable probe checks (all retailers)", String(page.inputs.comparableChecks)],
        ["of which MORE or LESS", `${page.inputs.differences} (${pct(d.differenceRate)})`],
      ],
    ),
  );
  out.push("");
  out.push("## Why");
  out.push("");
  for (const reason of d.reasons) out.push(`- ${reason}`);
  out.push("");
  out.push("## Phase 2 briefs");
  out.push("");
  if (d.phase2.length === 0) {
    out.push("None until the verdict is not INCONCLUSIVE.");
  } else {
    for (const brief of d.phase2) out.push(`- ${brief}`);
  }
  out.push("");
  out.push("## Sign-off");
  out.push("");
  out.push(
    `- Counsel reviewed ADR 0003: ${page.config.counselReviewed ?? "not yet (required before any panelist outside Jamie's personal network installs, and before this decision is final)"}.`,
  );
  out.push("- Decided by: Jamie, on: (date).");
  out.push("");
  return out.join("\n");
}

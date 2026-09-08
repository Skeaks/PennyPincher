import { describe, expect, it } from "vitest";
import { pilotWindow, weekWindow } from "../src/config";
import { decide } from "../src/decide";
import { reconcile } from "../src/reconcile";
import { pct, renderDecision, renderReconcile, renderSkus, renderWeek } from "../src/render";
import { buildWeekReport, decisionInputs, summarize } from "../src/report";
import { ladderRows, probeTwin, row, testConfig } from "./helpers";

const config = testConfig();
const NOW = new Date("2026-09-21T09:00:00.000Z");

/** CLAUDE.md rule 10: none of these may appear without a claims-reviewed label. */
const REGULATED = /\b(save|savings|cheapest|guarantee)\b|lowest price/i;

function sampleRows() {
  const mine = row({ observedAt: "2026-09-16T10:00:00.000Z", priceMinor: 249 });
  return [
    ...ladderRows({ seed: "w1", n: 40, observers: 40, sku: "a" }),
    ...ladderRows({ seed: "w2", n: 6, sku: "b", tiers: [500] }),
    ...ladderRows({ seed: "w3", n: 2, sku: "c" }),
    mine,
    probeTwin(mine, { priceMinor: 199 }),
    probeTwin(mine),
  ];
}

describe("renderWeek", () => {
  it("writes every section the brief lists, offline", async () => {
    const report = await buildWeekReport({
      config,
      week: 1,
      rows: sampleRows(),
      flags: [
        {
          panelistId: "x",
          status: "suspect",
          reason: "r",
          cellKey: "c",
          flaggedAt: "t",
          reviewedAt: null,
          reviewNote: null,
        },
      ],
      api: null,
      now: NOW,
    });
    const md = renderWeek(report);
    expect(md).toMatch(/^# Pilot week 1: 2026-09-14 to 2026-09-20 \(UTC\)/);
    expect(md).toContain("Metro: Test metro. Retailer: instacart.");
    for (const heading of [
      "## Panel",
      "## Cells (instacart, one vote per panelist, whole week)",
      "## Cells as the API sees them (72 h window)",
      "## Lever probe (logged-in vs anonymous, by retailer)",
      "## Adapter health (last 7 days per the API)",
      "## Top SKUs (instacart, by observations)",
    ]) {
      expect(md).toContain(heading);
    }
    expect(md).toContain("| panelists active | 49 | 49 |");
    expect(md).toContain("| cells RESOLVED | 2 |");
    expect(md).toContain("| resolved cells with more than one tier | 1 (50.0%) |");
    expect(md).toContain("| 3 | 1 |");
    expect(md).toMatch(
      /Max spread: 50\.3% \(\$1\.99 to \$2\.99\) in `instacart\|10769\|a\|delivery\|085`/,
    );
    expect(md).toContain("| instacart | 2 | 2 | 1 | 1 | 0 | 50.0% | $0.50 | 0 | 0 | 0 |");
    expect(md).toContain("1 suspect (excluded from every cell below), 0 cleared");
    expect(md).toContain("Not queried (`--no-api`).");
    expect(md).toContain("| 1 | a | Product a | 40 | 40 |");
  });

  it("uses none of the regulated words", () => {
    const rows = sampleRows();
    const summary = summarize(config, rows, [], pilotWindow(config));
    const inputs = decisionInputs(summary);
    const pages = [
      renderDecision({
        config,
        window: pilotWindow(config),
        generatedAt: NOW.toISOString(),
        inputs,
        decision: decide(inputs, config.thresholds, null),
      }),
      renderReconcile({
        config,
        window: pilotWindow(config),
        generatedAt: NOW.toISOString(),
        reconciliation: reconcile(summary.cells),
      }),
      renderSkus({
        config,
        window: weekWindow(config, 1),
        generatedAt: NOW.toISOString(),
        skus: [{ retailerSku: "a", title: "Product a", observations: 3, panelists: 2 }],
      }),
    ];
    for (const page of pages) expect(page).not.toMatch(REGULATED);
  });
});

describe("renderDecision", () => {
  it("states the verdict, the rule, the numbers and the sign-off", () => {
    const inputs = { resolvedCells: 25, multiTierCells: 10, comparableChecks: 80, differences: 4 };
    const md = renderDecision({
      config,
      window: pilotWindow(config),
      generatedAt: NOW.toISOString(),
      inputs,
      decision: decide(inputs, config.thresholds, null),
    });
    expect(md).toMatch(/^# S16 decision\n\n\*\*Verdict: TRACK_B \(not final\)\.\*\*/);
    expect(md).toContain("- If >= 20.0% of RESOLVED cells show multiple tiers");
    expect(md).toContain("| of which more than one tier | 10 (40.0%) |");
    expect(md).toContain("| of which MORE or LESS | 4 (5.0%) |");
    expect(md).toContain("- Basket optimizer");
    expect(md).toContain("Counsel reviewed ADR 0003: not yet");
    expect(md).toContain("- Decided by: Jamie, on: (date).");
  });

  it("shows the counsel date once it exists", () => {
    const inputs = { resolvedCells: 0, multiTierCells: 0, comparableChecks: 0, differences: 0 };
    const md = renderDecision({
      config: testConfig({ counselReviewed: "2026-09-30" }),
      window: pilotWindow(config),
      generatedAt: NOW.toISOString(),
      inputs,
      decision: decide(inputs, config.thresholds, "2026-09-30"),
    });
    expect(md).toContain("Counsel reviewed ADR 0003: 2026-09-30.");
    expect(md).toContain("None until the verdict is not INCONCLUSIVE.");
  });
});

describe("renderReconcile", () => {
  it("tabulates the sweeps and the recommendation", () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      ladderRows({ seed: `r-${i}`, n: 30, observers: 30, sku: `s${i}` }),
    ).flat();
    const summary = summarize(config, rows, [], pilotWindow(config));
    const md = renderReconcile({
      config,
      window: pilotWindow(config),
      generatedAt: NOW.toISOString(),
      reconciliation: reconcile(summary.cells),
    });
    expect(md).toContain("25 cells RESOLVED over the window, 25 of them with more than one tier");
    expect(md).toContain("## Safety factor sweep (sightings held at 3)");
    expect(md).toContain("## Sightings sweep (factor held at 1.5)");
    expect(md).toMatch(/\| 3 \| 25 \| \d+\.\d% \| \d+\.\d% \| 33\.3% \|/);
    expect(md).toMatch(/\| 1\.5 \| 25 \| \d+ \(\d+\.\d%\) \| \d+ \(\d+\.\d%\) \| \d+(\.5)? \|/);
    expect(md).toContain("## Recommendation");
  });
});

describe("pct", () => {
  it("formats to one decimal and n/a for null", () => {
    expect(pct(0.12345)).toBe("12.3%");
    expect(pct(1)).toBe("100.0%");
    expect(pct(null)).toBe("n/a");
  });
});

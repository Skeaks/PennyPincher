import { requiredObservations } from "@pennypincher/stats";
import { describe, expect, it } from "vitest";
import {
  CELL_THRESHOLD,
  buildCells,
  cellMetrics,
  commonTitle,
  panelMetrics,
  topSkus,
} from "../src/metrics";
import { ladderRows, probeTwin, row } from "./helpers";

const WEEK = { from: "2026-09-14T00:00:00.000Z", to: "2026-09-21T00:00:00.000Z" };
const NONE = new Set<string>();

describe("buildCells", () => {
  it("collapses to one vote per panelist and resolves over the window", () => {
    // 30 panelists, 3 rows each: the resolver sees 30 votes, not 90.
    const rows = ladderRows({ seed: "cells-1", n: 90, observers: 30 });
    const [cell, ...rest] = buildCells(rows, "instacart", NONE, WEEK);
    expect(rest).toHaveLength(0);
    expect(cell).toMatchObject({
      cellKey: "instacart|10769|2748189|delivery|085",
      retailerSku: "2748189",
      rows: 90,
      panelists: 30,
      n: 30,
      suspectsExcluded: 0,
    });
    expect(cell?.votes).toHaveLength(30);
    expect(cell?.resolution.status).toBe("RESOLVED");
    if (cell?.resolution.status !== "RESOLVED") return;
    expect(cell.resolution.tiers.map((t) => t.price)).toEqual([199, 249, 299]);
    expect(cell.spread).toBeCloseTo(100 / 199);
  });

  it("leaves other retailers out and keys cells apart", () => {
    const rows = [
      ...ladderRows({ seed: "a", n: 6, sku: "1" }),
      ...ladderRows({ seed: "b", n: 6, sku: "2", zip3: "191" }),
      ...ladderRows({ seed: "c", n: 6, sku: "1", retailer: "target" }),
    ];
    const cells = buildCells(rows, "instacart", NONE, WEEK);
    expect(cells.map((c) => c.cellKey)).toEqual([
      "instacart|10769|1|delivery|085",
      "instacart|10769|2|delivery|191",
    ]);
  });

  it("excludes suspects from the votes but counts their rows", () => {
    const rows = ladderRows({ seed: "sus", n: 10 });
    const suspect = rows[0]?.panelistId ?? "";
    const [cell] = buildCells(rows, "instacart", new Set([suspect]), WEEK);
    expect(cell).toMatchObject({ rows: 10, panelists: 10, n: 9, suspectsExcluded: 1 });
  });

  it("ignores rows outside the window even if handed in", () => {
    const rows = ladderRows({ seed: "old", n: 10, startAt: "2026-09-01T00:00:00.000Z" });
    const [cell] = buildCells(rows, "instacart", NONE, WEEK);
    expect(cell?.n).toBe(10);
    expect(cell?.resolution.status).toBe("UNRESOLVED");
    if (cell?.resolution.status !== "UNRESOLVED") return;
    expect(cell.resolution.reason).toBe("no_observations");
  });
});

describe("cellMetrics", () => {
  it("counts thresholds, resolutions, tiers and spread", () => {
    expect(CELL_THRESHOLD).toBe(requiredObservations(2));
    const rows = [
      ...ladderRows({ seed: "one-tier", n: 12, sku: "a", tiers: [500] }),
      ...ladderRows({ seed: "two-tier", n: 40, sku: "b", tiers: [100, 150] }),
      ...ladderRows({ seed: "three-tier", n: 40, sku: "c" }),
      ...ladderRows({ seed: "thin", n: 2, sku: "d" }),
    ];
    const cells = buildCells(rows, "instacart", NONE, WEEK);
    const m = cellMetrics(cells);
    expect(m).toMatchObject({
      threshold: CELL_THRESHOLD,
      cells: 4,
      withThreshold: 3,
      resolved: 3,
      multiTier: 2,
      suspectsExcluded: 0,
    });
    expect(m.multiTierShare).toBeCloseTo(2 / 3);
    expect(m.unresolvedByReason).toEqual({ insufficient_n: 1 });
    expect(m.tierHistogram).toEqual({ "1": 1, "2": 1, "3": 1 });
    expect(m.maxSpread).toMatchObject({
      cellKey: "instacart|10769|c|delivery|085",
      floorMinor: 199,
      topMinor: 299,
    });
    expect(m.maxSpread?.spread).toBeCloseTo(100 / 199);
    expect(m.medianSpread).toBeCloseTo((0.5 + 100 / 199) / 2);
  });

  it("is honest with nothing resolved", () => {
    const m = cellMetrics(buildCells(ladderRows({ seed: "x", n: 3 }), "instacart", NONE, WEEK));
    expect(m.resolved).toBe(0);
    expect(m.multiTierShare).toBeNull();
    expect(m.maxSpread).toBeNull();
    expect(m.medianSpread).toBeNull();
    expect(m.tierHistogram).toEqual({});
  });
});

describe("panelMetrics", () => {
  it("counts panelists and rows for all retailers and the pilot retailer", () => {
    const mine = row();
    const rows = [
      mine,
      probeTwin(mine),
      row({ panelistId: "p2", isEstimate: true, zip3: null, fulfillment: "pickup" }),
      row({ panelistId: "p3", retailer: "target", adapter: "target@0.1.0" }),
    ];
    expect(panelMetrics(rows, "instacart")).toEqual({
      panelistsAll: 3,
      panelistsRetailer: 2,
      observationsAll: 4,
      observationsRetailer: 3,
      probeRows: 1,
      estimateRows: 1,
      byAdapter: { "instacart@0.2.0": 3, "target@0.1.0": 1 },
      byZip3: { "085": 2, "": 1 },
      byFulfillment: { delivery: 2, pickup: 1 },
    });
  });
});

describe("topSkus", () => {
  it("ranks by observations, then panelists, then SKU, and caps the list", () => {
    const rows = [
      ...ladderRows({ seed: "s1", n: 5, sku: "sku-b", observers: 5 }),
      ...ladderRows({ seed: "s2", n: 5, sku: "sku-a", observers: 2 }),
      ...ladderRows({ seed: "s3", n: 7, sku: "sku-c" }),
      ...ladderRows({ seed: "s4", n: 9, sku: "sku-t", retailer: "target" }),
    ];
    const top = topSkus(rows, "instacart", 2);
    expect(top).toEqual([
      { retailerSku: "sku-c", title: "Product sku-c", observations: 7, panelists: 7 },
      { retailerSku: "sku-b", title: "Product sku-b", observations: 5, panelists: 5 },
    ]);
  });

  it("commonTitle picks the most frequent title, ties alphabetically", () => {
    expect(commonTitle([row({ title: "B" }), row({ title: "A" }), row({ title: "B" })])).toBe("B");
    expect(commonTitle([row({ title: "B" }), row({ title: "A" })])).toBe("A");
    expect(commonTitle([])).toBe("");
  });
});

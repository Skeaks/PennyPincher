/**
 * The report against the real API: the Hono app from apps/api on its in-memory repos, fed
 * synthetic batches through POST /v1/observations, then read back the way production is
 * (GET /v1/cells, GET /v1/adapter-health) with the export being what the repo stored. No
 * network, no D1.
 */
import { generateLadder } from "@pennypincher/synth";
import { createApp } from "api/src/app";
import { MemoryObservationRepo } from "api/src/repo/memory";
import { MemoryAdapterHealthRepo } from "api/src/routes/adapter-health";
import { describe, expect, it } from "vitest";
import { appClient } from "../src/api";
import { CELL_THRESHOLD } from "../src/metrics";
import { renderWeek } from "../src/render";
import { buildWeekReport } from "../src/report";
import { fromObservation, testConfig } from "./helpers";

/** Inside week 1 and inside the API's 72 h window ending at NOW, so both views see every row. */
const NOW = new Date("2026-09-20T23:59:59.000Z");
const START_AT = "2026-09-19T08:00:00.000Z";

function ladder(seed: string, sku: string, tiers: number[], n: number, observers: number) {
  return generateLadder({
    seed,
    tiers,
    observers,
    shell: {
      retailerSku: sku,
      title: `Product ${sku}`,
      url: `https://www.instacart.com/products/${sku}-product`,
      startAt: START_AT,
    },
  }).sample(n);
}

describe("pilot-report against the API app", () => {
  it("agrees with the API on every cell when both windows hold the same rows", async () => {
    const repo = new MemoryObservationRepo();
    const health = new MemoryAdapterHealthRepo();
    const app = createApp<Record<string, never>>({
      repo: () => repo,
      now: () => NOW,
      adapterHealth: () => health,
      log: () => {},
    });

    const observations = [
      ...ladder("e2e-a", "a", [199, 249, 299], 60, 30),
      ...ladder("e2e-b", "b", [500], 12, 12),
      // Two votes can never resolve (one tier needs three sightings), so this cell stays
      // below the threshold whatever prices it draws.
      ...ladder("e2e-c", "c", [100, 150], 2, 2),
    ];
    for (let i = 0; i < observations.length; i += 200) {
      const res = await app.request("/v1/observations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ observations: observations.slice(i, i + 200) }),
      });
      expect(res.status).toBe(201);
    }
    const posted = await app.request("/v1/adapter-health", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientVersion: "0.1.0",
        date: "2026-09-20",
        adapters: [
          {
            adapter: "instacart",
            version: "0.2.0",
            attempted: 80,
            extracted: 75,
            failed: { no_price: 5 },
          },
        ],
      }),
    });
    expect(posted.status).toBe(201);

    // The export is what the repo holds: the S14 dedupe folded nothing here (distinct prices
    // or distinct minutes), so every observation is a row.
    const rows = observations.map((o) => fromObservation(o, NOW.toISOString()));
    const report = await buildWeekReport({
      config: testConfig(),
      week: 1,
      rows,
      flags: [],
      api: appClient(app),
      now: NOW,
    });

    expect(report.cells.cells).toBe(3);
    expect(report.cells.withThreshold).toBe(2);
    expect(report.cells.resolved).toBe(2);
    expect(report.cells.multiTier).toBe(1);
    expect(report.apiView).toEqual({
      queried: 2,
      resolved: 2,
      multiTier: 1,
      errors: {},
      at: NOW.toISOString(),
    });
    expect(report.health?.lines).toEqual([
      {
        adapter: "instacart@0.2.0",
        attempted: 80,
        extracted: 75,
        extractionRate: 0.9375,
        failed: [["no_price", 5]],
      },
    ]);
    expect(report.panel.panelistsAll).toBe(44);
    expect(report.panel.observationsAll).toBe(74);

    const md = renderWeek(report);
    expect(md).toContain(
      `Queried 2 cells (those at or above the threshold above) at ${NOW.toISOString()}: 2 RESOLVED, 1 with more than one tier, 0 errors.`,
    );
    expect(md).toContain("| instacart@0.2.0 | 80 | 75 | 93.8% | no_price 5 |");
    expect(CELL_THRESHOLD).toBe(5);
  });

  it("records API errors per cell instead of failing the report", async () => {
    const repo = new MemoryObservationRepo();
    const app = createApp<Record<string, never>>({
      repo: () => repo,
      now: () => NOW,
      pilotToken: () => "secret",
      log: () => {},
    });
    const rows = ladder("e2e-d", "d", [199, 249], 10, 10).map((o) =>
      fromObservation(o, NOW.toISOString()),
    );
    // No bearer: every cell answers 401 and the health endpoint is not mounted (404).
    const report = await buildWeekReport({
      config: testConfig(),
      week: 1,
      rows,
      flags: [],
      api: appClient(app),
      now: NOW,
    });
    expect(report.apiView?.errors).toEqual({ "instacart|10769|d|delivery|085": 401 });
    expect(report.health?.error).toBe("GET /v1/adapter-health answered 404");
    const md = renderWeek(report);
    expect(md).toContain("| `instacart|10769|d|delivery|085` | 401 |");
  });
});

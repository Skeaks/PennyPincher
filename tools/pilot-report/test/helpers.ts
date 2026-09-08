import type { PriceObservation } from "@pennypincher/schema";
import { type LadderOptions, generateLadder } from "@pennypincher/synth";
import { toRow } from "api/src/repo/observations";
import type { PilotConfig } from "../src/config";
import type { ExportRow } from "../src/rows";

/** A Monday; week 1 is the 14th to the 20th, week 2 the 21st to the 27th. */
export const START = "2026-09-14";

export function testConfig(overrides: Partial<PilotConfig> = {}): PilotConfig {
  return {
    metro: "Test metro",
    retailer: "instacart",
    zip3s: ["085"],
    recruitingSource: "test",
    startDate: START,
    weeks: 2,
    panelTarget: { min: 30, max: 60 },
    skuCount: 200,
    counselReviewed: null,
    apiBaseUrl: "http://localhost:8787",
    thresholds: {
      multiTierShare: 0.2,
      probeDifferenceRate: 0.1,
      minResolvedCells: 20,
      minProbeChecks: 50,
    },
    ...overrides,
  };
}

/** What the D1 export of a stored observation looks like, typed. */
export function fromObservation(o: PriceObservation, receivedAt = o.observedAt): ExportRow {
  const { rawJson: _raw, evidenceHash: _hash, ...rest } = toRow(o, receivedAt);
  return { ...rest, cleanSession: o.context.cleanSession };
}

export interface LadderRowsOptions extends Partial<Omit<LadderOptions, "seed" | "tiers">> {
  seed: number | string;
  tiers?: number[];
  sku?: string;
  n: number;
  retailer?: "instacart" | "target" | "walmart";
  storeId?: string;
  label?: string;
  zip3?: string;
  startAt?: string;
}

/** `n` rows of one synthetic cell, one panelist per `observers` (default: one each). */
export function ladderRows(options: LadderRowsOptions): ExportRow[] {
  const { seed, n, sku, retailer, storeId, label, zip3, startAt, tiers, ...rest } = options;
  const ladder = generateLadder({
    ...rest,
    seed,
    tiers: tiers ?? [199, 249, 299],
    shell: {
      retailer: retailer ?? "instacart",
      store: { retailerStoreId: storeId ?? "10769", label: label ?? "Wegmans" },
      retailerSku: sku ?? "2748189",
      title: `Product ${sku ?? "2748189"}`,
      url: `https://www.instacart.com/products/${sku ?? "2748189"}-product`,
      zip3: zip3 ?? "085",
      startAt: startAt ?? "2026-09-15T12:00:00.000Z",
    },
  });
  return ladder.sample(n).map((o) => fromObservation(o));
}

let counter = 0;

/** One row with sensible defaults; override what the test is about. */
export function row(overrides: Partial<ExportRow> = {}): ExportRow {
  counter++;
  return {
    observationId: `obs-${counter}`,
    schemaVersion: "1.1.0",
    panelistId: "panelist-1",
    observedAt: "2026-09-15T12:00:00.000Z",
    retailer: "instacart",
    retailerStoreId: "10769",
    storeLabel: "Wegmans",
    retailerSku: "2748189",
    upc: null,
    title: "Bananas",
    priceMinor: 199,
    currency: "USD",
    isEstimate: false,
    fulfillment: "delivery",
    sessionState: "logged_in",
    surface: "web",
    zip3: "085",
    device: "desktop",
    adapter: "instacart@0.2.0",
    clientVersion: "0.1.0",
    cellKey: "instacart|10769|2748189|delivery|085",
    receivedAt: "2026-09-15T12:01:00.000Z",
    cleanSession: undefined,
    ...overrides,
  };
}

/** The probe's anonymous row for a logged-in row: two minutes later, logged out, clean. */
export function probeTwin(mine: ExportRow, overrides: Partial<ExportRow> = {}): ExportRow {
  counter++;
  return {
    ...mine,
    observationId: `anon-${counter}`,
    observedAt: new Date(Date.parse(mine.observedAt) + 2 * 60_000).toISOString(),
    sessionState: "logged_out",
    cleanSession: true,
    ...overrides,
  };
}

/** Rows as `wrangler d1 execute --json` prints them: snake_case, booleans as 0 / 1. */
export function wranglerJson(rows: readonly ExportRow[]): unknown {
  return [
    {
      results: rows.map((r) => ({
        observation_id: r.observationId,
        schema_version: r.schemaVersion,
        panelist_id: r.panelistId,
        observed_at: r.observedAt,
        retailer: r.retailer,
        retailer_store_id: r.retailerStoreId,
        store_label: r.storeLabel,
        retailer_sku: r.retailerSku,
        upc: r.upc,
        title: r.title,
        price_minor: r.priceMinor,
        currency: r.currency,
        is_estimate: r.isEstimate ? 1 : 0,
        fulfillment: r.fulfillment,
        session_state: r.sessionState,
        surface: r.surface,
        zip3: r.zip3,
        device: r.device,
        adapter: r.adapter,
        client_version: r.clientVersion,
        cell_key: r.cellKey,
        received_at: r.receivedAt,
        clean_session: r.cleanSession === undefined ? null : r.cleanSession ? 1 : 0,
      })),
      success: true,
      meta: { duration: 1 },
    },
  ];
}

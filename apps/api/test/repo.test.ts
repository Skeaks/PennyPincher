import { describe, expect, it } from "vitest";
import migration from "../migrations/0001_observations.sql?raw";
import { INSERT_SQL, OBSERVATION_COLUMNS, bindingsFor } from "../src/repo/d1";
import { MemoryObservationRepo } from "../src/repo/memory";
import { cellKey, toRow } from "../src/repo/observations";
import { uuidFor, validObservation } from "./fixtures";

describe("cellKey", () => {
  it("is retailer|retailerStoreId|retailerSku|fulfillment|zip3", () => {
    expect(cellKey(validObservation())).toBe("instacart|10769|2748189|delivery|085");
  });

  it("writes absent parts as empty strings", () => {
    const o = validObservation();
    const walmartish = validObservation({
      retailer: "walmart",
      store: { label: "East Windsor Supercenter" },
      context: { ...o.context, fulfillment: "pickup" },
    });
    const { zip3: _z, ...context } = walmartish.context;
    expect(cellKey({ ...walmartish, context })).toBe("walmart||2748189|pickup|");
  });
});

describe("toRow", () => {
  it("flattens every top-level field and keeps the payload as raw_json", () => {
    const o = validObservation();
    const row = toRow(o, "2026-09-04T16:00:00.000Z");
    expect(row).toEqual({
      observationId: o.observationId,
      schemaVersion: "1.0.0",
      panelistId: o.panelistId,
      observedAt: o.observedAt,
      retailer: "instacart",
      retailerStoreId: "10769",
      storeLabel: "Wegmans",
      retailerSku: "2748189",
      upc: null,
      title: "Bananas, Sold by the Each",
      priceMinor: 22,
      currency: "USD",
      isEstimate: true,
      fulfillment: "delivery",
      sessionState: "logged_in",
      surface: "web",
      zip3: "085",
      device: "desktop",
      adapter: "instacart@0.1.0",
      clientVersion: "0.1.0",
      evidenceHash: "a".repeat(64),
      cellKey: "instacart|10769|2748189|delivery|085",
      rawJson: JSON.stringify(o),
      receivedAt: "2026-09-04T16:00:00.000Z",
    });
  });

  it("stores nulls for optional fields that are absent", () => {
    const o = validObservation();
    const { store: _s, ...noStore } = o;
    const row = toRow(noStore, "2026-09-04T16:00:00.000Z");
    expect(row.retailerStoreId).toBeNull();
    expect(row.storeLabel).toBeNull();
    expect(row.cellKey).toBe("instacart||2748189|delivery|085");
  });
});

describe("D1 statement", () => {
  const tableColumns = (() => {
    const body = /CREATE TABLE IF NOT EXISTS observations \(([^;]*)\);/.exec(migration)?.[1] ?? "";
    return body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("--"))
      .map((line) => line.split(/\s+/)[0] ?? "");
  })();

  it("inserts exactly the columns the migration creates", () => {
    expect([...OBSERVATION_COLUMNS].sort()).toEqual([...tableColumns].sort());
  });

  it("binds one value per column, booleans as 0/1", () => {
    const row = toRow(validObservation(), "2026-09-04T16:00:00.000Z");
    const bindings = bindingsFor(row);
    expect(bindings).toHaveLength(OBSERVATION_COLUMNS.length);
    expect(bindings[OBSERVATION_COLUMNS.indexOf("is_estimate")]).toBe(1);
    expect(bindings[OBSERVATION_COLUMNS.indexOf("upc")]).toBeNull();
    expect(bindings[OBSERVATION_COLUMNS.indexOf("cell_key")]).toBe(row.cellKey);
  });

  it("is idempotent on the primary key and indexes (cell_key, observed_at)", () => {
    expect(INSERT_SQL.startsWith("INSERT OR IGNORE INTO observations (")).toBe(true);
    expect(migration).toMatch(/observation_id\s+TEXT PRIMARY KEY/);
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS \w+\s+ON observations \(cell_key, observed_at\)/,
    );
  });
});

describe("MemoryObservationRepo", () => {
  it("counts duplicates across and within batches", async () => {
    const repo = new MemoryObservationRepo();
    const at = "2026-09-04T16:00:00.000Z";
    const a = toRow(validObservation({ observationId: uuidFor(1) }), at);
    const b = toRow(validObservation({ observationId: uuidFor(2) }), at);

    expect(await repo.insertMany([a, b, b])).toEqual({ accepted: 2, duplicates: 1 });
    expect(await repo.insertMany([a])).toEqual({ accepted: 0, duplicates: 1 });
    expect(await repo.insertMany([])).toEqual({ accepted: 0, duplicates: 0 });
    expect(await repo.getById(uuidFor(2))).toEqual(b);
    expect(await repo.getById(uuidFor(3))).toBeUndefined();
  });
});

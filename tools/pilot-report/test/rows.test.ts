import { describe, expect, it } from "vitest";
import {
  EXPORT_COLUMNS,
  exportSql,
  flagsSql,
  inWindow,
  isProbeRow,
  parseExport,
  parseFlags,
  toObservationRow,
  unwrapResults,
  wranglerCommand,
} from "../src/rows";
import { probeTwin, row, wranglerJson } from "./helpers";

describe("exportSql", () => {
  const sql = exportSql({ from: "2026-09-14T00:00:00.000Z", to: "2026-09-21T00:00:00.000Z" });

  it("selects every flattened column but the payload and the hash, plus cleanSession", () => {
    for (const column of EXPORT_COLUMNS) expect(sql).toContain(column);
    // raw_json appears only inside json_extract, never as a column of its own.
    const selected = sql.slice("SELECT ".length, sql.indexOf(" FROM ")).split(", ");
    expect(selected).not.toContain("raw_json");
    expect(selected).not.toContain("evidence_hash");
    expect(sql).toContain("json_extract(raw_json, '$.context.cleanSession') AS clean_session");
  });

  it("bounds observed_at half-open and orders deterministically", () => {
    expect(sql).toContain("observed_at >= '2026-09-14T00:00:00.000Z'");
    expect(sql).toContain("observed_at < '2026-09-21T00:00:00.000Z'");
    expect(sql).toMatch(/ORDER BY observed_at, observation_id$/);
  });

  it("wranglerCommand names the environment's database and asks for JSON", () => {
    expect(wranglerCommand(sql)).toBe(
      `pnpm exec wrangler d1 execute pennypincher-production --env production --remote --json --command "${sql}"`,
    );
    expect(wranglerCommand(flagsSql(), "staging")).toContain("pennypincher-staging --env staging");
    expect(flagsSql()).toContain("FROM panelist_flags");
  });
});

describe("parseExport", () => {
  it("reads wrangler --json output, a bare array, or { results }", () => {
    const rows = [row({ observationId: "a" }), row({ observationId: "b", cleanSession: true })];
    const json = wranglerJson(rows);
    const parsed = parseExport(json);
    expect(parsed).toEqual(rows);
    expect(parseExport(unwrapResults(json))).toEqual(rows);
    expect(parseExport({ results: unwrapResults(json) })).toEqual(rows);
    expect(parseExport([])).toEqual([]);
  });

  it("turns 0 / 1 into booleans and null clean_session into undefined", () => {
    const [record] = unwrapResults(wranglerJson([row({ isEstimate: true })]));
    expect(record?.is_estimate).toBe(1);
    expect(record?.clean_session).toBeNull();
    const [parsed] = parseExport([record]);
    expect(parsed?.isEstimate).toBe(true);
    expect(parsed?.cleanSession).toBeUndefined();
    const [clean] = parseExport([{ ...record, clean_session: 1 }]);
    expect(clean?.cleanSession).toBe(true);
  });

  it("names the row and column of a missing or mistyped value", () => {
    const [record] = unwrapResults(wranglerJson([row()]));
    const { price_minor: _p, ...missing } = record as Record<string, unknown>;
    expect(() => parseExport([missing])).toThrow("row 0: price_minor is missing");
    expect(() => parseExport([{ ...record, price_minor: "1.99" }])).toThrow(
      "row 0: price_minor must be an integer",
    );
    expect(() => parseExport([{ ...record, is_estimate: "yes" }])).toThrow(
      "row 0: is_estimate must be a boolean or 0 / 1",
    );
    expect(() => parseExport("nope")).toThrow(/not wrangler --json output/);
  });

  it("keeps nullable columns null", () => {
    const [parsed] = parseExport(
      wranglerJson([row({ retailerStoreId: null, storeLabel: null, zip3: null })]),
    );
    expect(parsed?.retailerStoreId).toBeNull();
    expect(parsed?.storeLabel).toBeNull();
    expect(parsed?.zip3).toBeNull();
  });
});

describe("parseFlags", () => {
  it("reads the panelist_flags columns", () => {
    const flags = parseFlags([
      {
        results: [
          {
            panelist_id: "p1",
            status: "suspect",
            reason: "outside_range",
            cell_key: "c",
            flagged_at: "2026-09-15T00:00:00.000Z",
            reviewed_at: null,
            review_note: null,
          },
        ],
        success: true,
      },
    ]);
    expect(flags).toEqual([
      {
        panelistId: "p1",
        status: "suspect",
        reason: "outside_range",
        cellKey: "c",
        flaggedAt: "2026-09-15T00:00:00.000Z",
        reviewedAt: null,
        reviewNote: null,
      },
    ]);
    expect(() => parseFlags([{ panelist_id: "p", status: "maybe" }])).toThrow(/status/);
  });
});

describe("row helpers", () => {
  it("inWindow is half-open on observedAt", () => {
    const window = { from: "2026-09-14T00:00:00.000Z", to: "2026-09-21T00:00:00.000Z" };
    const inside = row({ observedAt: "2026-09-14T00:00:00.000Z" });
    const edge = row({ observedAt: "2026-09-21T00:00:00.000Z" });
    const before = row({ observedAt: "2026-09-13T23:59:59.999Z" });
    expect(inWindow([inside, edge, before], window)).toEqual([inside]);
  });

  it("isProbeRow needs logged_out and a clean session", () => {
    const mine = row();
    expect(isProbeRow(mine)).toBe(false);
    expect(isProbeRow(probeTwin(mine))).toBe(true);
    expect(isProbeRow(row({ sessionState: "logged_out" }))).toBe(false);
    expect(isProbeRow(row({ sessionState: "logged_in", cleanSession: true }))).toBe(false);
  });

  it("toObservationRow drops cleanSession and blanks the two unexported columns", () => {
    const converted = toObservationRow(row({ cleanSession: true }));
    expect("cleanSession" in converted).toBe(false);
    expect(converted.rawJson).toBe("");
    expect(converted.evidenceHash).toBe("");
  });
});

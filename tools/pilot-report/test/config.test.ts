import { describe, expect, it } from "vitest";
import { parsePilotConfig, pilotWindow, weekWindow } from "../src/config";
import { START, testConfig } from "./helpers";

describe("parsePilotConfig", () => {
  it("accepts the test config and fills the defaults", () => {
    const { thresholds: _t, zip3s: _z, ...minimal } = testConfig();
    const result = parsePilotConfig(minimal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.thresholds).toEqual({
      multiTierShare: 0.2,
      probeDifferenceRate: 0.1,
      minResolvedCells: 20,
      minProbeChecks: 50,
    });
    expect(result.config.zip3s).toEqual([]);
  });

  it("refuses a placeholder retailer and says what to do", () => {
    const result = parsePilotConfig({ ...testConfig(), retailer: "Y" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/retailer: must be one of instacart, target, walmart/);
    expect(result.errors[0]).toMatch(/docs\/pilot\/pilot.json/);
  });

  it("reports every other problem by path", () => {
    const result = parsePilotConfig({
      ...testConfig(),
      startDate: "next monday",
      zip3s: ["0851"],
      apiBaseUrl: "not a url",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.errors.map((e) => e.split(":")[0]);
    expect(paths).toEqual(["zip3s.0", "startDate", "apiBaseUrl"]);
  });

  it("allows startDate and counselReviewed to be null", () => {
    const result = parsePilotConfig({ ...testConfig(), startDate: null, counselReviewed: null });
    expect(result.ok).toBe(true);
  });
});

describe("weekWindow", () => {
  it("is seven UTC days from the start, end exclusive", () => {
    expect(weekWindow(testConfig(), 1)).toEqual({
      week: 1,
      from: `${START}T00:00:00.000Z`,
      to: "2026-09-21T00:00:00.000Z",
    });
    expect(weekWindow(testConfig(), 2)).toEqual({
      week: 2,
      from: "2026-09-21T00:00:00.000Z",
      to: "2026-09-28T00:00:00.000Z",
    });
  });

  it("refuses weeks outside the pilot and a null start", () => {
    expect(() => weekWindow(testConfig(), 3)).toThrow(/between 1 and 2/);
    expect(() => weekWindow(testConfig(), 0)).toThrow(/between 1 and 2/);
    expect(() => weekWindow(testConfig({ startDate: null }), 1)).toThrow(/startDate is null/);
  });

  it("pilotWindow spans every week", () => {
    expect(pilotWindow(testConfig())).toEqual({
      week: 0,
      from: `${START}T00:00:00.000Z`,
      to: "2026-09-28T00:00:00.000Z",
    });
  });
});

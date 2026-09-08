import { describe, expect, it } from "vitest";
import { PHASE_2, decide } from "../src/decide";
import { testConfig } from "./helpers";

const T = testConfig().thresholds;

describe("decide", () => {
  it("Track B when at least 20% of enough resolved cells show multiple tiers", () => {
    const d = decide(
      { resolvedCells: 40, multiTierCells: 8, comparableChecks: 100, differences: 30 },
      T,
      "2026-09-10",
    );
    expect(d.verdict).toBe("TRACK_B");
    expect(d.multiTierShare).toBeCloseTo(0.2);
    expect(d.final).toBe(true);
    expect(d.phase2).toEqual(PHASE_2.TRACK_B);
    expect(d.reasons.at(-1)).toMatch(/Track B is real/);
  });

  it("Track A when the probe differs on at least 10% of enough checks and cells are single-tier", () => {
    const d = decide(
      { resolvedCells: 40, multiTierCells: 2, comparableChecks: 100, differences: 10 },
      T,
      "2026-09-10",
    );
    expect(d.verdict).toBe("TRACK_A");
    expect(d.differenceRate).toBeCloseTo(0.1);
    expect(d.phase2).toEqual(PHASE_2.TRACK_A);
    expect(d.reasons.at(-1)).toMatch(/while cells are single-tier/);
  });

  it("Track A on probe evidence alone when the cells could not be judged, and says so", () => {
    const d = decide(
      { resolvedCells: 3, multiTierCells: 3, comparableChecks: 60, differences: 12 },
      T,
      "2026-09-10",
    );
    expect(d.verdict).toBe("TRACK_A");
    expect(d.reasons.at(-1)).toMatch(/cells could not be judged/);
  });

  it("the pivot when both minimums are met and neither threshold is", () => {
    const d = decide(
      { resolvedCells: 20, multiTierCells: 3, comparableChecks: 50, differences: 4 },
      T,
      "2026-09-10",
    );
    expect(d.verdict).toBe("PIVOT");
    expect(d.phase2).toEqual(PHASE_2.PIVOT);
    expect(d.final).toBe(true);
  });

  it("INCONCLUSIVE below a minimum with no threshold met", () => {
    const d = decide(
      { resolvedCells: 19, multiTierCells: 3, comparableChecks: 49, differences: 4 },
      T,
      "2026-09-10",
    );
    expect(d.verdict).toBe("INCONCLUSIVE");
    expect(d.phase2).toEqual([]);
    expect(d.final).toBe(false);
    expect(d.reasons[0]).toMatch(/19 RESOLVED cells \(< 20\)/);
    expect(d.reasons[1]).toMatch(/49 comparable probe checks \(< 50\)/);
  });

  it("is never final without counsel's review of ADR 0003", () => {
    const d = decide(
      { resolvedCells: 40, multiTierCells: 20, comparableChecks: 100, differences: 50 },
      T,
      null,
    );
    expect(d.verdict).toBe("TRACK_B");
    expect(d.final).toBe(false);
    expect(d.reasons.at(-1)).toMatch(/Counsel has not reviewed ADR 0003/);
  });

  it("reports n/a shares with zero denominators", () => {
    const d = decide(
      { resolvedCells: 0, multiTierCells: 0, comparableChecks: 0, differences: 0 },
      T,
      null,
    );
    expect(d.multiTierShare).toBeNull();
    expect(d.differenceRate).toBeNull();
    expect(d.verdict).toBe("INCONCLUSIVE");
  });
});

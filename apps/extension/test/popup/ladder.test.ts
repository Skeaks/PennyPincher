// @vitest-environment happy-dom
/**
 * The ladder section of the popup (S11): the three states rendered from cell fixtures, the
 * user's tier highlighted, the floor marked, the explain line with N, the "needs N more"
 * line, the contribution counter, and the copy rule (CLAIM_WORDS also covers this file's
 * output; the src scan in test/probe/popup.test.ts covers src/popup).
 */
import { describe, expect, it } from "vitest";
import {
  cellKeyOf,
  contributionText,
  formatMinor,
  ladderElement,
  ladderView,
  neededText,
  stateText,
} from "../../src/popup/ladder";
import type { CellFetch, CellSummary } from "../../src/sync/transport";
import { validObservation } from "../fixtures";

const CLAIM_WORDS = /\b(save|saves|saving|savings|cheapest|cheaper|lowest price|guarantee[sd]?)\b/i;

/** Cell responses shaped exactly as apps/api/src/routes/cells.ts returns them. */
const RESOLVED: CellSummary = {
  cellKey: "instacart|10769|2748189|delivery|085",
  resolution: {
    status: "RESOLVED",
    tiers: [
      { price: 199, share: 0.2, n: 10 },
      { price: 249, share: 0.3, n: 15 },
      { price: 299, share: 0.5, n: 25 },
    ],
    floor: 199,
    confidence: 0.99,
    n: 50,
    currency: "USD",
    windowHours: 72,
  },
  n: 50,
  panelists: 50,
  observations: 132,
  summary:
    "3 prices in the last 3 days across 50 observations: $1.99 (20%), $2.49 (30%), $2.99 (50%). Floor: $1.99, seen 10 times. Confidence 99% that no tier is still hidden.",
  updatedAt: "2026-09-07T12:00:00.000Z",
};

const UNRESOLVED: CellSummary = {
  cellKey: RESOLVED.cellKey,
  resolution: {
    status: "UNRESOLVED",
    reason: "insufficient_n",
    n: 4,
    needed: 5,
    tiersSeen: 3,
    currency: "USD",
    windowHours: 72,
  },
  n: 4,
  panelists: 4,
  observations: 9,
  summary:
    "Not enough data yet: 4 observations in the last 3 days showing 3 distinct prices. About 5 more needed before the tiers can be resolved.",
  updatedAt: "2026-09-07T12:00:00.000Z",
};

const NO_DATA: CellSummary = {
  cellKey: RESOLVED.cellKey,
  resolution: {
    status: "UNRESOLVED",
    reason: "no_observations",
    n: 0,
    needed: 5,
    tiersSeen: 0,
    currency: "USD",
    windowHours: 72,
  },
  n: 0,
  panelists: 0,
  observations: 0,
  summary: "0 observations in the last 3 days. About 5 needed before price tiers can be resolved.",
  updatedAt: "2026-09-07T12:00:00.000Z",
};

const ok = (cell: CellSummary): CellFetch => ({ ok: true, cell });

function text(node: HTMLElement): string {
  return (node.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("ladderView", () => {
  it("RESOLVED: one bar per tier, the user's tier and the floor marked", () => {
    const view = ladderView(ok(RESOLVED), 249);
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.tiers).toEqual([
      { price: 199, share: 0.2, n: 10, mine: false, floor: true },
      { price: 249, share: 0.3, n: 15, mine: true, floor: false },
      { price: 299, share: 0.5, n: 25, mine: false, floor: false },
    ]);
    expect(view.n).toBe(50);
    expect(view.mineOnLadder).toBe(true);
    expect(view.summary).toBe(RESOLVED.summary);
    expect(ladderView(ok(RESOLVED), 105)).toMatchObject({ kind: "resolved", mineOnLadder: false });
  });

  it("UNRESOLVED: carries needed and whether more data will help", () => {
    expect(ladderView(ok(UNRESOLVED), 199)).toEqual({
      kind: "unresolved",
      needed: 5,
      summary: UNRESOLVED.summary,
      n: 4,
      moreWillHelp: true,
    });
    const mixed: CellSummary = {
      ...UNRESOLVED,
      resolution: {
        status: "UNRESOLVED",
        reason: "too_many_tiers",
        n: 40,
        needed: 0,
        tiersSeen: 9,
        currency: "USD",
        windowHours: 72,
      },
    };
    expect(ladderView(ok(mixed), 199)).toMatchObject({ kind: "unresolved", moreWillHelp: false });
  });

  it("NO DATA: nobody observed the cell, or the panel could not be reached", () => {
    expect(ladderView(ok(NO_DATA), 199)).toEqual({ kind: "no_data", summary: NO_DATA.summary });
    expect(ladderView({ ok: false, reason: "network_error" }, 199)).toEqual({
      kind: "no_data",
      unreachable: true,
    });
    expect(ladderView({ ok: false, reason: "http_error", status: 401 }, 199)).toMatchObject({
      kind: "no_data",
      unreachable: true,
    });
  });
});

describe("ladderElement", () => {
  it("renders RESOLVED with a bar per tier, widths by share, your tier and the floor labelled", () => {
    const node = ladderElement(ladderView(ok(RESOLVED), 249));
    expect(text(node)).toContain("RESOLVED");
    const tiers = Array.from(node.querySelectorAll("li.tier"));
    expect(tiers).toHaveLength(3);
    expect(tiers.map((t) => t.querySelector(".bar")?.getAttribute("style"))).toEqual([
      "width: 20%",
      "width: 30%",
      "width: 50%",
    ]);
    expect(tiers[0]?.className).toBe("tier floor");
    expect(tiers[1]?.className).toBe("tier mine");
    expect(tiers[2]?.className).toBe("tier");
    expect(text(tiers[0] as HTMLElement)).toBe("$1.99 · 20% (floor)");
    expect(text(tiers[1] as HTMLElement)).toBe("$2.49 · 30% (your price)");
    expect(text(tiers[2] as HTMLElement)).toBe("$2.99 · 50%");
    // The explain line, with N.
    expect(text(node)).toContain("across 50 observations");
    expect(text(node)).not.toContain("not one of the confirmed tiers");
  });

  it("says when the user's price is not on the ladder", () => {
    const node = ladderElement(ladderView(ok(RESOLVED), 105));
    expect(text(node)).toContain("Your recorded price is not one of the confirmed tiers yet.");
    expect(node.querySelectorAll("li.tier.mine")).toHaveLength(0);
  });

  it("renders UNRESOLVED with the needs-N-more line and the explain line", () => {
    const node = ladderElement(ladderView(ok(UNRESOLVED), 199));
    expect(text(node)).toContain("UNRESOLVED");
    expect(text(node)).toContain("Needs 5 more observations");
    expect(text(node)).toContain("4 observations in the last 3 days");
    expect(node.querySelectorAll("li.tier")).toHaveLength(0);
  });

  it("renders NO DATA for an empty cell and for an unreachable panel", () => {
    const empty = ladderElement(ladderView(ok(NO_DATA), 199));
    expect(text(empty)).toContain("NO DATA");
    expect(text(empty)).toContain("0 observations in the last 3 days");
    const down = ladderElement(ladderView({ ok: false, reason: "network_error" }, 199));
    expect(text(down)).toContain("NO DATA");
    expect(text(down)).toContain("Could not reach the panel");
  });

  it("renders the loading and unconfigured placeholders", () => {
    expect(text(ladderElement({ kind: "loading" }))).toContain("Checking the panel");
    const off = ladderElement({ kind: "unconfigured" });
    expect(text(off)).toContain("NO DATA");
    expect(text(off)).toContain("no panel access configured");
  });

  it("uses no claim language in any state", () => {
    const views = [
      ladderView(ok(RESOLVED), 249),
      ladderView(ok(RESOLVED), 105),
      ladderView(ok(UNRESOLVED), 199),
      ladderView(ok(NO_DATA), 199),
      ladderView({ ok: false, reason: "network_error" }, 199),
      { kind: "loading" } as const,
      { kind: "unconfigured" } as const,
    ];
    for (const view of views) {
      expect(text(ladderElement(view))).not.toMatch(CLAIM_WORDS);
      expect(stateText(view)).not.toMatch(CLAIM_WORDS);
    }
    for (const n of [0, 1, 12]) {
      expect(contributionText(n)).not.toMatch(CLAIM_WORDS);
      expect(neededText(n)).not.toMatch(CLAIM_WORDS);
    }
  });
});

describe("copy helpers", () => {
  it("state words are exactly the brief's three", () => {
    expect(stateText(ladderView(ok(RESOLVED), 199))).toBe("RESOLVED");
    expect(stateText(ladderView(ok(UNRESOLVED), 199))).toBe("UNRESOLVED");
    expect(stateText(ladderView(ok(NO_DATA), 199))).toBe("NO DATA");
  });

  it("pluralises", () => {
    expect(neededText(1)).toBe("Needs 1 more observation");
    expect(neededText(12)).toBe("Needs 12 more observations");
    expect(contributionText(0)).toBe("You contributed 0 observations this week.");
    expect(contributionText(1)).toBe("You contributed 1 observation this week.");
    expect(contributionText(7)).toBe("You contributed 7 observations this week.");
  });

  it("formats minor units like the stats package", () => {
    expect(formatMinor(22, "USD")).toBe("$0.22");
    expect(formatMinor(1200, "USD")).toBe("$12.00");
    expect(formatMinor(1200, "EUR")).toBe("12.00 EUR");
  });

  it("computes the cell key exactly as the API does", () => {
    const o = validObservation();
    expect(cellKeyOf(o)).toBe("instacart|safeway|item_123456|delivery|941");
    const { store: _s, ...noStore } = o;
    const { zip3: _z, ...context } = o.context;
    expect(cellKeyOf({ ...noStore, context })).toBe("instacart||item_123456|delivery|");
  });
});

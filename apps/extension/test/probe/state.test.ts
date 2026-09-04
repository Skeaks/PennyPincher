/** The rate table, the result cache and its cap, and the per-retailer counters. */
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  MAX_RESULTS,
  PROBE_INTERVAL_MS,
  PROBE_KEY,
  clearProbeState,
  loadProbeState,
  pruneRate,
  recordResult,
  reserveProbe,
  updateProbeState,
} from "../../src/probe/state";
import { type ProbeResult, emptyProbeState } from "../../src/probe/types";

function result(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    key: "instacart:1",
    retailer: "instacart",
    retailerSku: "1",
    url: "https://www.instacart.com/store/wegmans/products/1-x",
    checkedAt: "2026-09-04T15:30:00.000Z",
    mine: { observationId: "a", amountMinor: 22, priceText: "$0.22", fulfillment: "delivery" },
    verdict: "SAME",
    deltaMinor: 0,
    ...overrides,
  };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe("reserveProbe / pruneRate", () => {
  it("grants the first claim, refuses within the hour, grants again after it", () => {
    const state = emptyProbeState();
    expect(reserveProbe(state, "k", 1000)).toBe(true);
    expect(reserveProbe(state, "k", 1000 + PROBE_INTERVAL_MS - 1)).toBe(false);
    expect(state.rate.k).toBe(1000);
    expect(reserveProbe(state, "k", 1000 + PROBE_INTERVAL_MS)).toBe(true);
    expect(state.rate.k).toBe(1000 + PROBE_INTERVAL_MS);
  });

  it("a clock that went backwards does not lock the key", () => {
    const state = emptyProbeState();
    reserveProbe(state, "k", 5000);
    expect(reserveProbe(state, "k", 4000)).toBe(true);
  });

  it("prune drops only the entries whose hour has passed", () => {
    const state = emptyProbeState();
    state.rate = { old: 0, fresh: PROBE_INTERVAL_MS };
    pruneRate(state, PROBE_INTERVAL_MS + 1);
    expect(state.rate).toEqual({ fresh: PROBE_INTERVAL_MS });
  });
});

describe("recordResult", () => {
  it("counts checks, differences and failures per retailer, failures by reason", () => {
    const state = emptyProbeState();
    recordResult(state, result({ key: "instacart:1", verdict: "SAME" }));
    recordResult(state, result({ key: "instacart:2", verdict: "MORE", deltaMinor: 5 }));
    recordResult(state, result({ key: "instacart:3", verdict: "LESS", deltaMinor: -5 }));
    recordResult(state, result({ key: "instacart:4", verdict: "STORE_DIFFERS" }));
    recordResult(state, result({ key: "instacart:5", verdict: "UNCHECKED", reason: "no_price" }));
    recordResult(state, result({ key: "instacart:6", verdict: "UNCHECKED", reason: "no_price" }));
    recordResult(state, result({ key: "instacart:7", verdict: "UNCHECKED", reason: "redirected" }));
    recordResult(state, result({ key: "target:1", retailer: "target", verdict: "STORE_DIFFERS" }));
    expect(state.stats).toEqual({
      instacart: {
        checks: 7,
        differences: 2,
        failures: 3,
        failuresByReason: { no_price: 2, redirected: 1 },
      },
      target: { checks: 1, differences: 0, failures: 0, failuresByReason: {} },
    });
    expect(Object.keys(state.results)).toHaveLength(8);
  });

  it("a new result for the same key replaces the old one", () => {
    const state = emptyProbeState();
    recordResult(state, result({ verdict: "SAME" }));
    recordResult(
      state,
      result({ verdict: "MORE", deltaMinor: 3, checkedAt: "2026-09-04T16:30:00.000Z" }),
    );
    expect(state.results["instacart:1"]?.verdict).toBe("MORE");
    expect(state.stats.instacart?.checks).toBe(2);
  });

  it(`keeps at most ${MAX_RESULTS} results, dropping the oldest`, () => {
    const state = emptyProbeState();
    for (let i = 0; i < MAX_RESULTS + 3; i++) {
      recordResult(
        state,
        result({
          key: `instacart:${i}`,
          retailerSku: String(i),
          checkedAt: new Date(Date.UTC(2026, 8, 4, 0, 0, i)).toISOString(),
        }),
      );
    }
    expect(Object.keys(state.results)).toHaveLength(MAX_RESULTS);
    expect(state.results["instacart:0"]).toBeUndefined();
    expect(state.results["instacart:2"]).toBeUndefined();
    expect(state.results["instacart:3"]).toBeDefined();
    expect(state.results[`instacart:${MAX_RESULTS + 2}`]).toBeDefined();
    expect(state.stats.instacart?.checks).toBe(MAX_RESULTS + 3);
  });
});

describe("storage", () => {
  it("loads an empty state, persists updates, and clears", async () => {
    expect(await loadProbeState()).toEqual(emptyProbeState());
    await updateProbeState((s) => {
      reserveProbe(s, "k", 1);
    });
    expect((await loadProbeState()).rate).toEqual({ k: 1 });
    await clearProbeState();
    expect(await loadProbeState()).toEqual(emptyProbeState());
    expect((await fakeBrowser.storage.local.get(PROBE_KEY))[PROBE_KEY]).toBeUndefined();
  });

  it("ignores a corrupt record", async () => {
    await fakeBrowser.storage.local.set({ [PROBE_KEY]: { version: 99 } });
    expect(await loadProbeState()).toEqual(emptyProbeState());
  });

  it("concurrent updates do not lose writes", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        updateProbeState((s) => {
          reserveProbe(s, `k${i}`, 1);
        }),
      ),
    );
    expect(Object.keys((await loadProbeState()).rate)).toHaveLength(20);
  });
});

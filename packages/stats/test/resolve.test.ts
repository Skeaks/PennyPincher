import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOW_HOURS,
  MAX_TIERS,
  MIN_TIER_SIGHTINGS,
  RESOLVE_SAFETY_FACTOR,
  SINGLETON_NOISE_MIN_N,
  requiredObservations,
  resolve,
} from "../src/index";
import { NOW, SYNTH_START, obs, repeated } from "./helpers";

describe("required N", () => {
  it("is ceil(k * H_k * 1.5): k=1 -> 2, k=2 -> 5, k=3 -> 9, k=4 -> 13, k=5 -> 18, k=8 -> 33", () => {
    expect(RESOLVE_SAFETY_FACTOR).toBe(1.5);
    expect([1, 2, 3, 4, 5, 8].map(requiredObservations)).toEqual([2, 5, 9, 13, 18, 33]);
  });
});

describe("resolve: RESOLVED", () => {
  it("finds tiers, shares, floor, and n on a clean three-tier cell", () => {
    const r = resolve(obs(repeated({ 299: 10, 199: 4, 249: 6 })), { now: NOW });
    expect(r.status).toBe("RESOLVED");
    if (r.status !== "RESOLVED") return;
    expect(r.tiers).toEqual([
      { price: 199, share: 0.2, n: 4 },
      { price: 249, share: 0.3, n: 6 },
      { price: 299, share: 0.5, n: 10 },
    ]);
    expect(r.floor).toBe(199);
    expect(r.n).toBe(20);
    expect(r.currency).toBe("USD");
    expect(r.windowHours).toBe(DEFAULT_WINDOW_HOURS);
    expect(r.confidence).toBeGreaterThan(0.95);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it("a single price resolves once seen MIN_TIER_SIGHTINGS times", () => {
    const r = resolve(obs([499, 499, 499]), { now: NOW });
    expect(r).toMatchObject({ status: "RESOLVED", floor: 499, n: 3 });
    if (r.status === "RESOLVED") expect(r.tiers).toEqual([{ price: 499, share: 1, n: 3 }]);
  });

  it("confidence grows with n at fixed shares", () => {
    const at = (n: number) => {
      const r = resolve(obs(repeated({ 199: n / 2, 299: n / 2 })), { now: NOW });
      return r.status === "RESOLVED" ? r.confidence : -1;
    };
    // Two equal tiers: P(all seen) = 1 - 2 * 0.5^n.
    expect(at(6)).toBeCloseTo(1 - 2 * 0.5 ** 6, 12);
    expect(at(20)).toBeCloseTo(1 - 2 * 0.5 ** 20, 12);
    expect(at(6)).toBeLessThan(at(20));
  });

  it("carries the currency of the observations", () => {
    const prices = obs(repeated({ 100: 3, 200: 3 }));
    for (const o of prices) o.facts.price.currency = "EUR";
    const r = resolve(prices, { now: NOW });
    expect(r.currency).toBe("EUR");
  });
});

describe("resolve: UNRESOLVED", () => {
  it("no_observations on an empty input, with the k=2 minimum as needed", () => {
    expect(resolve([], { now: NOW })).toEqual({
      status: "UNRESOLVED",
      reason: "no_observations",
      n: 0,
      needed: requiredObservations(2),
      tiersSeen: 0,
      currency: "USD",
      windowHours: DEFAULT_WINDOW_HOURS,
    });
  });

  it("insufficient_n reports the shortfall against ceil(k * H_k * 1.5)", () => {
    // Two tiers seen, 3 observations, need 5 for k=2. But the rare tier (199, seen once)
    // also needs ~3/p = 9 total before it clears the sightings guard, and `needed` is the
    // larger of the two shortfalls so the number does not creep upward one guard at a time.
    const r = resolve(obs([199, 299, 299]), { now: NOW });
    expect(r).toMatchObject({
      status: "UNRESOLVED",
      reason: "insufficient_n",
      n: 3,
      needed: 6,
      tiersSeen: 2,
    });
    // With every tier already seen 3+ times, the shortfall is the coupon one alone.
    const r2 = resolve(obs([199, 199, 199, 299, 299, 299, 399]), { now: NOW });
    expect(r2).toMatchObject({ reason: "insufficient_n", n: 7, needed: 14 });
  });

  it("rare_tier_unconfirmed when the rarest tier has fewer than MIN_TIER_SIGHTINGS", () => {
    // Enough N for k=2 (need 5) but the floor was seen once.
    const r = resolve(obs(repeated({ 199: 1, 299: 9 })), { now: NOW });
    expect(r).toMatchObject({
      status: "UNRESOLVED",
      reason: "rare_tier_unconfirmed",
      n: 10,
      tiersSeen: 2,
    });
    // ~3/p with p = 1/10: 30 total, so 20 more.
    if (r.status === "UNRESOLVED") expect(r.needed).toBe(MIN_TIER_SIGHTINGS * 10 - 10);
  });

  it("rare_tier_unconfirmed applies to a rare tier that is not the floor too", () => {
    const r = resolve(obs(repeated({ 199: 9, 299: 2 })), { now: NOW });
    expect(r).toMatchObject({ status: "UNRESOLVED", reason: "rare_tier_unconfirmed", n: 11 });
  });

  it("needed is at least 1 while UNRESOLVED", () => {
    const r = resolve(obs(repeated({ 199: 2, 299: 2 })), { now: NOW });
    expect(r.status).toBe("UNRESOLVED");
    if (r.status === "UNRESOLVED") expect(r.needed).toBeGreaterThanOrEqual(1);
  });

  it("too_many_tiers above MAX_TIERS repeated prices, needed 0", () => {
    const counts: Record<number, number> = {};
    for (let i = 0; i <= MAX_TIERS; i++) counts[100 + i] = 5;
    const r = resolve(obs(repeated(counts)), { now: NOW });
    expect(r).toMatchObject({
      status: "UNRESOLVED",
      reason: "too_many_tiers",
      needed: 0,
      tiersSeen: MAX_TIERS + 1,
    });
  });

  it("exactly MAX_TIERS tiers can resolve", () => {
    const counts: Record<number, number> = {};
    for (let i = 0; i < MAX_TIERS; i++) counts[100 + i] = 6;
    const r = resolve(obs(repeated(counts)), { now: NOW });
    expect(r.status).toBe("RESOLVED");
    if (r.status === "RESOLVED") expect(r.tiers).toHaveLength(MAX_TIERS);
  });
});

describe("noise: singletons", () => {
  it("below SINGLETON_NOISE_MIN_N a singleton is kept and blocks resolution", () => {
    const n = SINGLETON_NOISE_MIN_N - 1;
    const r = resolve(obs(repeated({ 199: n - 1, 999: 1 })), { now: NOW });
    expect(r).toMatchObject({ status: "UNRESOLVED", reason: "rare_tier_unconfirmed", n });
  });

  it("at SINGLETON_NOISE_MIN_N a singleton above the floor is dropped as noise", () => {
    const n = SINGLETON_NOISE_MIN_N;
    const r = resolve(obs(repeated({ 199: n - 1, 999: 1 })), { now: NOW });
    expect(r.status).toBe("RESOLVED");
    if (r.status !== "RESOLVED") return;
    expect(r.tiers).toEqual([{ price: 199, share: 1, n: n - 1 }]);
    // n counts the dropped observation; shares are over the kept tiers.
    expect(r.n).toBe(n);
  });

  it("a singleton BELOW the floor is never dropped, however large the cell", () => {
    const r = resolve(obs(repeated({ 22: 1, 249: 500 })), { now: NOW });
    expect(r).toMatchObject({ status: "UNRESOLVED", reason: "rare_tier_unconfirmed", n: 501 });
  });

  it("a price seen twice is not noise", () => {
    const r = resolve(obs(repeated({ 199: 200, 999: 2 })), { now: NOW });
    expect(r).toMatchObject({ status: "UNRESOLVED", reason: "rare_tier_unconfirmed" });
  });

  it("when every price is a singleton nothing is dropped", () => {
    const prices = Array.from({ length: SINGLETON_NOISE_MIN_N }, (_, i) => 100 + i);
    const r = resolve(obs(prices), { now: NOW });
    expect(r).toMatchObject({ status: "UNRESOLVED", reason: "too_many_tiers" });
    if (r.status === "UNRESOLVED") expect(r.tiersSeen).toBe(SINGLETON_NOISE_MIN_N);
  });
});

describe("time window", () => {
  const H = 3_600_000;

  it("defaults to 72 hours ending at now; older observations do not count", () => {
    const nowMs = Date.parse(NOW);
    const inside = new Date(nowMs - 71 * H).toISOString();
    const outside = new Date(nowMs - 73 * H).toISOString();
    const rows = [
      ...obs(repeated({ 199: 3, 299: 3 }), inside),
      ...obs(repeated({ 99: 3 }), outside),
    ];
    const r = resolve(rows, { now: NOW });
    expect(r).toMatchObject({ status: "RESOLVED", floor: 199, n: 6 });
  });

  it("windowHours is honoured", () => {
    const nowMs = Date.parse(NOW);
    const rows = [
      ...obs(repeated({ 199: 3, 299: 3 }), new Date(nowMs - 2 * H).toISOString()),
      ...obs(repeated({ 99: 3 }), new Date(nowMs - 10 * H).toISOString()),
    ];
    expect(resolve(rows, { now: NOW, windowHours: 24 })).toMatchObject({ floor: 99, n: 9 });
    expect(resolve(rows, { now: NOW, windowHours: 6 })).toMatchObject({ floor: 199, n: 6 });
    expect(resolve(rows, { now: NOW, windowHours: 1 })).toMatchObject({
      status: "UNRESOLVED",
      reason: "no_observations",
      windowHours: 1,
    });
  });

  it("observations dated after now do not count", () => {
    const rows = obs(repeated({ 199: 3, 299: 3 }));
    // Window ends before the sample starts.
    const r = resolve(rows, { now: new Date(Date.parse(SYNTH_START) - 1000) });
    expect(r).toMatchObject({ status: "UNRESOLVED", reason: "no_observations" });
  });

  it("unparseable timestamps are ignored, not fatal", () => {
    const rows = obs(repeated({ 199: 3, 299: 3 }));
    rows.push({ observedAt: "not a date", facts: { price: { amountMinor: 1 } } });
    expect(resolve(rows, { now: NOW })).toMatchObject({ status: "RESOLVED", floor: 199, n: 6 });
  });

  it("accepts now as ISO string, epoch ms, or Date", () => {
    const rows = obs(repeated({ 199: 3, 299: 3 }));
    for (const now of [NOW, Date.parse(NOW), new Date(NOW)]) {
      expect(resolve(rows, { now })).toMatchObject({ status: "RESOLVED", n: 6 });
    }
  });

  it("rejects a non-positive windowHours and an invalid now", () => {
    expect(() => resolve([], { windowHours: 0 })).toThrow(RangeError);
    expect(() => resolve([], { windowHours: -1 })).toThrow(RangeError);
    expect(() => resolve([], { now: "yesterday" })).toThrow(RangeError);
  });

  it("does not use the wall clock when now is given", () => {
    // Synth-dated observations are in the past relative to any real run; with `now` fixed
    // they resolve, and the default (wall clock) would not see them once 72 h have passed.
    const rows = obs(repeated({ 199: 3, 299: 3 }));
    expect(resolve(rows, { now: NOW }).n).toBe(6);
  });
});

describe("input validation", () => {
  it("rejects non-integer or negative prices", () => {
    expect(() =>
      resolve([{ observedAt: NOW, facts: { price: { amountMinor: 1.5 } } }], { now: NOW }),
    ).toThrow(RangeError);
    expect(() =>
      resolve([{ observedAt: NOW, facts: { price: { amountMinor: -1 } } }], { now: NOW }),
    ).toThrow(RangeError);
  });

  it("does not mutate its input", () => {
    const rows = obs(repeated({ 299: 3, 199: 3 }));
    const before = JSON.stringify(rows);
    resolve(rows, { now: NOW });
    expect(JSON.stringify(rows)).toBe(before);
  });
});

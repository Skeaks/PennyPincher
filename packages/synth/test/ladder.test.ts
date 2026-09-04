import { PriceObservation } from "@pennypincher/schema";
import { describe, expect, it } from "vitest";
import { buildTruth, generateLadder, validateSample } from "../src/index";

const TIERS = [199, 249, 299]; // cents

function frequencies(tiers: number[], k: number): number[] {
  const counts = new Array<number>(k).fill(0);
  for (const t of tiers) counts[t] = (counts[t] ?? 0) + 1;
  return counts.map((c) => c / tiers.length);
}

describe("truth", () => {
  it("sorts tiers ascending and carries probabilities with them", () => {
    const { truth } = generateLadder({
      tiers: [299, 199, 249],
      probabilities: [0.5, 0.2, 0.3],
      seed: 1,
    });
    expect(truth.prices).toEqual([199, 249, 299]);
    expect(truth.probabilities).toEqual([0.2, 0.3, 0.5]);
    expect(truth.floor).toBe(199);
    expect(truth.floorProbability).toBe(0.2);
    expect(truth.k).toBe(3);
  });

  it("defaults to uniform probabilities", () => {
    const { truth } = generateLadder({ tiers: TIERS, seed: 1 });
    expect(truth.probabilities).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it("floorRarity pins the lowest tier and rescales the rest in proportion", () => {
    const { truth } = generateLadder({
      tiers: TIERS,
      probabilities: [0.5, 0.3, 0.2],
      floorRarity: 0.1,
      seed: 1,
    });
    expect(truth.probabilities[0]).toBeCloseTo(0.1, 12);
    expect(truth.probabilities[1]).toBeCloseTo(0.9 * 0.6, 12);
    expect(truth.probabilities[2]).toBeCloseTo(0.9 * 0.4, 12);
  });

  it("plantFloor adds a new tier below every existing one at rarity p", () => {
    const { truth } = generateLadder({
      tiers: TIERS,
      plantFloor: { price: 149, p: 0.05 },
      seed: 1,
    });
    expect(truth.prices).toEqual([149, 199, 249, 299]);
    expect(truth.floor).toBe(149);
    expect(truth.floorProbability).toBe(0.05);
    expect(truth.probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    for (const p of truth.probabilities.slice(1)) expect(p).toBeCloseTo(0.95 / 3, 12);
  });

  it("rejects bad input loudly", () => {
    expect(() => buildTruth({ tiers: [], seed: 1 })).toThrow(/empty/);
    expect(() => buildTruth({ tiers: [1.5], seed: 1 })).toThrow(/integers/);
    expect(() => buildTruth({ tiers: [199, 199], seed: 1 })).toThrow(/distinct/);
    expect(() => buildTruth({ tiers: TIERS, probabilities: [0.5, 0.5], seed: 1 })).toThrow(
      /one entry/,
    );
    expect(() => buildTruth({ tiers: TIERS, probabilities: [0.5, 0.3, 0.3], seed: 1 })).toThrow(
      /sum/,
    );
    expect(() => buildTruth({ tiers: TIERS, floorRarity: 1, seed: 1 })).toThrow(/floorRarity/);
    expect(() => buildTruth({ tiers: TIERS, plantFloor: { price: 250, p: 0.1 }, seed: 1 })).toThrow(
      /below the lowest/,
    );
    expect(() => generateLadder({ tiers: TIERS, stickiness: 1.2, seed: 1 })).toThrow(/stickiness/);
    expect(() => generateLadder({ tiers: TIERS, observers: 0, seed: 1 })).toThrow(/observers/);
  });
});

describe("sampling", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = generateLadder({ tiers: TIERS, seed: "alpha" }).sample(50);
    const b = generateLadder({ tiers: TIERS, seed: "alpha" }).sample(50);
    const c = generateLadder({ tiers: TIERS, seed: "beta" }).sample(50);
    expect(a).toEqual(b);
    expect(a.map((o) => o.facts.price.amountMinor)).not.toEqual(
      c.map((o) => o.facts.price.amountMinor),
    );
    expect(a[0]?.observationId).not.toBe(c[0]?.observationId);
  });

  it("sample(n) is a prefix of sample(n + m)", () => {
    const ladder = generateLadder({ tiers: TIERS, seed: 7, observers: 10, stickiness: 0.5 });
    expect(ladder.sample(120).slice(0, 40)).toEqual(ladder.sample(40));
  });

  it("draws i.i.d. from the tier distribution (10,000 draws within 1.5 points of truth)", () => {
    const ladder = generateLadder({
      tiers: [100, 200, 300, 400],
      probabilities: [0.1, 0.2, 0.3, 0.4],
      seed: 42,
    });
    const freq = frequencies(ladder.sampleTiers(10_000), 4);
    for (let i = 0; i < 4; i++) {
      expect(Math.abs((freq[i] ?? 0) - (ladder.truth.probabilities[i] ?? 0))).toBeLessThan(0.015);
    }
  });

  it("shows no serial correlation at stickiness 0 (lag-1 agreement ~ sum of p^2)", () => {
    const ladder = generateLadder({ tiers: TIERS, seed: 3, observers: 1 });
    const t = ladder.sampleTiers(20_000);
    let same = 0;
    for (let i = 1; i < t.length; i++) if (t[i] === t[i - 1]) same++;
    // Independent draws agree with probability sum(p_i^2) = 1/3 for three uniform tiers.
    expect(same / (t.length - 1)).toBeCloseTo(1 / 3, 1);
  });

  it("a planted floor at rarity p shows up at ~p", () => {
    const ladder = generateLadder({ tiers: TIERS, plantFloor: { price: 149, p: 0.02 }, seed: 11 });
    const obs = ladder.sample(20_000);
    const floorShare = obs.filter((o) => o.facts.price.amountMinor === 149).length / obs.length;
    expect(floorShare).toBeGreaterThan(0.015);
    expect(floorShare).toBeLessThan(0.025);
    expect(Math.min(...obs.map((o) => o.facts.price.amountMinor))).toBe(ladder.truth.floor);
  });

  it("never emits a price outside the truth set", () => {
    const ladder = generateLadder({ tiers: TIERS, plantFloor: { price: 149, p: 0.1 }, seed: 5 });
    const allowed = new Set(ladder.truth.prices);
    for (const o of ladder.sample(2_000)) expect(allowed.has(o.facts.price.amountMinor)).toBe(true);
  });
});

describe("stickiness and observers", () => {
  it("at stickiness 1 every observer repeats their first tier forever", () => {
    const ladder = generateLadder({ tiers: TIERS, seed: 9, observers: 5, stickiness: 1 });
    const obs = ladder.sample(500);
    const byPanelist = new Map<string, Set<number>>();
    for (const o of obs) {
      const set = byPanelist.get(o.panelistId) ?? new Set<number>();
      set.add(o.facts.price.amountMinor);
      byPanelist.set(o.panelistId, set);
    }
    expect(byPanelist.size).toBe(5);
    for (const prices of byPanelist.values()) expect(prices.size).toBe(1);
  });

  it("stickiness leaves the marginal distribution alone but raises lag-1 agreement", () => {
    const sticky = generateLadder({ tiers: TIERS, seed: 21, observers: 1, stickiness: 0.8 });
    const t = sticky.sampleTiers(30_000);
    const freq = frequencies(t, 3);
    for (const f of freq) expect(Math.abs(f - 1 / 3)).toBeLessThan(0.03);
    let same = 0;
    for (let i = 1; i < t.length; i++) if (t[i] === t[i - 1]) same++;
    // P(same) = s + (1 - s) * sum(p_i^2) = 0.8 + 0.2 / 3.
    expect(same / (t.length - 1)).toBeCloseTo(0.8 + 0.2 / 3, 1);
  });

  it("gives every observer a distinct panelistId, and every observation its own by default", () => {
    const solo = generateLadder({ tiers: TIERS, seed: 2 }).sample(300);
    expect(new Set(solo.map((o) => o.panelistId)).size).toBe(300);
    expect(new Set(solo.map((o) => o.observationId)).size).toBe(300);

    const panel = generateLadder({ tiers: TIERS, seed: 2, observers: 12 }).sample(300);
    expect(new Set(panel.map((o) => o.panelistId)).size).toBe(12);
    expect(new Set(panel.map((o) => o.observationId)).size).toBe(300);
  });
});

describe("schema", () => {
  it("every observation validates against @pennypincher/schema, including in 200-row batches", () => {
    const ladder = generateLadder({
      tiers: TIERS,
      plantFloor: { price: 149, p: 0.05 },
      seed: "schema",
      observers: 40,
      stickiness: 0.3,
    });
    const obs = ladder.sample(650);
    expect(validateSample(obs)).toEqual([]);
    for (const o of obs.slice(0, 5)) expect(PriceObservation.safeParse(o).success).toBe(true);
  });

  it("stamps the rendered price text and synth provenance", () => {
    const [o] = generateLadder({ tiers: [1234], seed: 1 }).sample(1);
    expect(o?.facts.priceText).toBe("$12.34");
    expect(o?.provenance.adapter).toMatch(/^synth@\d+\.\d+\.\d+$/);
    expect(o?.observedAt).toBe("2026-09-04T15:26:18.000Z");
  });

  it("honours a custom shell", () => {
    const [o] = generateLadder({
      tiers: [6],
      seed: 1,
      shell: {
        retailer: "walmart",
        store: { label: "East Windsor Supercenter" },
        retailerSku: "44390948",
        title: "Fresh Banana, Each",
        url: "https://www.walmart.com/ip/Fresh-Banana-Each/44390948",
        fulfillment: "pickup",
        sessionState: "logged_out",
      },
    }).sample(1);
    expect(o?.retailer).toBe("walmart");
    expect(o?.store).toEqual({ label: "East Windsor Supercenter" });
    expect(o?.facts.priceText).toBe("$0.06");
    expect(PriceObservation.safeParse(o).success).toBe(true);
  });
});

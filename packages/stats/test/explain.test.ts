import { describe, expect, it } from "vitest";
import { MAX_TIERS, type Resolution, explain, formatMinor, resolve } from "../src/index";
import { NOW, obs, repeated } from "./helpers";

/** CLAUDE.md rule 10: regulated claims. None of these may appear without a claims-reviewed label. */
const FORBIDDEN = ["save", "savings", "cheapest", "lowest price", "guarantee"];

function everyResolution(): Resolution[] {
  const tooMany: Record<number, number> = {};
  for (let i = 0; i <= MAX_TIERS; i++) tooMany[100 + i] = 5;
  return [
    resolve(obs(repeated({ 199: 4, 249: 6, 299: 10 })), { now: NOW }),
    resolve(obs(repeated({ 499: 3 })), { now: NOW }),
    resolve([], { now: NOW }),
    resolve(obs([199, 299, 299]), { now: NOW }),
    resolve(obs(repeated({ 199: 1, 299: 9 })), { now: NOW }),
    resolve(obs(repeated(tooMany)), { now: NOW }),
    resolve(obs(repeated({ 199: 4, 299: 4 })), { now: NOW, windowHours: 6 }),
  ];
}

describe("explain", () => {
  it("covers every status and reason", () => {
    const seen = new Set(
      everyResolution().map((r) => (r.status === "RESOLVED" ? "RESOLVED" : r.reason)),
    );
    expect([...seen].sort()).toEqual(
      [
        "RESOLVED",
        "insufficient_n",
        "no_observations",
        "rare_tier_unconfirmed",
        "too_many_tiers",
      ].sort(),
    );
  });

  it("always includes N and the window, never savings language", () => {
    for (const r of everyResolution()) {
      const line = explain(r);
      expect(line).toContain(String(r.n));
      expect(line).toMatch(/in the last \d+ (hours?|days?)/);
      for (const word of FORBIDDEN) {
        expect(line.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("RESOLVED: lists every tier with its share, names the floor and the confidence", () => {
    const r = resolve(obs(repeated({ 199: 4, 249: 6, 299: 10 })), { now: NOW });
    expect(explain(r)).toBe(
      "3 prices in the last 3 days across 20 observations: $1.99 (20%), $2.49 (30%), $2.99 (50%). Floor: $1.99, seen 4 times. Confidence 99% that no tier is still hidden.",
    );
  });

  it("RESOLVED with one price says so plainly", () => {
    const r = resolve(obs(repeated({ 499: 3 })), { now: NOW });
    expect(explain(r)).toBe(
      "One price in the last 3 days: $4.99, seen 3 times across 3 observations. Everyone we observed was shown the same price.",
    );
  });

  it("UNRESOLVED lines state how many more observations are needed", () => {
    expect(explain(resolve([], { now: NOW }))).toBe(
      "0 observations in the last 3 days. About 5 needed before price tiers can be resolved.",
    );
    expect(explain(resolve(obs([199, 299, 299]), { now: NOW }))).toBe(
      "Not enough data yet: 3 observations in the last 3 days showing 2 distinct prices. About 6 more needed before the tiers can be resolved.",
    );
    expect(explain(resolve(obs(repeated({ 199: 1, 299: 9 })), { now: NOW }))).toBe(
      "10 observations in the last 3 days show 2 distinct prices, but the rarest has been seen fewer than 3 times. About 20 more needed to confirm it.",
    );
  });

  it("too_many_tiers says more data will not help", () => {
    const counts: Record<number, number> = {};
    for (let i = 0; i <= MAX_TIERS; i++) counts[100 + i] = 5;
    const line = explain(resolve(obs(repeated(counts)), { now: NOW }));
    expect(line).toContain("More observations will not help");
    expect(line).toContain(`${MAX_TIERS + 1} distinct prices`);
  });

  it("formats a non-24h window in hours and other currencies with their code", () => {
    const r = resolve(obs(repeated({ 199: 4, 299: 4 })), { now: NOW, windowHours: 6 });
    expect(explain(r)).toContain("in the last 6 hours");
    expect(formatMinor(22, "USD")).toBe("$0.22");
    expect(formatMinor(1200, "USD")).toBe("$12.00");
    expect(formatMinor(1205, "EUR")).toBe("12.05 EUR");
  });
});

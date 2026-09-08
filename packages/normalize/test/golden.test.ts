/**
 * The golden harness (S13). `__golden__/pairs.json` is a hand-labelled set of same/different
 * product pairs across Instacart, Target and Walmart. The matcher must reach precision 0.97
 * on "same": when it says two references are one product, it is right at least 97 times in
 * 100. Recall is reported, never gated: a missed match costs a cross-retailer ladder one
 * observation, a false merge corrupts it.
 *
 * The file is human-owned (CLAUDE.md rule 3). If this test fails after a relabel, fix the
 * matcher, not the labels.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { canonicalize, matchProducts } from "../src";

const Side = z.object({
  retailer: z.enum(["instacart", "target", "walmart"]),
  store: z.string().optional(),
  retailerSku: z.string().optional(),
  title: z.string().min(1),
  brand: z.string().optional(),
  sizeText: z.string().optional(),
  upc: z.string().optional(),
  source: z.string().min(1),
});

const Pair = z.object({
  id: z.string().regex(/^p\d{3}$/),
  label: z.enum(["same", "different"]),
  a: Side,
  b: Side,
  note: z.string().optional(),
});

const Golden = z.object({
  $comment: z.string(),
  status: z.enum(["proposed", "reviewed"]),
  labelledBy: z.string(),
  pairs: z.array(Pair),
});

const MIN_SAME_PRECISION = 0.97;

const golden = Golden.parse(
  JSON.parse(readFileSync(join(__dirname, "..", "__golden__", "pairs.json"), "utf8")),
);

describe("golden pairs file", () => {
  it("holds 100 pairs with unique ids", () => {
    expect(golden.pairs).toHaveLength(100);
    expect(new Set(golden.pairs.map((p) => p.id)).size).toBe(100);
  });

  it("covers all three retailers and both labels", () => {
    const retailers = new Set(golden.pairs.flatMap((p) => [p.a.retailer, p.b.retailer]));
    expect([...retailers].sort()).toEqual(["instacart", "target", "walmart"]);
    const labels = golden.pairs.reduce(
      (n, p) => {
        n[p.label] += 1;
        return n;
      },
      { same: 0, different: 0 },
    );
    expect(labels.same).toBeGreaterThanOrEqual(30);
    expect(labels.different).toBeGreaterThanOrEqual(30);
  });

  it("has at least one cross-retailer pair per label", () => {
    const cross = (label: "same" | "different") =>
      golden.pairs.some((p) => p.label === label && p.a.retailer !== p.b.retailer);
    expect(cross("same")).toBe(true);
    expect(cross("different")).toBe(true);
  });
});

describe("matcher against the golden pairs", () => {
  const results = golden.pairs.map((p) => ({ pair: p, match: matchProducts(p.a, p.b) }));
  const tp = results.filter((r) => r.match.same && r.pair.label === "same").length;
  const fp = results.filter((r) => r.match.same && r.pair.label === "different");
  const fn = results.filter((r) => !r.match.same && r.pair.label === "same");
  const precision = tp + fp.length === 0 ? 1 : tp / (tp + fp.length);
  const recall = tp + fn.length === 0 ? 1 : tp / (tp + fn.length);

  it(`reaches precision >= ${MIN_SAME_PRECISION} on "same"`, () => {
    expect(
      precision,
      `false merges: ${fp.map((r) => `${r.pair.id} (${r.pair.a.title} | ${r.pair.b.title})`).join("; ")}`,
    ).toBeGreaterThanOrEqual(MIN_SAME_PRECISION);
  });

  it("reports recall (not gated)", () => {
    const missed = fn.map(
      (r) => `${r.pair.id} ${r.match.reason ?? ""} ${r.match.score.toFixed(2)}`,
    );
    console.info(
      `golden: precision ${precision.toFixed(3)} recall ${recall.toFixed(3)} ` +
        `(tp ${tp}, fp ${fp.length}, fn ${fn.length}); missed: ${missed.join(", ") || "none"}`,
    );
    expect(recall).toBeGreaterThanOrEqual(0);
    expect(recall).toBeLessThanOrEqual(1);
  });

  it("gives every fixture-sourced side a canonical id", () => {
    for (const p of golden.pairs) {
      for (const side of [p.a, p.b]) {
        const c = canonicalize(side);
        expect(c.canonicalId, `${p.id} ${side.title}`).not.toBeNull();
        expect(c.method).not.toBe("none");
      }
    }
  });

  it("agrees on canonical ids for every UPC-decided same pair", () => {
    for (const { pair, match } of results) {
      if (match.method !== "upc" || pair.label !== "same") continue;
      expect(canonicalize(pair.a).canonicalId, pair.id).toBe(canonicalize(pair.b).canonicalId);
    }
  });
});

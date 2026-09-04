/**
 * The popup's view model: every state it can show, from data alone. Plus the copy rule: no
 * regulated claim word appears in anything the probe or popup can render (CLAUDE.md rule 10;
 * the brief adds "cheaper").
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { latestOwnObservation, popupView } from "../../src/popup/model";
import { verdictDetail, verdictText } from "../../src/probe/compare";
import { type ProbeResult, type ProbeVerdict, emptyProbeState } from "../../src/probe/types";
import { URL_BANANAS, fixture, ownInstacartObservation } from "./helpers";

const loggedIn = fixture("instacart", "wegmans-bananas");
const loggedOut = fixture("instacart", "wegmans-bananas-logged-out");

function result(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    key: "instacart:2748189",
    retailer: "instacart",
    retailerSku: "2748189",
    url: URL_BANANAS,
    checkedAt: "2026-09-04T15:30:00.000Z",
    mine: { observationId: "a", amountMinor: 22, priceText: "$0.22", fulfillment: "delivery" },
    anon: { observationId: "b", amountMinor: 22, priceText: "$0.22", fulfillment: "delivery" },
    verdict: "SAME",
    deltaMinor: 0,
    ...overrides,
  };
}

describe("popupView", () => {
  const mine = ownInstacartObservation(loggedIn, URL_BANANAS);

  it("is off without consent, whatever else is known", () => {
    const probe = emptyProbeState();
    probe.results[result().key] = result();
    expect(
      popupView({ consented: false, tabUrl: URL_BANANAS, observations: [mine], probe }),
    ).toEqual({ kind: "off" });
  });

  it("is unsupported off a supported product page, including no tab at all", () => {
    const probe = emptyProbeState();
    for (const tabUrl of [undefined, "https://example.com/", "https://www.instacart.com/store/"]) {
      expect(popupView({ consented: true, tabUrl, observations: [mine], probe })).toEqual({
        kind: "unsupported",
      });
    }
  });

  it("has no observation when nothing was recorded for this page", () => {
    expect(
      popupView({
        consented: true,
        tabUrl: URL_BANANAS,
        observations: [],
        probe: emptyProbeState(),
      }),
    ).toEqual({ kind: "no_observation" });
  });

  it("is pending when the user's price is known but no check has run", () => {
    expect(
      popupView({
        consented: true,
        tabUrl: `${URL_BANANAS}?utm=x#top`,
        observations: [mine],
        probe: emptyProbeState(),
      }),
    ).toMatchObject({ kind: "pending", mine: { amountMinor: 22, priceText: "$0.22" } });
  });

  it("shows the result for this product's key", () => {
    const probe = emptyProbeState();
    probe.results[result().key] = result({ verdict: "MORE", deltaMinor: 10 });
    expect(
      popupView({ consented: true, tabUrl: URL_BANANAS, observations: [mine], probe }),
    ).toEqual({
      kind: "result",
      result: result({ verdict: "MORE", deltaMinor: 10 }),
    });
  });

  it("never treats the probe's own anonymous row as the user's price", () => {
    const anon = ownInstacartObservation(
      loggedOut,
      URL_BANANAS,
      "11111111-0000-4000-8000-000000000009",
    );
    anon.context = { ...anon.context, cleanSession: true };
    anon.observedAt = "2026-09-04T16:00:00.000Z";
    expect(latestOwnObservation([mine, anon], URL_BANANAS)).toBe(mine);
    expect(latestOwnObservation([anon], URL_BANANAS)).toBeUndefined();
    const newer = { ...mine, observedAt: "2026-09-04T17:00:00.000Z" };
    expect(latestOwnObservation([mine, anon, newer], URL_BANANAS)).toBe(newer);
  });
});

const CLAIM_WORDS = /\b(save|saves|saving|savings|cheapest|cheaper|lowest price|guarantee[sd]?)\b/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("no claim language", () => {
  it("in any verdict line or detail", () => {
    const verdicts: ProbeVerdict[] = ["SAME", "MORE", "LESS", "STORE_DIFFERS", "UNCHECKED"];
    for (const v of verdicts) {
      expect(verdictText(v, 10)).not.toMatch(CLAIM_WORDS);
      expect(verdictDetail(v) ?? "").not.toMatch(CLAIM_WORDS);
    }
  });

  it("anywhere in src/probe, src/popup, or the entrypoints", () => {
    const src = join(__dirname, "..", "..", "src");
    const files = [
      ...walk(join(src, "probe")),
      ...walk(join(src, "popup")),
      ...walk(join(src, "entrypoints")),
    ].filter((f) => /\.(ts|html)$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(CLAIM_WORDS);
    }
  });
});

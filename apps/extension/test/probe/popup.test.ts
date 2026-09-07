/**
 * The popup's view model: every state it can show, from data alone. Plus the copy rule: no
 * regulated claim word appears in anything the probe or popup can render (CLAUDE.md rule 10;
 * the brief adds "cheaper").
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ListingTally } from "../../src/capture/tally";
import { type PopupInputs, latestOwnObservation, popupView } from "../../src/popup/model";
import { listingText } from "../../src/popup/render";
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

/** Inputs with no listing tally unless a test supplies one. */
function view(inputs: Omit<PopupInputs, "listingTally"> & { listingTally?: ListingTally }) {
  return popupView({ listingTally: {}, ...inputs });
}

describe("popupView", () => {
  const mine = ownInstacartObservation(loggedIn, URL_BANANAS);

  it("is off without consent, whatever else is known", () => {
    const probe = emptyProbeState();
    probe.results[result().key] = result();
    expect(view({ consented: false, tabUrl: URL_BANANAS, observations: [mine], probe })).toEqual({
      kind: "off",
    });
  });

  it("is unsupported off a supported product page, including no tab at all", () => {
    const probe = emptyProbeState();
    for (const tabUrl of [undefined, "https://example.com/", "https://www.instacart.com/store/"]) {
      expect(view({ consented: true, tabUrl, observations: [mine], probe })).toEqual({
        kind: "unsupported",
      });
    }
  });

  it("has no observation when nothing was recorded for this page", () => {
    expect(
      view({
        consented: true,
        tabUrl: URL_BANANAS,
        observations: [],
        probe: emptyProbeState(),
      }),
    ).toEqual({ kind: "no_observation" });
  });

  it("is pending when the user's price is known but no check has run", () => {
    expect(
      view({
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
    expect(view({ consented: true, tabUrl: URL_BANANAS, observations: [mine], probe })).toEqual({
      kind: "result",
      result: result({ verdict: "MORE", deltaMinor: 10 }),
    });
  });

  it("does not show a result computed against a price the page no longer shows", () => {
    // The probe ran an hour ago at $0.22; the page now shows $0.25 and capture stored it.
    const probe = emptyProbeState();
    probe.results[result().key] = result({ verdict: "SAME", deltaMinor: 0 });
    const repriced = {
      ...mine,
      observationId: "11111111-0000-4000-8000-000000000003",
      observedAt: "2026-09-04T16:00:00.000Z",
      facts: {
        ...mine.facts,
        price: { amountMinor: 25, currency: "USD" as const },
        priceText: "$0.25",
      },
    };
    expect(
      view({ consented: true, tabUrl: URL_BANANAS, observations: [mine, repriced], probe }),
    ).toMatchObject({ kind: "pending", mine: { amountMinor: 25, priceText: "$0.25" } });
    // Same price again on a later reload (new observation id): the result still applies.
    const reloaded = { ...mine, observationId: "11111111-0000-4000-8000-000000000004" };
    expect(
      view({ consented: true, tabUrl: URL_BANANAS, observations: [reloaded], probe }),
    ).toMatchObject({ kind: "result" });
  });

  it("says there is nothing to compare when the recorded price was not from a signed-in session", () => {
    const anon = ownInstacartObservation(loggedOut, URL_BANANAS);
    expect(anon.context.sessionState).toBe("logged_out");
    const probe = emptyProbeState();
    expect(
      view({ consented: true, tabUrl: URL_BANANAS, observations: [anon], probe }),
    ).toMatchObject({ kind: "not_signed_in", mine: { amountMinor: 22 } });
    // A cached result for the SKU does not change that: the probe never runs for this row.
    probe.results[result().key] = result();
    expect(
      view({ consented: true, tabUrl: URL_BANANAS, observations: [anon], probe }),
    ).toMatchObject({ kind: "not_signed_in" });
  });

  it("on a search, aisle or storefront page, reports the tally for that page (S17)", () => {
    const search = "https://www.instacart.com/store/walmart/s?k=milk#results";
    const probe = emptyProbeState();
    expect(view({ consented: true, tabUrl: search, observations: [mine], probe })).toEqual({
      kind: "listing",
      recorded: 0,
    });
    const listingTally = {
      "https://www.instacart.com/store/walmart/s": {
        recorded: 12,
        at: "2026-09-07T15:00:00.000Z",
      },
    };
    expect(
      view({ consented: true, tabUrl: search, observations: [mine], probe, listingTally }),
    ).toEqual({ kind: "listing", recorded: 12 });
    expect(
      view({ consented: false, tabUrl: search, observations: [], probe, listingTally }),
    ).toEqual({ kind: "off" });
    expect(listingText(0)).toBe("No prices recorded on this page yet.");
    expect(listingText(1)).toBe("1 price on this page recorded.");
    expect(listingText(12)).toBe("12 prices on this page recorded.");
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

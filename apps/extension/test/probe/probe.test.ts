/**
 * The probe end to end on fixture pages: the logged-in page triggers an anonymous fetch of the
 * same URL, the logged-out page is parsed by the same adapter, a second observation is stored
 * (`logged_out`, `cleanSession`, same panelist), the pair is compared, and the hour is claimed
 * whether or not the check produced a price.
 */
import { PriceObservation } from "@pennypincher/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { acceptConsent } from "../../src/lib/consent";
import { probeObservation } from "../../src/probe/probe";
import { PROBE_INTERVAL_MS, loadProbeState } from "../../src/probe/state";
import { append, count, list } from "../../src/store";
import {
  LOGIN_WALL_HTML,
  T0,
  URL_BANANAS,
  URL_TARGET_BANANA,
  directExtract,
  fakeFetch,
  fixture,
  ownInstacartObservation,
  probeDeps,
  sidecarAdapter,
  sidecarObservation,
  withPrice,
} from "./helpers";

const loggedIn = fixture("instacart", "wegmans-bananas");
const loggedOut = fixture("instacart", "wegmans-bananas-logged-out");
const strawberries = fixture("instacart", "wegmans-organic-strawberries-16oz");
const targetIn = fixture("target", "banana-each");
const targetOut = fixture("target", "banana-each-logged-out");

async function ownBananas(): Promise<PriceObservation> {
  const mine = ownInstacartObservation(loggedIn, URL_BANANAS);
  await append(mine);
  return mine;
}

beforeEach(async () => {
  fakeBrowser.reset();
  await acceptConsent(new Date("2026-09-04T10:00:00.000Z"));
});

describe("a logged-in observation with a logged-out page for the same SKU", () => {
  it("fetches the product URL once, stores the anonymous observation, and compares", async () => {
    const mine = await ownBananas();
    expect(mine.context.sessionState).toBe("logged_in");
    const fetch = fakeFetch(loggedOut.html);
    const outcome = await probeObservation(mine, probeDeps({ fetchPage: fetch.fetchPage }));

    expect(fetch.calls).toEqual([URL_BANANAS]);
    expect(outcome).toMatchObject({
      status: "checked",
      result: {
        key: "instacart:2748189",
        retailer: "instacart",
        retailerSku: "2748189",
        url: URL_BANANAS,
        checkedAt: T0.toISOString(),
        verdict: "SAME",
        deltaMinor: 0,
        mine: { amountMinor: 22, priceText: "$0.22", storeId: "10769" },
        anon: { amountMinor: 22, priceText: "$0.22", storeId: "10769" },
      },
    });

    const rows = await list();
    expect(rows).toHaveLength(2);
    const anon = rows[1];
    expect(PriceObservation.safeParse(anon).success).toBe(true);
    expect(anon).toMatchObject({
      panelistId: mine.panelistId,
      retailer: "instacart",
      store: { retailerStoreId: "10769", label: "Wegmans" },
      product: { retailerSku: "2748189", url: URL_BANANAS },
      facts: { price: { amountMinor: 22, currency: "USD" } },
      context: {
        sessionState: "logged_out",
        cleanSession: true,
        surface: "web",
        device: "desktop",
      },
      provenance: { adapter: "instacart@0.1.0", clientVersion: "0.1.0" },
    });
    expect(anon?.observationId).not.toBe(mine.observationId);
    // The user's own row is untouched: still logged in, no cleanSession flag.
    expect(rows[0]).toEqual(mine);

    const state = await loadProbeState();
    expect(state.rate["instacart:2748189"]).toBe(T0.getTime());
    expect(state.stats.instacart).toEqual({
      checks: 1,
      differences: 0,
      failures: 0,
      failuresByReason: {},
    });
    expect(state.results["instacart:2748189"]?.verdict).toBe("SAME");
  });

  it("reports MORE when the anonymous page shows less, with the delta", async () => {
    const mine = await ownBananas();
    const fetch = fakeFetch(withPrice(loggedOut.html, "$0.12 each (est.)"));
    const outcome = await probeObservation(mine, probeDeps({ fetchPage: fetch.fetchPage }));
    expect(outcome).toMatchObject({
      status: "checked",
      result: { verdict: "MORE", deltaMinor: 10, anon: { amountMinor: 12 } },
    });
    expect((await loadProbeState()).stats.instacart?.differences).toBe(1);
  });

  it("reports LESS when the anonymous page shows more", async () => {
    const mine = await ownBananas();
    const fetch = fakeFetch(withPrice(loggedOut.html, "$0.31 each (est.)"));
    const outcome = await probeObservation(mine, probeDeps({ fetchPage: fetch.fetchPage }));
    expect(outcome).toMatchObject({
      status: "checked",
      result: { verdict: "LESS", deltaMinor: -9, anon: { amountMinor: 31 } },
    });
    expect(await count()).toBe(2);
  });

  it("probes each SKU at most once per hour, then again once the hour has passed", async () => {
    const mine = await ownBananas();
    const fetch = fakeFetch(loggedOut.html);
    let now = T0;
    const deps = probeDeps({ fetchPage: fetch.fetchPage, now: () => now });

    expect((await probeObservation(mine, deps)).status).toBe("checked");
    now = new Date(T0.getTime() + PROBE_INTERVAL_MS - 1);
    expect(await probeObservation(mine, deps)).toEqual({
      status: "skipped",
      reason: "rate_limited",
    });
    expect(fetch.calls).toHaveLength(1);
    expect(await count()).toBe(2);

    now = new Date(T0.getTime() + PROBE_INTERVAL_MS);
    expect((await probeObservation(mine, deps)).status).toBe("checked");
    expect(fetch.calls).toHaveLength(2);
    expect((await loadProbeState()).stats.instacart?.checks).toBe(2);
  });

  it("a different SKU is its own rate bucket", async () => {
    const mine = await ownBananas();
    const other = ownInstacartObservation(
      strawberries,
      "https://www.instacart.com/store/wegmans/products/2748254-wegmans-organic-strawberries",
      "11111111-0000-4000-8000-000000000002",
    );
    const fetch = fakeFetch(loggedOut.html);
    const deps = probeDeps({ fetchPage: fetch.fetchPage });
    expect((await probeObservation(mine, deps)).status).toBe("checked");
    // Strawberries fetched, but the fake returns the bananas page: the SKU does not match.
    expect(await probeObservation(other, deps)).toMatchObject({
      status: "checked",
      result: { verdict: "UNCHECKED", reason: "sku_mismatch" },
    });
    expect(fetch.calls).toHaveLength(2);
  });
});

describe("when the anonymous page has no price", () => {
  it("a login wall is Could not check: counted, nothing stored, not retried this hour", async () => {
    const mine = await ownBananas();
    const fetch = fakeFetch(LOGIN_WALL_HTML);
    const deps = probeDeps({ fetchPage: fetch.fetchPage });
    const outcome = await probeObservation(mine, deps);
    expect(outcome).toMatchObject({
      status: "checked",
      result: { verdict: "UNCHECKED", reason: "no_price", mine: { amountMinor: 22 } },
    });
    expect((outcome as { result: { anon?: unknown } }).result.anon).toBeUndefined();
    expect(await count()).toBe(1);

    const state = await loadProbeState();
    expect(state.stats.instacart).toEqual({
      checks: 1,
      differences: 0,
      failures: 1,
      failuresByReason: { no_price: 1 },
    });

    expect(await probeObservation(mine, deps)).toEqual({
      status: "skipped",
      reason: "rate_limited",
    });
    expect(fetch.calls).toHaveLength(1);
  });

  it("a redirect is never followed: Could not check, the adapter never runs", async () => {
    const mine = await ownBananas();
    let extracted = 0;
    const outcome = await probeObservation(
      mine,
      probeDeps({
        fetchPage: async () => ({ ok: false, reason: "redirected" }),
        extract: async () => {
          extracted += 1;
          return { ok: false, reason: "adapter_threw" };
        },
      }),
    );
    expect(outcome).toMatchObject({
      status: "checked",
      result: { verdict: "UNCHECKED", reason: "redirected" },
    });
    expect(extracted).toBe(0);
    expect((await loadProbeState()).stats.instacart?.failuresByReason).toEqual({ redirected: 1 });
  });

  it("a bot check (HTTP 403) is Could not check with the status as detail", async () => {
    const mine = await ownBananas();
    const outcome = await probeObservation(
      mine,
      probeDeps({ fetchPage: async () => ({ ok: false, reason: "http_error", detail: "403" }) }),
    );
    expect(outcome).toMatchObject({
      status: "checked",
      result: { verdict: "UNCHECKED", reason: "http_error", detail: "403" },
    });
  });

  it("a tab that cannot parse any more is extract_unavailable", async () => {
    const mine = await ownBananas();
    const outcome = await probeObservation(
      mine,
      probeDeps({
        fetchPage: fakeFetch(loggedOut.html).fetchPage,
        extract: async () => {
          throw new Error("tab closed");
        },
      }),
    );
    expect(outcome).toMatchObject({
      status: "checked",
      result: { verdict: "UNCHECKED", reason: "extract_unavailable", detail: "tab closed" },
    });
  });

  it("a store rejection (schema or consent) is store_rejected, not a throw", async () => {
    const mine = await ownBananas();
    const outcome = await probeObservation(
      mine,
      probeDeps({ fetchPage: fakeFetch(loggedOut.html).fetchPage, clientVersion: "nope" }),
    );
    expect(outcome).toMatchObject({
      status: "checked",
      result: { verdict: "UNCHECKED", reason: "store_rejected" },
    });
    expect(await count()).toBe(1);
  });
});

describe("the probe does not run at all", () => {
  it("for a logged-out observation: there is nothing to compare against", async () => {
    const anon = ownInstacartObservation(loggedOut, URL_BANANAS);
    expect(anon.context.sessionState).toBe("logged_out");
    const fetch = fakeFetch(loggedOut.html);
    expect(await probeObservation(anon, probeDeps({ fetchPage: fetch.fetchPage }))).toEqual({
      status: "skipped",
      reason: "not_logged_in",
    });
    expect(fetch.calls).toEqual([]);
    expect(await loadProbeState()).toEqual({ version: 1, rate: {}, results: {}, stats: {} });
  });

  it("without consent: no fetch, no state", async () => {
    const mine = ownInstacartObservation(loggedIn, URL_BANANAS);
    await fakeBrowser.storage.local.remove("pp:consent");
    const fetch = fakeFetch(loggedOut.html);
    expect(await probeObservation(mine, probeDeps({ fetchPage: fetch.fetchPage }))).toEqual({
      status: "skipped",
      reason: "no_consent",
    });
    expect(fetch.calls).toEqual([]);
    expect(await loadProbeState()).toEqual({ version: 1, rate: {}, results: {}, stats: {} });
  });

  it("for garbage or a retailer with no adapter", async () => {
    const fetch = fakeFetch(loggedOut.html);
    const deps = probeDeps({ fetchPage: fetch.fetchPage });
    expect(await probeObservation({ nope: true }, deps)).toEqual({
      status: "skipped",
      reason: "invalid_observation",
    });
    const target = sidecarObservation(targetIn, URL_TARGET_BANANA);
    expect(await probeObservation(target, deps)).toEqual({
      status: "skipped",
      reason: "no_adapter",
    });
    expect(fetch.calls).toEqual([]);
  });
});

describe("the same-store rule on the Target banana pair", () => {
  it("is STORE_DIFFERS, and both observations are stored with their own stores", async () => {
    // No Target adapter until S12: a sidecar-backed stand-in reads the logged-out fixture.
    const adapter = sidecarAdapter(targetOut, "target.com");
    const mine = sidecarObservation(targetIn, URL_TARGET_BANANA);
    await append(mine);
    const fetch = fakeFetch(targetOut.html);
    const outcome = await probeObservation(
      mine,
      probeDeps({
        fetchPage: fetch.fetchPage,
        extract: directExtract(adapter),
        adapters: [adapter],
      }),
    );
    expect(fetch.calls).toEqual([URL_TARGET_BANANA]);
    expect(outcome).toMatchObject({
      status: "checked",
      result: {
        verdict: "STORE_DIFFERS",
        mine: { amountMinor: 29, storeId: "1872", storeLabel: "Durham" },
        anon: { amountMinor: 39, storeId: "1151", storeLabel: "Princeton" },
      },
    });
    expect((outcome as { result: { deltaMinor?: number } }).result.deltaMinor).toBeUndefined();

    const rows = await list();
    expect(rows.map((r) => [r.store?.retailerStoreId, r.context.sessionState])).toEqual([
      ["1872", "logged_in"],
      ["1151", "logged_out"],
    ]);
    expect(rows[1]).toMatchObject({ panelistId: mine.panelistId, context: { cleanSession: true } });
    expect((await loadProbeState()).stats.target).toEqual({
      checks: 1,
      differences: 0,
      failures: 0,
      failuresByReason: {},
    });
  });
});

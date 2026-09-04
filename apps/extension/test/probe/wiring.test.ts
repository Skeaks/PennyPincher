/**
 * The message plumbing on the fake browser: a stored observation reported by the content
 * script reaches the background and runs a probe; the content script answers extract
 * requests by parsing with a DOM parser; the prune alarm is registered and clears old rate
 * entries. The fetch is a fake returning fixture HTML.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { acceptConsent } from "../../src/lib/consent";
import {
  PRUNE_ALARM,
  PRUNE_PERIOD_MINUTES,
  pruneStoredRate,
  registerProbe,
} from "../../src/probe/background";
import { handleExtractRequest, reportOutcome } from "../../src/probe/content";
import {
  OBSERVED,
  PROBE_EXTRACT,
  isExtractRequest,
  isObservedMessage,
} from "../../src/probe/messages";
import type { ProbeOutcome } from "../../src/probe/probe";
import { PROBE_INTERVAL_MS, loadProbeState, updateProbeState } from "../../src/probe/state";
import { count } from "../../src/store";
import { parseDocument } from "../capture/dom";
import {
  LOGIN_WALL_HTML,
  T0,
  URL_BANANAS,
  fakeFetch,
  fixture,
  happyDomExtract,
  ownInstacartObservation,
  probeDeps,
} from "./helpers";

const loggedIn = fixture("instacart", "wegmans-bananas");
const loggedOut = fixture("instacart", "wegmans-bananas-logged-out");

/** A sender as Chrome fills it for a content script in tab 7. Only `tab.id` is read. */
const fromTab7 = { tab: { id: 7 } } as unknown as Browser.runtime.MessageSender;
const fromNoTab = {} as Browser.runtime.MessageSender;

beforeEach(async () => {
  fakeBrowser.reset();
  await acceptConsent(new Date("2026-09-04T10:00:00.000Z"));
});

async function settled(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("message guards", () => {
  it("accept only their own shapes", () => {
    expect(isObservedMessage({ type: OBSERVED, observation: {} })).toBe(true);
    expect(isObservedMessage({ type: OBSERVED })).toBe(false);
    expect(isObservedMessage({ type: PROBE_EXTRACT, html: "", ctx: {} })).toBe(false);
    expect(isObservedMessage("pp:observed")).toBe(false);
    expect(isExtractRequest({ type: PROBE_EXTRACT, html: "", ctx: { url: "x" } })).toBe(true);
    expect(isExtractRequest({ type: PROBE_EXTRACT, html: 1, ctx: {} })).toBe(false);
    expect(isExtractRequest(null)).toBe(false);
  });
});

describe("content script side", () => {
  it("reports only stored outcomes, and never lets a send failure escape", async () => {
    const sent: unknown[] = [];
    const send = async (m: unknown) => {
      sent.push(m);
      throw new Error("no background");
    };
    const mine = ownInstacartObservation(loggedIn, URL_BANANAS);
    reportOutcome({ status: "stored", observation: mine }, send);
    reportOutcome({ status: "duplicate" }, send);
    reportOutcome({ status: "no_consent" }, send);
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([{ type: OBSERVED, observation: mine }]);
  });

  it("extracts from fetched HTML with a detached document and the matching adapter", () => {
    const ctx = {
      url: URL_BANANAS,
      surface: "web",
      device: "desktop",
      sessionState: "logged_out",
      cleanSession: true,
    } as const;
    const result = handleExtractRequest({ type: PROBE_EXTRACT, html: loggedOut.html, ctx }, (h) =>
      parseDocument(h, URL_BANANAS),
    );
    expect(result).toMatchObject({
      ok: true,
      observation: {
        product: { retailerSku: "2748189" },
        facts: { price: { amountMinor: 22 } },
        context: { sessionState: "logged_out", cleanSession: true },
      },
    });
    const wall = handleExtractRequest({ type: PROBE_EXTRACT, html: LOGIN_WALL_HTML, ctx }, (h) =>
      parseDocument(h, URL_BANANAS),
    );
    expect(wall).toEqual({ ok: false, reason: "no_price" });
    const none = handleExtractRequest(
      { type: PROBE_EXTRACT, html: loggedOut.html, ctx: { ...ctx, url: "https://example.com/" } },
      (h) => parseDocument(h, URL_BANANAS),
    );
    expect(none).toEqual({ ok: false, reason: "not_product_page" });
  });
});

describe("background side", () => {
  it("runs a probe for an observation reported from a tab, and registers the hourly prune alarm", async () => {
    const fetch = fakeFetch(loggedOut.html);
    const outcomes: ProbeOutcome[] = [];
    const { extract: _drop, ...deps } = probeDeps({ fetchPage: fetch.fetchPage });
    registerProbe(
      deps,
      () => happyDomExtract(),
      (o) => outcomes.push(o),
    );

    const alarm = await fakeBrowser.alarms.get(PRUNE_ALARM);
    expect(alarm?.periodInMinutes).toBe(PRUNE_PERIOD_MINUTES);

    const mine = ownInstacartObservation(loggedIn, URL_BANANAS);
    await fakeBrowser.runtime.onMessage.trigger(
      { type: OBSERVED, observation: mine },
      fromTab7,
      () => undefined,
    );
    await settled(() => outcomes.length >= 1);
    expect(outcomes[0]).toMatchObject({ status: "checked", result: { verdict: "SAME" } });
    expect(fetch.calls).toEqual([URL_BANANAS]);
    // The user's own row was not stored by the background: only the anonymous one.
    expect(await count()).toBe(1);
  });

  it("ignores messages that are not observations or come from no tab", async () => {
    const fetch = fakeFetch(loggedOut.html);
    const outcomes: ProbeOutcome[] = [];
    const { extract: _drop, ...deps } = probeDeps({ fetchPage: fetch.fetchPage });
    registerProbe(
      deps,
      () => happyDomExtract(),
      (o) => outcomes.push(o),
    );
    const mine = ownInstacartObservation(loggedIn, URL_BANANAS);
    await fakeBrowser.runtime.onMessage.trigger({ type: "other" }, fromTab7, () => {});
    await fakeBrowser.runtime.onMessage.trigger(
      { type: OBSERVED, observation: mine },
      fromNoTab,
      () => {},
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(outcomes).toEqual([]);
    expect(fetch.calls).toEqual([]);
  });

  it("the prune alarm drops rate entries older than an hour", async () => {
    await updateProbeState((s) => {
      s.rate = { old: T0.getTime() - PROBE_INTERVAL_MS - 1, fresh: T0.getTime() - 1000 };
    });
    const { extract: _drop, ...deps } = probeDeps();
    registerProbe(deps, () => happyDomExtract());
    await fakeBrowser.alarms.onAlarm.trigger({
      name: PRUNE_ALARM,
      scheduledTime: T0.getTime(),
      periodInMinutes: PRUNE_PERIOD_MINUTES,
      persistAcrossSessions: true,
    });
    await settled(() => false, 30).catch(() => undefined);
    expect((await loadProbeState()).rate).toEqual({ fresh: T0.getTime() - 1000 });

    await pruneStoredRate(T0.getTime() + PROBE_INTERVAL_MS);
    expect((await loadProbeState()).rate).toEqual({});
  });
});

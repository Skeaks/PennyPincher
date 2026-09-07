/**
 * The capture flow end to end on fixture documents: consent gating (the adapter is never
 * invoked without consent), storing, deduplication, the MutationObserver debounce, and the
 * SPA re-capture path.
 */
import { PriceObservation } from "@pennypincher/schema";
import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { Adapter } from "../../src/capture/adapter";
import { INSTACART_ADAPTER_VERSION, instacartAdapter } from "../../src/capture/adapters/instacart";
import { getPanelistId } from "../../src/capture/panelist";
import {
  type CaptureDeps,
  type CaptureOutcome,
  DEBOUNCE_MS,
  captureOnce,
  startCapture,
  watchPage,
} from "../../src/capture/run";
import { acceptConsent, hasConsent } from "../../src/lib/consent";
import { append, count, list } from "../../src/store";
import { listFixtures, parseDocument } from "./dom";

const bananas = listFixtures("instacart").find((f) => f.slug === "wegmans-bananas");
if (!bananas) throw new Error("fixture wegmans-bananas missing");
const URL_BANANAS =
  "https://www.instacart.com/store/wegmans/products/2748189-bananas-sold-by-the-each";

function deps(overrides: Partial<CaptureDeps> = {}): CaptureDeps {
  let n = 0;
  return {
    hasConsent,
    append,
    panelistId: () => getPanelistId(new Date("2026-09-04T15:00:00.000Z")),
    clientVersion: "0.1.0",
    now: () => new Date("2026-09-04T15:26:18.000Z"),
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    ...overrides,
  };
}

function spyAdapter(): { adapter: Adapter; calls: number } {
  const state = { calls: 0 };
  const adapter: Adapter = {
    name: "instacart",
    version: "9.9.9",
    matches: (url) => instacartAdapter.matches(url),
    pageKind: (url) => instacartAdapter.pageKind(url),
    extract(doc, ctx) {
      state.calls += 1;
      return instacartAdapter.extract(doc, ctx);
    },
  };
  return {
    adapter,
    get calls() {
      return state.calls;
    },
  };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe("captureOnce", () => {
  const ctx = { url: URL_BANANAS, surface: "web", device: "desktop" } as const;

  it("without consent, does not run the adapter and stores nothing", async () => {
    const spy = spyAdapter();
    const doc = parseDocument(bananas.html, URL_BANANAS);
    const outcome = await captureOnce(doc, ctx, deps({ adapters: [spy.adapter] }));
    expect(outcome).toEqual({ status: "no_consent" });
    expect(spy.calls).toBe(0);
    expect(await count()).toBe(0);
  });

  it("with consent, stores a schema-valid observation", async () => {
    await acceptConsent();
    const doc = parseDocument(bananas.html, URL_BANANAS);
    const outcome = await captureOnce(doc, ctx, deps());
    expect(outcome.status).toBe("stored");
    const rows = await list();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(PriceObservation.safeParse(row).success).toBe(true);
    expect(row).toMatchObject({
      observationId: "00000000-0000-4000-8000-000000000001",
      observedAt: "2026-09-04T15:26:18.000Z",
      retailer: "instacart",
      product: { retailerSku: "2748189", url: URL_BANANAS },
      facts: { price: { amountMinor: 22, currency: "USD" } },
      provenance: { adapter: `instacart@${INSTACART_ADAPTER_VERSION}`, clientVersion: "0.1.0" },
    });
    expect(row?.panelistId).toBe(await getPanelistId(new Date("2026-09-04T15:00:00.000Z")));
  });

  it("the same rendering is not stored twice within a page session", async () => {
    await acceptConsent();
    const doc = parseDocument(bananas.html, URL_BANANAS);
    const seen = new Set<string>();
    expect((await captureOnce(doc, ctx, deps(), seen)).status).toBe("stored");
    expect((await captureOnce(doc, ctx, deps(), seen)).status).toBe("duplicate");
    expect(await count()).toBe(1);
  });

  it("a page no adapter matches is no_adapter", async () => {
    await acceptConsent();
    const doc = parseDocument(bananas.html, URL_BANANAS);
    const outcome = await captureOnce(
      doc,
      { ...ctx, url: "https://www.instacart.com/store/" },
      deps(),
    );
    expect(outcome).toEqual({ status: "no_adapter" });
    expect(await count()).toBe(0);
  });

  it("an extraction failure is reported with the adapter id and reason, nothing stored", async () => {
    await acceptConsent();
    const doc = parseDocument("<html><body></body></html>", URL_BANANAS);
    const outcome = await captureOnce(doc, ctx, deps());
    expect(outcome).toEqual({
      status: "extract_failed",
      adapter: `instacart@${INSTACART_ADAPTER_VERSION}`,
      reason: "no_title",
    });
    expect(await count()).toBe(0);
  });

  it("a store rejection is reported, not thrown", async () => {
    await acceptConsent();
    const doc = parseDocument(bananas.html, URL_BANANAS);
    const outcome = await captureOnce(doc, ctx, deps({ clientVersion: "not-semver" }));
    expect(outcome).toMatchObject({ status: "rejected" });
    expect((outcome as { error: string }).error).toMatch(/clientVersion/);
    expect(await count()).toBe(0);
  });
});

describe("captureOnce on a listing page (S17)", () => {
  const URL_AISLE = "https://www.instacart.com/store/wegmans/collections/produce?page=2";
  const ctx = { url: URL_AISLE, surface: "web", device: "desktop" } as const;

  it("stores one row per priced tile, all schema-valid, and reports the page", async () => {
    await acceptConsent();
    const doc = parseDocument(bananas.html, URL_AISLE);
    const outcome = await captureOnce(doc, ctx, deps());
    expect(outcome.status).toBe("listing");
    if (outcome.status !== "listing") return;
    expect(outcome.url).toBe("https://www.instacart.com/store/wegmans/collections/produce");
    expect(outcome.adapter).toBe(`instacart@${INSTACART_ADAPTER_VERSION}`);
    expect(outcome.stored.length).toBeGreaterThanOrEqual(10);
    expect(outcome.duplicates).toBe(0);
    expect(outcome.rejected).toBe(0);
    expect(outcome.skipped).toEqual({});
    const rows = await list();
    expect(rows).toHaveLength(outcome.stored.length);
    for (const row of rows) expect(PriceObservation.safeParse(row).success).toBe(true);
    expect(new Set(rows.map((r) => r.product.retailerSku)).size).toBe(rows.length);
    expect(rows.map((r) => r.observationId)).toEqual(
      rows.map((_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`),
    );
  });

  it("the same tiles are not stored twice within a page session", async () => {
    await acceptConsent();
    const doc = parseDocument(bananas.html, URL_AISLE);
    const seen = new Set<string>();
    const first = await captureOnce(doc, ctx, deps(), seen);
    const second = await captureOnce(doc, ctx, deps(), seen);
    if (first.status !== "listing" || second.status !== "listing") throw new Error("not listing");
    expect(second.stored).toEqual([]);
    expect(second.duplicates).toBe(first.stored.length);
    expect(await count()).toBe(first.stored.length);
  });

  it("without consent, no tile is read", async () => {
    const spy = spyAdapter();
    const doc = parseDocument(bananas.html, URL_AISLE);
    expect(await captureOnce(doc, ctx, deps({ adapters: [spy.adapter] }))).toEqual({
      status: "no_consent",
    });
    expect(await count()).toBe(0);
  });

  it("a store that rejects every row reports them as rejected, nothing thrown", async () => {
    await acceptConsent();
    const doc = parseDocument(bananas.html, URL_AISLE);
    const outcome = await captureOnce(doc, ctx, deps({ clientVersion: "not-semver" }));
    expect(outcome.status).toBe("listing");
    if (outcome.status !== "listing") return;
    expect(outcome.stored).toEqual([]);
    expect(outcome.rejected).toBeGreaterThanOrEqual(10);
    expect(await count()).toBe(0);
  });

  it("an adapter without a tile extractor records nothing on a listing", async () => {
    await acceptConsent();
    const adapter: Adapter = {
      name: "instacart",
      version: "0.0.0",
      matches: () => true,
      pageKind: () => "listing",
      extract: () => ({ ok: false, reason: "not_product_page" }),
    };
    const outcome = await captureOnce(
      parseDocument(bananas.html, URL_AISLE),
      ctx,
      deps({ adapters: [adapter] }),
    );
    expect(outcome).toMatchObject({ status: "listing", stored: [], skipped: {} });
  });
});

/**
 * A hand-cranked timer so the debounce is deterministic. happy-dom delivers MutationObserver
 * callbacks on its own real-time queue, so the tests wait a few real milliseconds for those and
 * crank the debounce by hand instead of faking the global clock (mixing the two is flaky).
 */
function scheduler() {
  const pending = new Map<number, () => void>();
  const delays: number[] = [];
  let next = 0;
  return {
    opts: {
      setTimeout: (fn: () => void, ms: number) => {
        next += 1;
        pending.set(next, fn);
        delays.push(ms);
        return next;
      },
      clearTimeout: (h: unknown) => {
        pending.delete(h as number);
      },
    },
    delays,
    get pendingCount() {
      return pending.size;
    },
    /** Fire every armed timer, as if its delay had elapsed. */
    fire() {
      const fns = Array.from(pending.values());
      pending.clear();
      for (const fn of fns) fn();
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Let happy-dom deliver pending mutation records. */
async function delivered(): Promise<void> {
  await sleep(25);
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor: timed out");
    await sleep(5);
  }
}

describe("watchPage", () => {
  it(`arms a ${DEBOUNCE_MS} ms timer per mutation burst and fires once when it elapses`, async () => {
    const win = new Window({ url: URL_BANANAS });
    win.document.write("<html><body><div id=a></div></body></html>");
    const doc = win.document as unknown as Document;
    const settled = vi.fn();
    const sched = scheduler();
    const stop = watchPage(doc, settled, sched.opts);

    const a = doc.getElementById("a");
    for (let i = 0; i < 5; i++) {
      a?.appendChild(doc.createElement("span"));
      await delivered();
    }
    // Every burst re-armed the timer: exactly one is pending, all at the debounce delay.
    expect(settled).not.toHaveBeenCalled();
    expect(sched.pendingCount).toBe(1);
    expect(sched.delays.length).toBeGreaterThanOrEqual(1);
    expect(new Set(sched.delays)).toEqual(new Set([DEBOUNCE_MS]));

    sched.fire();
    expect(settled).toHaveBeenCalledTimes(1);

    stop();
    a?.appendChild(doc.createElement("span"));
    await delivered();
    expect(sched.pendingCount).toBe(0);
    sched.fire();
    expect(settled).toHaveBeenCalledTimes(1);
  });
});

describe("startCapture", () => {
  function windowFor(html: string): Window {
    const win = new Window({ url: URL_BANANAS, width: 1440, height: 900 });
    win.document.write(html);
    return win;
  }

  it("captures on start, ignores unrelated DOM churn, and re-captures when the price changes", async () => {
    await acceptConsent();
    const win = windowFor(bananas.html);
    const outcomes: CaptureOutcome[] = [];
    const sched = scheduler();
    const stop = startCapture(win as unknown as globalThis.Window, deps(), sched.opts, (o) =>
      outcomes.push(o),
    );

    await waitFor(() => outcomes.length >= 1);
    expect(outcomes.map((o) => o.status)).toEqual(["stored"]);
    expect(await count()).toBe(1);

    // Unrelated churn: a toast appears. Same rendering, so no second row.
    win.document.body.appendChild(win.document.createElement("div"));
    await delivered();
    sched.fire();
    await waitFor(() => outcomes.length >= 2);
    expect(outcomes.map((o) => o.status)).toEqual(["stored", "duplicate"]);
    expect(await count()).toBe(1);

    // The SPA swaps the product: the price changes without a page load.
    const labels = win.document.querySelectorAll("#item_details span.screen-reader-only");
    for (const span of Array.from(labels)) {
      if (/^current price:/i.test(span.textContent ?? "")) {
        span.textContent = "Current price: $0.31 each (est.)";
      }
    }
    await delivered();
    sched.fire();
    await waitFor(() => outcomes.length >= 3);
    expect(
      outcomes.map((o) => o.status),
      JSON.stringify(outcomes[2]),
    ).toEqual(["stored", "duplicate", "stored"]);
    const rows = await list();
    expect(rows.map((r) => r.facts.price.amountMinor)).toEqual([22, 31]);

    stop();
  });

  it("on a listing page, stores the tiles and records the tally for the popup", async () => {
    await acceptConsent();
    const win = new Window({
      url: "https://www.instacart.com/store/wegmans/collections/produce?page=2",
      width: 1440,
      height: 900,
    });
    win.document.write(bananas.html);
    const tallies: [string, number][] = [];
    const outcomes: CaptureOutcome[] = [];
    const sched = scheduler();
    const stop = startCapture(
      win as unknown as globalThis.Window,
      deps({
        tally: async (url, recorded) => {
          tallies.push([url, recorded]);
        },
      }),
      sched.opts,
      (o) => outcomes.push(o),
    );
    await waitFor(() => outcomes.length >= 1);
    expect(outcomes[0]?.status).toBe("listing");
    const stored = await count();
    expect(stored).toBeGreaterThanOrEqual(10);
    expect(tallies).toEqual([
      ["https://www.instacart.com/store/wegmans/collections/produce", stored],
    ]);

    // Unrelated churn: same tiles, nothing new stored, the tally is restated unchanged.
    win.document.body.appendChild(win.document.createElement("div"));
    await delivered();
    sched.fire();
    await waitFor(() => outcomes.length >= 2);
    expect(outcomes[1]).toMatchObject({ status: "listing", stored: [], duplicates: stored });
    expect(await count()).toBe(stored);
    expect(tallies[1]).toEqual([
      "https://www.instacart.com/store/wegmans/collections/produce",
      stored,
    ]);
    stop();
  });

  it("without consent, never stores and never invokes the adapter, however often the page changes", async () => {
    const win = windowFor(bananas.html);
    const spy = spyAdapter();
    const outcomes: CaptureOutcome[] = [];
    const sched = scheduler();
    const stop = startCapture(
      win as unknown as globalThis.Window,
      deps({ adapters: [spy.adapter] }),
      sched.opts,
      (o) => outcomes.push(o),
    );
    await waitFor(() => outcomes.length >= 1);
    win.document.body.appendChild(win.document.createElement("div"));
    await delivered();
    sched.fire();
    await waitFor(() => outcomes.length >= 2);
    expect(outcomes.map((o) => o.status)).toEqual(["no_consent", "no_consent"]);
    expect(spy.calls).toBe(0);
    expect(await count()).toBe(0);
    stop();
  });
});

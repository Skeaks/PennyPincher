/**
 * The adapter health beacon (S12): outcomes become counts per adapter, the counts round-trip
 * through local storage, the daily upload goes through the sync transport with a payload
 * that carries counts and versions only, and a successful upload resets what it sent.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  type AdapterHealthReport,
  HEALTH_ALARM,
  HEALTH_KEY,
  HEALTH_PERIOD_MINUTES,
  type HealthState,
  type HealthUploadDeps,
  type HealthUploadOutcome,
  adapterOf,
  buildReport,
  clearHealthState,
  emptyHealthState,
  loadHealthState,
  recordCaptureOutcome,
  registerHealthBeacon,
  runHealthUpload,
  saveHealthState,
  subtract,
  utcDate,
  withOutcome,
} from "../../src/capture/health";
import type { CaptureOutcome } from "../../src/capture/run";
import { acceptConsent } from "../../src/lib/consent";
import type { SyncConfig } from "../../src/sync/config";
import type { HealthPostResult } from "../../src/sync/transport";
import { validObservation } from "../fixtures";

const T0 = new Date("2026-09-07T12:00:00.000Z");
const TARGET = "target@0.1.0";
const WALMART = "walmart@0.1.0";

const stored: CaptureOutcome = {
  status: "stored",
  observation: validObservation({
    provenance: { adapter: TARGET, clientVersion: "0.1.0", evidenceHash: "a".repeat(64) },
  }),
};
const failed: CaptureOutcome = { status: "extract_failed", adapter: TARGET, reason: "no_price" };
const listing: CaptureOutcome = {
  status: "listing",
  adapter: "instacart@0.2.0",
  url: "https://www.instacart.com/store/s",
  stored: [validObservation(), validObservation()],
  duplicates: 1,
  rejected: 1,
  skipped: { no_sku: 3, unparseable_price: 1 },
};

beforeEach(() => {
  fakeBrowser.reset();
});

describe("withOutcome", () => {
  it("counts a stored observation as attempted and extracted, under its provenance adapter", () => {
    const s = withOutcome(emptyHealthState(T0), stored);
    expect(s.adapters).toEqual({ [TARGET]: { attempted: 1, extracted: 1, failed: {} } });
    expect(s.since).toBe(T0.toISOString());
  });

  it("counts an extract failure by reason", () => {
    let s = withOutcome(emptyHealthState(T0), failed);
    s = withOutcome(s, failed);
    s = withOutcome(s, { status: "extract_failed", adapter: TARGET, reason: "no_title" });
    expect(s.adapters[TARGET]).toEqual({
      attempted: 3,
      extracted: 0,
      failed: { no_price: 2, no_title: 1 },
    });
  });

  it("counts duplicate and rejected under the fallback adapter, and rejected as a failure", () => {
    let s = withOutcome(emptyHealthState(T0), { status: "duplicate" }, WALMART);
    s = withOutcome(s, { status: "rejected", error: "schema" }, WALMART);
    expect(s.adapters[WALMART]).toEqual({ attempted: 2, extracted: 2, failed: { rejected: 1 } });
  });

  it("ignores outcomes without an adapter, and no_consent / no_adapter always", () => {
    const empty = emptyHealthState(T0);
    expect(withOutcome(empty, { status: "duplicate" })).toBe(empty);
    expect(withOutcome(empty, { status: "no_consent" }, TARGET)).toBe(empty);
    expect(withOutcome(empty, { status: "no_adapter" }, TARGET)).toBe(empty);
  });

  it("counts a listing: every tile attempted, stored + duplicates + rejected extracted, skips by reason", () => {
    const s = withOutcome(emptyHealthState(T0), listing);
    expect(s.adapters["instacart@0.2.0"]).toEqual({
      attempted: 8,
      extracted: 4,
      failed: { no_sku: 3, unparseable_price: 1, rejected: 1 },
    });
  });

  it("never mutates its input", () => {
    const before = withOutcome(emptyHealthState(T0), failed);
    const snapshot = JSON.parse(JSON.stringify(before));
    withOutcome(before, stored);
    withOutcome(before, failed);
    expect(before).toEqual(snapshot);
  });

  it("adapterOf names the adapter for stored, extract_failed and listing only", () => {
    expect(adapterOf(stored)).toBe(TARGET);
    expect(adapterOf(failed)).toBe(TARGET);
    expect(adapterOf(listing)).toBe("instacart@0.2.0");
    expect(adapterOf({ status: "duplicate" })).toBeUndefined();
    expect(adapterOf({ status: "rejected", error: "x" })).toBeUndefined();
    expect(adapterOf({ status: "no_consent" })).toBeUndefined();
  });
});

describe("subtract", () => {
  it("removes the uploaded counts, drops adapters left at zero, never goes negative", () => {
    let current = emptyHealthState(T0);
    for (let i = 0; i < 3; i++) current = withOutcome(current, failed);
    current = withOutcome(current, stored);
    current = withOutcome(current, { status: "duplicate" }, WALMART);
    const uploaded: HealthState = {
      version: 1,
      since: T0.toISOString(),
      adapters: {
        [TARGET]: { attempted: 3, extracted: 0, failed: { no_price: 3 } },
        [WALMART]: { attempted: 5, extracted: 5, failed: {} },
        "instacart@0.2.0": { attempted: 1, extracted: 1, failed: {} },
      },
    };
    const later = new Date(T0.getTime() + 1000);
    const left = subtract(current, uploaded, later);
    expect(left).toEqual({
      version: 1,
      since: later.toISOString(),
      adapters: { [TARGET]: { attempted: 1, extracted: 1, failed: {} } },
    });
  });
});

describe("buildReport", () => {
  it("is undefined when nothing was attempted", () => {
    expect(buildReport(emptyHealthState(T0), "0.1.0", T0)).toBeUndefined();
  });

  it("splits name@version, sorts by adapter, stamps the UTC date and the client version", () => {
    let s = withOutcome(emptyHealthState(T0), { status: "duplicate" }, WALMART);
    s = withOutcome(s, failed);
    s = withOutcome(s, stored);
    const report = buildReport(s, "0.1.0", new Date("2026-09-07T23:59:59.999Z"));
    expect(report).toEqual({
      clientVersion: "0.1.0",
      date: "2026-09-07",
      adapters: [
        {
          adapter: "target",
          version: "0.1.0",
          attempted: 2,
          extracted: 1,
          failed: { no_price: 1 },
        },
        { adapter: "walmart", version: "0.1.0", attempted: 1, extracted: 1, failed: {} },
      ],
    });
    expect(utcDate(new Date("2026-09-08T00:00:00.000Z"))).toBe("2026-09-08");
  });

  it("carries counts and versions only: no observation data, no ids", () => {
    const s = withOutcome(withOutcome(emptyHealthState(T0), stored), listing);
    const report = buildReport(s, "0.1.0", T0);
    expect(report).toBeDefined();
    if (!report) return;
    expect(Object.keys(report).sort()).toEqual(["adapters", "clientVersion", "date"]);
    for (const entry of report.adapters) {
      expect(Object.keys(entry).sort()).toEqual([
        "adapter",
        "attempted",
        "extracted",
        "failed",
        "version",
      ]);
      for (const value of Object.values(entry.failed)) expect(typeof value).toBe("number");
    }
    const text = JSON.stringify(report);
    for (const forbidden of ["observationId", "panelistId", "http", "$", "@", "zip", "store"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe("recordCaptureOutcome / loadHealthState", () => {
  it("round-trips through storage and accumulates", async () => {
    await recordCaptureOutcome(stored, undefined, T0);
    await recordCaptureOutcome(failed, undefined, T0);
    await recordCaptureOutcome({ status: "duplicate" }, TARGET, T0);
    expect((await loadHealthState()).adapters).toEqual({
      [TARGET]: { attempted: 3, extracted: 2, failed: { no_price: 1 } },
    });
    await clearHealthState();
    expect((await loadHealthState(T0)).adapters).toEqual({});
  });

  it("serialises concurrent writers so no count is lost", async () => {
    await Promise.all([
      recordCaptureOutcome(stored),
      recordCaptureOutcome(failed),
      recordCaptureOutcome(stored),
      recordCaptureOutcome({ status: "duplicate" }, WALMART),
    ]);
    const s = await loadHealthState();
    expect(s.adapters[TARGET]).toEqual({ attempted: 3, extracted: 2, failed: { no_price: 1 } });
    expect(s.adapters[WALMART]).toEqual({ attempted: 1, extracted: 1, failed: {} });
  });

  it("does nothing for outcomes it cannot attribute, and never throws", async () => {
    await recordCaptureOutcome({ status: "duplicate" });
    await recordCaptureOutcome({ status: "no_consent" }, TARGET);
    await recordCaptureOutcome({ status: "no_adapter" }, TARGET);
    expect((await fakeBrowser.storage.local.get(HEALTH_KEY))[HEALTH_KEY]).toBeUndefined();
  });

  it("tolerates garbage in storage", async () => {
    await fakeBrowser.storage.local.set({ [HEALTH_KEY]: "nope" });
    expect((await loadHealthState(T0)).adapters).toEqual({});
    await fakeBrowser.storage.local.set({
      [HEALTH_KEY]: { version: 1, since: "t", adapters: { x: { attempted: "1" } } },
    });
    expect((await loadHealthState(T0)).adapters).toEqual({});
  });
});

describe("runHealthUpload", () => {
  const CONFIG: SyncConfig = { apiBaseUrl: "https://api.test.invalid", token: "test-pilot-bearer" };

  function deps(overrides: Partial<HealthUploadDeps> = {}) {
    const posted: AdapterHealthReport[] = [];
    let state = withOutcome(withOutcome(emptyHealthState(T0), stored), failed);
    const d: HealthUploadDeps = {
      hasConsent: async () => true,
      config: () => CONFIG,
      load: async () => state,
      save: async (s) => {
        state = s;
      },
      post: async (_config, report) => {
        posted.push(report);
        return { ok: true };
      },
      clientVersion: () => "0.1.0",
      now: () => T0,
      ...overrides,
    };
    return { deps: d, posted, state: () => state };
  }

  it("is off without consent and unconfigured without a token", async () => {
    expect(await runHealthUpload(deps({ hasConsent: async () => false }).deps)).toEqual({
      status: "off",
    });
    expect(await runHealthUpload(deps({ config: () => ({ ...CONFIG, token: "" }) }).deps)).toEqual({
      status: "unconfigured",
    });
  });

  it("sends nothing when nothing was attempted", async () => {
    const d = deps({ load: async () => emptyHealthState(T0) });
    expect(await runHealthUpload(d.deps)).toEqual({ status: "nothing" });
    expect(d.posted).toEqual([]);
  });

  it("posts the report and resets the counts it sent", async () => {
    const d = deps();
    const outcome = await runHealthUpload(d.deps);
    expect(outcome.status).toBe("uploaded");
    expect(d.posted).toHaveLength(1);
    expect(d.posted[0]).toEqual({
      clientVersion: "0.1.0",
      date: "2026-09-07",
      adapters: [
        {
          adapter: "target",
          version: "0.1.0",
          attempted: 2,
          extracted: 1,
          failed: { no_price: 1 },
        },
      ],
    });
    expect(d.state().adapters).toEqual({});
  });

  it("keeps a count recorded while the request was in flight", async () => {
    let state = withOutcome(emptyHealthState(T0), failed);
    const d = deps({
      load: async () => state,
      save: async (s) => {
        state = s;
      },
      post: async () => {
        // A content script counts one more failure while the upload runs.
        state = withOutcome(state, failed);
        return { ok: true };
      },
    });
    expect((await runHealthUpload(d.deps)).status).toBe("uploaded");
    expect(state.adapters[TARGET]).toEqual({ attempted: 1, extracted: 0, failed: { no_price: 1 } });
  });

  it("keeps the counts when the upload fails, and reports the failure", async () => {
    const failure: HealthPostResult = { ok: false, reason: "http_error", status: 503 };
    const d = deps({ post: async () => failure });
    const outcome = await runHealthUpload(d.deps);
    expect(outcome).toMatchObject({ status: "failed", failure });
    expect(d.state().adapters[TARGET]).toEqual({
      attempted: 2,
      extracted: 1,
      failed: { no_price: 1 },
    });
  });

  it("treats a transport that throws as a network error", async () => {
    const d = deps({
      post: async () => {
        throw new Error("boom");
      },
    });
    expect(await runHealthUpload(d.deps)).toMatchObject({
      status: "failed",
      failure: { ok: false, reason: "network_error" },
    });
  });
});

describe("registerHealthBeacon", () => {
  const CONFIG: SyncConfig = { apiBaseUrl: "https://api.test.invalid", token: "test-pilot-bearer" };

  function alarm(name: string) {
    return {
      name,
      scheduledTime: T0.getTime(),
      periodInMinutes: HEALTH_PERIOD_MINUTES,
      persistAcrossSessions: true,
    };
  }

  async function settled(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  function deps(overrides: Partial<HealthUploadDeps> = {}): HealthUploadDeps {
    return {
      hasConsent: async () => true,
      config: () => CONFIG,
      load: loadHealthState,
      save: saveHealthState,
      post: async () => ({ ok: true }),
      clientVersion: () => "0.1.0",
      now: () => T0,
      ...overrides,
    };
  }

  it("creates the daily alarm", async () => {
    registerHealthBeacon(deps());
    const a = await fakeBrowser.alarms.get(HEALTH_ALARM);
    expect(a?.periodInMinutes).toBe(HEALTH_PERIOD_MINUTES);
    expect(HEALTH_PERIOD_MINUTES).toBe(24 * 60);
  });

  it("uploads when the alarm fires, through the real storage, and resets", async () => {
    await acceptConsent(new Date("2026-09-04T10:00:00.000Z"));
    await recordCaptureOutcome(failed, undefined, T0);
    const outcomes: HealthUploadOutcome[] = [];
    registerHealthBeacon(deps(), (o) => outcomes.push(o));
    await fakeBrowser.alarms.onAlarm.trigger(alarm(HEALTH_ALARM));
    await settled(() => outcomes.length === 1);
    expect(outcomes[0]).toMatchObject({ status: "uploaded", report: { date: "2026-09-07" } });
    expect((await loadHealthState()).adapters).toEqual({});
  });

  it("ignores other alarms", async () => {
    const outcomes: HealthUploadOutcome[] = [];
    registerHealthBeacon(deps(), (o) => outcomes.push(o));
    await fakeBrowser.alarms.onAlarm.trigger(alarm("pp:sync"));
    await new Promise((r) => setTimeout(r, 20));
    expect(outcomes).toEqual([]);
  });

  it("a run that rejects does not escape the listener", async () => {
    let ran = false;
    registerHealthBeacon(
      deps({
        load: async () => {
          ran = true;
          throw new Error("storage exploded");
        },
      }),
    );
    await expect(fakeBrowser.alarms.onAlarm.trigger(alarm(HEALTH_ALARM))).resolves.toBeDefined();
    await settled(() => ran);
  });
});

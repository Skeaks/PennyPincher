/**
 * Sync (S11): batching, marking sent, retry with backoff, off until consent, off without a
 * token. The transport is a fake that records every call; no network, ever.
 */
import type { PriceObservation } from "@pennypincher/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { acceptConsent, hasConsent } from "../../src/lib/consent";
import { append, list } from "../../src/store";
import { DEFAULT_API_BASE_URL, type SyncConfig, isConfigured } from "../../src/sync/config";
import {
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  SENT_RETENTION_MS,
  type SyncState,
  backoffMs,
  clearSyncState,
  contributedSince,
  emptySyncState,
  inBackoff,
  loadSyncState,
  pruneSent,
  saveSyncState,
} from "../../src/sync/state";
import { BATCH_SIZE, type SyncDeps, batches, pending, runSync } from "../../src/sync/sync";
import type { UploadResult } from "../../src/sync/transport";
import { idFor, validObservation } from "../fixtures";

const T0 = new Date("2026-09-07T12:00:00.000Z");
// Deliberately low-entropy so gitleaks does not flag a test fixture as a leaked secret.
const CONFIG: SyncConfig = { apiBaseUrl: "https://api.test.invalid", token: "test-pilot-bearer" };

function rows(n: number, from = 1): PriceObservation[] {
  return Array.from({ length: n }, (_, i) => validObservation({ observationId: idFor(from + i) }));
}

interface FakePost {
  calls: { config: SyncConfig; batch: PriceObservation[] }[];
  post: SyncDeps["post"];
}

/** A transport that answers from a script; the last answer repeats. */
function fakePost(...answers: UploadResult[]): FakePost {
  const calls: FakePost["calls"] = [];
  return {
    calls,
    post: async (config, batch) => {
      calls.push({ config, batch: [...batch] });
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
      return answer ?? { ok: true, accepted: batch.length, duplicates: 0 };
    },
  };
}

function deps(overrides: Partial<SyncDeps> = {}): SyncDeps {
  return {
    hasConsent,
    config: () => CONFIG,
    list,
    loadState: loadSyncState,
    saveState: saveSyncState,
    post: fakePost().post,
    now: () => T0,
    ...overrides,
  };
}

beforeEach(async () => {
  fakeBrowser.reset();
  await acceptConsent(new Date("2026-09-04T10:00:00.000Z"));
});

async function seed(n: number): Promise<void> {
  for (const o of rows(n)) await append(o);
}

describe("runSync", () => {
  it("is off without consent and reads nothing", async () => {
    fakeBrowser.reset();
    let listed = 0;
    const fake = fakePost();
    const outcome = await runSync(
      deps({
        post: fake.post,
        list: async () => {
          listed += 1;
          return rows(3);
        },
      }),
    );
    expect(outcome).toEqual({ status: "off" });
    expect(listed).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it("is off without a token, and reads nothing", async () => {
    await seed(2);
    const fake = fakePost();
    const outcome = await runSync(
      deps({ post: fake.post, config: () => ({ ...CONFIG, token: "" }) }),
    );
    expect(outcome).toEqual({ status: "unconfigured" });
    expect(fake.calls).toEqual([]);
  });

  it("uploads in batches of 200, oldest first, and marks every row sent", async () => {
    await seed(450);
    const fake = fakePost();
    const outcome = await runSync(deps({ post: fake.post }));

    expect(outcome).toEqual({
      status: "uploaded",
      batches: 3,
      rows: 450,
      accepted: 450,
      duplicates: 0,
    });
    expect(fake.calls.map((c) => c.batch.length)).toEqual([200, 200, 50]);
    expect(fake.calls[0]?.batch[0]?.observationId).toBe(idFor(1));
    expect(fake.calls[2]?.batch[49]?.observationId).toBe(idFor(450));
    expect(fake.calls.every((c) => c.config === CONFIG)).toBe(true);

    const state = await loadSyncState();
    expect(Object.keys(state.sent)).toHaveLength(450);
    expect(state.sent[idFor(450)]).toBe(T0.toISOString());
    expect(state.failures).toBe(0);
    expect(state.lastSuccessAt).toBe(T0.toISOString());
    expect(state.nextAttemptAt).toBeUndefined();
  });

  it("sends nothing on the next run when everything has gone, and only the new rows after that", async () => {
    await seed(3);
    const first = fakePost();
    await runSync(deps({ post: first.post }));
    const second = fakePost();
    expect(await runSync(deps({ post: second.post }))).toEqual({ status: "nothing" });
    expect(second.calls).toEqual([]);

    await append(validObservation({ observationId: idFor(4) }));
    const third = fakePost();
    const outcome = await runSync(deps({ post: third.post }));
    expect(outcome).toMatchObject({ status: "uploaded", batches: 1, rows: 1 });
    expect(third.calls[0]?.batch.map((o) => o.observationId)).toEqual([idFor(4)]);
  });

  it("stops at the first failed batch, keeps the earlier batches marked, and backs off", async () => {
    await seed(450);
    const fake = fakePost(
      { ok: true, accepted: 200, duplicates: 0 },
      { ok: false, reason: "http_error", status: 503 },
    );
    const outcome = await runSync(deps({ post: fake.post }));

    expect(outcome).toEqual({
      status: "failed",
      batches: 1,
      rows: 200,
      failure: { ok: false, reason: "http_error", status: 503 },
      retryAt: new Date(T0.getTime() + BASE_BACKOFF_MS).toISOString(),
    });
    expect(fake.calls).toHaveLength(2);
    const state = await loadSyncState();
    expect(Object.keys(state.sent)).toHaveLength(200);
    expect(state.failures).toBe(1);
    expect(state.nextAttemptAt).toBe(new Date(T0.getTime() + BASE_BACKOFF_MS).toISOString());
  });

  it("skips runs during the backoff, then resends the unsent rows and resets on success", async () => {
    await seed(250);
    const failing = fakePost({ ok: false, reason: "network_error" });
    await runSync(deps({ post: failing.post }));
    expect(failing.calls).toHaveLength(1);

    const tooSoon = fakePost();
    const skipped = await runSync(
      deps({ post: tooSoon.post, now: () => new Date(T0.getTime() + BASE_BACKOFF_MS - 1) }),
    );
    expect(skipped).toEqual({
      status: "backoff",
      until: new Date(T0.getTime() + BASE_BACKOFF_MS).toISOString(),
    });
    expect(tooSoon.calls).toEqual([]);

    const later = new Date(T0.getTime() + BASE_BACKOFF_MS);
    const ok = fakePost();
    const outcome = await runSync(deps({ post: ok.post, now: () => later }));
    expect(outcome).toMatchObject({ status: "uploaded", batches: 2, rows: 250 });
    // The failed batch's rows were never marked, so they went again in full.
    expect(ok.calls.map((c) => c.batch.length)).toEqual([200, 50]);
    const state = await loadSyncState();
    expect(state.failures).toBe(0);
    expect(state.nextAttemptAt).toBeUndefined();
    expect(state.lastSuccessAt).toBe(later.toISOString());
  });

  it("doubles the backoff per consecutive failure and caps it at a day", async () => {
    await seed(1);
    let now = T0;
    const failing = fakePost({ ok: false, reason: "http_error", status: 500 });
    const delays: number[] = [];
    for (let i = 0; i < 9; i++) {
      const outcome = await runSync(deps({ post: failing.post, now: () => now }));
      expect(outcome.status).toBe("failed");
      if (outcome.status !== "failed") return;
      delays.push(Date.parse(outcome.retryAt) - now.getTime());
      now = new Date(Date.parse(outcome.retryAt));
    }
    expect(delays).toEqual([
      BASE_BACKOFF_MS,
      BASE_BACKOFF_MS * 2,
      BASE_BACKOFF_MS * 4,
      BASE_BACKOFF_MS * 8,
      BASE_BACKOFF_MS * 16,
      BASE_BACKOFF_MS * 32,
      BASE_BACKOFF_MS * 64,
      MAX_BACKOFF_MS,
      MAX_BACKOFF_MS,
    ]);
    expect(failing.calls).toHaveLength(9);
  });

  it("never throws: a transport that throws counts as a failure", async () => {
    await seed(1);
    const outcome = await runSync(
      deps({
        post: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(outcome).toMatchObject({
      status: "failed",
      batches: 0,
      failure: { ok: false, reason: "network_error" },
    });
    expect((await loadSyncState()).failures).toBe(1);
  });

  it("counts duplicates the API reports without treating them as failures", async () => {
    await seed(2);
    const fake = fakePost({ ok: true, accepted: 1, duplicates: 1 });
    expect(await runSync(deps({ post: fake.post }))).toEqual({
      status: "uploaded",
      batches: 1,
      rows: 2,
      accepted: 1,
      duplicates: 1,
    });
  });
});

describe("pure helpers", () => {
  it("batches slices at BATCH_SIZE", () => {
    expect(BATCH_SIZE).toBe(200);
    expect(batches([]).length).toBe(0);
    expect(batches(rows(1)).map((b) => b.length)).toEqual([1]);
    expect(batches(rows(200)).map((b) => b.length)).toEqual([200]);
    expect(batches(rows(201)).map((b) => b.length)).toEqual([200, 1]);
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("pending keeps only rows without a sent record, in store order", () => {
    const state = emptySyncState();
    state.sent[idFor(2)] = T0.toISOString();
    expect(pending(rows(3), state).map((o) => o.observationId)).toEqual([idFor(1), idFor(3)]);
  });

  it("backoffMs: 0 for no failures, then 15 min doubling to a day", () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1)).toBe(15 * 60 * 1000);
    expect(backoffMs(2)).toBe(30 * 60 * 1000);
    expect(backoffMs(7)).toBe(BASE_BACKOFF_MS * 64);
    expect(backoffMs(8)).toBe(MAX_BACKOFF_MS);
    expect(backoffMs(50)).toBe(MAX_BACKOFF_MS);
  });

  it("inBackoff: active until nextAttemptAt, never for an absurd or backwards clock", () => {
    const state: SyncState = { ...emptySyncState(), nextAttemptAt: T0.toISOString() };
    expect(inBackoff(state, T0.getTime() - 1)).toBe(true);
    expect(inBackoff(state, T0.getTime())).toBe(false);
    expect(inBackoff(emptySyncState(), T0.getTime())).toBe(false);
    // A nextAttemptAt more than a day out cannot come from this code: treat as expired.
    expect(inBackoff(state, T0.getTime() - MAX_BACKOFF_MS - 1)).toBe(false);
    expect(inBackoff({ ...state, nextAttemptAt: "garbage" }, T0.getTime())).toBe(false);
  });

  it("contributedSince counts uploads at or after the instant", () => {
    const state = emptySyncState();
    state.sent.a = "2026-09-01T00:00:00.000Z";
    state.sent.b = "2026-09-06T00:00:00.000Z";
    state.sent.c = "2026-09-07T00:00:00.000Z";
    state.sent.d = "not a date";
    expect(contributedSince(state, Date.parse("2026-09-06T00:00:00.000Z"))).toBe(2);
    expect(contributedSince(state, 0)).toBe(3);
  });

  it("pruneSent forgets ids that left the store once their upload is a week old", () => {
    const state = emptySyncState();
    const old = new Date(T0.getTime() - SENT_RETENTION_MS).toISOString();
    const recent = new Date(T0.getTime() - SENT_RETENTION_MS + 1).toISOString();
    state.sent.stillStored = old;
    state.sent.goneButRecent = recent;
    state.sent.goneAndOld = old;
    pruneSent(state, new Set(["stillStored"]), T0.getTime());
    expect(Object.keys(state.sent).sort()).toEqual(["goneButRecent", "stillStored"]);
  });
});

describe("sync state storage", () => {
  it("round-trips, defaults to empty on garbage, and clears", async () => {
    expect(await loadSyncState()).toEqual(emptySyncState());
    await fakeBrowser.storage.local.set({ "pp:sync": "nope" });
    expect(await loadSyncState()).toEqual(emptySyncState());
    const state: SyncState = { version: 1, sent: { x: T0.toISOString() }, failures: 2 };
    await saveSyncState(state);
    expect(await loadSyncState()).toEqual(state);
    await clearSyncState();
    expect(await loadSyncState()).toEqual(emptySyncState());
  });
});

describe("config", () => {
  it("defaults to the staging Worker and is unconfigured without a token", () => {
    expect(DEFAULT_API_BASE_URL).toBe("https://pennypincher-api-staging.jamesjlee04.workers.dev");
    expect(isConfigured({ apiBaseUrl: DEFAULT_API_BASE_URL, token: "" })).toBe(false);
    expect(isConfigured({ apiBaseUrl: DEFAULT_API_BASE_URL, token: "t" })).toBe(true);
    expect(isConfigured({ apiBaseUrl: "http://insecure.invalid", token: "t" })).toBe(false);
  });
});

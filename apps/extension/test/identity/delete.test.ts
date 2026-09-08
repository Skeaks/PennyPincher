/**
 * "Delete my data" (S14), end to end against the real API app on its in-memory repo: rows
 * captured under several rotated ids are uploaded by the sync, the delete removes them all
 * from the server and clears local state. Then the failure modes with a scripted transport.
 * No network: the "transport" is `app.request` on the Hono app.
 */
import type { PriceObservation } from "@pennypincher/schema";
import { createApp } from "api/src/app";
import { MemoryObservationRepo } from "api/src/repo/memory";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  type DeleteDeps,
  type DeleteOutcome,
  defaultDeleteDeps,
  deleteMyData,
  deleteOutcomeText,
  idsToDelete,
} from "../../src/identity/delete";
import { getPanelistId, listPanelistIds } from "../../src/identity/panelist";
import { acceptConsent } from "../../src/lib/consent";
import { PROBE_KEY, updateProbeState } from "../../src/probe/state";
import { append, count as countObservations, list } from "../../src/store";
import type { SyncConfig } from "../../src/sync/config";
import { loadSyncState } from "../../src/sync/state";
import { runSync } from "../../src/sync/sync";
import { type DeleteResult, classifyDelete, classifyUpload } from "../../src/sync/transport";
import { idFor, validObservation } from "../fixtures";

// Deliberately low-entropy so gitleaks does not flag a test fixture as a leaked secret.
const CONFIG: SyncConfig = { apiBaseUrl: "https://api.test.invalid", token: "test-pilot-bearer" };
const UNCONFIGURED: SyncConfig = { apiBaseUrl: CONFIG.apiBaseUrl, token: "" };
const T0 = new Date("2026-09-04T15:00:00.000Z");
const WEEK = 7 * 24 * 60 * 60 * 1000;

let minted = 0;
const mint = () => `10000000-0000-4000-8000-${(++minted).toString(16).padStart(12, "0")}`;

/** The API on a fresh in-memory repo, reachable only through `app.request`. */
function server() {
  const repo = new MemoryObservationRepo();
  const app = createApp<{ PILOT_TOKEN?: string }>({
    repo: () => repo,
    now: () => T0,
    pilotToken: (env) => env.PILOT_TOKEN,
    log: () => {},
  });
  const env = { PILOT_TOKEN: CONFIG.token };
  const headers = (config: SyncConfig) => ({ authorization: `Bearer ${config.token}` });
  return {
    repo,
    post: async (config: SyncConfig, batch: readonly PriceObservation[]) =>
      classifyUpload(
        await app.request(
          "/v1/observations",
          {
            method: "POST",
            headers: { ...headers(config), "content-type": "application/json" },
            body: JSON.stringify({ observations: batch }),
          },
          env,
        ),
      ),
    deletePanelist: async (config: SyncConfig, id: string): Promise<DeleteResult> =>
      classifyDelete(
        await app.request(
          `/v1/panelists/${encodeURIComponent(id)}`,
          { method: "DELETE", headers: headers(config) },
          env,
        ),
      ),
    panelists: () => new Set([...repo.rows.values()].map((r) => r.panelistId)),
  };
}

function deps(overrides: Partial<DeleteDeps> = {}): DeleteDeps {
  return { ...defaultDeleteDeps(), config: () => CONFIG, ...overrides };
}

/** Capture one observation under the current id at `now`, as capture/run.ts would. */
async function capture(now: Date, n: number): Promise<string> {
  const panelistId = await getPanelistId(now, mint);
  await append(
    validObservation({
      observationId: idFor(n),
      panelistId,
      observedAt: now.toISOString(),
      product: { ...validObservation().product, retailerSku: `sku-${n}` },
    }),
  );
  return panelistId;
}

beforeEach(async () => {
  fakeBrowser.reset();
  minted = 0;
  await acceptConsent(T0);
});

describe("deleteMyData end to end", () => {
  it("removes every id this browser used from the server, then clears local state", async () => {
    const api = server();
    // Three weeks of capture under three rotated ids, uploaded by the sync as it goes.
    const ids: string[] = [];
    for (let week = 0; week < 3; week++) {
      const now = new Date(T0.getTime() + week * WEEK);
      ids.push(await capture(now, week * 2 + 1));
      await capture(now, week * 2 + 2);
      const outcome = await runSync({
        hasConsent: async () => true,
        config: () => CONFIG,
        list,
        loadState: loadSyncState,
        saveState: async () => {},
        post: api.post,
        now: () => now,
      });
      expect(outcome).toMatchObject({ status: "uploaded", accepted: 2 });
    }
    // A bystander's rows must survive.
    const other = validObservation({ observationId: idFor(99), panelistId: idFor(77) });
    await api.post(CONFIG, [other]);
    await updateProbeState(() => {});
    expect(await fakeBrowser.storage.local.get(PROBE_KEY)).toHaveProperty(PROBE_KEY);

    expect(new Set(ids).size).toBe(3);
    expect(api.panelists()).toEqual(new Set([...ids, idFor(77)]));
    expect(await listPanelistIds()).toEqual([ids[2], ids[1], ids[0]]);

    const outcome = await deleteMyData(deps({ deletePanelist: api.deletePanelist }));

    expect(outcome).toEqual({ status: "deleted", ids: 3, serverRows: 6 });
    expect(api.panelists()).toEqual(new Set([idFor(77)]));
    expect(await countObservations()).toBe(0);
    expect(await listPanelistIds()).toEqual([]);
    expect(Object.keys((await loadSyncState()).sent)).toHaveLength(0);
    expect(await fakeBrowser.storage.local.get(PROBE_KEY)).toEqual({});
    // A repeat is harmless: nothing to delete, everything already gone.
    expect(await deleteMyData(deps({ deletePanelist: api.deletePanelist }))).toEqual({
      status: "deleted",
      ids: 0,
      serverRows: 0,
    });
  });

  it("also deletes ids that only survive on stored rows (older than the identity history)", async () => {
    const api = server();
    const ids: string[] = [];
    // 15 rotations: 13 ids stay in the identity history (S15), the first two survive only on
    // their stored rows.
    for (let week = 0; week < 15; week++) {
      ids.push(await capture(new Date(T0.getTime() + week * WEEK), week + 1));
    }
    await api.post(CONFIG, await list());
    expect((await listPanelistIds()).length).toBe(13);
    expect(api.panelists().size).toBe(15);

    const outcome = await deleteMyData(deps({ deletePanelist: api.deletePanelist }));
    expect(outcome).toEqual({ status: "deleted", ids: 15, serverRows: 15 });
    expect(api.panelists().size).toBe(0);
  });

  it("idsToDelete puts the identity's ids first and adds the rest without repeats", () => {
    const rows = [
      validObservation({ panelistId: "b" }),
      validObservation({ panelistId: "a" }),
      validObservation({ panelistId: "c" }),
    ];
    expect(idsToDelete(["a", "b"], rows)).toEqual(["a", "b", "c"]);
    expect(idsToDelete([], [])).toEqual([]);
  });
});

describe("deleteMyData failure modes", () => {
  it("without a pilot token clears local state only and says so", async () => {
    await capture(T0, 1);
    let called = 0;
    const outcome = await deleteMyData(
      deps({
        config: () => UNCONFIGURED,
        deletePanelist: async () => {
          called += 1;
          return { ok: true, deleted: 0 };
        },
      }),
    );
    expect(outcome).toEqual({ status: "local_only", ids: 1 });
    expect(called).toBe(0);
    expect(await countObservations()).toBe(0);
    expect(await listPanelistIds()).toEqual([]);
  });

  it("when the server cannot be reached, removes nothing and reports the failure", async () => {
    await capture(T0, 1);
    await capture(new Date(T0.getTime() + WEEK), 2);
    const answers: DeleteResult[] = [
      { ok: true, deleted: 1 },
      { ok: false, reason: "http_error", status: 503 },
    ];
    const outcome = await deleteMyData(
      deps({
        deletePanelist: async () => answers.shift() ?? { ok: false, reason: "network_error" },
      }),
    );
    expect(outcome).toEqual({
      status: "failed",
      ids: 2,
      failed: 1,
      failure: { ok: false, reason: "http_error", status: 503 },
    });
    expect(await countObservations()).toBe(2);
    expect((await listPanelistIds()).length).toBe(2);
  });

  it("a transport that throws counts as a network error", async () => {
    await capture(T0, 1);
    const outcome = await deleteMyData(
      deps({
        deletePanelist: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(outcome).toMatchObject({ status: "failed", failure: { reason: "network_error" } });
  });
});

describe("classifyDelete", () => {
  const response = (status: number, body: unknown) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  });

  it("reads deleted from a 200 and classifies everything else", async () => {
    expect(await classifyDelete(response(200, { panelistId: "x", deleted: 3 }))).toEqual({
      ok: true,
      deleted: 3,
    });
    expect(await classifyDelete(response(401, { errors: ["unauthorized"] }))).toEqual({
      ok: false,
      reason: "http_error",
      status: 401,
    });
    expect(await classifyDelete(response(200, { nope: 1 }))).toEqual({
      ok: false,
      reason: "bad_response",
      status: 200,
    });
    expect(
      await classifyDelete({
        status: 200,
        ok: true,
        json: async () => {
          throw new Error("not json");
        },
      }),
    ).toEqual({ ok: false, reason: "bad_response", status: 200 });
  });
});

describe("deleteOutcomeText", () => {
  it("says what happened, and that a failure removed nothing", () => {
    const cases: [DeleteOutcome, RegExp][] = [
      [{ status: "deleted", ids: 3, serverRows: 6 }, /removed 6 records under 3 IDs/],
      [{ status: "deleted", ids: 1, serverRows: 1 }, /removed 1 record under 1 ID,/],
      [{ status: "local_only", ids: 1 }, /never sent anything/],
      [
        { status: "failed", ids: 2, failed: 1, failure: { ok: false, reason: "network_error" } },
        /1 of 2 IDs\. Nothing was removed/,
      ],
    ];
    for (const [outcome, pattern] of cases) expect(deleteOutcomeText(outcome)).toMatch(pattern);
  });
});

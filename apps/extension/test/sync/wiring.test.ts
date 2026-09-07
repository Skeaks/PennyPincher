/**
 * The sync alarm on the fake browser: registered at 15 minutes, runs a sync when it fires,
 * ignores other alarms, and a run that rejects never escapes the listener.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { acceptConsent } from "../../src/lib/consent";
import { append } from "../../src/store";
import { SYNC_ALARM, SYNC_PERIOD_MINUTES, registerSync } from "../../src/sync/background";
import { loadSyncState } from "../../src/sync/state";
import { type SyncDeps, type SyncOutcome, defaultSyncDeps } from "../../src/sync/sync";
import { validObservation } from "../fixtures";

const T0 = new Date("2026-09-07T12:00:00.000Z");

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

function alarm(name: string) {
  return {
    name,
    scheduledTime: T0.getTime(),
    periodInMinutes: SYNC_PERIOD_MINUTES,
    persistAcrossSessions: true,
  };
}

function deps(overrides: Partial<SyncDeps> = {}): SyncDeps {
  return {
    ...defaultSyncDeps(),
    // Deliberately low-entropy so gitleaks does not flag a test fixture as a leaked secret.
    config: () => ({ apiBaseUrl: "https://api.test.invalid", token: "test-pilot-bearer" }),
    post: async (_config, batch) => ({ ok: true, accepted: batch.length, duplicates: 0 }),
    now: () => T0,
    ...overrides,
  };
}

describe("registerSync", () => {
  it("creates the 15-minute alarm", async () => {
    registerSync(deps());
    const alarm = await fakeBrowser.alarms.get(SYNC_ALARM);
    expect(alarm?.periodInMinutes).toBe(SYNC_PERIOD_MINUTES);
    expect(SYNC_PERIOD_MINUTES).toBe(15);
  });

  it("runs a sync when the alarm fires and reports the outcome", async () => {
    await append(validObservation());
    const outcomes: SyncOutcome[] = [];
    registerSync(deps(), (o) => outcomes.push(o));
    await fakeBrowser.alarms.onAlarm.trigger(alarm(SYNC_ALARM));
    await settled(() => outcomes.length === 1);
    expect(outcomes[0]).toMatchObject({ status: "uploaded", rows: 1 });
    expect(Object.keys((await loadSyncState()).sent)).toHaveLength(1);
  });

  it("ignores other alarms", async () => {
    await append(validObservation());
    const outcomes: SyncOutcome[] = [];
    registerSync(deps(), (o) => outcomes.push(o));
    await fakeBrowser.alarms.onAlarm.trigger(alarm("pp:probe-prune"));
    await new Promise((r) => setTimeout(r, 20));
    expect(outcomes).toEqual([]);
    expect(Object.keys((await loadSyncState()).sent)).toHaveLength(0);
  });

  it("a run that rejects does not escape the listener", async () => {
    let ran = false;
    registerSync(
      deps({
        list: async () => {
          ran = true;
          throw new Error("storage exploded");
        },
      }),
    );
    await expect(fakeBrowser.alarms.onAlarm.trigger(alarm(SYNC_ALARM))).resolves.toBeDefined();
    await settled(() => ran);
  });
});

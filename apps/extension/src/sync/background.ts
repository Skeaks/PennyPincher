/**
 * Background wiring for sync (S11): a 15-minute alarm runs `runSync`. `alarms` is already in
 * the manifest. Registered synchronously so a service worker that just woke up for the alarm
 * still has the listener. Capture is not involved at all: it appends to the store and moves
 * on; this picks the rows up later.
 */
import { browser } from "wxt/browser";
import { type SyncDeps, type SyncOutcome, defaultSyncDeps, runSync } from "./sync";

export const SYNC_ALARM = "pp:sync";
export const SYNC_PERIOD_MINUTES = 15;

export function registerSync(
  deps: SyncDeps = defaultSyncDeps(),
  onOutcome: (outcome: SyncOutcome) => void = () => {},
): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== SYNC_ALARM) return;
    void runSync(deps).then(onOutcome, () => undefined);
  });
  void browser.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
}

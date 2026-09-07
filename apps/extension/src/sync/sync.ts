/**
 * One sync run (S11): upload every stored observation that has not been uploaded, in batches
 * of BATCH_SIZE, and remember which ones went. Runs from a 15-minute alarm in the background
 * (`background.ts`); capture never waits on it and never calls it.
 *
 *  - Off until consent, and off until a pilot token is configured in the build.
 *  - A failed batch stops the run and starts an exponential backoff (15 min doubling to a day).
 *    Rows are never marked sent on failure, so the next run resends them; the API is
 *    idempotent on observationId and counts a resend as `duplicates`, never an error.
 *  - Never throws. Every decision is data in, `SyncOutcome` out, so it is testable with a
 *    fake transport.
 */
import type { PriceObservation } from "@pennypincher/schema";
import { hasConsent } from "../lib/consent";
import { list } from "../store";
import { type SyncConfig, isConfigured, syncConfigFromEnv } from "./config";
import {
  type SyncState,
  backoffMs,
  inBackoff,
  loadSyncState,
  pruneSent,
  saveSyncState,
} from "./state";
import { type UploadResult, postObservations } from "./transport";

/** The API's batch limit (`ObservationBatch` allows at most 200). */
export const BATCH_SIZE = 200;

export interface SyncDeps {
  hasConsent: () => Promise<boolean>;
  config: () => SyncConfig;
  list: () => Promise<PriceObservation[]>;
  loadState: () => Promise<SyncState>;
  saveState: (state: SyncState) => Promise<void>;
  post: (config: SyncConfig, batch: readonly PriceObservation[]) => Promise<UploadResult>;
  now: () => Date;
}

export type SyncOutcome =
  /** No consent: nothing read, nothing sent. */
  | { status: "off" }
  /** No token in this build. */
  | { status: "unconfigured" }
  /** A backoff is active; `until` is when the next run may try. */
  | { status: "backoff"; until: string }
  /** Everything stored has already been uploaded. */
  | { status: "nothing" }
  /** Every pending batch went. */
  | { status: "uploaded"; batches: number; rows: number; accepted: number; duplicates: number }
  /** A batch failed after `batches` succeeded; `retryAt` is the backoff. */
  | { status: "failed"; batches: number; rows: number; failure: UploadResult; retryAt: string };

export function defaultSyncDeps(): SyncDeps {
  return {
    hasConsent,
    config: syncConfigFromEnv,
    list,
    loadState: loadSyncState,
    saveState: saveSyncState,
    post: postObservations,
    now: () => new Date(),
  };
}

/** The rows not yet uploaded, oldest first. Pure. */
export function pending(
  observations: readonly PriceObservation[],
  state: SyncState,
): PriceObservation[] {
  return observations.filter((o) => state.sent[o.observationId] === undefined);
}

/** Slice into upload-sized batches. Pure. */
export function batches<T>(rows: readonly T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function runSync(deps: SyncDeps = defaultSyncDeps()): Promise<SyncOutcome> {
  if (!(await deps.hasConsent())) return { status: "off" };
  const config = deps.config();
  if (!isConfigured(config)) return { status: "unconfigured" };

  const now = deps.now();
  const state = await deps.loadState();
  if (inBackoff(state, now.getTime())) {
    return { status: "backoff", until: state.nextAttemptAt ?? now.toISOString() };
  }

  const observations = await deps.list();
  pruneSent(state, new Set(observations.map((o) => o.observationId)), now.getTime());
  const queue = batches(pending(observations, state));
  if (queue.length === 0) {
    await deps.saveState(state);
    return { status: "nothing" };
  }

  let sentBatches = 0;
  let sentRows = 0;
  let accepted = 0;
  let duplicates = 0;
  for (const batch of queue) {
    const result = await deps
      .post(config, batch)
      .catch((): UploadResult => ({ ok: false, reason: "network_error" }));
    if (!result.ok) {
      state.failures += 1;
      const retryAt = new Date(deps.now().getTime() + backoffMs(state.failures)).toISOString();
      state.nextAttemptAt = retryAt;
      await deps.saveState(state);
      return { status: "failed", batches: sentBatches, rows: sentRows, failure: result, retryAt };
    }
    const at = deps.now().toISOString();
    for (const o of batch) state.sent[o.observationId] = at;
    sentBatches += 1;
    sentRows += batch.length;
    accepted += result.accepted;
    duplicates += result.duplicates;
    // Persist after every batch so a service worker killed mid-run does not resend what went.
    await deps.saveState(state);
  }

  const done: SyncState = {
    version: 1,
    sent: state.sent,
    failures: 0,
    lastSuccessAt: deps.now().toISOString(),
  };
  await deps.saveState(done);
  return { status: "uploaded", batches: sentBatches, rows: sentRows, accepted, duplicates };
}

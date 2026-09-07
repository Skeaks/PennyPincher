/**
 * Sync state on `chrome.storage.local` (S11): which observations have been uploaded and when,
 * and the retry backoff. The observation store is append-only and never edited in place, so
 * "sent" lives here as a map from observationId to the upload time rather than as a flag on
 * the row. Writers are serialised like the other stores. Nothing here is PII.
 */
import { browser } from "wxt/browser";

export const SYNC_KEY = "pp:sync";

/** First retry after a failure. Doubles per consecutive failure up to MAX_BACKOFF_MS. */
export const BASE_BACKOFF_MS = 15 * 60 * 1000;
export const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

/** How long an id stays in `sent` after its row left the store, so the weekly count holds. */
export const SENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface SyncState {
  version: 1;
  /** observationId -> ISO-8601 UTC upload time. */
  sent: Record<string, string>;
  /** Consecutive failed runs. Reset to 0 by a successful upload. */
  failures: number;
  /** ISO-8601 UTC. Runs before this instant are skipped. Absent when no backoff is active. */
  nextAttemptAt?: string;
  /** ISO-8601 UTC of the last run that uploaded at least one batch. */
  lastSuccessAt?: string;
}

export function emptySyncState(): SyncState {
  return { version: 1, sent: {}, failures: 0 };
}

function isSyncState(value: unknown): value is SyncState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as SyncState;
  return (
    s.version === 1 &&
    typeof s.sent === "object" &&
    s.sent !== null &&
    typeof s.failures === "number"
  );
}

let writeQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => undefined);
  return run;
}

export async function loadSyncState(): Promise<SyncState> {
  const result = await browser.storage.local.get(SYNC_KEY);
  const raw = result[SYNC_KEY];
  return isSyncState(raw) ? raw : emptySyncState();
}

export async function saveSyncState(state: SyncState): Promise<void> {
  await serialized(() => browser.storage.local.set({ [SYNC_KEY]: state }));
}

/** Forget every upload record and the backoff. Called from "Delete my data". */
export async function clearSyncState(): Promise<void> {
  await serialized(() => browser.storage.local.remove(SYNC_KEY));
}

/** 15 min, 30 min, 1 h, 2 h, ... capped at a day. */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (failures - 1));
}

/** True while a backoff is active at `nowMs`. A clock that went backwards does not block. */
export function inBackoff(state: SyncState, nowMs: number): boolean {
  if (state.nextAttemptAt === undefined) return false;
  const until = Date.parse(state.nextAttemptAt);
  return Number.isFinite(until) && nowMs < until && until - nowMs <= MAX_BACKOFF_MS;
}

/** Observations uploaded at or after `sinceMs`: the popup's "you contributed N this week". */
export function contributedSince(state: SyncState, sinceMs: number): number {
  let n = 0;
  for (const at of Object.values(state.sent)) {
    const t = Date.parse(at);
    if (Number.isFinite(t) && t >= sinceMs) n += 1;
  }
  return n;
}

/**
 * Drop `sent` entries whose row is no longer in the store AND whose upload is older than
 * SENT_RETENTION_MS. Keeps the map bounded by the store cap plus a week of uploads.
 */
export function pruneSent(state: SyncState, storedIds: ReadonlySet<string>, nowMs: number): void {
  for (const [id, at] of Object.entries(state.sent)) {
    if (storedIds.has(id)) continue;
    const t = Date.parse(at);
    if (!Number.isFinite(t) || nowMs - t >= SENT_RETENTION_MS) delete state.sent[id];
  }
}

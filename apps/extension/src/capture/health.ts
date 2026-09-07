/**
 * Adapter health beacon (S12): the telemetry that says when a retailer's DOM change has
 * silently broken capture. Per adapter (`name@version`), how many captures were attempted,
 * how many yielded an observation, and how many failed by reason, kept in
 * `chrome.storage.local` and uploaded once a day through `sync/transport.ts`. The counts
 * are reset after each successful upload (the uploaded counts are subtracted, so a capture
 * recorded during the upload is not lost).
 *
 * The payload carries the client version, the adapter name and version, the counts and a
 * UTC date. No observation data, no ids, no URLs. Off until consent, like the sync.
 *
 * `capture/tally.ts` counts prices per listing page for the popup; that is a different
 * question (which page, how many rows) keyed by URL, so this file keeps its own counts.
 */
import { browser } from "wxt/browser";
import { hasConsent } from "../lib/consent";
import { type SyncConfig, isConfigured, syncConfigFromEnv } from "../sync/config";
import { type HealthPostResult, postAdapterHealth } from "../sync/transport";
import type { ExtractFailureReason } from "./adapter";
import type { CaptureOutcome } from "./run";

export const HEALTH_KEY = "pp:adapter-health";
export const HEALTH_ALARM = "pp:adapter-health";
/** Once a day. */
export const HEALTH_PERIOD_MINUTES = 24 * 60;

/** Why a capture yielded no stored observation. `rejected`: extracted but the store refused it. */
export type HealthFailureReason = ExtractFailureReason | "rejected";

export interface AdapterCounts {
  attempted: number;
  extracted: number;
  failed: Partial<Record<HealthFailureReason, number>>;
}

export interface HealthState {
  version: 1;
  /** ISO-8601 UTC: when these counts started. */
  since: string;
  /** Keyed by `name@version`. */
  adapters: Record<string, AdapterCounts>;
}

export function emptyHealthState(now: Date): HealthState {
  return { version: 1, since: now.toISOString(), adapters: {} };
}

function emptyCounts(): AdapterCounts {
  return { attempted: 0, extracted: 0, failed: {} };
}

function isCounts(value: unknown): value is AdapterCounts {
  if (typeof value !== "object" || value === null) return false;
  const c = value as AdapterCounts;
  return (
    typeof c.attempted === "number" &&
    typeof c.extracted === "number" &&
    typeof c.failed === "object" &&
    c.failed !== null
  );
}

function isHealthState(value: unknown): value is HealthState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as HealthState;
  return (
    s.version === 1 &&
    typeof s.since === "string" &&
    typeof s.adapters === "object" &&
    s.adapters !== null &&
    Object.values(s.adapters).every(isCounts)
  );
}

function countsFor(state: HealthState, adapter: string): AdapterCounts {
  const existing = state.adapters[adapter];
  if (existing) return existing;
  const fresh = emptyCounts();
  state.adapters[adapter] = fresh;
  return fresh;
}

function addFailure(counts: AdapterCounts, reason: HealthFailureReason, n: number): void {
  if (n <= 0) return;
  counts.failed[reason] = (counts.failed[reason] ?? 0) + n;
}

/** The adapter a capture outcome names, when it names one. */
export function adapterOf(outcome: CaptureOutcome): string | undefined {
  switch (outcome.status) {
    case "stored":
      return outcome.observation.provenance.adapter;
    case "extract_failed":
    case "listing":
      return outcome.adapter;
    default:
      return undefined;
  }
}

/**
 * Pure: the state with one capture outcome counted. `fallbackAdapter` names the adapter for
 * the outcomes that do not carry it (`duplicate`, `rejected`); without it those are not
 * counted. `no_consent` and `no_adapter` are not attempts and never count.
 */
export function withOutcome(
  state: HealthState,
  outcome: CaptureOutcome,
  fallbackAdapter?: string,
): HealthState {
  const adapter = adapterOf(outcome) ?? fallbackAdapter;
  if (adapter === undefined) return state;
  const next: HealthState = {
    version: 1,
    since: state.since,
    adapters: Object.fromEntries(
      Object.entries(state.adapters).map(([k, v]) => [
        k,
        { attempted: v.attempted, extracted: v.extracted, failed: { ...v.failed } },
      ]),
    ),
  };
  switch (outcome.status) {
    case "no_consent":
    case "no_adapter":
      return state;
    case "stored":
    case "duplicate": {
      const counts = countsFor(next, adapter);
      counts.attempted += 1;
      counts.extracted += 1;
      return next;
    }
    case "rejected": {
      const counts = countsFor(next, adapter);
      counts.attempted += 1;
      counts.extracted += 1;
      addFailure(counts, "rejected", 1);
      return next;
    }
    case "extract_failed": {
      const counts = countsFor(next, adapter);
      counts.attempted += 1;
      addFailure(counts, outcome.reason, 1);
      return next;
    }
    case "listing": {
      const counts = countsFor(next, adapter);
      let skipped = 0;
      for (const [reason, n] of Object.entries(outcome.skipped)) {
        const count = n ?? 0;
        skipped += count;
        addFailure(counts, reason as ExtractFailureReason, count);
      }
      const extracted = outcome.stored.length + outcome.duplicates + outcome.rejected;
      counts.attempted += extracted + skipped;
      counts.extracted += extracted;
      addFailure(counts, "rejected", outcome.rejected);
      return next;
    }
  }
}

/** Pure: `state` with the counts of `uploaded` removed, never below zero. */
export function subtract(state: HealthState, uploaded: HealthState, now: Date): HealthState {
  const next = emptyHealthState(now);
  for (const [adapter, counts] of Object.entries(state.adapters)) {
    const sent = uploaded.adapters[adapter];
    const remaining: AdapterCounts = {
      attempted: Math.max(0, counts.attempted - (sent?.attempted ?? 0)),
      extracted: Math.max(0, counts.extracted - (sent?.extracted ?? 0)),
      failed: {},
    };
    for (const [reason, n] of Object.entries(counts.failed)) {
      const left = (n ?? 0) - (sent?.failed[reason as HealthFailureReason] ?? 0);
      if (left > 0) remaining.failed[reason as HealthFailureReason] = left;
    }
    if (remaining.attempted > 0) next.adapters[adapter] = remaining;
  }
  return next;
}

// ---------------------------------------------------------------------------------------------
// Storage.
// ---------------------------------------------------------------------------------------------

let writeQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => undefined);
  return run;
}

export async function loadHealthState(now = new Date()): Promise<HealthState> {
  const result = await browser.storage.local.get(HEALTH_KEY);
  const raw = result[HEALTH_KEY];
  return isHealthState(raw) ? raw : emptyHealthState(now);
}

export async function saveHealthState(state: HealthState): Promise<void> {
  await serialized(() => browser.storage.local.set({ [HEALTH_KEY]: state }));
}

/** Forget every count. Called from "Delete my data". */
export async function clearHealthState(): Promise<void> {
  await serialized(() => browser.storage.local.remove(HEALTH_KEY));
}

/**
 * Count one capture outcome. Writers are serialised within this realm (one content script,
 * or the background); two tabs counting at the same instant can still lose one, because the
 * get-then-set on `chrome.storage.local` is not atomic across realms. Telemetry, so accepted
 * (review of PR #34); making the background the single writer is the follow-up. Never
 * throws: a storage failure is not capture's problem.
 */
export function recordCaptureOutcome(
  outcome: CaptureOutcome,
  fallbackAdapter?: string,
  now = new Date(),
): Promise<void> {
  if (adapterOf(outcome) === undefined && fallbackAdapter === undefined) return Promise.resolve();
  if (outcome.status === "no_consent" || outcome.status === "no_adapter") return Promise.resolve();
  return serialized(async () => {
    const current = await loadHealthState(now);
    await browser.storage.local.set({
      [HEALTH_KEY]: withOutcome(current, outcome, fallbackAdapter),
    });
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------
// The daily upload.
// ---------------------------------------------------------------------------------------------

/** One adapter's line in the beacon. */
export interface AdapterHealthEntry {
  adapter: string;
  version: string;
  attempted: number;
  extracted: number;
  failed: Partial<Record<HealthFailureReason, number>>;
}

/** What `POST /v1/adapter-health` receives. Counts and versions only. */
export interface AdapterHealthReport {
  clientVersion: string;
  /** UTC calendar date the counts are reported on, `YYYY-MM-DD`. */
  date: string;
  adapters: AdapterHealthEntry[];
}

export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Pure: the report for `state`, or undefined when nothing was attempted. */
export function buildReport(
  state: HealthState,
  clientVersion: string,
  now: Date,
): AdapterHealthReport | undefined {
  const adapters: AdapterHealthEntry[] = [];
  for (const [id, counts] of Object.entries(state.adapters).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (counts.attempted <= 0) continue;
    const at = id.indexOf("@");
    const adapter = at === -1 ? id : id.slice(0, at);
    const version = at === -1 ? "" : id.slice(at + 1);
    adapters.push({
      adapter,
      version,
      attempted: counts.attempted,
      extracted: counts.extracted,
      failed: { ...counts.failed },
    });
  }
  if (adapters.length === 0) return undefined;
  return { clientVersion, date: utcDate(now), adapters };
}

export interface HealthUploadDeps {
  hasConsent: () => Promise<boolean>;
  config: () => SyncConfig;
  load: (now: Date) => Promise<HealthState>;
  save: (state: HealthState) => Promise<void>;
  post: (config: SyncConfig, report: AdapterHealthReport) => Promise<HealthPostResult>;
  clientVersion: () => string;
  now: () => Date;
}

export type HealthUploadOutcome =
  | { status: "off" }
  | { status: "unconfigured" }
  | { status: "nothing" }
  | { status: "uploaded"; report: AdapterHealthReport }
  | { status: "failed"; report: AdapterHealthReport; failure: HealthPostResult };

export function defaultHealthDeps(): HealthUploadDeps {
  return {
    hasConsent,
    config: syncConfigFromEnv,
    load: loadHealthState,
    save: saveHealthState,
    post: postAdapterHealth,
    clientVersion: () => browser.runtime.getManifest().version,
    now: () => new Date(),
  };
}

/** One upload. Never throws. On success the uploaded counts are subtracted and saved. */
export async function runHealthUpload(
  deps: HealthUploadDeps = defaultHealthDeps(),
): Promise<HealthUploadOutcome> {
  if (!(await deps.hasConsent())) return { status: "off" };
  const config = deps.config();
  if (!isConfigured(config)) return { status: "unconfigured" };

  const now = deps.now();
  const state = await deps.load(now);
  const report = buildReport(state, deps.clientVersion(), now);
  if (!report) return { status: "nothing" };

  const result = await deps
    .post(config, report)
    .catch((): HealthPostResult => ({ ok: false, reason: "network_error" }));
  if (!result.ok) return { status: "failed", report, failure: result };

  // Re-read before subtracting: a content script may have counted while the request ran.
  const latest = await deps.load(deps.now());
  await deps.save(subtract(latest, state, deps.now()));
  return { status: "uploaded", report };
}

/**
 * Background wiring: a daily alarm runs the upload. The listener is registered synchronously,
 * like the sync's. The alarm is created only when it does not already exist: `alarms.create`
 * with an existing name replaces it and restarts the countdown, and the MV3 worker restarts
 * many times a day (the 15-minute sync alarm, every content-script message), so an
 * unconditional create would push a 24-hour alarm forward forever and it would never fire.
 */
export function registerHealthBeacon(
  deps: HealthUploadDeps = defaultHealthDeps(),
  onOutcome: (outcome: HealthUploadOutcome) => void = () => {},
): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== HEALTH_ALARM) return;
    void runHealthUpload(deps).then(onOutcome, () => undefined);
  });
  void ensureHealthAlarm();
}

/** Create the daily alarm unless one is already scheduled. Never throws. */
export async function ensureHealthAlarm(): Promise<void> {
  try {
    const existing = await browser.alarms.get(HEALTH_ALARM);
    if (existing) return;
    await browser.alarms.create(HEALTH_ALARM, { periodInMinutes: HEALTH_PERIOD_MINUTES });
  } catch {
    // No alarms API (a test without the fake browser): the beacon simply stays off.
  }
}

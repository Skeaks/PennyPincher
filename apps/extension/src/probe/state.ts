/**
 * Probe state on `chrome.storage.local`: the rate table (one attempt per retailer + SKU per
 * hour), the latest result per key, and the per-retailer counters the options page shows.
 *
 * Writers are serialised the same way as the observation store, so a probe finishing while
 * the prune alarm runs cannot lose either write. Nothing here is PII: keys are retailer + SKU,
 * values are prices, store ids, timestamps and counters.
 */
import { browser } from "wxt/browser";
import {
  type ProbeFailureReason,
  type ProbeResult,
  type ProbeState,
  type RetailerProbeStats,
  emptyProbeState,
} from "./types";

export const PROBE_KEY = "pp:probe";
/** "At most once per retailerSku per hour." */
export const PROBE_INTERVAL_MS = 60 * 60 * 1000;
/** Latest results kept for the popup. The observation store holds the full record. */
export const MAX_RESULTS = 500;

let writeQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => undefined);
  return run;
}

function isProbeState(value: unknown): value is ProbeState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as ProbeState;
  return (
    s.version === 1 &&
    typeof s.rate === "object" &&
    s.rate !== null &&
    typeof s.results === "object" &&
    s.results !== null &&
    typeof s.stats === "object" &&
    s.stats !== null
  );
}

export async function loadProbeState(): Promise<ProbeState> {
  const result = await browser.storage.local.get(PROBE_KEY);
  const raw = result[PROBE_KEY];
  return isProbeState(raw) ? raw : emptyProbeState();
}

/** Read-modify-write under the queue. `mutate` edits the state in place. */
export async function updateProbeState(mutate: (state: ProbeState) => void): Promise<ProbeState> {
  return serialized(async () => {
    const state = await loadProbeState();
    mutate(state);
    await browser.storage.local.set({ [PROBE_KEY]: state });
    return state;
  });
}

/** Forget every probe result and counter. Called from "Delete my data". */
export async function clearProbeState(): Promise<void> {
  await serialized(() => browser.storage.local.remove(PROBE_KEY));
}

/** Drop rate entries whose hour has passed. Pure; the alarm handler persists the result. */
export function pruneRate(state: ProbeState, nowMs: number): void {
  for (const [key, at] of Object.entries(state.rate)) {
    if (!(nowMs - at < PROBE_INTERVAL_MS)) delete state.rate[key];
  }
}

/**
 * Claim the next hour for `key`. True when the caller may probe now; the claim stands whether
 * the probe then succeeds or fails ("never retry within the hour"). A clock that went backwards
 * counts as expired rather than blocking the key forever.
 */
export function reserveProbe(state: ProbeState, key: string, nowMs: number): boolean {
  const last = state.rate[key];
  if (last !== undefined && nowMs - last >= 0 && nowMs - last < PROBE_INTERVAL_MS) return false;
  state.rate[key] = nowMs;
  return true;
}

function statsFor(state: ProbeState, retailer: ProbeResult["retailer"]): RetailerProbeStats {
  const existing = state.stats[retailer];
  if (existing) return existing;
  const fresh: RetailerProbeStats = {
    checks: 0,
    differences: 0,
    failures: 0,
    failuresByReason: {},
  };
  state.stats[retailer] = fresh;
  return fresh;
}

/** Store a result and bump the retailer's counters. Evicts the oldest results past the cap. */
export function recordResult(state: ProbeState, result: ProbeResult): void {
  state.results[result.key] = result;
  const stats = statsFor(state, result.retailer);
  stats.checks += 1;
  if (result.verdict === "MORE" || result.verdict === "LESS") stats.differences += 1;
  if (result.verdict === "UNCHECKED") {
    stats.failures += 1;
    const reason: ProbeFailureReason = result.reason ?? "extract_unavailable";
    stats.failuresByReason[reason] = (stats.failuresByReason[reason] ?? 0) + 1;
  }
  const keys = Object.keys(state.results);
  if (keys.length > MAX_RESULTS) {
    const byAge = keys.sort((a, b) =>
      (state.results[a]?.checkedAt ?? "").localeCompare(state.results[b]?.checkedAt ?? ""),
    );
    for (const k of byAge.slice(0, keys.length - MAX_RESULTS)) delete state.results[k];
  }
}

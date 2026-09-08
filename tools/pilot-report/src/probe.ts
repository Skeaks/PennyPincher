/**
 * Lever-probe difference rate from the export. The extension keeps its own verdicts locally
 * (`ProbeResult`, never uploaded); what reaches the server is the pair of observations, the
 * user's logged-in row and the anonymous row the probe stored with `sessionState: "logged_out"`
 * and `cleanSession: true` (S06). This module re-pairs them and re-applies the same-store
 * rule, so the server-side rate is computed from what the panel actually contributed.
 *
 * The store rule mirrors `apps/extension/src/probe/compare.ts`: store ids when both sides
 * have one; the label as a fallback except on Instacart, where the label is the banner, not a
 * location (Jamie, 2026-09-07); nothing to match on is STORE_UNKNOWN, not a comparison.
 */
import type { ExportRow } from "./rows";
import { isProbeRow } from "./rows";

/** Pair an anonymous row with a logged-in row at most this long before it. */
export const PAIR_LOOKBACK_MS = 60 * 60_000;
/** Clock skew between the content script's observation and the background's probe. */
export const PAIR_SLACK_MS = 5 * 60_000;

export type ProbeVerdict = "SAME" | "MORE" | "LESS" | "STORE_DIFFERS" | "STORE_UNKNOWN";

export interface ProbePair {
  retailer: string;
  retailerSku: string;
  panelistId: string;
  mine: ExportRow;
  anon: ExportRow;
  verdict: ProbeVerdict;
  /** `mine - anon` in minor units; SAME / MORE / LESS only. */
  deltaMinor?: number;
}

export interface Pairing {
  pairs: ProbePair[];
  /** Anonymous rows with no logged-in row of the same panelist + SKU inside the window, per retailer. */
  unpaired: Record<string, number>;
}

export function labelNamesLocation(retailer: string): boolean {
  return retailer !== "instacart";
}

export function sameStore(a: ExportRow, b: ExportRow): boolean | undefined {
  if (a.retailerStoreId !== null && b.retailerStoreId !== null) {
    return a.retailerStoreId === b.retailerStoreId;
  }
  if (!labelNamesLocation(a.retailer)) return undefined;
  if (a.storeLabel !== null && b.storeLabel !== null) return a.storeLabel === b.storeLabel;
  return undefined;
}

export function compareRows(
  mine: ExportRow,
  anon: ExportRow,
): Pick<ProbePair, "verdict" | "deltaMinor"> {
  const same = sameStore(mine, anon);
  if (same === undefined) return { verdict: "STORE_UNKNOWN" };
  if (!same) return { verdict: "STORE_DIFFERS" };
  const deltaMinor = mine.priceMinor - anon.priceMinor;
  if (deltaMinor === 0) return { verdict: "SAME", deltaMinor };
  return { verdict: deltaMinor > 0 ? "MORE" : "LESS", deltaMinor };
}

/**
 * For every anonymous row, the logged-in row of the same panelist, retailer and SKU closest
 * in time inside `[anon - lookback, anon + slack]`. A logged-in row may anchor several probes
 * (the probe fires at most hourly per SKU while the user keeps the page open).
 */
export function pairProbes(rows: readonly ExportRow[]): Pairing {
  const mine = new Map<string, ExportRow[]>();
  for (const row of rows) {
    if (row.sessionState !== "logged_in") continue;
    const key = `${row.panelistId}|${row.retailer}|${row.retailerSku}`;
    const list = mine.get(key);
    if (list) list.push(row);
    else mine.set(key, [row]);
  }
  const pairs: ProbePair[] = [];
  const unpaired: Record<string, number> = {};
  for (const anon of rows) {
    if (!isProbeRow(anon)) continue;
    const at = Date.parse(anon.observedAt);
    const candidates = mine.get(`${anon.panelistId}|${anon.retailer}|${anon.retailerSku}`) ?? [];
    let best: ExportRow | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const t = Date.parse(candidate.observedAt);
      if (t < at - PAIR_LOOKBACK_MS || t > at + PAIR_SLACK_MS) continue;
      const distance = Math.abs(at - t);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (best === undefined) {
      unpaired[anon.retailer] = (unpaired[anon.retailer] ?? 0) + 1;
      continue;
    }
    pairs.push({
      retailer: anon.retailer,
      retailerSku: anon.retailerSku,
      panelistId: anon.panelistId,
      mine: best,
      anon,
      ...compareRows(best, anon),
    });
  }
  return { pairs, unpaired };
}

export interface RetailerProbeRate {
  retailer: string;
  /** Pairs found. */
  checks: number;
  /** SAME + MORE + LESS: both sides resolved to one store. */
  comparable: number;
  same: number;
  more: number;
  less: number;
  storeDiffers: number;
  storeUnknown: number;
  unpaired: number;
  /** (MORE + LESS) / comparable; null with no comparable checks. */
  differenceRate: number | null;
  /** Over MORE and LESS pairs; null without any. */
  medianAbsDeltaMinor: number | null;
}

export function probeRates(pairing: Pairing): RetailerProbeRate[] {
  const byRetailer = new Map<string, ProbePair[]>();
  for (const pair of pairing.pairs) {
    const list = byRetailer.get(pair.retailer);
    if (list) list.push(pair);
    else byRetailer.set(pair.retailer, [pair]);
  }
  for (const retailer of Object.keys(pairing.unpaired)) {
    if (!byRetailer.has(retailer)) byRetailer.set(retailer, []);
  }
  return [...byRetailer.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([retailer, pairs]) => {
      const count = (verdict: ProbeVerdict) => pairs.filter((p) => p.verdict === verdict).length;
      const same = count("SAME");
      const more = count("MORE");
      const less = count("LESS");
      const comparable = same + more + less;
      const deltas = pairs
        .filter((p) => p.verdict === "MORE" || p.verdict === "LESS")
        .map((p) => Math.abs(p.deltaMinor ?? 0));
      return {
        retailer,
        checks: pairs.length,
        comparable,
        same,
        more,
        less,
        storeDiffers: count("STORE_DIFFERS"),
        storeUnknown: count("STORE_UNKNOWN"),
        unpaired: pairing.unpaired[retailer] ?? 0,
        differenceRate: comparable === 0 ? null : (more + less) / comparable,
        medianAbsDeltaMinor: median(deltas),
      };
    });
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[mid - 1] ?? 0) + upper) / 2;
}

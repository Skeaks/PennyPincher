/**
 * Semantic dedup (S14): the same panelist reporting the same price for the same cell within
 * ten minutes is one observation, not several. A shopper who reloads a product page, opens
 * its modal and scrolls past its tile has seen one price once; storing each view would
 * inflate `observations` on the cell (the query API already collapses to one vote per
 * panelist, so N is safe either way, but the raw count and the storage are not).
 *
 * Distance is measured on `observedAt`, the client's clock, because that is when the price
 * was seen; `receivedAt` only says when the sync ran. A row is a duplicate when any stored
 * row, or any row already kept from the same batch, has the same panelist, cell, price and
 * currency and an `observedAt` less than SEMANTIC_DEDUP_MS away. Rows are considered oldest
 * first, so of three views at 0, 9 and 18 minutes the first and the last are kept: the
 * middle one is within ten minutes of the first, the last is not.
 *
 * A duplicate is never stored, so resending it later finds the same twin and is a duplicate
 * again: the answer is stable across retries.
 */
import type { ObservationRow } from "../repo/observations";

export const SEMANTIC_DEDUP_MS = 10 * 60 * 1_000;

export interface DedupResult {
  /** Rows to store, oldest first. A row whose id repeats inside the batch appears once. */
  kept: ObservationRow[];
  /** Rows dropped as repeat views. */
  duplicates: number;
}

/** panelist|cell|price|currency: what makes two rows "the same observation". */
export function semanticKey(row: ObservationRow): string {
  return `${row.panelistId}|${row.cellKey}|${row.priceMinor}|${row.currency}`;
}

/**
 * Split a batch into rows to store and repeat views, given the rows already stored that could
 * be twins (the caller loads each panelist's rows around the batch's time span). Pure.
 */
export function dedupeSemantic(
  rows: readonly ObservationRow[],
  existing: readonly ObservationRow[],
): DedupResult {
  const seen = new Map<string, number[]>();
  const remember = (row: ObservationRow) => {
    const key = semanticKey(row);
    const times = seen.get(key);
    if (times) times.push(Date.parse(row.observedAt));
    else seen.set(key, [Date.parse(row.observedAt)]);
  };
  for (const row of existing) remember(row);

  const ordered = [...rows].sort(
    (a, b) =>
      Date.parse(a.observedAt) - Date.parse(b.observedAt) ||
      a.observationId.localeCompare(b.observationId),
  );
  const kept: ObservationRow[] = [];
  let duplicates = 0;
  for (const row of ordered) {
    const t = Date.parse(row.observedAt);
    const twins = seen.get(semanticKey(row)) ?? [];
    if (twins.some((other) => Math.abs(other - t) < SEMANTIC_DEDUP_MS)) {
      duplicates += 1;
      continue;
    }
    remember(row);
    kept.push(row);
  }
  return { kept, duplicates };
}

/**
 * The `observedAt` span the caller must load per panelist so every possible twin is in
 * `existing`: the batch's earliest minus the window to its latest plus the window.
 */
export function twinSpan(rows: readonly ObservationRow[]): { from: Date; to: Date } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const t = Date.parse(row.observedAt);
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return { from: new Date(min - SEMANTIC_DEDUP_MS), to: new Date(max + SEMANTIC_DEDUP_MS) };
}

/** Rows grouped by panelistId, insertion order kept within each group. */
export function byPanelist(rows: readonly ObservationRow[]): Map<string, ObservationRow[]> {
  const groups = new Map<string, ObservationRow[]>();
  for (const row of rows) {
    const group = groups.get(row.panelistId);
    if (group) group.push(row);
    else groups.set(row.panelistId, [row]);
  }
  return groups;
}

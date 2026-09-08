/**
 * Panel and cell metrics over one window of export rows.
 *
 * Cells are resolved here the way the API resolves them (one vote per panelist, suspects
 * excluded, `resolve()` from @pennypincher/stats) but over the report's window rather than
 * the API's 72 h: at pilot density (30 to 60 panelists over 200 SKUs) a 72 h window rarely
 * reaches the coupon threshold, and the decision is about whether variance exists, not about
 * what the popup showed on a given afternoon. The API's own view is reported next to it
 * (`api.ts`) so the two can be compared.
 */
import { type Resolution, requiredObservations, resolve } from "@pennypincher/stats";
import type { ObservationRow } from "api/src/repo/observations";
import { onePerPanelist } from "api/src/routes/cells";
import { median } from "./probe";
import { type ExportRow, isProbeRow, toObservationRow } from "./rows";

/** Cells with at least this many votes count as "N >= threshold": the two-tier minimum. */
export const CELL_THRESHOLD = requiredObservations(2);

export interface CellSummary {
  cellKey: string;
  retailerSku: string;
  title: string;
  /** Rows in the window before the collapse. */
  rows: number;
  /** Distinct panelists, suspects included. */
  panelists: number;
  /** Votes the resolver saw: one per non-suspect panelist. */
  n: number;
  suspectsExcluded: number;
  /** The votes, ascending by observedAt; the reconciliation replays them. */
  votes: ObservationRow[];
  resolution: Resolution;
  /** `(top - floor) / floor` for RESOLVED cells with more than one tier; otherwise undefined. */
  spread?: number;
}

/** Group one retailer's rows by cell and resolve each over the window ending at `window.to`. */
export function buildCells(
  rows: readonly ExportRow[],
  retailer: string,
  suspects: ReadonlySet<string>,
  window: { from: string; to: string },
): CellSummary[] {
  const groups = new Map<string, ExportRow[]>();
  for (const row of rows) {
    if (row.retailer !== retailer) continue;
    const list = groups.get(row.cellKey);
    if (list) list.push(row);
    else groups.set(row.cellKey, [row]);
  }
  const windowHours = (Date.parse(window.to) - Date.parse(window.from)) / 3_600_000;
  const now = new Date(Date.parse(window.to) - 1);
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cellKey, cellRows]) => {
      const panelists = new Set(cellRows.map((r) => r.panelistId));
      const kept = cellRows.filter((r) => !suspects.has(r.panelistId));
      const votes = onePerPanelist(kept.map(toObservationRow));
      const resolution = resolve(
        votes.map((v) => ({
          observedAt: v.observedAt,
          facts: { price: { amountMinor: v.priceMinor, currency: v.currency } },
        })),
        { windowHours, now },
      );
      const first = cellRows[0];
      const summary: CellSummary = {
        cellKey,
        retailerSku: first?.retailerSku ?? "",
        title: commonTitle(cellRows),
        rows: cellRows.length,
        panelists: panelists.size,
        n: votes.length,
        suspectsExcluded: cellRows.length - kept.length,
        votes,
        resolution,
      };
      if (resolution.status === "RESOLVED" && resolution.tiers.length > 1) {
        const top = resolution.tiers[resolution.tiers.length - 1]?.price ?? resolution.floor;
        summary.spread = resolution.floor === 0 ? 0 : (top - resolution.floor) / resolution.floor;
      }
      return summary;
    });
}

export interface SpreadRecord {
  cellKey: string;
  title: string;
  spread: number;
  floorMinor: number;
  topMinor: number;
}

export interface CellMetrics {
  threshold: number;
  cells: number;
  withThreshold: number;
  resolved: number;
  unresolvedByReason: Record<string, number>;
  /** RESOLVED cells with more than one tier. */
  multiTier: number;
  /** `multiTier / resolved`; null when nothing resolved. */
  multiTierShare: number | null;
  /** Tier count -> number of RESOLVED cells with that many tiers. */
  tierHistogram: Record<string, number>;
  maxSpread: SpreadRecord | null;
  medianSpread: number | null;
  suspectsExcluded: number;
}

export function cellMetrics(cells: readonly CellSummary[]): CellMetrics {
  const resolved = cells.filter((c) => c.resolution.status === "RESOLVED");
  const unresolvedByReason: Record<string, number> = {};
  for (const cell of cells) {
    if (cell.resolution.status === "UNRESOLVED") {
      const reason = cell.resolution.reason;
      unresolvedByReason[reason] = (unresolvedByReason[reason] ?? 0) + 1;
    }
  }
  const tierHistogram: Record<string, number> = {};
  let maxSpread: SpreadRecord | null = null;
  const spreads: number[] = [];
  for (const cell of resolved) {
    if (cell.resolution.status !== "RESOLVED") continue;
    const k = String(cell.resolution.tiers.length);
    tierHistogram[k] = (tierHistogram[k] ?? 0) + 1;
    if (cell.spread === undefined) continue;
    spreads.push(cell.spread);
    if (maxSpread === null || cell.spread > maxSpread.spread) {
      maxSpread = {
        cellKey: cell.cellKey,
        title: cell.title,
        spread: cell.spread,
        floorMinor: cell.resolution.floor,
        topMinor: cell.resolution.tiers[cell.resolution.tiers.length - 1]?.price ?? 0,
      };
    }
  }
  const multiTier = spreads.length;
  return {
    threshold: CELL_THRESHOLD,
    cells: cells.length,
    withThreshold: cells.filter((c) => c.n >= CELL_THRESHOLD).length,
    resolved: resolved.length,
    unresolvedByReason,
    multiTier,
    multiTierShare: resolved.length === 0 ? null : multiTier / resolved.length,
    tierHistogram,
    maxSpread,
    medianSpread: median(spreads),
    suspectsExcluded: cells.reduce((sum, c) => sum + c.suspectsExcluded, 0),
  };
}

export interface PanelMetrics {
  panelistsAll: number;
  panelistsRetailer: number;
  observationsAll: number;
  observationsRetailer: number;
  /** The probe's anonymous rows, all retailers. */
  probeRows: number;
  estimateRows: number;
  /** `provenance.adapter` -> rows, all retailers. */
  byAdapter: Record<string, number>;
  /** zip3 -> rows for the pilot retailer; "" for rows without one. */
  byZip3: Record<string, number>;
  byFulfillment: Record<string, number>;
}

export function panelMetrics(rows: readonly ExportRow[], retailer: string): PanelMetrics {
  const all = new Set<string>();
  const mine = new Set<string>();
  const byAdapter: Record<string, number> = {};
  const byZip3: Record<string, number> = {};
  const byFulfillment: Record<string, number> = {};
  let observationsRetailer = 0;
  let probeRows = 0;
  let estimateRows = 0;
  for (const row of rows) {
    all.add(row.panelistId);
    byAdapter[row.adapter] = (byAdapter[row.adapter] ?? 0) + 1;
    if (isProbeRow(row)) probeRows++;
    if (row.isEstimate) estimateRows++;
    if (row.retailer !== retailer) continue;
    mine.add(row.panelistId);
    observationsRetailer++;
    const zip = row.zip3 ?? "";
    byZip3[zip] = (byZip3[zip] ?? 0) + 1;
    byFulfillment[row.fulfillment] = (byFulfillment[row.fulfillment] ?? 0) + 1;
  }
  return {
    panelistsAll: all.size,
    panelistsRetailer: mine.size,
    observationsAll: rows.length,
    observationsRetailer,
    probeRows,
    estimateRows,
    byAdapter,
    byZip3,
    byFulfillment,
  };
}

export interface SkuCount {
  retailerSku: string;
  title: string;
  observations: number;
  panelists: number;
}

/** The pilot retailer's SKUs by observation count, ties by panelists then SKU. */
export function topSkus(rows: readonly ExportRow[], retailer: string, top: number): SkuCount[] {
  const groups = new Map<string, ExportRow[]>();
  for (const row of rows) {
    if (row.retailer !== retailer) continue;
    const list = groups.get(row.retailerSku);
    if (list) list.push(row);
    else groups.set(row.retailerSku, [row]);
  }
  return [...groups.entries()]
    .map(([retailerSku, skuRows]) => ({
      retailerSku,
      title: commonTitle(skuRows),
      observations: skuRows.length,
      panelists: new Set(skuRows.map((r) => r.panelistId)).size,
    }))
    .sort(
      (a, b) =>
        b.observations - a.observations ||
        b.panelists - a.panelists ||
        a.retailerSku.localeCompare(b.retailerSku),
    )
    .slice(0, top);
}

/** The title most rows carry; adapters can read the same product slightly differently. */
export function commonTitle(rows: readonly ExportRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.title, (counts.get(row.title) ?? 0) + 1);
  let best = "";
  let bestCount = 0;
  for (const [title, count] of counts) {
    if (count > bestCount || (count === bestCount && title < best)) {
      best = title;
      bestCount = count;
    }
  }
  return best;
}

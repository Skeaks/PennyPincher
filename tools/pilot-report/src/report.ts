/**
 * Orchestration: from export rows (+ flags, + the API) to the numbers a week report or the
 * decision quotes. Pure apart from the API calls; the CLI does the file I/O.
 */
import { activeSuspects } from "api/src/ingest/abuse";
import type { PanelistFlag } from "api/src/repo/observations";
import { type ApiCellsView, type ApiClient, queryCells } from "./api";
import type { PilotConfig, WeekWindow } from "./config";
import { weekWindow } from "./config";
import type { DecisionInputs } from "./decide";
import { type HealthView, fetchHealth } from "./health";
import {
  CELL_THRESHOLD,
  type CellMetrics,
  type CellSummary,
  type PanelMetrics,
  type SkuCount,
  buildCells,
  cellMetrics,
  panelMetrics,
  topSkus,
} from "./metrics";
import { type RetailerProbeRate, pairProbes, probeRates } from "./probe";
import { type ExportRow, inWindow } from "./rows";

export interface FlagCounts {
  suspects: number;
  cleared: number;
}

/** Everything derived from rows alone, over one window. */
export interface PilotSummary {
  window: WeekWindow;
  rows: number;
  panel: PanelMetrics;
  flags: FlagCounts;
  cells: CellSummary[];
  metrics: CellMetrics;
  probes: RetailerProbeRate[];
}

export function summarize(
  config: PilotConfig,
  allRows: readonly ExportRow[],
  flags: readonly PanelistFlag[],
  window: WeekWindow,
): PilotSummary {
  const rows = inWindow(allRows, window);
  const suspects = activeSuspects(flags);
  const cells = buildCells(rows, config.retailer, suspects, window);
  return {
    window,
    rows: rows.length,
    panel: panelMetrics(rows, config.retailer),
    flags: {
      suspects: suspects.size,
      cleared: flags.filter((f) => f.status === "cleared").length,
    },
    cells,
    metrics: cellMetrics(cells),
    probes: probeRates(pairProbes(rows)),
  };
}

/** The four numbers the decision rules read, over the pilot retailer's cells and every retailer's probes. */
export function decisionInputs(summary: PilotSummary): DecisionInputs {
  return {
    resolvedCells: summary.metrics.resolved,
    multiTierCells: summary.metrics.multiTier,
    comparableChecks: summary.probes.reduce((sum, r) => sum + r.comparable, 0),
    differences: summary.probes.reduce((sum, r) => sum + r.more + r.less, 0),
  };
}

export interface WeekReport {
  week: number;
  window: WeekWindow;
  metro: string;
  retailer: string;
  generatedAt: string;
  rows: number;
  panel: PanelMetrics;
  flags: FlagCounts;
  cells: CellMetrics;
  /** Null when the report ran without the API (`--no-api`). */
  apiView: ApiCellsView | null;
  probes: RetailerProbeRate[];
  health: HealthView | null;
  topSkus: SkuCount[];
}

export interface WeekReportOptions {
  config: PilotConfig;
  week: number;
  rows: readonly ExportRow[];
  flags: readonly PanelistFlag[];
  /** Null skips the API sections. */
  api: ApiClient | null;
  now: Date;
  /** How many SKUs the report lists. Default 20. */
  listSkus?: number;
}

export async function buildWeekReport(options: WeekReportOptions): Promise<WeekReport> {
  const window = weekWindow(options.config, options.week);
  const summary = summarize(options.config, options.rows, options.flags, window);
  const rows = inWindow(options.rows, window);
  let apiView: ApiCellsView | null = null;
  let health: HealthView | null = null;
  if (options.api) {
    const keys = summary.cells.filter((c) => c.n >= CELL_THRESHOLD).map((c) => c.cellKey);
    apiView = await queryCells(options.api, keys);
    health = await fetchHealth(options.api);
  }
  return {
    week: options.week,
    window,
    metro: options.config.metro,
    retailer: options.config.retailer,
    generatedAt: options.now.toISOString(),
    rows: summary.rows,
    panel: summary.panel,
    flags: summary.flags,
    cells: summary.metrics,
    apiView,
    probes: summary.probes,
    health,
    topSkus: topSkus(rows, options.config.retailer, options.listSkus ?? 20),
  };
}

/**
 * Adapter health as `GET /v1/adapter-health` reports it (S12): the last seven days, one line
 * per adapter version per date. The report folds the dates so a week reads as one line per
 * adapter version, failures by reason in descending order.
 */
import type { AdapterHealthSummary } from "api/src/routes/adapter-health";
import type { ApiClient } from "./api";

export interface AdapterHealthLine {
  /** `name@version`. */
  adapter: string;
  attempted: number;
  extracted: number;
  /** `extracted / attempted`; null when nothing was attempted. */
  extractionRate: number | null;
  /** Reason -> count, descending by count then reason. */
  failed: Array<[string, number]>;
}

export interface HealthView {
  lines: AdapterHealthLine[];
  /** Why the lines are empty, when they are because of the API rather than the panel. */
  error: string | null;
}

export function summarizeHealth(rows: readonly AdapterHealthSummary[]): AdapterHealthLine[] {
  const byAdapter = new Map<
    string,
    { attempted: number; extracted: number; failed: Map<string, number> }
  >();
  for (const row of rows) {
    const line = byAdapter.get(row.adapter) ?? { attempted: 0, extracted: 0, failed: new Map() };
    line.attempted += row.attempted;
    line.extracted += row.extracted;
    for (const [reason, count] of Object.entries(row.failed)) {
      line.failed.set(reason, (line.failed.get(reason) ?? 0) + count);
    }
    byAdapter.set(row.adapter, line);
  }
  return [...byAdapter.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([adapter, line]) => ({
      adapter,
      attempted: line.attempted,
      extracted: line.extracted,
      extractionRate: line.attempted === 0 ? null : line.extracted / line.attempted,
      failed: [...line.failed.entries()].sort(
        ([ra, ca], [rb, cb]) => cb - ca || ra.localeCompare(rb),
      ),
    }));
}

export async function fetchHealth(api: ApiClient): Promise<HealthView> {
  const result = await api.getJson("/v1/adapter-health");
  if (result.status !== 200 || !Array.isArray(result.body)) {
    return { lines: [], error: `GET /v1/adapter-health answered ${result.status}` };
  }
  const rows = result.body.filter(isSummary);
  return { lines: summarizeHealth(rows), error: null };
}

function isSummary(value: unknown): value is AdapterHealthSummary {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.adapter === "string" &&
    typeof row.attempted === "number" &&
    typeof row.extracted === "number" &&
    typeof row.failed === "object" &&
    row.failed !== null
  );
}

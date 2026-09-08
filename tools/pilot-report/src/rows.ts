/**
 * The D1 export. The API has no listing endpoint (by design: nothing serves observations in
 * bulk), so the week's rows come out of D1 with `wrangler d1 execute --remote --json` and this
 * module turns that output into typed rows. `exportSql` and `wranglerCommand` print the exact
 * command so the export is reproducible; the report never talks to D1 itself.
 *
 * `clean_session` is `json_extract(raw_json, '$.context.cleanSession')`: the probe's anonymous
 * row is `session_state = 'logged_out'` with `cleanSession: true` (S06), and only that pair of
 * facts tells a probe row from a panelist who simply shops logged out.
 */
import type { ObservationRow, PanelistFlag } from "api/src/repo/observations";

/** An exported observation: every flattened column except the raw payload and the hash. */
export type ExportRow = Omit<
  ObservationRow,
  "rawJson" | "evidenceHash" | "canonicalId" | "canonicalCellKey"
> & {
  /** `context.cleanSession`; undefined when the row never carried it. */
  cleanSession: boolean | undefined;
};

/** Column -> row field, in the order the SELECT lists them. */
const COLUMNS: ReadonlyArray<readonly [string, keyof ExportRow]> = [
  ["observation_id", "observationId"],
  ["schema_version", "schemaVersion"],
  ["panelist_id", "panelistId"],
  ["observed_at", "observedAt"],
  ["retailer", "retailer"],
  ["retailer_store_id", "retailerStoreId"],
  ["store_label", "storeLabel"],
  ["retailer_sku", "retailerSku"],
  ["upc", "upc"],
  ["title", "title"],
  ["price_minor", "priceMinor"],
  ["currency", "currency"],
  ["is_estimate", "isEstimate"],
  ["fulfillment", "fulfillment"],
  ["session_state", "sessionState"],
  ["surface", "surface"],
  ["zip3", "zip3"],
  ["device", "device"],
  ["adapter", "adapter"],
  ["client_version", "clientVersion"],
  ["cell_key", "cellKey"],
  ["received_at", "receivedAt"],
];

const NULLABLE = new Set<keyof ExportRow>(["retailerStoreId", "storeLabel", "upc", "zip3"]);
const NUMERIC = new Set<keyof ExportRow>(["priceMinor"]);
const BOOLEAN = new Set<keyof ExportRow>(["isEstimate"]);

export const EXPORT_COLUMNS: readonly string[] = COLUMNS.map(([column]) => column);

/** The SELECT for one window, `[from, to)` on `observed_at`. */
export function exportSql(window: { from: string; to: string }): string {
  const columns = [
    ...EXPORT_COLUMNS,
    "json_extract(raw_json, '$.context.cleanSession') AS clean_session",
  ].join(", ");
  return `SELECT ${columns} FROM observations WHERE observed_at >= '${window.from}' AND observed_at < '${window.to}' ORDER BY observed_at, observation_id`;
}

export function flagsSql(): string {
  return "SELECT panelist_id, status, reason, cell_key, flagged_at, reviewed_at, review_note FROM panelist_flags";
}

/** The command that produces the export, run from `apps/api/` (docs/data-retention.md). */
export function wranglerCommand(sql: string, env = "production"): string {
  const database = env === "production" ? "pennypincher-production" : "pennypincher-staging";
  return `pnpm exec wrangler d1 execute ${database} --env ${env} --remote --json --command "${sql}"`;
}

/**
 * `wrangler d1 execute --json` prints `[{ results: [...], success, meta }]`; one statement, one
 * element. A bare array of row objects, or `{ results }`, is accepted too so a hand-made file
 * (tests, a filtered export) works.
 */
export function unwrapResults(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) {
    if (json.length === 0) return [];
    const first = json[0];
    if (isRecord(first) && Array.isArray(first.results)) {
      return json.flatMap((statement) =>
        isRecord(statement) && Array.isArray(statement.results)
          ? statement.results.filter(isRecord)
          : [],
      );
    }
    return json.filter(isRecord);
  }
  if (isRecord(json) && Array.isArray(json.results)) return json.results.filter(isRecord);
  throw new Error("export is not wrangler --json output, an array of rows, or { results }");
}

export function parseExport(json: unknown): ExportRow[] {
  return unwrapResults(json).map((record, index) => parseRow(record, index));
}

function parseRow(record: Record<string, unknown>, index: number): ExportRow {
  const row: Partial<Record<keyof ExportRow, unknown>> = {};
  for (const [column, field] of COLUMNS) {
    const value = record[column];
    if (value === undefined || value === null) {
      if (NULLABLE.has(field)) {
        row[field] = null;
        continue;
      }
      throw new Error(`row ${index}: ${column} is missing`);
    }
    if (NUMERIC.has(field)) {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new Error(`row ${index}: ${column} must be an integer, got ${String(value)}`);
      }
      row[field] = value;
    } else if (BOOLEAN.has(field)) {
      row[field] = toBoolean(value, `row ${index}: ${column}`);
    } else {
      if (typeof value !== "string") {
        throw new Error(`row ${index}: ${column} must be a string, got ${typeof value}`);
      }
      row[field] = value;
    }
  }
  const clean = record.clean_session;
  row.cleanSession =
    clean === undefined || clean === null
      ? undefined
      : toBoolean(clean, `row ${index}: clean_session`);
  return row as ExportRow;
}

/** SQLite stores booleans as 0 / 1; `json_extract` of a JSON boolean also yields 0 / 1. */
function toBoolean(value: unknown, where: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return value === 1;
  if (value === "0" || value === "1" || value === "true" || value === "false") {
    return value === "1" || value === "true";
  }
  throw new Error(`${where} must be a boolean or 0 / 1, got ${String(value)}`);
}

export function parseFlags(json: unknown): PanelistFlag[] {
  return unwrapResults(json).map((record, index) => {
    const status = record.status;
    if (status !== "suspect" && status !== "cleared") {
      throw new Error(`flag ${index}: status must be suspect or cleared`);
    }
    return {
      panelistId: requireString(record.panelist_id, `flag ${index}: panelist_id`),
      status,
      reason: requireString(record.reason, `flag ${index}: reason`),
      cellKey: requireString(record.cell_key, `flag ${index}: cell_key`),
      flaggedAt: requireString(record.flagged_at, `flag ${index}: flagged_at`),
      reviewedAt: optionalString(record.reviewed_at),
      reviewNote: optionalString(record.review_note),
    };
  });
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== "string") throw new Error(`${where} must be a string`);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rows with `observedAt` in `[from, to)`. The export is already bounded; this re-filters exactly. */
export function inWindow(rows: readonly ExportRow[], window: { from: string; to: string }) {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  return rows.filter((row) => {
    const t = Date.parse(row.observedAt);
    return !Number.isNaN(t) && t >= from && t < to;
  });
}

/** The probe's anonymous row (S06): logged out, from a clean session. */
export function isProbeRow(row: ExportRow): boolean {
  return row.sessionState === "logged_out" && row.cleanSession === true;
}

/** The row shape the API's dedupe (`onePerPanelist`) reads. The two dropped columns are unused there. */
export function toObservationRow(row: ExportRow): ObservationRow {
  const { cleanSession: _clean, ...rest } = row;
  return { ...rest, evidenceHash: "", rawJson: "" };
}
